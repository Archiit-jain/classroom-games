import type { Audience, ChatDecision, ChatInputLimit, RuntimeRequest } from '@cg/game-sdk';
import { isInAudience } from '@cg/game-sdk';
import type { Moderator } from '@cg/moderation';
import {
  fail,
  isValidRoomCode,
  normalizeRoomCode,
  ok,
  type GameResults,
  type MatchUpdate,
  type Result,
  type RoomView,
  type TakeoverReason,
} from '@cg/protocol';
import type { BotManager } from '../bots/BotManager';
import type { ServerConfig } from '../config';
import type { Logger } from '../log';
import type { Notifier } from '../notifier';
import { GameRuntime, type RuntimeSnapshot } from '../runtime/GameRuntime';
import type { GameRegistry } from '../runtime/GameRegistry';
import type { Session, SessionManager } from '../session/SessionManager';
import { newId, randomSeed } from '../util/ids';
import type { TimerService } from '../util/TimerService';
import { generateRoomCode, nextBotName } from './naming';
import { policyFor } from './policies';
import type { RoomStore } from './RoomStore';
import type { ActiveMatch, HumanMember, Member, Room, RoomSnapshot, SeatState } from './types';

export interface RoomManagerDeps {
  config: ServerConfig;
  store: RoomStore;
  registry: GameRegistry;
  sessions: SessionManager;
  moderator: Moderator;
  timers: TimerService;
  bots: BotManager;
  notifier: Notifier;
  log: Logger;
  now?: () => number;
}

type Empty = Record<never, never>;
const EMPTY: Empty = {};

type RemovalReason = 'LEFT' | 'KICKED' | 'GRACE_EXPIRED';

/**
 * Owns every room: membership, host, lifecycle (LOBBY → STARTING → IN_GAME →
 * RESULTS), reconnect grace, bot takeover/reclaim and the link between a
 * room and its running match. All methods are synchronous; Node's single
 * thread makes each one atomic.
 */
export class RoomManager {
  private readonly now: () => number;

  constructor(private readonly deps: RoomManagerDeps) {
    this.now = deps.now ?? Date.now;
  }

  // ───────────────────────────── queries ─────────────────────────────

  get roomCount(): number {
    return this.deps.store.count();
  }

  getRoom(id: string): Room | undefined {
    return this.deps.store.get(id);
  }

  /** The room and membership record of a session, if it is in a room. */
  context(session: Session): { room: Room; member: HumanMember } | null {
    if (!session.roomId) return null;
    const room = this.deps.store.get(session.roomId);
    const member = room ? findHuman(room, session.id) : undefined;
    return room && member ? { room, member } : null;
  }

  view(room: Room): RoomView {
    const game = this.deps.registry.get(room.gameId);
    return {
      id: room.id,
      kind: room.kind,
      code: room.code,
      gameId: room.gameId,
      settings: room.settings,
      phase: room.phase,
      hostId: room.hostId,
      startsAt: room.startsAt,
      capacity: game?.manifest.players.max ?? 0,
      minPlayers: game?.manifest.players.min ?? 0,
      members: room.members.map((m) =>
        m.kind === 'HUMAN'
          ? {
              kind: 'HUMAN',
              id: m.id,
              nickname: m.nickname,
              status: m.connected ? 'CONNECTED' : 'AWAY',
            }
          : { kind: 'BOT', id: m.id, name: m.name },
      ),
      match: room.match
        ? {
            matchId: room.match.matchId,
            gameId: room.match.gameId,
            results: room.match.results,
            seats: room.match.seats.map((s) => ({
              seat: s.seat,
              memberId: s.memberId,
              memberKind: s.memberKind,
              displayName: s.displayName,
              controller: s.memberKind === 'BOT' || s.takeover ? 'BOT' : 'HUMAN',
              takeover: s.takeover
                ? { reason: s.takeover.reason, botName: s.takeover.botName }
                : null,
            })),
          }
        : null,
    };
  }

  /** Player ids of the humans (currently in the room) covered by a game audience. */
  playersInAudience(room: Room, audience: Audience): string[] {
    const seats = room.match?.seats ?? [];
    return seats
      .filter((s) => s.memberKind === 'HUMAN' && !s.forfeited && isInAudience(audience, s.seat))
      .map((s) => s.memberId)
      .filter((id) => findHuman(room, id));
  }

  /** The seat a human plays in the room's running match, if any. */
  seatOfPlayer(room: Room, playerId: string): number | undefined {
    return room.phase === 'IN_GAME' ? seatOf(room.match, playerId)?.seat : undefined;
  }

