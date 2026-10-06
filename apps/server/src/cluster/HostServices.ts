import type { Moderator } from '@cg/moderation';
import { fail, ok, type C2SEventName, type Result } from '@cg/protocol';
import { C2S } from '@cg/protocol/schemas';
import { BotManager } from '../bots/BotManager';
import { ChatService } from '../chat/ChatService';
import type { ServerConfig } from '../config';
import { errorFields, type Logger } from '../log';
import type { Notifier } from '../notifier';
import { ReportService, type ReportFlag, type ReportSink } from '../reports/ReportService';
import { InMemoryRoomStore, type RoomStore } from '../rooms/RoomStore';
import { Matchmaker } from '../rooms/Matchmaker';
import { MatchmakingMetrics } from '../rooms/MatchmakingMetrics';
import { RoomManager } from '../rooms/RoomManager';
import type { Room, RoomSnapshot } from '../rooms/types';
import type { GameRegistry } from '../runtime/GameRegistry';
import { SessionManager, type Session } from '../session/SessionManager';
import { EVENT_BUCKETS } from '../transport/eventBuckets';
import { RateLimiter } from '../util/RateLimiter';
import { TimerService } from '../util/TimerService';
import { KEYS, type Cluster, type HostCall } from './Cluster';
import type { SharedStore, StoreWrite } from './SharedStore';

/** Shared-store keys for the authoritative state. */
export const STATE_KEYS = {
  session: (id: string) => `cg:s:${id}`,
  room: (id: string) => `cg:r:${id}`,
  sessions: 'cg:s:',
  rooms: 'cg:r:',
  reports: 'cg:reports',
} as const;

/** Snapshots expire on their own if nothing touches them for a day (safety net). */
const SNAPSHOT_TTL_MS = 25 * 3600_000;

export interface HostServicesDeps {
  config: ServerConfig;
  log: Logger;
  registry: GameRegistry;
  moderator: Moderator;
  store: SharedStore;
  cluster: Cluster;
  /** The lease value this term holds; every write is fenced by it. */
  fence: string;
  /** Is this socket (on this instance) still open? */
  hasLocalSocket(socketId: string): boolean;
  reportSink?: ReportSink;
  /** How long changes may wait before being written together. */
  flushDelayMs?: number;
}

/** Reports kept in the shared store (newest 1,000, 24 h). */
class StoreReportSink implements ReportSink {
  constructor(
    private readonly store: SharedStore,
    private readonly maxFlags: number,
    private readonly ttlMs: number,
  ) {}

  record(flag: ReportFlag): void {
    void this.store
      .pushCapped(STATE_KEYS.reports, JSON.stringify(flag), this.maxFlags, this.ttlMs)
      .catch(() => undefined);
  }
}

/** A RoomStore that reports which rooms may have changed (for persistence). */
class TrackingRoomStore implements RoomStore {
  private readonly inner = new InMemoryRoomStore();

  constructor(
    private readonly touched: (id: string) => void,
    private readonly removed: (id: string) => void,
  ) {}

  get(id: string): Room | undefined {
    const room = this.inner.get(id);
    if (room) this.touched(id);
    return room;
  }
  getByCode(code: string): Room | undefined {
    const room = this.inner.getByCode(code);
    if (room) this.touched(room.id);
    return room;
  }
  hasCode(code: string): boolean {
    return this.inner.hasCode(code);
  }
  add(room: Room): void {
    this.inner.add(room);
    this.touched(room.id);
  }
  remove(id: string): void {
    this.inner.remove(id);
    this.removed(id);
  }
  all(): Room[] {
    return this.inner.all();
  }
  count(): number {
    return this.inner.count();
  }
}

/**
 * The authoritative services of one hosting term: sessions, rooms, matches,
 * chat, reports, bots and their timers — the same single-process code as
 * always — plus persistence of every change to the shared store, so that the
 * next host can continue exactly where this one stopped (ADR-023).
 */
