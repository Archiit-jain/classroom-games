import {
  fail,
  ok,
  type ErrorCode,
  type PublicRoomListing,
  type Result,
  type RoomView,
} from '@cg/protocol';
import type { ServerConfig } from '../config';
import type { Logger } from '../log';
import type { Notifier } from '../notifier';
import type { GameRegistry } from '../runtime/GameRegistry';
import type { Session, SessionManager } from '../session/SessionManager';
import type { RateLimiter } from '../util/RateLimiter';
import type { TimerService } from '../util/TimerService';
import type { MatchmakingMetrics } from './MatchmakingMetrics';
import type { RoomManager } from './RoomManager';
import type { Room } from './types';

export interface MatchmakerDeps {
  config: ServerConfig;
  rooms: RoomManager;
  registry: GameRegistry;
  sessions: SessionManager;
  notifier: Notifier;
  timers: TimerService;
  limiter: RateLimiter;
  metrics: MatchmakingMetrics;
  log: Logger;
}

const FEED_TIMER = 'public:feed';

/**
 * Public matchmaking (docs/design/PUBLIC_LOBBY_DESIGN.md §5): Quick Play for one game or
 * any game, joining from Browse, and the live Browse feed. It runs on the room host, so
 * every choice of a room and the join that follows happen in one synchronous step — players
 * on different instances can't take the same seat or create duplicate rooms.
 */
export class Matchmaker {
  /** Next game for Any Game when nothing is open (catalogue order). */
  private rotation = 0;
  /** Sessions subscribed to the Browse feed (mirrors `session.browsing`). */
  private readonly browsers = new Set<string>();

  constructor(private readonly deps: MatchmakerDeps) {}

  /** Quick Play: a specific game, or any game (`null`). Joins the best room or creates one. */
  play(session: Session, gameId: string | null): Result<{ room: RoomView }> {
    const limited = this.limit(session, 'matchmaking');
    if (limited) return limited;
    this.deps.metrics.count('requests');
    if (!session.nickname) return fail('NICKNAME_REQUIRED');
    if (gameId !== null && !this.deps.registry.get(gameId)?.manifest.publicMatch.enabled) {
      return this.failed('GAME_NOT_FOUND');
    }
    const ctx = this.deps.rooms.context(session);
    if (ctx) {
      const { room } = ctx;
      const same = room.kind === 'PUBLIC' && room.phase === 'LOBBY';
      if (same && (gameId === null || room.gameId === gameId)) {
        return ok({ room: this.deps.rooms.view(room) });
      }
      return this.failed('ALREADY_IN_ROOM');
    }
    const best = this.best(session, gameId);
    if (best) return this.join(session, best);
    const created = this.deps.rooms.createPublic(gameId ?? this.nextInRotation());
    if (!created.ok) return this.failed(created.code);
    this.deps.metrics.count('roomsCreated');
    return this.join(session, created.value.room);
  }

  /** Join a room picked from the Browse feed. Everything is re-checked here. */
  joinListed(session: Session, roomId: string): Result<{ room: RoomView }> {
    const limited = this.limit(session, 'matchmaking');
    if (limited) return limited;
    this.deps.metrics.count('requests');
    const room = this.deps.rooms.getRoom(roomId);
    if (!room || room.kind !== 'PUBLIC') {
      this.sendFeed([session.id]);
      return this.failed('ROOM_NOT_FOUND');
    }
    const result = this.join(session, room);
    // The room filled or started a moment ago: give this player a fresh list straight away.
    if (!result.ok) this.sendFeed([session.id]);
    return result;
  }

  /** Subscribe to (or leave) the Browse feed. A subscriber gets the full list at once. */
  browse(session: Session, on: boolean): Result<Record<never, never>> {
    const limited = this.limit(session, 'browse');
    if (limited) return limited;
    this.setBrowsing(session, on);
    if (on) this.sendFeed([session.id]);
    return ok({});
  }

  /** A public room changed: push the feed soon (coalesced). */
  changed(): void {
    if (this.browsers.size === 0 || this.deps.timers.has(FEED_TIMER)) return;
    this.deps.timers.set(FEED_TIMER, this.deps.config.matchmaking.browsePushMs, () =>
      this.sendFeed([...this.browsers]),
    );
  }