  humanIds(room: Room): string[] {
    return room.members.filter((m): m is HumanMember => m.kind === 'HUMAN').map((m) => m.id);
  }

  // ───────────────────────────── commands ─────────────────────────────

  create(session: Session, gameId: string): Result<{ room: RoomView }> {
    if (!session.nickname || !session.nicknameKey) return fail('NICKNAME_REQUIRED');
    if (session.roomId) return fail('ALREADY_IN_ROOM');
    const game = this.deps.registry.get(gameId);
    if (!game) return fail('GAME_NOT_FOUND');
    if (this.deps.store.count() >= this.deps.config.limits.maxRooms) return fail('SERVER_BUSY');

    const now = this.now();
    const room: Room = {
      id: newId('r'),
      kind: 'PRIVATE',
      code: generateRoomCode((c) => this.deps.store.hasCode(c)),
      gameId,
      settings: game.defaultSettings,
      phase: 'LOBBY',
      hostId: session.id,
      members: [humanMember(session, now)],
      barred: new Set(),
      match: null,
      startsAt: null,
      createdAt: now,
      noHumansSince: null,
      chat: [],
    };
    this.deps.store.add(room);
    session.roomId = room.id;
    this.deps.log.info('room created', { roomId: room.id, gameId });
    this.broadcast(room);
    return ok({ room: this.view(room) });
  }

  join(session: Session, rawCode: string): Result<{ room: RoomView }> {
    if (!session.nickname || !session.nicknameKey) return fail('NICKNAME_REQUIRED');
    const code = normalizeRoomCode(rawCode);
    const room = isValidRoomCode(code) ? this.deps.store.getByCode(code) : undefined;
    if (!room || room.kind !== 'PRIVATE') return fail('ROOM_NOT_FOUND');
    if (session.roomId === room.id) return ok({ room: this.view(room) });
    if (session.roomId) return fail('ALREADY_IN_ROOM');
    if (room.barred.has(session.id)) return fail('REMOVED_FROM_ROOM');
    if (!policyFor(room).isJoinable(room)) return fail('ROOM_IN_PROGRESS');
    const game = this.deps.registry.get(room.gameId);
    if (!game || room.members.length >= game.manifest.players.max) return fail('ROOM_FULL');
    const key = session.nicknameKey;
    const clash = room.members.some((m) =>
      m.kind === 'HUMAN' ? m.nicknameKey === key : this.deps.moderator.nicknameKey(m.name) === key,
    );
    if (clash) return fail('NICKNAME_TAKEN');

    room.members.push(humanMember(session, this.now()));
    session.roomId = room.id;
    this.broadcast(room);
    this.deps.notifier.chatHistory(session.id, room.chat);
    return ok({ room: this.view(room) });
  }

  leave(session: Session): Result<Empty> {
    const ctx = this.context(session);
    if (!ctx) return fail('NOT_IN_ROOM');
    this.removeHuman(ctx.room, session.id, 'LEFT');
    return ok(EMPTY);
  }

  setGame(session: Session, gameId: string): Result<Empty> {
    const ctx = this.manageable(session, 'LOBBY');
    if (!ctx.ok) return ctx;
    const { room } = ctx.value;
    const game = this.deps.registry.get(gameId);
    if (!game) return fail('GAME_NOT_FOUND');
    if (room.members.length > game.manifest.players.max) return fail('TOO_MANY_PLAYERS_FOR_GAME');
    if (!game.manifest.bots.supported && room.members.some((m) => m.kind === 'BOT')) {
      return fail('BOTS_NOT_SUPPORTED');
    }
    room.gameId = gameId;
    room.settings = game.defaultSettings;
    this.broadcast(room);
    return ok(EMPTY);
  }

  updateSettings(session: Session, settings: unknown): Result<Empty> {
    const ctx = this.manageable(session, 'LOBBY');
    if (!ctx.ok) return ctx;
    const { room } = ctx.value;
    const game = this.deps.registry.get(room.gameId);
    const parsed = game?.settingsSchema.safeParse(settings);
    if (!parsed?.success) return fail('INVALID_SETTINGS');
    room.settings = parsed.data;
    this.broadcast(room);
    return ok(EMPTY);
  }