export class HostServices {
  readonly timers: TimerService;
  readonly sessions: SessionManager;
  readonly rooms: RoomManager;
  readonly chat: ChatService;
  readonly reports: ReportService;
  readonly reportSink: ReportSink;
  readonly bots: BotManager;
  readonly matchmaker: Matchmaker;
  readonly metrics = new MatchmakingMetrics();
  private readonly limiter: RateLimiter;
  private readonly log: Logger;

  private readonly dirtyRooms = new Set<string>();
  private readonly dirtySessions = new Set<string>();
  private readonly deletedRooms = new Set<string>();
  private readonly deletedSessions = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;
  private readonly sweeper: ReturnType<typeof setInterval>;
  private readonly metricsLog: ReturnType<typeof setInterval>;
  private disposed = false;

  private constructor(private readonly deps: HostServicesDeps) {
    const { config, log } = deps;
    this.log = log;
    this.timers = new TimerService(log);
    this.limiter = new RateLimiter({
      ...config.rateLimits,
      chat: { burst: config.chat.burst, perSecond: config.chat.perSecond },
    });
    this.sessions = new SessionManager(config, deps.moderator, Date.now, {
      touched: (id) => this.markSession(id),
      removed: (id) => this.dropSession(id),
    });
    const notifier = this.createNotifier();
    let chatForBots: ChatService | null = null;
    let matchmaker: Matchmaker | null = null;
    const metrics = this.metrics;
    this.bots = new BotManager({
      timers: this.timers,
      log,
      onChat: (matchId, seat, text) => chatForBots?.sendFromBot(matchId, seat, text),
    });
    this.rooms = new RoomManager({
      config,
      store: new TrackingRoomStore(
        (id) => this.markRoom(id),
        (id) => this.dropRoom(id),
      ),
      registry: deps.registry,
      sessions: this.sessions,
      moderator: deps.moderator,
      timers: this.timers,
      bots: this.bots,
      notifier,
      log,
      publicEvents: {
        changed: () => matchmaker?.changed(),
        joined: () => metrics.count('joins'),
        cancelled: () => metrics.count('cancelled'),
        fillCompleted: (botSeats) => {
          metrics.count('fillsCompleted');
          metrics.count('botSeatsFilled', botSeats);
        },
        started: (waits) => {
          metrics.count('matchesStarted');
          metrics.waited(waits);
        },
        playWithBots: () => metrics.count('playWithBots'),
      },
    });
    this.matchmaker = new Matchmaker({
      config,
      rooms: this.rooms,
      registry: deps.registry,
      sessions: this.sessions,
      notifier,
      timers: this.timers,
      limiter: this.limiter,
      metrics,
      log,
    });
    matchmaker = this.matchmaker;
    this.chat = new ChatService({
      config,
      moderator: deps.moderator,
      rooms: this.rooms,
      notifier,
      limiter: this.limiter,
    });
    chatForBots = this.chat;
    this.reportSink =
      deps.reportSink ??
      new StoreReportSink(deps.store, config.reports.maxFlags, config.reports.flagTtlMs);
    this.reports = new ReportService({
      sink: this.reportSink,
      rooms: this.rooms,
      limiter: this.limiter,
      log,
    });
    this.sweeper = setInterval(() => this.sweep(), config.timing.sweepIntervalMs);
    this.sweeper.unref?.();
    this.metricsLog = setInterval(() => {
      if (this.metrics.takeChanged()) log.info('matchmaking metrics', this.metrics.snapshot());
    }, 60_000);
    this.metricsLog.unref?.();
  }

  /** Builds the services for a new hosting term from whatever the shared store holds. */
  static async start(deps: HostServicesDeps): Promise<HostServices> {
    const host = new HostServices(deps);
    await host.restore();
    return host;
  }

  // ───────────────────────────── requests ─────────────────────────────

