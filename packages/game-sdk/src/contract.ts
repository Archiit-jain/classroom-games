import type { ChatErrorCode, GameErrorCode, GameResults } from '@cg/protocol';
import type { ZodType } from 'zod';
import type { SeededRng } from './rng';

export type SeatIndex = number;
export type TimerId = string;

/** Who may receive an event. Decided by the engine at emission time. */
export type Audience =
  { to: 'ALL' } | { to: 'SEATS'; seats: SeatIndex[] } | { to: 'ALL_EXCEPT'; seats: SeatIndex[] };

export type Scoped<E> = Audience & { event: E };

export interface StepCtx {
  /** Server time (ms since epoch). Use for deadlines shown to players. */
  now: number;
  rng: SeededRng;
}

export type TimerCommand = { set: TimerId; ms: number } | { clear: TimerId };

/** Asks the platform to do something outside the engine's authority. */
export type RuntimeRequest = { type: 'MARK_IDLE'; seat: SeatIndex };

export interface Transition<S, E> {
  state: S;
  events: Scoped<E>[];
  timers?: TimerCommand[];
  requests?: RuntimeRequest[];
}

export type Verdict = { ok: true } | { ok: false; code: GameErrorCode };

export type SeatChange = 'DISCONNECTED' | 'RECONNECTED' | 'BOT_TOOK_OVER' | 'RECLAIMED' | 'LEFT';

export type SyncStyle = 'TURN_PHASE' | 'STREAMED' | 'SIMULATED';

export interface GameManifest {
  id: string;
  version: number;
  players: { min: number; max: number };
  sync: SyncStyle;
  bots: { supported: boolean; canTakeOverSeat: boolean };
  publicMatch: { targetPlayers: number; minHumans: number };
  reclaim: 'IMMEDIATE' | 'NEXT_PHASE_BOUNDARY';
  layout: { orientation: 'any' | 'portrait-preferred' | 'landscape-preferred' };
}

export interface BotCtx {
  seat: SeatIndex;
  now: number;
  rng: SeededRng;
}

/** One chunk of a bot's drawing plan, sent `delayMs` after the previous one. */
export interface BotStreamStep {
  delayMs: number;
  chunk: unknown;
}

export type BotDecision<A> =
  | { kind: 'ACTION'; action: A; thinkMs: number }
  /** Chat text sent through the same chat pipeline (and game hook) as a human's message. */
  | { kind: 'CHAT'; text: string; thinkMs: number }
  /**
   * A timed plan of stream chunks (e.g. a drawing), each submitted through the same
   * `stream.accept` path as a human's. The plan stops at the first rejected chunk.
   */
  | { kind: 'STREAM'; steps: BotStreamStep[]; thinkMs: number };

export interface BotModule<V, A, E, M = unknown> {
  createMemory(seat: SeatIndex): M;
  /** Receives ONLY events visible to the bot's seat. Must not mutate `memory`. */
  observe(memory: M, events: E[]): M;
  decide(view: V, memory: M, ctx: BotCtx): BotDecision<A> | null;
}

export interface StreamLimits {
  maxChunkBytes: number;
  maxChunksPerSec: number;
  maxPointsPerTurn: number;
  maxStrokesPerTurn: number;
}

/**
 * Required when `manifest.sync === 'STREAMED'`. Chunks arrive on `match:stream` (rate-limited),
 * are parsed with `chunkSchema` and passed to `accept`, which may update the state (no new
 * version, no `match:update`) and returns what to relay to whom. `replay` rebuilds a seat's
 * picture after a reconnect or resync.
 */
export interface StreamModule<S, C = unknown> {
  chunkSchema: ZodType<C>;
  limits: StreamLimits;
  accept(s: S, seat: SeatIndex, chunk: C): { state: S; relay: C; audience: Audience } | Verdict;
  replay(s: S, viewer: SeatIndex): C[];
}

export type ChatDecision =
  /**
   * Show the message normally. A game may attach a transition to record public
   * information about it (e.g. a wrong guess) — it is committed before the broadcast.
   */
  | { kind: 'PASS'; transition?: Transition<unknown, unknown> }
  | { kind: 'RESTRICT'; audience: Audience; channel: string }
  | { kind: 'CONSUME'; transition: Transition<unknown, unknown> }
  | { kind: 'BLOCK'; code: ChatErrorCode };

export interface ChatInterceptor<S> {
  intercept(s: S, seat: SeatIndex, normalized: string, ctx: StepCtx): ChatDecision;
}

/**
 * The server-side contract every game implements. All functions must be pure:
 * no I/O, no clocks, no Math.random, no in-place mutation of `s`.
 */
export interface GameModule<S, A, V, E, Settings> {
  manifest: GameManifest;
  settingsSchema: ZodType<Settings>;
  defaultSettings: Settings;
  actionSchema: ZodType<A>;

  setup(seats: SeatIndex[], settings: Settings, ctx: StepCtx): Transition<S, E>;
  validateAction(s: S, seat: SeatIndex, a: A): Verdict;
  applyAction(s: S, seat: SeatIndex, a: A, ctx: StepCtx): Transition<S, E>;
  onTimer(s: S, timer: TimerId, ctx: StepCtx): Transition<S, E>;
  onSeatChange(s: S, seat: SeatIndex, change: SeatChange, ctx: StepCtx): Transition<S, E>;

  getPlayerView(s: S, viewer: SeatIndex): V;
  isOver(s: S): boolean;
  getResults(s: S): GameResults;

  bot: BotModule<V, A, E>;
  stream?: StreamModule<S>;
  chat?: ChatInterceptor<S>;
  /**
   * Only consulted when `manifest.reclaim === 'NEXT_PHASE_BOUNDARY'`: may a
   * returning human take their seat back from the bot right now?
   */
  canReclaimSeat?(s: S, seat: SeatIndex): boolean;
}

/** Erased form used by the platform registry, which handles many games. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGameModule = GameModule<any, any, any, any, any>;