  addBot(session: Session): Result<Empty> {
    const ctx = this.manageable(session, 'LOBBY');
    if (!ctx.ok) return ctx;
    const { room } = ctx.value;
    const game = this.deps.registry.get(room.gameId);
    if (!game?.manifest.bots.supported) return fail('BOTS_NOT_SUPPORTED');
    if (room.members.length >= game.manifest.players.max) return fail('ROOM_FULL');
    room.members.push({
      kind: 'BOT',
      id: newId('b'),
      name: nextBotName(room),
      joinedAt: this.now(),
    });
    this.broadcast(room);
    return ok(EMPTY);
  }

  removeBot(session: Session, botId: string): Result<Empty> {
    const ctx = this.manageable(session, 'LOBBY');
    if (!ctx.ok) return ctx;
    const { room } = ctx.value;
    const index = room.members.findIndex((m) => m.kind === 'BOT' && m.id === botId);
    if (index < 0) return fail('BOT_NOT_FOUND');
    room.members.splice(index, 1);
    this.broadcast(room);
    return ok(EMPTY);
  }

  kick(session: Session, targetId: string): Result<Empty> {
    const ctx = this.manageable(session, null);
    if (!ctx.ok) return ctx;
    const { room } = ctx.value;
    if (targetId === session.id) return fail('CANNOT_TARGET_SELF');
    if (!findHuman(room, targetId)) return fail('PLAYER_NOT_FOUND');
    room.barred.add(targetId);
    this.deps.notifier.roomEvent(targetId, { type: 'KICKED' });
    this.removeHuman(room, targetId, 'KICKED');
    return ok(EMPTY);
  }

  start(session: Session): Result<Empty> {
    const ctx = this.manageable(session, 'LOBBY');
    if (!ctx.ok) return ctx;
    const { room } = ctx.value;
    const game = this.deps.registry.get(room.gameId);
    if (!game) return fail('GAME_NOT_FOUND');
    if (room.members.length < game.manifest.players.min) return fail('NOT_ENOUGH_PLAYERS');
    if (room.members.length > game.manifest.players.max) return fail('TOO_MANY_PLAYERS_FOR_GAME');

    const countdown = this.deps.config.timing.startingCountdownMs;
    room.phase = 'STARTING';
    room.startsAt = this.now() + countdown;
    this.deps.timers.set(`room:${room.id}:start`, countdown, () => this.beginMatch(room.id));
    this.broadcast(room);
    return ok(EMPTY);
  }

  playAgain(session: Session): Result<Empty> {
    const ctx = this.manageable(session, 'RESULTS');
    if (!ctx.ok) return ctx;
    this.resetToLobby(ctx.value.room);
    return this.start(session);
  }

  backToLobby(session: Session): Result<Empty> {
    const ctx = this.manageable(session, 'RESULTS');
    if (!ctx.ok) return ctx;
    this.resetToLobby(ctx.value.room);
    this.broadcast(ctx.value.room);
    return ok(EMPTY);
  }

  reclaimSeat(session: Session): Result<Empty> {
    const ctx = this.context(session);
    if (!ctx) return fail('NOT_IN_ROOM');
    const { room } = ctx;
    const seat = room.phase === 'IN_GAME' ? seatOf(room.match, session.id) : undefined;
    if (!seat || !seat.takeover || seat.forfeited) return fail('SEAT_NOT_RECLAIMABLE');
    this.reclaim(room, seat);
    return ok(EMPTY);
  }

  submitAction(
    session: Session,
    matchId: string,
    version: number,
    actionId: string,
    action: unknown,
  ): Result<{ version: number }> {
    const ctx = this.context(session);
    if (!ctx) return fail('NOT_IN_ROOM');
    const match = ctx.room.match;
    if (!match || match.matchId !== matchId || ctx.room.phase !== 'IN_GAME')
      return fail('MATCH_NOT_FOUND');
    const seat = seatOf(match, session.id);
    if (!seat) return fail('MATCH_NOT_FOUND');
    if (seat.takeover) return fail('SEAT_CONTROLLED_BY_BOT');
    return match.runtime.submitAction(seat.seat, version, actionId, action);
  }

  /** A chunk of streamed game data (e.g. drawing strokes) from the player in a seat. */
  submitStream(session: Session, matchId: string, chunk: unknown): Result<Empty> {
    const ctx = this.context(session);
    if (!ctx) return fail('NOT_IN_ROOM');
    const match = ctx.room.match;
    if (!match || match.matchId !== matchId || ctx.room.phase !== 'IN_GAME')
      return fail('MATCH_NOT_FOUND');
    const seat = seatOf(match, session.id);
    if (!seat) return fail('MATCH_NOT_FOUND');
    if (seat.takeover) return fail('SEAT_CONTROLLED_BY_BOT');
    return match.runtime.acceptStream(seat.seat, chunk);
  }