  /** Handles a request forwarded from a gateway (or from this instance). */
  handle(call: HostCall): unknown {
    const data = call.data as Record<string, unknown>;
    switch (call.op) {
      case 'resolve': {
        const resolved = this.sessions.resolve(data.token, String(data.ip));
        if (!resolved.ok) return resolved;
        const { session, token } = resolved.value;
        return ok({
          sessionId: session.id,
          nickname: session.nickname,
          ...(token ? { token } : {}),
        });
      }
      case 'attach':
        return this.attach(String(data.sessionId), String(data.socketId), call.from);
      case 'detach': {
        const session = this.sessions.get(String(data.sessionId));
        if (session && this.sessions.detachSocket(session, String(data.socketId))) {
          this.rooms.onDisconnected(session);
        }
        return ok({});
      }
      case 'event':
        return this.event(
          String(data.sessionId),
          data.name as C2SEventName,
          data.payload,
          typeof data.ip === 'string' ? data.ip : 'unknown',
        );
      case 'metrics':
        return ok(this.metrics.snapshot());
      default:
        return fail('INVALID_PAYLOAD');
    }
  }

  private attach(sessionId: string, socketId: string, instanceId: string): Result<object> {
    const session = this.sessions.get(sessionId);
    if (!session) return fail('INTERNAL_ERROR');
    // One active socket per session: a newer tab takes over from an older one.
    const previous = this.sessions.attachSocket(session, socketId, instanceId);
    if (previous) {
      this.deps.cluster.send(previous.instanceId ?? this.deps.cluster.instanceId, {
        t: 'displace',
        socketId: previous.socketId,
      });
    }
    this.rooms.onConnected(session);
    return ok({});
  }

