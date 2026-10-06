import type { AnyGameModule, SeatIndex } from '../contract';
import { createRng, type SeededRng } from '../rng';
import { simulateMatch, type SimulateOptions } from './harness';
import { deepFreeze } from './stable';

/**
 * Engine fuzzing (Phase 10). While bots play a whole match, every step attacks the
 * engine from every seat with hostile actions:
 *
 * - mutations of the legal action a bot is about to take (numbers → negative, huge,
 *   fractional, NaN-like; strings → empty, huge, Unicode; fields dropped, added or
 *   swapped for other types; arrays emptied or bloated);
 * - every legal action seen earlier in the match, replayed now (stale, duplicate,
 *   out-of-turn and out-of-phase actions) from every seat;
 * - the same for stream chunks (drawing strokes, NPAT drafts).
 *
 * The rules: the schema, `validateAction` and `stream.accept` never throw; an action
 * the engine accepts must apply without throwing and keep the state serialisable and
 * the game's invariant true. The match state is deep-frozen, so any mutation of it
 * throws. Nothing a probe does changes the real match (transitions are discarded).
 */
export interface FuzzOptions<S> extends Omit<
  SimulateOptions<S>,
  'probe' | 'probeStream' | 'perturbHidden' | 'observe'
> {
  /** Mutated variants tried per seat per step (default 6; each stacks 1–3 mutations). */
  mutationsPerStep?: number;
  /** Earlier legal actions replayed per seat per step (default 4). */
  replaysPerStep?: number;
  /**
   * Legal-shaped actions bots never make (e.g. a loan, a vote), built from the current
   * state so they reach the engine's deeper checks. Each is tried as is and mutated,
   * from every seat, at every step — streamed steps included.
   */
  seedActions?: (state: S) => unknown[];
}

export interface FuzzReport {
  steps: number;
  attempts: number;
  /** Attempts the schema rejected. */
  rejectedBySchema: number;
  /** Attempts that passed the schema but the engine refused. */
  rejectedByEngine: number;
  /** Hostile attempts the engine accepted (legal moves in disguise, e.g. a replay that is legal again). */
  accepted: number;
}

const HOSTILE_NUMBERS = [
  -1,
  -0,
  0.5,
  -1.5,
  1e9,
  -1e9,
  Number.MAX_SAFE_INTEGER,
  Number.MIN_SAFE_INTEGER,
  1e308,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
];
const HOSTILE_STRINGS = [
  '',
  ' ',
  'x'.repeat(10_000),
  '__proto__',
  'constructor',
  '\u0000',
  'ａｂｃ',
  '🙂🙂',
  'null',
  '-1',
  '1e309',
];
const HOSTILE_VALUES: unknown[] = [null, undefined, true, false, {}, [], '0', 0];

function pick<T>(rng: SeededRng, items: readonly T[]): T {
  return items[rng.int(0, items.length - 1)] as T;
}

/** One random hostile change somewhere inside `value` (recursively). */
export function mutate(value: unknown, rng: SeededRng, depth = 0): unknown {
  if (Array.isArray(value)) {
    const roll = rng.int(0, 4);
    if (roll === 0 || value.length === 0) return [];
    if (roll === 1) return [...value, ...value, ...value];
    if (roll === 2) return value.map((v, i) => (i === 0 ? pick(rng, HOSTILE_VALUES) : v));
    if (roll === 3) return Array.from({ length: 2_000 }, () => value[0]);
    const i = rng.int(0, value.length - 1);
    return value.map((v, k) => (k === i ? mutate(v, rng, depth + 1) : v));
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const roll = rng.int(0, 4);
    if (roll === 0 && entries.length > 0) {
      // Drop a field (but keep a discriminant most of the time so the schema reaches deeper).
      const i = rng.int(0, entries.length - 1);
      return Object.fromEntries(entries.filter((_, k) => k !== i));
    }
    if (roll === 1) return { ...(value as object), extra: pick(rng, HOSTILE_VALUES) };
    if (roll === 2 && entries.length > 0) {
      const i = rng.int(0, entries.length - 1);
      return Object.fromEntries(
        entries.map(([k, v], n) => [k, n === i ? pick(rng, HOSTILE_VALUES) : v]),
      );
    }
    if (entries.length === 0 || depth > 4) return pick(rng, HOSTILE_VALUES);
    const i = rng.int(0, entries.length - 1);
    return Object.fromEntries(
      entries.map(([k, v], n) => [k, n === i ? mutate(v, rng, depth + 1) : v]),
    );
  }
  if (typeof value === 'number') {
    return rng.next() < 0.7 ? pick(rng, HOSTILE_NUMBERS) : value + pick(rng, [-1, 1, 2, -2, 100]);
  }
  if (typeof value === 'string') {
    if (rng.next() < 0.5) return pick(rng, HOSTILE_STRINGS);
    // Small edits keep look-alike ids ("h:1:2" → "h:1:3", "h:99:2"…).
    const chars = [...value];
    const i = rng.int(0, Math.max(0, chars.length - 1));
    chars[i] = pick(rng, ['0', '9', '-', 'Z', ':', '99']);
    return chars.join('');
  }
  return pick(rng, [...HOSTILE_VALUES, ...HOSTILE_NUMBERS.slice(0, 3)]);
}