  resync(session: Session, matchId: string): Result<{ update: MatchUpdate }> {
    const ctx = this.context(session);
    const match = ctx?.room.match;
    if (!ctx || !match || match.matchId !== matchId || !match.runtime.isStarted)
      return fail('MATCH_NOT_FOUND');
    const seat = seatOf(match, session.id);
    if (!seat) return fail('MATCH_NOT_FOUND');
    this.sendStreamReplay(session.id, match, seat.seat);
    return ok({ update: match.runtime.viewFor(seat.seat) });
  }

  /** Sends a player everything streamed so far (STREAMED games), replacing what they had. */
  private sendStreamReplay(playerId: string, match: ActiveMatch, seat: number): void {
    const chunks = match.runtime.streamReplay(seat);
    if (chunks)
      this.deps.notifier.matchStream([playerId], { matchId: match.matchId, chunks, reset: true });
  }

  /** The room running a match (bots act by match id). */
  roomOfMatch(matchId: string): { room: Room; match: ActiveMatch } | null {
    for (const room of this.deps.store.all()) {
      if (room.match?.matchId === matchId && room.phase === 'IN_GAME')
        return { room, match: room.match };
    }
    return null;
  }

  /** Offers a bot's chat message (e.g. a drawing-game guess) to the game's interceptor. */
  interceptChatForSeat(room: Room, seat: number, normalized: string): ChatDecision {
    const match = room.match;
    if (room.phase !== 'IN_GAME' || !match) return { kind: 'PASS' };
    return match.runtime.interceptChat(seat, normalized) ?? { kind: 'PASS' };
  }

  /** The running game's own rate limit when this player's next message is game input. */
  chatInputLimit(room: Room, playerId: string): ChatInputLimit | null {
    const match = room.match;
    if (room.phase !== 'IN_GAME' || !match) return null;
    const seat = seatOf(match, playerId);
    if (!seat) return null;
    return match.runtime.chatInputLimit(seat.seat);
  }

  /** Offers a chat message to the running game's interceptor (if any). */
  interceptChat(room: Room, playerId: string, normalized: string): ChatDecision {
    const match = room.match;
    if (room.phase !== 'IN_GAME' || !match) return { kind: 'PASS' };
    const seat = seatOf(match, playerId);
    if (!seat) return { kind: 'PASS' };
    return match.runtime.interceptChat(seat.seat, normalized) ?? { kind: 'PASS' };
  }

  // ─────────────────────── connection lifecycle ───────────────────────

  /**
   * A session's socket (re)connected. Restores its seat and resends its state.
   * Always sends a room snapshot — `null` when the player is not in a room — so a
   * client never keeps showing a room it was removed from while offline.
   */
  onConnected(session: Session): void {
    if (!session.roomId) {
      this.deps.notifier.roomSnapshot([session.id], null);
      return;
    }
    const room = this.deps.store.get(session.roomId);
    const member = room ? findHuman(room, session.id) : undefined;
    if (!room || !member) {
      session.roomId = null;
      this.deps.notifier.roomSnapshot([session.id], null);
      return;
    }
    member.connected = true;
    member.graceUntil = null;
    room.noHumansSince = null;
    this.deps.timers.clear(graceKey(room.id, member.id));

    const seat = room.phase === 'IN_GAME' ? seatOf(room.match, member.id) : undefined;
    if (seat && room.match) {
      if (seat.takeover?.reason === 'DISCONNECTED') this.reclaim(room, seat);
      else if (!seat.takeover) room.match.runtime.seatChanged(seat.seat, 'RECONNECTED');
    }
    this.broadcast(room);
    this.deps.notifier.chatHistory(member.id, room.chat);
    if (seat && room.match?.runtime.isStarted) {
      this.deps.notifier.matchUpdate(member.id, room.match.runtime.viewFor(seat.seat));
      this.sendStreamReplay(member.id, room.match, seat.seat);
    }
  }

  /** A session's active socket is gone. Starts the reconnect grace period. */
  onDisconnected(session: Session): void {
    const ctx = this.context(session);
    if (!ctx) return;
    const { room, member } = ctx;
    member.connected = false;
    this.startGrace(room, member);
    const seat = room.phase === 'IN_GAME' ? seatOf(room.match, member.id) : undefined;
    if (seat && !seat.takeover && room.match)
      room.match.runtime.seatChanged(seat.seat, 'DISCONNECTED');
    if (!room.members.some((m) => m.kind === 'HUMAN' && m.connected))
      room.noHumansSince = this.now();
    this.broadcast(room);
  }

