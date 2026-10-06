import type { GameResults } from '@cg/protocol';
import { eventsForSeat } from '../audience';
import type {
  AnyGameModule,
  RuntimeRequest,
  Scoped,
  SeatIndex,
  TimerId,
  Transition,
} from '../contract';
import { createRng, type SeededRng } from '../rng';
import { deepFreeze, stableStringify } from './stable';

export type PerturbHidden<S> = (state: S, viewer: SeatIndex, rng: SeededRng) => S;

/**
 * Asserts that `viewer`'s view does not depend on information hidden from them:
 * the view must be identical after `perturb` changes every hidden value.
 */
export function assertNoViewLeak<S>(
  game: AnyGameModule,
  state: S,
  viewer: SeatIndex,
  perturb: PerturbHidden<S>,
  rng: SeededRng,
): void {
  const original = stableStringify(game.getPlayerView(state, viewer));
  const perturbed = stableStringify(game.getPlayerView(perturb(state, viewer, rng), viewer));
  if (original !== perturbed) {
    throw new Error(
      `View leak: seat ${viewer}'s view changed when hidden information changed.\n` +
        `before: ${original}\nafter:  ${perturbed}`,
    );
  }
}

export interface SimulateOptions<S> {
  seats: number;
  seed: number;
  settings?: unknown;
  /** Safety cap on transitions; exceeding it fails the run (non-termination). */
  maxSteps?: number;
  /** When false, bots never act and only timers advance the match. */
  botsAct?: boolean;
  invariant?: (state: S) => void;
  perturbHidden?: PerturbHidden<S>;
  /**
   * Also play bots' STREAM plans (chunk by chunk through `stream.accept`, on the
   * virtual clock), as the server does. Off by default.
   */
  streams?: boolean;
  /**
   * Called before every bot action with the current (frozen) state and the action a
   * bot is about to take — the fuzzer (`fuzzMatch`) attacks the engine from here.
   */
  probe?: (state: S, ctx: { seat: SeatIndex; action: unknown; now: number }) => void;
  /** Called before every streamed chunk a bot sends (streams only). */
  probeStream?: (state: S, ctx: { seat: SeatIndex; chunk: unknown; now: number }) => void;
}

export interface SimulationResult<S, E> {
  state: S;
  steps: number;
  results: GameResults;
  requests: RuntimeRequest[];
  /** Every event each seat received, in order. */
  delivered: E[][];
}

/**
 * Plays one complete match with bots in every seat on a virtual clock, checking
 * on every transition: valid audiences, serialisable state/events, engine
 * purity (state is deep-frozen), the game's invariant and (optionally) view leaks.
 */
