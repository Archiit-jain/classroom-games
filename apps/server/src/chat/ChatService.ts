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

    // 1. Rate limit (first, so floods cost almost nothing).
    const now = this.now();
    const until = this.cooldownUntil.get(session.id);
    if (until !== undefined && until > now) return fail('CHAT_COOLDOWN', until - now);
    if (!this.deps.limiter.take(session.id, 'chat')) {
      const cooldown = this.deps.config.chat.cooldownMs;
      this.cooldownUntil.set(session.id, now + cooldown);
      return fail('CHAT_COOLDOWN', cooldown);
    }

    // 2. Normalise, 3. let the running game intercept (e.g. drawing-game guesses).
    const decision = this.deps.rooms.interceptChat(
      room,
      session.id,
      this.deps.moderator.normalize(text),
    );
    if (decision.kind === 'BLOCK') return fail(decision.code);
    if (decision.kind === 'CONSUME') return ok({});

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
  }
}