  /** Closes rooms that have had no connected humans for too long. */
  sweep(): void {
    const now = this.now();
    for (const room of this.deps.store.all()) {
      const anyConnected = room.members.some((m) => m.kind === 'HUMAN' && m.connected);
      if (anyConnected) {
        room.noHumansSince = null;
      } else {
        room.noHumansSince ??= now;
        if (now - room.noHumansSince >= this.deps.config.timing.roomIdleCloseMs)
          this.closeRoom(room);
      }
    }
  }

  /**
   * Stops every match and timer here. With `endRooms` the rooms are closed for good
   * (server shutdown); without, they are only let go — their state stays in the shared
   * store and the next host instance continues them.
   */
  dispose(endRooms = true): void {
    for (const room of this.deps.store.all()) {
      if (endRooms) {
        this.closeRoom(room, false);
        continue;
      }
      if (room.match) {
        this.deps.bots.detachMatch(room.match.matchId);
        room.match.runtime.stop();
      }
    }
  }

  // ───────────────────────────── internals ─────────────────────────────

  private manageable(
    session: Session,
    phase: Room['phase'] | null,
  ): Result<{ room: Room; member: HumanMember }> {
    const ctx = this.context(session);
    if (!ctx) return fail('NOT_IN_ROOM');
    if (!policyFor(ctx.room).canManage(ctx.room, session.id)) return fail('NOT_HOST');
    if (phase && ctx.room.phase !== phase) return fail('INVALID_PHASE');
    return ok(ctx);
  }

  private broadcast(room: Room): void {
    this.deps.notifier.roomSnapshot(this.humanIds(room), this.view(room));
  }

  private resetToLobby(room: Room): void {
    room.match = null;
    room.phase = 'LOBBY';
    room.startsAt = null;
  }

  private beginMatch(roomId: string): void {
    const room = this.deps.store.get(roomId);
    if (!room || room.phase !== 'STARTING') return;
    const game = this.deps.registry.get(room.gameId);
    if (!game || room.members.length < game.manifest.players.min) {
      this.resetToLobby(room);
      this.broadcast(room);
      return;
    }

    const matchId = newId('m');
    const seats: SeatState[] = room.members.map((m, seat) => ({
      seat,
      memberId: m.id,
      memberKind: m.kind,
      displayName: m.kind === 'HUMAN' ? m.nickname : m.name,
      takeover: null,
      forfeited: false,
    }));
    const runtime = this.createRuntime(roomId, matchId, room.settings, seats.length);
    room.match = {
      matchId,
      gameId: room.gameId,
      runtime,
      seats,
      results: null,
      pendingReclaims: new Set(),
    };
    room.phase = 'IN_GAME';
    room.startsAt = null;

    for (const s of seats)
      if (s.memberKind === 'BOT') this.deps.bots.attach(runtime, s.seat, false);
    this.deps.log.info('match started', {
      roomId,
      matchId,
      gameId: room.gameId,
      seats: seats.length,
    });
    this.broadcast(room);
    runtime.start({ bots: seats.filter((s) => s.memberKind === 'BOT').map((s) => s.seat) });

    // Humans who were already away when the match began get a bot once their grace ends.
    for (const s of seats) {
      const member = s.memberKind === 'HUMAN' ? findHuman(room, s.memberId) : undefined;
      if (member && !member.connected) runtime.seatChanged(s.seat, 'DISCONNECTED');
    }
  }

  private createRuntime(
    roomId: string,
    matchId: string,
    settings: unknown,
    seatCount: number,
    restore?: RuntimeSnapshot,
  ): GameRuntime {
    const gameId = restore?.gameId ?? this.deps.store.get(roomId)?.gameId ?? '';
    const game = this.deps.registry.get(gameId);
    if (!game) throw new Error(`Unknown game ${gameId}`);
    return new GameRuntime({
      matchId,
      game,
      settings,
      seatCount,
      seed: randomSeed(),
      ...(restore ? { restore } : {}),
      timers: this.deps.timers,
      log: this.deps.log,
      now: this.now,
      hooks: {
        deliver: (seat, update) => this.deliver(roomId, matchId, seat, update),
        onRequest: (request) => this.handleRequest(roomId, matchId, request),
        onOver: (results) => this.finishMatch(roomId, matchId, results),
        afterTransition: () => this.processPendingReclaims(roomId, matchId),
        onCrash: () => this.abortMatch(roomId, matchId),
        deliverStream: (audience, chunks) => this.deliverStream(roomId, matchId, audience, chunks),
      },
    });
  }

