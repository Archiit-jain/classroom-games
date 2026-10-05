import { z } from 'zod';
import { toAll, toSeats } from '../audience';
import type {
  GameModule,
  RuntimeRequest,
  Scoped,
  SeatIndex,
  StepCtx,
  Transition,
} from '../contract';
import type { SeededRng } from '../rng';
import type {
  FixtureAction,
  FixtureBotMemory,
  FixtureEvent,
  FixtureSettings,
  FixtureState,
  FixtureView,
} from './types';

export const FIXTURE_GAME_ID = 'fixture';
const TURN_TIMER = 'turn';

export interface FixtureOptions {
  /** Overrides `turnSeconds` (tests use very short turns). */
  turnMs?: number;
  /** Consecutive timeouts before the engine asks the platform to mark a seat idle. */
  idleAfterTimeouts?: number;
  /** Bot "thinking" delay range in ms (tests use short delays). */
  botThinkMs?: [min: number, max: number];
}

type T = Transition<FixtureState, FixtureEvent>;

export function createFixtureGame(
  options: FixtureOptions = {},
): GameModule<FixtureState, FixtureAction, FixtureView, FixtureEvent, FixtureSettings> {
  const idleAfter = options.idleAfterTimeouts ?? 2;
  const [thinkMin, thinkMax] = options.botThinkMs ?? [600, 1200];

  const nextSeat = (s: FixtureState, seat: SeatIndex): SeatIndex => {
    const i = s.seats.indexOf(seat);
    return s.seats[(i + 1) % s.seats.length] as SeatIndex;
  };

  const advance = (
    s: FixtureState,
    seat: SeatIndex,
    amount: number,
    auto: boolean,
    ctx: StepCtx,
    timeouts: Record<number, number>,
    requests: RuntimeRequest[],
  ): T => {
    const counter = s.counter + amount;
    const lastMove = { seat, amount, auto };
    const added: Scoped<FixtureEvent> = toAll({ type: 'ADDED', seat, amount, counter, auto });

    if (counter >= s.target) {
      return {
        state: { ...s, counter, lastMove, timeouts, phase: 'OVER', winner: seat },
        events: [added, toAll({ type: 'MATCH_OVER', winner: seat, lucky: s.lucky })],
        timers: [{ clear: TURN_TIMER }],
        requests,
      };
    }

    const turn = nextSeat(s, seat);
    const turnDeadline = ctx.now + s.turnMs;
    return {
      state: { ...s, counter, lastMove, timeouts, turn, turnDeadline },
      events: [added, toAll({ type: 'TURN_STARTED', seat: turn, deadline: turnDeadline })],
      timers: [{ set: TURN_TIMER, ms: s.turnMs }],
      requests,
    };
  };

  return {
    manifest: {
      id: FIXTURE_GAME_ID,
      version: 1,
      players: { min: 2, max: 4 },
      sync: 'TURN_PHASE',
      bots: { supported: true, canTakeOverSeat: true },
      publicMatch: { enabled: false, targetPlayers: 4, minHumans: 2 },
      reclaim: 'IMMEDIATE',
      layout: { orientation: 'any' },
    },

    settingsSchema: z.strictObject({
      target: z.number().int().min(10).max(30),
      turnSeconds: z.number().int().min(5).max(30),
    }),
    defaultSettings: { target: 15, turnSeconds: 10 },

    actionSchema: z.strictObject({
      type: z.literal('ADD'),
      amount: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    }),

    setup(seats, settings, ctx) {
      const turnMs = options.turnMs ?? settings.turnSeconds * 1000;
      const lucky: Record<number, number> = {};
      const timeouts: Record<number, number> = {};
      for (const seat of seats) {
        lucky[seat] = ctx.rng.int(1, 9);
        timeouts[seat] = 0;
      }
      const first = seats[0] as SeatIndex;
      const turnDeadline = ctx.now + turnMs;
      const state: FixtureState = {
        phase: 'PLAYING',
        seats: [...seats],
        counter: 0,
        target: settings.target,
        turnMs,
        turn: first,
        turnDeadline,
        lucky,
        timeouts,
        lastMove: null,
        winner: null,
      };
      return {
        state,
        events: [
          ...seats.map((seat) =>
            toSeats([seat], { type: 'LUCKY_DEALT', lucky: lucky[seat] as number } as const),
          ),
          toAll({ type: 'TURN_STARTED', seat: first, deadline: turnDeadline }),
        ],
        timers: [{ set: TURN_TIMER, ms: turnMs }],
      };
    },

    validateAction(s, seat) {
      if (s.phase !== 'PLAYING') return { ok: false, code: 'INVALID_PHASE' };
      if (seat !== s.turn) return { ok: false, code: 'NOT_YOUR_TURN' };
      return { ok: true };
    },

    applyAction(s, seat, a, ctx) {
      return advance(s, seat, a.amount, false, ctx, { ...s.timeouts, [seat]: 0 }, []);
    },

    onTimer(s, timer, ctx) {
      if (timer !== TURN_TIMER || s.phase !== 'PLAYING') return { state: s, events: [] };
      const seat = s.turn;
      const count = (s.timeouts[seat] ?? 0) + 1;
      const requests: RuntimeRequest[] = count === idleAfter ? [{ type: 'MARK_IDLE', seat }] : [];
      return advance(s, seat, 1, true, ctx, { ...s.timeouts, [seat]: count }, requests);
    },

    onSeatChange(s, seat, change) {
      if (change === 'BOT_TOOK_OVER' || change === 'RECLAIMED') {
        return { state: { ...s, timeouts: { ...s.timeouts, [seat]: 0 } }, events: [] };
      }
      return { state: s, events: [] };
    },

    getPlayerView(s, viewer) {
      return {
        phase: s.phase,
        counter: s.counter,
        target: s.target,
        turn: s.turn,
        turnDeadline: s.turnDeadline,
        yourLucky: s.lucky[viewer] ?? 0,
        lastMove: s.lastMove,
        winner: s.winner,
        revealedLucky: s.phase === 'OVER' ? { ...s.lucky } : null,
      };
    },

    isOver: (s) => s.phase === 'OVER',

    getResults(s) {
      return {
        placements: s.seats.map((seat) => ({ seat, place: seat === s.winner ? 1 : 2 })),
        stats: Object.fromEntries(s.seats.map((seat) => [seat, { lucky: s.lucky[seat] ?? 0 }])),
      };
    },

    bot: {
      createMemory: (): FixtureBotMemory => ({ movesSeen: 0 }),
      observe: (memory: FixtureBotMemory, events: FixtureEvent[]): FixtureBotMemory => ({
        movesSeen: memory.movesSeen + events.filter((e) => e.type === 'ADDED').length,
      }),
      decide(view, _memory, ctx) {
        if (view.phase !== 'PLAYING' || view.turn !== ctx.seat) return null;
        const remaining = view.target - view.counter;
        const amount = (remaining <= 3 ? remaining : ctx.rng.int(1, 3)) as 1 | 2 | 3;
        return {
          kind: 'ACTION',
          action: { type: 'ADD', amount },
          thinkMs: ctx.rng.int(thinkMin, thinkMax),
        };
      },
    },
  };
}

export const fixtureGame = createFixtureGame();

/**
 * Leak-checker helper: returns a copy of the state in which every piece of
 * information hidden from `viewer` has been changed. A correct view for
 * `viewer` must be identical for both states.
 */
export function perturbFixtureHidden(
  s: FixtureState,
  viewer: SeatIndex,
  rng: SeededRng,
): FixtureState {
  if (s.phase === 'OVER') return s;
  const lucky: Record<number, number> = {};
  for (const seat of s.seats) {
    const current = s.lucky[seat] as number;
    lucky[seat] = seat === viewer ? current : ((current + rng.int(0, 7)) % 9) + 1;
  }
  return { ...s, lucky };
}
