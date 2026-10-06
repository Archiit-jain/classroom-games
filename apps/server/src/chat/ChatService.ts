import type { Moderator } from '@cg/moderation';
import { fail, ok, type ChatMessage, type ReactionId, type Result } from '@cg/protocol';
import type { ServerConfig } from '../config';
import type { Notifier } from '../notifier';
import type { RoomManager } from '../rooms/RoomManager';
import type { Session } from '../session/SessionManager';
import { newId } from '../util/ids';
import type { RateLimiter } from '../util/RateLimiter';

export interface ChatServiceDeps {
  config: ServerConfig;
  moderator: Moderator;
  rooms: RoomManager;
  notifier: Notifier;
  limiter: RateLimiter;
  now?: () => number;
}

type Empty = Record<never, never>;

/**
 * Room chat. Pipeline (spec §7): rate limit → normalise → game hook →
 * detect/censor → broadcast. Profanity is censored, never punished; only
 * flooding earns a short cooldown.
 */
export class ChatService {
  private readonly cooldownUntil = new Map<string, number>();
  /** Each player's last room message (normalised) — only to refuse an exact repeat. */
  private readonly lastMessage = new Map<string, { key: string; at: number }>();
  private readonly now: () => number;

  constructor(private readonly deps: ChatServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  send(session: Session, rawText: string): Result<Empty> {
    const ctx = this.deps.rooms.context(session);
    if (!ctx) return fail('NOT_IN_ROOM');
    const { room, member } = ctx;

    const text = rawText.replace(/\s+/gu, ' ').trim();
    if (!text) return fail('CHAT_EMPTY');
    if ([...text].length > this.deps.config.chat.maxLength) return fail('INVALID_PAYLOAD');

    // 1. Rate limit (first, so floods cost almost nothing). Game input typed into the
    // chat (e.g. guesses while drawing) has the game's own limit and no cooldown;
    // everything else uses the room-chat limit.
    const now = this.now();
    const inputLimit = this.deps.rooms.chatInputLimit(room, session.id);
    if (inputLimit) {
      const bucket = `chatInput:${room.gameId}`;
      if (!this.deps.limiter.take(session.id, bucket, inputLimit)) {
        return fail('RATE_LIMITED', this.deps.limiter.retryAfterMs(session.id, bucket));
      }
    } else {
      const until = this.cooldownUntil.get(session.id);
      if (until !== undefined && until > now) return fail('CHAT_COOLDOWN', until - now);
      if (!this.deps.limiter.take(session.id, 'chat')) {
        const cooldown = this.deps.config.chat.cooldownMs;
        this.cooldownUntil.set(session.id, now + cooldown);
        return fail('CHAT_COOLDOWN', cooldown);
      }
    }

    // 2. Normalise, 3. let the running game intercept (e.g. drawing-game guesses).
    const normalized = this.deps.moderator.normalize(text);
    const decision = this.deps.rooms.interceptChat(room, session.id, normalized);
    if (decision.kind === 'BLOCK') return fail(decision.code);
    if (decision.kind === 'CONSUME') return ok({});

    // Room chat only: the same message again within the window is spam, not conversation
    // (refused, never punished). Game input such as guesses keeps the game's own rules.
    if (!inputLimit) {
      const key = normalized; // case, accents and spacing don't make it a new message
      const last = this.lastMessage.get(session.id);
      if (last && last.key === key && now - last.at < this.deps.config.chat.repeatWindowMs) {
        return fail('CHAT_REPEATED');
      }
      this.lastMessage.set(session.id, { key, at: now });
    }

    // 4. Detect + censor, 5. broadcast.
    const { display } = this.deps.moderator.moderate(text);
    const message: ChatMessage = {
      id: newId('c'),
      fromId: member.id,
      fromName: member.nickname,
      isBot: false,
      text: display,
      sentAt: now,
      channel: decision.kind === 'RESTRICT' ? decision.channel : 'ROOM',
    };

    let recipients: string[];
    if (decision.kind === 'RESTRICT') {
      recipients = [
        ...new Set([member.id, ...this.deps.rooms.playersInAudience(room, decision.audience)]),
      ];
    } else {
      recipients = this.deps.rooms.humanIds(room);
      room.chat.push(message);
      if (room.chat.length > this.deps.config.chat.bufferSize) room.chat.shift();
    }
    this.deps.notifier.chatMessage(recipients, message);
    return ok({});
  }

  /**
   * A bot's chat message — only games whose bots play through chat use this (a
   * drawing-game guess, spec §12). It takes the same path as a human's message: the
   * game's interceptor first, then moderation and the broadcast, marked as a bot.
   */
  sendFromBot(matchId: string, seat: number, rawText: string): void {
    const found = this.deps.rooms.roomOfMatch(matchId);
    const seatState = found?.match.seats[seat];
    if (!found || !seatState) return;
    const text = rawText.replace(/\s+/gu, ' ').trim();
    if (!text || [...text].length > this.deps.config.chat.maxLength) return;

    const decision = this.deps.rooms.interceptChatForSeat(
      found.room,
      seat,
      this.deps.moderator.normalize(text),
    );
    if (decision.kind === 'BLOCK' || decision.kind === 'CONSUME') return;

    const { display } = this.deps.moderator.moderate(text);
    const takeover = seatState.takeover;
    const message: ChatMessage = {
      id: newId('c'),
      fromId: takeover ? takeover.botId : seatState.memberId,
      fromName: takeover ? takeover.botName : seatState.displayName,
      isBot: true,
      text: display,
      sentAt: this.now(),
      channel: decision.kind === 'RESTRICT' ? decision.channel : 'ROOM',
    };
    let recipients: string[];
    if (decision.kind === 'RESTRICT') {
      recipients = this.deps.rooms.playersInAudience(found.room, decision.audience);
    } else {
      recipients = this.deps.rooms.humanIds(found.room);
      found.room.chat.push(message);
      if (found.room.chat.length > this.deps.config.chat.bufferSize) found.room.chat.shift();
    }
    this.deps.notifier.chatMessage(recipients, message);
  }

  /**
   * Quick reaction (spec §8): a fixed emote shown over the sender's seat for
   * everyone in the room. Only while a match is running; the transport applies
   * the 1-per-1.5 s limit. Players only — bots never react.
   */
  react(session: Session, reactionId: ReactionId): Result<Empty> {
    const ctx = this.deps.rooms.context(session);
    if (!ctx) return fail('NOT_IN_ROOM');
    const seat = this.deps.rooms.seatOfPlayer(ctx.room, session.id);
    if (seat === undefined) return fail('INVALID_PHASE');
    this.deps.notifier.reaction(this.deps.rooms.humanIds(ctx.room), {
      fromId: session.id,
      seat,
      reactionId,
      sentAt: this.now(),
    });
    return ok({});
  }

  sweep(): void {
    const now = this.now();
    for (const [id, until] of this.cooldownUntil) if (until <= now) this.cooldownUntil.delete(id);
    const window = this.deps.config.chat.repeatWindowMs;
    for (const [id, last] of this.lastMessage)
      if (now - last.at >= window) this.lastMessage.delete(id);
  }
}