  private startGrace(
    room: Room,
    member: HumanMember,
    ms = this.deps.config.timing.reconnectGraceMs,
  ): void {
    member.graceUntil = this.now() + ms;
    this.deps.timers.set(graceKey(room.id, member.id), ms, () =>
      this.graceExpired(room.id, member.id),
    );
  }

  // ─────────────────────── snapshots (multi-instance) ───────────────────────

  /** The room as plain JSON for the shared store (ADR-023). */
  snapshot(room: Room): RoomSnapshot {
    const { barred, match, ...rest } = room;
    return structuredClone({
      ...rest,
      barred: [...barred],
      match: match
        ? {
            matchId: match.matchId,
            gameId: match.gameId,
            seats: match.seats,
            results: match.results,
            pendingReclaims: [...match.pendingReclaims],
            runtime: match.runtime.snapshot(),
          }
        : null,
    });
  }

  /**
   * Continues a snapshotted room on this instance: rebuilds its match runtime,
   * re-arms every timer from its stored deadline (overdue ones fire at once) and
   * puts the bots back in their seats. Call `resendState` once all rooms are back.
   */
  restore(snapshot: RoomSnapshot): Room {
    const { barred, match, ...rest } = structuredClone(snapshot);
    const room: Room = { ...rest, barred: new Set(barred), match: null };
    this.deps.store.add(room);
    if (match) {
      const runtime = this.createRuntime(
        room.id,
        match.matchId,
        match.runtime.settings,
        match.runtime.seatCount,
        match.runtime,
      );
      room.match = {
        matchId: match.matchId,
        gameId: match.gameId,
        seats: match.seats,
        results: match.results,
        pendingReclaims: new Set(match.pendingReclaims),
        runtime,
      };
      if (room.phase === 'IN_GAME' && runtime.isStarted && !runtime.isOver) {
        for (const seat of match.seats) {
          if (seat.memberKind === 'BOT' || seat.takeover) {
            this.deps.bots.attach(runtime, seat.seat, true);
          }
        }
        runtime.resumeTimers();
      }
    }
    if (room.phase === 'STARTING' && room.startsAt !== null) {
      this.deps.timers.set(`room:${room.id}:start`, Math.max(0, room.startsAt - this.now()), () =>
        this.beginMatch(room.id),
      );
    }
    for (const m of room.members) {
      if (m.kind === 'HUMAN' && !m.connected && m.graceUntil !== null) {
        this.startGrace(room, m, Math.max(0, m.graceUntil - this.now()));
      }
    }
    return room;
  }

  /** Sends every connected player the room's current authoritative state (after a restore). */
  resendState(room: Room): void {
    if (!this.deps.store.get(room.id)) return;
    this.broadcast(room);
    const match = room.match;
    for (const m of room.members) {
      if (m.kind !== 'HUMAN' || !m.connected) continue;
      const seat = room.phase === 'IN_GAME' ? seatOf(match, m.id) : undefined;
      if (seat && match?.runtime.isStarted) {
        this.deps.notifier.matchUpdate(m.id, match.runtime.viewFor(seat.seat));
        this.sendStreamReplay(m.id, match, seat.seat);
      }
    }
  }

  private activeMatch(roomId: string, matchId: string): { room: Room; match: ActiveMatch } | null {
    const room = this.deps.store.get(roomId);
    const match = room?.match;
    return room && match && match.matchId === matchId ? { room, match } : null;
  }

  private deliver(roomId: string, matchId: string, seat: number, update: MatchUpdate): void {
    const found = this.activeMatch(roomId, matchId);
    const s = found?.match.seats[seat];
    if (!found || !s) return;
    if (s.memberKind === 'HUMAN' && !s.forfeited) {
      const member = findHuman(found.room, s.memberId);
      // Humans keep watching while a bot plays for them (so they can take the seat back).
      if (member?.connected) this.deps.notifier.matchUpdate(member.id, update);
    }
    if (s.memberKind === 'BOT' || s.takeover) this.deps.bots.onUpdate(matchId, seat, update);
  }

  /** Relays stream chunks to the connected humans in the audience (bots don't need them). */
  private deliverStream(
    roomId: string,
    matchId: string,
    audience: Audience,
    chunks: unknown[],
  ): void {
    const found = this.activeMatch(roomId, matchId);
    if (!found) return;
    const ids = this.playersInAudience(found.room, audience).filter(
      (id) => findHuman(found.room, id)?.connected,
    );
    if (ids.length > 0) this.deps.notifier.matchStream(ids, { matchId, chunks, reset: false });
  }