export function simulateMatch<S, E>(
  game: AnyGameModule,
  options: SimulateOptions<S>,
): SimulationResult<S, E> {
  const seatList: SeatIndex[] = Array.from({ length: options.seats }, (_, i) => i);
  const rng = createRng(options.seed);
  const botRng = createRng(options.seed ^ 0x9e3779b9);
  const leakRng = createRng(options.seed ^ 0x5bd1e995);
  const maxSteps = options.maxSteps ?? 10_000;
  const botsAct = options.botsAct ?? true;
  const settings = options.settings ?? game.defaultSettings;

  let now = 1_700_000_000_000;
  let state!: S;
  let steps = 0;
  const timers = new Map<TimerId, number>();
  const requests: RuntimeRequest[] = [];
  const delivered: E[][] = seatList.map(() => []);
  let memories: unknown[] = seatList.map((seat) => game.bot.createMemory(seat));
  /** Remaining chunks of each seat's running stream plan (due time, chunk). */
  const plans = new Map<SeatIndex, { at: number; chunk: unknown }[]>();

  const apply = (t: Transition<S, E>): void => {
    for (const scoped of t.events as Scoped<E>[]) {
      if (scoped.to !== 'ALL') {
        for (const seat of scoped.seats) {
          if (!seatList.includes(seat)) throw new Error(`Event addressed to unknown seat ${seat}`);
        }
      }
    }
    structuredClone(t.state);
    structuredClone(t.events);
    state = deepFreeze(t.state);
    for (const cmd of t.timers ?? []) {
      if ('set' in cmd) timers.set(cmd.set, now + cmd.ms);
      else timers.delete(cmd.clear);
    }
    requests.push(...(t.requests ?? []));
    memories = seatList.map((seat) => {
      const events = eventsForSeat(t.events, seat);
      delivered[seat]?.push(...events);
      return game.bot.observe(memories[seat], events);
    });
    options.invariant?.(state);
    if (options.perturbHidden) {
      for (const seat of seatList)
        assertNoViewLeak(game, state, seat, options.perturbHidden, leakRng);
    }
    steps++;
    if (steps > maxSteps) throw new Error(`Match did not finish within ${maxSteps} steps`);
  };

  apply(game.setup(seatList, settings, { now, rng }, { bots: seatList }));

  while (!game.isOver(state)) {
    let best: { seat: SeatIndex; action: unknown; thinkMs: number } | null = null;
    if (botsAct) {
      for (const seat of seatList) {
        if (plans.has(seat)) continue;
        const decision = game.bot.decide(game.getPlayerView(state, seat), memories[seat], {
          seat,
          now,
          rng: botRng,
        });
        if (decision?.kind === 'ACTION' && (!best || decision.thinkMs < best.thinkMs)) {
          best = { seat, action: decision.action, thinkMs: decision.thinkMs };
        } else if (decision?.kind === 'STREAM' && options.streams && decision.steps.length > 0) {
          let at = now + decision.thinkMs;
          plans.set(
            seat,
            decision.steps.map((step) => ({
              at: (at += Math.max(0, step.delayMs)),
              chunk: step.chunk,
            })),
          );
        }
      }
    }

    let nextTimer: { id: TimerId; at: number } | null = null;
    for (const [id, at] of timers) {
      if (!nextTimer || at < nextTimer.at) nextTimer = { id, at };
    }
    let nextChunk: { seat: SeatIndex; at: number } | null = null;
    for (const [seat, steps] of plans) {
      const at = (steps[0] as { at: number }).at;
      if (!nextChunk || at < nextChunk.at) nextChunk = { seat, at };
    }

    if (
      nextChunk &&
      (!nextTimer || nextChunk.at < nextTimer.at) &&
      (!best || nextChunk.at <= now + best.thinkMs)
    ) {
      const steps = plans.get(nextChunk.seat) as { at: number; chunk: unknown }[];
      const step = steps.shift() as { at: number; chunk: unknown };
      now = Math.max(now, step.at);
      if (steps.length === 0) plans.delete(nextChunk.seat);
      options.probeStream?.(state, { seat: nextChunk.seat, chunk: step.chunk, now });
      const stream = game.stream;
      const parsed = stream?.chunkSchema.safeParse(step.chunk);
      const out =
        stream && parsed?.success ? stream.accept(state, nextChunk.seat, parsed.data) : null;
      if (out && 'state' in out) {
        structuredClone(out.state);
        state = deepFreeze(out.state as S);
        options.invariant?.(state);
        if (options.perturbHidden) {
          for (const seat of seatList)
            assertNoViewLeak(game, state, seat, options.perturbHidden, leakRng);
        }
      } else {
        // As on the server: the first rejected chunk cancels the rest of the plan.
        plans.delete(nextChunk.seat);
      }
      continue;
    }

    if (best && (!nextTimer || now + best.thinkMs < nextTimer.at)) {
      now += best.thinkMs;
      options.probe?.(state, { seat: best.seat, action: best.action, now });
      const action = game.actionSchema.parse(best.action);
      const verdict = game.validateAction(state, best.seat, action);
      if (!verdict.ok) {
        throw new Error(`Bot at seat ${best.seat} chose an illegal action (${verdict.code})`);
      }
      apply(game.applyAction(state, best.seat, action, { now, rng }));
    } else if (nextTimer) {
      now = Math.max(now, nextTimer.at);
      timers.delete(nextTimer.id);
      apply(game.onTimer(state, nextTimer.id, { now, rng }));
    } else {
      throw new Error('Match stalled: no bot wants to act and no timer is pending');
    }
  }

  const results = game.getResults(state);
  const placed = results.placements.map((p) => p.seat).sort((a, b) => a - b);
  if (stableStringify(placed) !== stableStringify(seatList)) {
    throw new Error(`Results must place every seat exactly once, got ${stableStringify(placed)}`);
  }
  if (results.placements.some((p) => !Number.isInteger(p.place) || p.place < 1)) {
    throw new Error('Placements must be positive integers');
  }

  return { state, steps, results, requests, delivered };
}