  /** After a host hand-over: continue the feed for everyone who was browsing. */
  restore(): void {
    this.browsers.clear();
    for (const session of this.deps.sessions.all()) {
      if (session.browsing) this.browsers.add(session.id);
    }
    if (this.browsers.size > 0) this.sendFeed([...this.browsers]);
  }

  /** Every joinable public room, best first (most humans, then closest to starting). */
  listings(): PublicRoomListing[] {
    return this.rank(this.deps.rooms.joinablePublicRooms(null))
      .slice(0, this.deps.config.matchmaking.browseMaxRooms)
      .map((room) => {
        const game = this.deps.registry.get(room.gameId);
        return {
          roomId: room.id,
          gameId: room.gameId,
          humans: room.members.filter((m) => m.kind === 'HUMAN').length,
          targetPlayers: game?.manifest.publicMatch.targetPlayers ?? 0,
          maxPlayers: game?.manifest.players.max ?? 0,
          state: (room.public?.fillEndsAt ?? null) !== null ? 'FILLING' : 'WAITING',
          fillEndsAt: room.public?.fillEndsAt ?? null,
        };
      });
  }

  // ───────────────────────────── internals ─────────────────────────────

  private join(session: Session, room: Room): Result<{ room: RoomView }> {
    const result = this.deps.rooms.joinPublic(session, room);
    if (!result.ok) return this.failed(result.code);
    // In a room now: no need for the Browse feed any more.
    this.setBrowsing(session, false);
    return result;
  }

  /** The best joinable room for this player (no name clash), or null. */
  private best(session: Session, gameId: string | null): Room | null {
    const candidates = this.deps.rooms
      .joinablePublicRooms(gameId)
      .filter((room) => this.deps.rooms.canJoinPublic(session, room));
    if (gameId !== null) {
      // One game: the most humans, then the room whose fill window ends first, then the oldest.
      return (
        [...candidates].sort(
          (a, b) =>
            humans(b) - humans(a) ||
            (a.public?.fillEndsAt ?? Infinity) - (b.public?.fillEndsAt ?? Infinity) ||
            a.createdAt - b.createdAt,
        )[0] ?? null
      );
    }
    return this.rank(candidates)[0] ?? null;
  }

  /** Any game: the most humans, then the fewest free seats (closest to starting), then the oldest. */
  private rank(rooms: Room[]): Room[] {
    const free = (room: Room) =>
      (this.deps.registry.get(room.gameId)?.manifest.publicMatch.targetPlayers ?? 0) -
      room.members.length;
    return [...rooms].sort(
      (a, b) => humans(b) - humans(a) || free(a) - free(b) || a.createdAt - b.createdAt,
    );
  }

  private nextInRotation(): string {
    const games = this.deps.registry.publicGames();
    const game = games[this.rotation % games.length];
    this.rotation = (this.rotation + 1) % Math.max(1, games.length);
    return game?.manifest.id ?? '';
  }

  private setBrowsing(session: Session, on: boolean): void {
    if (Boolean(session.browsing) === on) return;
    session.browsing = on;
    this.deps.sessions.get(session.id); // persisted with the session (survives a hand-over)
    if (on) this.browsers.add(session.id);
    else this.browsers.delete(session.id);
  }

  private sendFeed(playerIds: string[]): void {
    const live = playerIds.filter((id) => this.deps.sessions.peek(id)?.socketId);
    if (live.length === 0) return;
    this.deps.metrics.count('browsePushes');
    this.deps.notifier.publicRooms(live, this.listings());
  }

  private limit(session: Session, bucket: 'matchmaking' | 'browse'): Result<never> | null {
    if (this.deps.limiter.take(session.id, bucket)) return null;
    return fail('RATE_LIMITED', this.deps.limiter.retryAfterMs(session.id, bucket));
  }

  private failed(code: ErrorCode): Result<never> {
    this.deps.metrics.failedJoin(code);
    return fail(code);
  }
}

function humans(room: Room): number {
  return room.members.filter((m) => m.kind === 'HUMAN').length;
}
