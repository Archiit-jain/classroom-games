import {
  createRng,
  eventsForSeat,
  type AnyGameModule,
  type ChatDecision,
  type RuntimeRequest,
  type SeatChange,
  type SeatIndex,
  type SeededRng,
  type StepCtx,
  type Transition,
} from '@cg/game-sdk';
import { fail, ok, type GameResults, type MatchUpdate, type Result } from '@cg/protocol';
import { errorFields, type Logger } from '../log';
import type { TimerService } from '../util/TimerService';

export interface RuntimeHooks {
  /** One filtered update per seat, after every transition. */
  deliver(seat: SeatIndex, update: MatchUpdate): void;
  onRequest(request: RuntimeRequest): void;
  onOver(results: GameResults): void;
  /** Runs after every committed transition (used for deferred seat reclaims). */
  afterTransition(): void;
  /** The engine threw; the match cannot continue. */
  onCrash(error: unknown): void;
}

export interface RuntimeOptions {
  matchId: string;
  game: AnyGameModule;
  settings: unknown;
  seatCount: number;
  seed: number;
  timers: TimerService;
  hooks: RuntimeHooks;
  log: Logger;
  now?: () => number;
}

type Producer = () => Transition<unknown, unknown> | null;

/**
 * Hosts one match: owns the authoritative state, feeds inputs to the pure
 * engine, schedules engine timers and fans out per-seat views + events.
 *
 * All transitions go through a single synchronous queue, so re-entrant calls
 * from hooks (e.g. a bot takeover triggered by an engine request) are applied
 * strictly one after another.
 */
export class GameRuntime {
  readonly matchId: string;
  readonly game: AnyGameModule;
  readonly seats: SeatIndex[];
  private readonly settings: unknown;
  private readonly rng: SeededRng;
  private readonly timers: TimerService;
  private readonly hooks: RuntimeHooks;
  private readonly log: Logger;
  private readonly now: () => number;

  private state: unknown = undefined;
  private started = false;
  private over = false;
  private stopped = false;
  private currentVersion = 0;
  private readonly queue: Producer[] = [];
  private busy = false;

  constructor(options: RuntimeOptions) {
    this.matchId = options.matchId;
    this.game = options.game;
    this.settings = options.settings;
    this.seats = Array.from({ length: options.seatCount }, (_, i) => i);
    this.rng = createRng(options.seed);
    this.timers = options.timers;
    this.hooks = options.hooks;
    this.log = options.log;
    this.now = options.now ?? Date.now;
  }

  get version(): number {
    return this.currentVersion;
  }

  get isOver(): boolean {
    return this.over;
  }

  get isStarted(): boolean {
    return this.started;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.run(() => this.game.setup(this.seats, this.settings, this.ctx()));
  }

  /**
   * Validates and applies a player's (or bot's) action. `version` is the view
   * version the client acted on; `null` for server-side bots. Older versions are
   * accepted — legality is decided by the engine against the CURRENT state —
   * but a version the server never issued is rejected.
   */
  submitAction(
    seat: SeatIndex,
    version: number | null,
    rawAction: unknown,
  ): Result<{ version: number }> {
    if (!this.started || this.over || this.stopped) return fail('INVALID_PHASE');
    if (version !== null && version > this.currentVersion) return fail('STALE_VERSION');
    const parsed = this.game.actionSchema.safeParse(rawAction);
    if (!parsed.success) return fail('INVALID_PAYLOAD');
    const verdict = this.game.validateAction(this.state, seat, parsed.data);
    if (!verdict.ok) return fail(verdict.code);
    this.run(() => {
      // Re-validate in case something ran between the check and this producer.
      const again = this.game.validateAction(this.state, seat, parsed.data);
      return again.ok ? this.game.applyAction(this.state, seat, parsed.data, this.ctx()) : null;
    });
    return ok({ version: this.currentVersion });
  }

  seatChanged(seat: SeatIndex, change: SeatChange): void {
    if (!this.started || this.stopped) return;
    this.run(() =>
      this.over ? null : this.game.onSeatChange(this.state, seat, change, this.ctx()),
    );
  }

  /** Lets a game's chat interceptor inspect a message. Returns null when the game has none. */
  interceptChat(seat: SeatIndex, normalized: string): ChatDecision | null {
    if (!this.game.chat || !this.started || this.over || this.stopped) return null;
    const decision = this.game.chat.intercept(this.state, seat, normalized, this.ctx());
    if (decision.kind === 'CONSUME') this.run(() => decision.transition);
    return decision;
  }

  /** A complete, event-free update for one seat (reconnects, resyncs, bots). */
  viewFor(seat: SeatIndex): MatchUpdate {
    return {
      matchId: this.matchId,
      gameId: this.game.manifest.id,
      version: this.currentVersion,
      you: seat,
      events: [],
      view: this.game.getPlayerView(this.state, seat),
      serverNow: this.now(),
    };
  }

  canReclaim(seat: SeatIndex): boolean {
    if (this.game.manifest.reclaim === 'IMMEDIATE') return true;
    return this.game.canReclaimSeat?.(this.state, seat) ?? true;
  }

  stop(): void {
    this.stopped = true;
    this.queue.length = 0;
    this.timers.clearPrefix(this.timerPrefix);
  }

  private get timerPrefix(): string {
    return `match:${this.matchId}:`;
  }

  private ctx(): StepCtx {
    return { now: this.now(), rng: this.rng };
  }

  private run(producer: Producer): void {
    this.queue.push(producer);
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length > 0 && !this.stopped) {
        const next = this.queue.shift() as Producer;
        const transition = next();
        if (transition) this.commit(transition);
      }
    } catch (err) {
      this.log.error('game engine failure', {
        matchId: this.matchId,
        gameId: this.game.manifest.id,
        ...errorFields(err),
      });
      this.stop();
      this.hooks.onCrash(err);
    } finally {
      this.busy = false;
    }
  }

  private commit(t: Transition<unknown, unknown>): void {
    this.state = t.state;
    this.currentVersion += 1;

    for (const cmd of t.timers ?? []) {
      if ('set' in cmd) {
        const id = cmd.set;
        this.timers.set(`${this.timerPrefix}${id}`, cmd.ms, () =>
          this.run(() => (this.over ? null : this.game.onTimer(this.state, id, this.ctx()))),
        );
      } else {
        this.timers.clear(`${this.timerPrefix}${cmd.clear}`);
      }
    }

    const serverNow = this.now();
    for (const seat of this.seats) {
      this.hooks.deliver(seat, {
        matchId: this.matchId,
        gameId: this.game.manifest.id,
        version: this.currentVersion,
        you: seat,
        events: eventsForSeat(t.events, seat),
        view: this.game.getPlayerView(this.state, seat),
        serverNow,
      });
    }

    for (const request of t.requests ?? []) this.hooks.onRequest(request);

    if (!this.over && this.game.isOver(this.state)) {
      this.over = true;
      this.timers.clearPrefix(this.timerPrefix);
      this.hooks.onOver(this.game.getResults(this.state));
    }
    this.hooks.afterTransition();
  }
}