/** Plays a bot match while attacking the engine at every step (see the file comment). */
export function fuzzMatch<S>(game: AnyGameModule, options: FuzzOptions<S>): FuzzReport {
  const rng = createRng(options.seed ^ 0x2545f491);
  const mutations = options.mutationsPerStep ?? 6;
  const replays = options.replaysPerStep ?? 4;
  const seats: SeatIndex[] = Array.from({ length: options.seats }, (_, i) => i);
  const seenActions: unknown[] = [];
  const seenChunks: unknown[] = [];
  const report: FuzzReport = {
    steps: 0,
    attempts: 0,
    rejectedBySchema: 0,
    rejectedByEngine: 0,
    accepted: 0,
  };

  const stacked = (value: unknown): unknown => {
    let out = value;
    for (let n = rng.int(1, 3); n > 0; n--) out = mutate(out, rng);
    return out;
  };

  const fail = (what: string, seat: SeatIndex, attempt: unknown, err: unknown): never => {
    const shown = JSON.stringify(attempt)?.slice(0, 300);
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${game.manifest.id}: ${what} threw for seat ${seat} with ${shown}: ${message}`,
    );
  };

  /** Returns the resulting (frozen) state when the engine accepted the attempt. */
  const tryAction = (state: S, seat: SeatIndex, attempt: unknown, now: number): S | null => {
    report.attempts++;
    let parsed: { success: boolean; data?: unknown };
    try {
      parsed = game.actionSchema.safeParse(attempt);
    } catch (err) {
      return fail('actionSchema', seat, attempt, err);
    }
    if (!parsed.success) {
      report.rejectedBySchema++;
      return null;
    }
    let verdict: { ok: boolean };
    try {
      verdict = game.validateAction(state, seat, parsed.data);
    } catch (err) {
      return fail('validateAction', seat, attempt, err);
    }
    if (!verdict.ok) {
      report.rejectedByEngine++;
      return null;
    }
    report.accepted++;
    try {
      const t = game.applyAction(state, seat, parsed.data, {
        now,
        rng: createRng(rng.int(1, 1e9)),
      });
      structuredClone(t.state);
      options.invariant?.(t.state as S);
      return deepFreeze(t.state as S);
    } catch (err) {
      return fail('applyAction', seat, attempt, err);
    }
  };

  const tryChunk = (state: S, seat: SeatIndex, attempt: unknown): void => {
    const stream = game.stream;
    if (!stream) return;
    report.attempts++;
    let parsed: { success: boolean; data?: unknown };
    try {
      parsed = stream.chunkSchema.safeParse(attempt);
    } catch (err) {
      return fail('chunkSchema', seat, attempt, err);
    }
    if (!parsed.success) {
      report.rejectedBySchema++;
      return;
    }
    try {
      const out = stream.accept(state, seat, parsed.data);
      if ('state' in out) {
        report.accepted++;
        structuredClone(out.state);
        options.invariant?.(out.state as S);
      } else report.rejectedByEngine++;
    } catch (err) {
      fail('stream.accept', seat, attempt, err);
    }
  };

  // A seed the engine accepts opens a state the bots never reach (an auction nobody
  // started, a review with votes): that state is attacked too, one level deep.
  const trySeeds = (state: S, now: number, depth = 0): void => {
    const seeds = options.seedActions?.(state) ?? [];
    for (const seat of seats) {
      for (const seed of seeds) {
        const next = tryAction(state, seat, seed, now);
        tryAction(state, seat, stacked(seed), now);
        if (next && depth === 0 && rng.next() < 0.25) trySeeds(next, now, 1);
      }
    }
  };

  simulateMatch<S, unknown>(game, {
    ...options,
    probe: (state, { action, now }) => {
      report.steps++;
      for (const seat of seats) {
        for (let i = 0; i < mutations; i++) tryAction(state, seat, stacked(action), now);
        for (let i = 0; i < Math.min(replays, seenActions.length); i++) {
          tryAction(state, seat, pick(rng, seenActions), now);
        }
      }
      if (seenActions.length < 500) seenActions.push(action);
    },
    // Seeds run on every state the match passes through (timer-driven phases too, e.g.
    // NPAT's review), not only when a bot acts.
    observe: (state, now) => trySeeds(state, now),
    probeStream: (state, { chunk }) => {
      for (const seat of seats) {
        for (let i = 0; i < Math.max(1, mutations >> 1); i++) {
          tryChunk(state, seat, stacked(chunk));
        }
        if (seenChunks.length > 0) tryChunk(state, seat, pick(rng, seenChunks));
      }
      if (seenChunks.length < 200) seenChunks.push(chunk);
    },
  });
  return report;
}