  private event(
    sessionId: string,
    name: C2SEventName,
    payload: unknown,
    ip: string,
  ): Result<object> {
    const session = this.sessions.get(sessionId);
    if (!session) return fail('INTERNAL_ERROR');
    const schema = C2S[name];
    if (!schema) return fail('INVALID_PAYLOAD');
    // The same per-session bucket the gateway applies, counted once for the whole
    // cluster: reconnecting through another instance doesn't reset it.
    const bucket = EVENT_BUCKETS[name as keyof typeof EVENT_BUCKETS] ?? null;
    if (bucket && !this.limiter.take(session.id, bucket)) {
      return fail('RATE_LIMITED', this.limiter.retryAfterMs(session.id, bucket));
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return fail('INVALID_PAYLOAD');
    // The payload was validated by the event's schema just above.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = parsed.data as Record<string, any>;
    const { rooms, chat, reports } = this;
    switch (name) {
      case 'session:setNickname':
        return this.sessions.setNickname(session, p.nickname);
      case 'room:create':
        return rooms.create(session, p.gameId);
      case 'room:join': {
        // Wrong codes cost the IP's budget (several sessions from one address share it).
        const guessKey = `ip:${ip}`;
        if (this.limiter.retryAfterMs(guessKey, 'codeGuess') > 0) {
          return fail('RATE_LIMITED', this.limiter.retryAfterMs(guessKey, 'codeGuess'));
        }
        const joined = rooms.join(session, p.code);
        if (!joined.ok && joined.code === 'ROOM_NOT_FOUND')
          this.limiter.take(guessKey, 'codeGuess');
        return joined;
      }
      case 'room:leave':
        return rooms.leave(session);
      case 'room:setGame':
        return rooms.setGame(session, p.gameId);
      case 'room:updateSettings':
        return rooms.updateSettings(session, p.settings);
      case 'room:addBot':
        return rooms.addBot(session);
      case 'room:removeBot':
        return rooms.removeBot(session, p.botId);
      case 'room:kick':
        return rooms.kick(session, p.playerId);
      case 'room:start':
        return rooms.start(session);
      case 'room:playAgain':
        return rooms.playAgain(session);
      case 'room:backToLobby':
        return rooms.backToLobby(session);
      case 'room:reclaimSeat':
        return rooms.reclaimSeat(session);
      case 'public:play':
        return this.matchmaker.play(session, p.gameId);
      case 'public:join':
        return this.matchmaker.joinListed(session, p.roomId);
      case 'public:browse':
        return this.matchmaker.browse(session, p.on);
      case 'public:playWithBots': {
        const limited = this.limiter.take(session.id, 'matchmaking');
        if (!limited)
          return fail('RATE_LIMITED', this.limiter.retryAfterMs(session.id, 'matchmaking'));
        return rooms.playWithBots(session);
      }
      case 'public:resultsChoice':
        return rooms.resultsChoice(session, p.stay);
      case 'match:action':
        return rooms.submitAction(session, p.matchId, p.version, p.actionId, p.action);
      case 'match:resync':
        return rooms.resync(session, p.matchId);
      case 'match:stream':
        return rooms.submitStream(session, p.matchId, p.chunk);
      case 'chat:send':
        return chat.send(session, p.text);
      case 'chat:react':
        return chat.react(session, p.reactionId);
      case 'report:submit':
        return reports.submit(session, p.playerId, p.reason);
      default:
        return fail('INVALID_PAYLOAD');
    }
  }

  /** Outbound messages: each goes to the instance that holds the player's socket. */
  private createNotifier(): Notifier {
    const send = (playerIds: readonly string[], event: string, payload: unknown) => {
      const byInstance = new Map<string, string[]>();
      for (const id of playerIds) {
        const session = this.sessions.peek(id);
        if (!session?.socketId) continue;
        const instance = session.instanceId ?? this.deps.cluster.instanceId;
        const list = byInstance.get(instance) ?? [];
        list.push(session.socketId);
        byInstance.set(instance, list);
      }
      for (const [instance, socketIds] of byInstance) {
        this.deps.cluster.send(instance, { t: 'deliver', socketIds, event, payload });
      }
    };
    return {
      roomSnapshot: (ids, room) => send(ids, 'room:snapshot', { room }),
      roomEvent: (id, event) => send([id], 'room:event', event),
      matchUpdate: (id, update) => send([id], 'match:update', update),
      matchEnd: (ids, end) => send(ids, 'match:end', end),
      matchStream: (ids, stream) => send(ids, 'match:stream', stream),
      chatMessage: (ids, message) => send(ids, 'chat:message', message),
      chatHistory: (id, messages) => send([id], 'chat:history', { messages: [...messages] }),
      reaction: (ids, reaction) => send(ids, 'chat:reaction', reaction),
      publicRooms: (ids, rooms) => send(ids, 'public:rooms', { rooms }),
    };
  }

  // ───────────────────────────── persistence ─────────────────────────────

  private markRoom(id: string): void {
    this.deletedRooms.delete(id);
    this.dirtyRooms.add(id);
    this.scheduleFlush();
  }
  private dropRoom(id: string): void {
    this.dirtyRooms.delete(id);
    this.deletedRooms.add(id);
    this.scheduleFlush();
  }
  private markSession(id: string): void {
    this.deletedSessions.delete(id);
    this.dirtySessions.add(id);
    this.scheduleFlush();
  }
  private dropSession(id: string): void {
    this.dirtySessions.delete(id);
    this.deletedSessions.add(id);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer || this.disposed) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.deps.flushDelayMs ?? 100);
    this.flushTimer.unref?.();
  }

  /** Writes every changed room and session to the shared store (fenced by the lease). */
  async flush(): Promise<void> {
    if (this.flushing) await this.flushing;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const writes: StoreWrite[] = [];
    const deletes: string[] = [];
    for (const id of this.dirtyRooms) {
      const room = this.rooms.getRoom(id);
      if (room) {
        writes.push({
          key: STATE_KEYS.room(id),
          value: JSON.stringify(this.rooms.snapshot(room)),
          ttlMs: SNAPSHOT_TTL_MS,
        });
      }
    }
    for (const id of this.dirtySessions) {
      const session = this.sessions.peek(id);
      if (session) {
        writes.push({
          key: STATE_KEYS.session(id),
          value: JSON.stringify(session),
          ttlMs: SNAPSHOT_TTL_MS,
        });
      }
    }
    for (const id of this.deletedRooms) deletes.push(STATE_KEYS.room(id));
    for (const id of this.deletedSessions) deletes.push(STATE_KEYS.session(id));
    this.dirtyRooms.clear();
    this.dirtySessions.clear();
    this.deletedRooms.clear();
    this.deletedSessions.clear();
    if (writes.length === 0 && deletes.length === 0) return;
    this.flushing = (async () => {
      try {
        const written = await this.deps.store.commit(KEYS.host, this.deps.fence, writes, deletes);
        if (!written) this.deps.cluster.loseHost('fenced off while writing');
      } catch (err) {
        this.log.error('state write failed', errorFields(err));
      } finally {
        this.flushing = null;
      }
    })();
    await this.flushing;
  }

  /**
   * Continues from the shared store: sessions, then rooms (runtimes, timers and
   * bots), then players whose instance is gone count as disconnected, then
   * every connected player gets the current state.
   */
  private async restore(): Promise<void> {
    const { store } = this.deps;
    const sessions: Session[] = [];
    for (const [, raw] of await store.loadPrefix(STATE_KEYS.sessions)) {
      try {
        sessions.push(JSON.parse(raw) as Session);
      } catch {
        // A corrupt entry is skipped (and overwritten or expired later).
      }
    }
    this.sessions.restore(sessions);
    const rooms: Room[] = [];
    for (const [key, raw] of await store.loadPrefix(STATE_KEYS.rooms)) {
      try {
        rooms.push(this.rooms.restore(JSON.parse(raw) as RoomSnapshot));
      } catch (err) {
        this.log.error('room restore failed', { key, ...errorFields(err) });
      }
    }
    this.dirtyRooms.clear();
    this.dirtySessions.clear();
    await this.disconnectOrphans();
    for (const room of rooms) this.rooms.resendState(room);
    this.matchmaker.restore();
    if (rooms.length || sessions.length) {
      this.metrics.count('hostTakeovers');
      this.log.info('state restored', { rooms: rooms.length, sessions: sessions.length });
    }
  }

  /** Players whose socket's instance is gone (or whose socket closed here) are disconnected. */
  private async disconnectOrphans(): Promise<void> {
    const alive = new Map<string, boolean>();
    for (const session of this.sessions.all()) {
      if (!session.socketId) continue;
      const instance = session.instanceId ?? this.deps.cluster.instanceId;
      let ok: boolean;
      if (instance === this.deps.cluster.instanceId) {
        ok = this.deps.hasLocalSocket(session.socketId);
      } else {
        if (!alive.has(instance)) alive.set(instance, await this.deps.cluster.isAlive(instance));
        ok = alive.get(instance) as boolean;
      }
      if (this.disposed) return;
      if (!ok && this.sessions.detachSocket(session, session.socketId)) {
        this.rooms.onDisconnected(session);
      }
    }
  }

  private sweep(): void {
    try {
      this.rooms.sweep();
      this.sessions.sweep();
      this.chat.sweep();
      this.limiter.sweep();
      void this.disconnectOrphans().catch(() => undefined);
    } catch (err) {
      this.log.error('sweep failed', errorFields(err));
    }
  }

  /** Ends this hosting term (state stays in the shared store for the next host). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    clearInterval(this.sweeper);
    clearInterval(this.metricsLog);
    this.rooms.dispose(false);
    this.timers.dispose();
  }

  /** Test/ops helper: ends every room (server shutdown). */
  closeAllRooms(): void {
    this.rooms.dispose(true);
  }
}