  private handleRequest(roomId: string, matchId: string, request: RuntimeRequest): void {
    const found = this.activeMatch(roomId, matchId);
    if (!found || request.type !== 'MARK_IDLE') return;
    const seat = found.match.seats[request.seat];
    if (!seat || seat.memberKind !== 'HUMAN' || seat.takeover || seat.forfeited) return;
    if (this.takeOver(found.room, found.match, seat, 'IDLE')) {
      this.deps.notifier.roomEvent(seat.memberId, { type: 'SEAT_TAKEN_OVER', reason: 'IDLE' });
      this.broadcast(found.room);
    }
  }

  /** Puts a bot in a human's seat. Returns false when the game does not allow it. */
  private takeOver(
    room: Room,
    match: ActiveMatch,
    seat: SeatState,
    reason: TakeoverReason,
  ): boolean {
    if (!match.runtime.game.manifest.bots.canTakeOverSeat) return false;
    seat.takeover = { botId: newId('b'), botName: nextBotName(room), reason };
    this.deps.bots.attach(match.runtime, seat.seat, true);
    match.runtime.seatChanged(seat.seat, 'BOT_TOOK_OVER');
    return true;
  }

  private reclaim(room: Room, seat: SeatState): void {
    const match = room.match;
    if (!match || !seat.takeover || seat.forfeited) return;
    if (!match.runtime.canReclaim(seat.seat)) {
      match.pendingReclaims.add(seat.seat);
      return;
    }
    match.pendingReclaims.delete(seat.seat);
    seat.takeover = null;
    this.deps.bots.detach(match.matchId, seat.seat);
    match.runtime.seatChanged(seat.seat, 'RECLAIMED');
    this.deps.notifier.roomEvent(seat.memberId, { type: 'SEAT_RECLAIMED' });
    this.broadcast(room);
    const member = findHuman(room, seat.memberId);
    if (member?.connected) {
      this.deps.notifier.matchUpdate(member.id, match.runtime.viewFor(seat.seat));
      this.sendStreamReplay(member.id, match, seat.seat);
    }
  }

  private processPendingReclaims(roomId: string, matchId: string): void {
    const found = this.activeMatch(roomId, matchId);
    if (!found || found.match.pendingReclaims.size === 0) return;
    for (const seatIndex of [...found.match.pendingReclaims]) {
      const seat = found.match.seats[seatIndex];
      const member = seat ? findHuman(found.room, seat.memberId) : undefined;
      if (!seat || !member?.connected) {
        found.match.pendingReclaims.delete(seatIndex);
        continue;
      }
      if (found.match.runtime.canReclaim(seatIndex)) this.reclaim(found.room, seat);
    }
  }

  private finishMatch(roomId: string, matchId: string, results: GameResults): void {
    const found = this.activeMatch(roomId, matchId);
    if (!found) return;
    const { room, match } = found;
    match.results = results;
    match.pendingReclaims.clear();
    this.deps.bots.detachMatch(matchId);
    match.runtime.stop();
    room.phase = 'RESULTS';
    this.deps.log.info('match finished', { roomId, matchId });
    this.deps.notifier.matchEnd(this.humanIds(room), { matchId, results });
    // Players still away get a fresh grace period to come back to the results/lobby.
    for (const m of room.members) {
      if (m.kind === 'HUMAN' && !m.connected && !this.deps.timers.has(graceKey(room.id, m.id))) {
        this.startGrace(room, m);
      }
    }
    this.broadcast(room);
  }

  private abortMatch(roomId: string, matchId: string): void {
    const found = this.activeMatch(roomId, matchId);
    if (!found) return;
    this.deps.bots.detachMatch(matchId);
    found.match.runtime.stop();
    this.resetToLobby(found.room);
    for (const id of this.humanIds(found.room))
      this.deps.notifier.roomEvent(id, { type: 'MATCH_ABORTED' });
    this.broadcast(found.room);
  }

  private graceExpired(roomId: string, playerId: string): void {
    const room = this.deps.store.get(roomId);
    const member = room ? findHuman(room, playerId) : undefined;
    if (!room || !member || member.connected) return;
    member.graceUntil = null;

    const match = room.match;
    const seat = room.phase === 'IN_GAME' ? seatOf(match, playerId) : undefined;
    if (!match || !seat) {
      this.removeHuman(room, playerId, 'GRACE_EXPIRED');
      return;
    }
    // In a match the player keeps their membership (so they can still come back);
    // a bot plays for them in the meantime.
    if (!seat.takeover && !seat.forfeited) this.takeOver(room, match, seat, 'DISCONNECTED');
    if (room.hostId === playerId) this.transferHost(room);
    if (this.onlyBotsRemain(room)) {
      this.closeRoom(room);
      return;
    }
    this.broadcast(room);
  }

  private removeHuman(room: Room, playerId: string, reason: RemovalReason): void {
    this.deps.timers.clear(graceKey(room.id, playerId));
    const match = room.match;
    const seat = room.phase === 'IN_GAME' ? seatOf(match, playerId) : undefined;
    if (match && seat && !seat.forfeited) {
      seat.forfeited = true;
      match.pendingReclaims.delete(seat.seat);
      if (!seat.takeover) this.takeOver(room, match, seat, 'LEFT');
      else seat.takeover.reason = 'LEFT';
      match.runtime.seatChanged(seat.seat, 'LEFT');
    }

    room.members = room.members.filter((m) => m.id !== playerId);
    const session = this.deps.sessions.get(playerId);
    if (session?.roomId === room.id) session.roomId = null;
    this.deps.notifier.roomSnapshot([playerId], null);
    this.deps.log.info('player removed from room', { roomId: room.id, reason });

    if (!room.members.some((m) => m.kind === 'HUMAN')) {
      this.closeRoom(room);
      return;
    }
    if (room.hostId === playerId) this.transferHost(room);
    if (room.phase === 'IN_GAME' && this.onlyBotsRemain(room)) {
      this.closeRoom(room);
      return;
    }
    if (room.phase === 'STARTING') {
      const game = this.deps.registry.get(room.gameId);
      if (!game || room.members.length < game.manifest.players.min) {
        this.deps.timers.clear(`room:${room.id}:start`);
        this.resetToLobby(room);
      }
    }
    this.broadcast(room);
  }

  /** Host passes to the earliest-joined connected human (else any human). Bots are never host. */
  private transferHost(room: Room): void {
    const humans = room.members.filter(
      (m): m is HumanMember => m.kind === 'HUMAN' && m.id !== room.hostId,
    );
    const next =
      humans.filter((m) => m.connected).sort((a, b) => a.joinedAt - b.joinedAt)[0] ?? humans[0];
    if (!next) return;
    room.hostId = next.id;
    for (const id of this.humanIds(room))
      this.deps.notifier.roomEvent(id, { type: 'HOST_CHANGED', hostId: next.id });
  }

  /** True when no human is connected or still inside their reconnect grace period. */
  private onlyBotsRemain(room: Room): boolean {
    return !room.members.some(
      (m) => m.kind === 'HUMAN' && (m.connected || this.deps.timers.has(graceKey(room.id, m.id))),
    );
  }

  private closeRoom(room: Room, notify = true): void {
    room.phase = 'CLOSED';
    if (room.match) {
      this.deps.bots.detachMatch(room.match.matchId);
      room.match.runtime.stop();
    }
    this.deps.timers.clearPrefix(`room:${room.id}:`);
    this.deps.timers.clearPrefix(`grace:${room.id}:`);
    for (const id of this.humanIds(room)) {
      const session = this.deps.sessions.get(id);
      if (session?.roomId === room.id) session.roomId = null;
      if (notify) {
        this.deps.notifier.roomEvent(id, { type: 'ROOM_CLOSED' });
        this.deps.notifier.roomSnapshot([id], null);
      }
    }
    this.deps.store.remove(room.id);
    this.deps.log.info('room closed', { roomId: room.id });
  }
}

function humanMember(session: Session, now: number): HumanMember {
  return {
    kind: 'HUMAN',
    id: session.id,
    nickname: session.nickname as string,
    nicknameKey: session.nicknameKey as string,
    joinedAt: now,
    connected: session.socketId !== null,
    graceUntil: null,
  };
}

function findHuman(room: Room, playerId: string): HumanMember | undefined {
  return room.members.find(
    (m: Member): m is HumanMember => m.kind === 'HUMAN' && m.id === playerId,
  );
}

function seatOf(match: ActiveMatch | null | undefined, memberId: string): SeatState | undefined {
  return match?.seats.find((s) => s.memberId === memberId && s.memberKind === 'HUMAN');
}

function graceKey(roomId: string, playerId: string): string {
  return `grace:${roomId}:${playerId}`;
}
