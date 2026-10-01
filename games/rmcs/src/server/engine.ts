import {
  toAll,
  toSeats,
  type GameModule,
  type RuntimeRequest,
  type SeatIndex,
  type SeededRng,
  type StepCtx,
  type Transition,
} from '@cg/game-sdk';
import { z } from 'zod';
import {
  MANTRI_POINTS,
  PHASE_ORDER,
  RAJA_POINTS,
  ROLES,
  SIPAHI_POINTS,
  TOTAL_ROUNDS,
  type Phase,
  type RmcsAction,
  type RmcsEvent,
  type RmcsSettings,
  type RmcsState,
  type RmcsTiming,
  type RmcsView,
  type Role,
  type RoundRecord,
  type SeatMap,
} from '../shared/types';

export const RMCS_GAME_ID = 'rmcs';
const PHASE_TIMER = 'phase';

/** Spec §10 timings. */
export const DEFAULT_TIMING: RmcsTiming = {
  dealMs: 2000,
  revealMs: 2000,
  guessMs: 30_000,
  resultMs: 4000,
};

export interface RmcsOptions {
  /** Multiplies every duration (dev/e2e speed-ups; production uses 1). */
  timeScale?: number;
  /** Per-phase overrides (tests). */
  timing?: Partial<RmcsTiming>;
  /** Bot "thinking" delay range before guessing, in ms (scaled by timeScale). */
  botThinkMs?: [min: number, max: number];
  /** Consecutive guessing timeouts before the seat is handed to a bot. */
  idleAfterTimeouts?: number;
}

type T = Transition<RmcsState, RmcsEvent>;

const phaseIndex = (p: Phase) => PHASE_ORDER.indexOf(p);

export function seatWithRole(roles: SeatMap<Role>, role: Role): number {
  for (const [seat, r] of Object.entries(roles)) if (r === role) return Number(seat);
  throw new Error(`No seat holds ${role}`);
}

/** The two seats the Mantri must choose between. */
export function candidatesOf(s: Pick<RmcsState, 'seats' | 'roles'>): number[] {
  return s.seats.filter((seat) => s.roles[seat] === 'CHOR' || s.roles[seat] === 'SIPAHI');
}

/** Round points: Raja 1000, Sipahi 500; Mantri 800 if right else 0; Chor 0 if caught else 800. */
export function scoreRound(roles: SeatMap<Role>, correct: boolean): SeatMap<number> {
  const deltas: SeatMap<number> = {};
  for (const [seat, role] of Object.entries(roles)) {
    deltas[Number(seat)] =
      role === 'RAJA'
        ? RAJA_POINTS
        : role === 'SIPAHI'
          ? SIPAHI_POINTS
          : role === 'MANTRI'
            ? correct
              ? MANTRI_POINTS
              : 0
            : correct
              ? 0
              : MANTRI_POINTS;
  }
  return deltas;
}

/** Standard competition ranking: equal scores share a place (1, 1, 3, 4). */
export function rankByScore(seats: number[], scores: SeatMap<number>) {
  return seats.map((seat) => ({
    seat,
    place: 1 + seats.filter((other) => (scores[other] ?? 0) > (scores[seat] ?? 0)).length,
  }));
}

export function createRmcsGame(
  options: RmcsOptions = {},
): GameModule<RmcsState, RmcsAction, RmcsView, RmcsEvent, RmcsSettings> {
  const scale = options.timeScale ?? 1;
  const timing: RmcsTiming = {
    dealMs: Math.round((options.timing?.dealMs ?? DEFAULT_TIMING.dealMs) * scale),
    revealMs: Math.round((options.timing?.revealMs ?? DEFAULT_TIMING.revealMs) * scale),
    guessMs: Math.round((options.timing?.guessMs ?? DEFAULT_TIMING.guessMs) * scale),
    resultMs: Math.round((options.timing?.resultMs ?? DEFAULT_TIMING.resultMs) * scale),
  };
  const [thinkMin, thinkMax] = (options.botThinkMs ?? [800, 2500]).map((ms) =>
    Math.max(0, Math.round(ms * scale)),
  ) as [number, number];
  const idleAfter = options.idleAfterTimeouts ?? 2;

  const enter = (s: RmcsState, phase: Phase, ms: number, ctx: StepCtx): RmcsState => ({
    ...s,
    phase,
    phaseMs: ms,
    phaseEndsAt: ctx.now + ms,
  });

  /** Shuffle the four chits and start a round. */
  const deal = (s: RmcsState, round: number, ctx: StepCtx): T => {
    const shuffled = ctx.rng.shuffle(ROLES);
    const roles: SeatMap<Role> = {};
    s.seats.forEach((seat, i) => {
      roles[seat] = shuffled[i] as Role;
    });
    const state = enter({ ...s, round, roles }, 'DEALING', s.timing.dealMs, ctx);
    return {
      state,
      events: [
        toAll({ type: 'ROUND_STARTED', round }),
        ...s.seats.map((seat) =>
          toSeats([seat], { type: 'ROLE_DEALT', role: roles[seat] as Role } as RmcsEvent),
        ),
      ],
      timers: [{ set: PHASE_TIMER, ms: s.timing.dealMs }],
    };
  };

  const resolve = (s: RmcsState, target: number, auto: boolean, ctx: StepCtx): T => {
    const mantri = seatWithRole(s.roles, 'MANTRI');
    const chor = seatWithRole(s.roles, 'CHOR');
    const correct = target === chor;
    const deltas = scoreRound(s.roles, correct);
    const scores: SeatMap<number> = {};
    for (const seat of s.seats) scores[seat] = (s.scores[seat] ?? 0) + (deltas[seat] ?? 0);

    const count = auto ? (s.timeouts[mantri] ?? 0) + 1 : 0;
    const requests: RuntimeRequest[] =
      auto && count === idleAfter ? [{ type: 'MARK_IDLE', seat: mantri }] : [];
    const record: RoundRecord = {
      round: s.round,
      roles: { ...s.roles },
      mantri,
      chor,
      target,
      correct,
      auto,
      deltas,
    };
    const state = enter(
      {
        ...s,
        scores,
        timeouts: { ...s.timeouts, [mantri]: count },
        history: [...s.history, record],
      },
      'ROUND_RESULT',
      s.timing.resultMs,
      ctx,
    );
    return {
      state,
      events: [
        toAll({ type: 'GUESS_MADE', mantri, target, auto }),
        toAll({
          type: 'ROUND_RESOLVED',
          round: s.round,
          roles: { ...s.roles },
          correct,
          deltas,
          scores,
        }),
      ],
      timers: [{ set: PHASE_TIMER, ms: s.timing.resultMs }],
      requests,
    };
  };

  const nothing = (s: RmcsState): T => ({ state: s, events: [] });

  return {
    manifest: {
      id: RMCS_GAME_ID,
      version: 1,
      players: { min: 4, max: 4 },
      sync: 'TURN_PHASE',
      bots: { supported: true, canTakeOverSeat: true },
      publicMatch: { targetPlayers: 4, minHumans: 2 },
      reclaim: 'IMMEDIATE',
      layout: { orientation: 'any' },
    },

    settingsSchema: z.strictObject({}) as unknown as z.ZodType<RmcsSettings>,
    defaultSettings: {},

    actionSchema: z.strictObject({
      type: z.literal('GUESS'),
      target: z.number().int().min(0).max(15),
    }),

    setup(seats, _settings, ctx) {
      if (seats.length !== 4) throw new Error('Raja Mantri Chor Sipahi needs exactly 4 seats');
      const zero = Object.fromEntries(seats.map((seat) => [seat, 0])) as SeatMap<number>;
      const initial: RmcsState = {
        phase: 'DEALING',
        seats: [...seats],
        round: 0,
        roles: {},
        scores: zero,
        phaseEndsAt: ctx.now,
        phaseMs: 0,
        timing,
        timeouts: { ...zero },
        history: [],
      };
      return deal(initial, 1, ctx);
    },

    validateAction(s, seat, a) {
      if (s.phase !== 'GUESSING') return { ok: false, code: 'INVALID_PHASE' };
      if (s.roles[seat] !== 'MANTRI') return { ok: false, code: 'NOT_YOUR_TURN' };
      if (!candidatesOf(s).includes(a.target)) return { ok: false, code: 'ILLEGAL_ACTION' };
      return { ok: true };
    },

    applyAction(s, _seat, a, ctx) {
      return resolve(s, a.target, false, ctx);
    },

    onTimer(s, timer, ctx) {
      if (timer !== PHASE_TIMER) return nothing(s);
      switch (s.phase) {
        case 'DEALING': {
          const seat = seatWithRole(s.roles, 'RAJA');
          return {
            state: enter(s, 'REVEAL_RAJA', s.timing.revealMs, ctx),
            events: [toAll({ type: 'RAJA_REVEALED', seat })],
            timers: [{ set: PHASE_TIMER, ms: s.timing.revealMs }],
          };
        }
        case 'REVEAL_RAJA': {
          const seat = seatWithRole(s.roles, 'MANTRI');
          return {
            state: enter(s, 'REVEAL_MANTRI', s.timing.revealMs, ctx),
            events: [toAll({ type: 'MANTRI_REVEALED', seat })],
            timers: [{ set: PHASE_TIMER, ms: s.timing.revealMs }],
          };
        }
        case 'REVEAL_MANTRI': {
          const state = enter(s, 'GUESSING', s.timing.guessMs, ctx);
          return {
            state,
            events: [
              toAll({
                type: 'GUESSING_STARTED',
                mantri: seatWithRole(s.roles, 'MANTRI'),
                deadline: state.phaseEndsAt,
              }),
            ],
            timers: [{ set: PHASE_TIMER, ms: s.timing.guessMs }],
          };
        }
        case 'GUESSING':
          // Time's up: the server guesses at random for the Mantri (spec §10).
          return resolve(s, ctx.rng.pick(candidatesOf(s)), true, ctx);
        case 'ROUND_RESULT':
          if (s.round < TOTAL_ROUNDS) return deal(s, s.round + 1, ctx);
          return {
            state: { ...s, phase: 'OVER', phaseMs: 0, phaseEndsAt: ctx.now },
            events: [toAll({ type: 'MATCH_OVER', scores: { ...s.scores } })],
          };
        case 'OVER':
          return nothing(s);
      }
    },

    onSeatChange(s, seat, change) {
      if (change === 'BOT_TOOK_OVER' || change === 'RECLAIMED') {
        return { state: { ...s, timeouts: { ...s.timeouts, [seat]: 0 } }, events: [] };
      }
      return nothing(s);
    },

    getPlayerView(s, viewer): RmcsView {
      const idx = phaseIndex(s.phase);
      const everything = idx >= phaseIndex('ROUND_RESULT');
      const raja = idx >= phaseIndex('REVEAL_RAJA') ? seatWithRole(s.roles, 'RAJA') : null;
      const mantri = idx >= phaseIndex('REVEAL_MANTRI') ? seatWithRole(s.roles, 'MANTRI') : null;
      const known: SeatMap<Role> = {};
      for (const seat of s.seats) {
        if (everything || seat === viewer || seat === raja || seat === mantri) {
          known[seat] = s.roles[seat] as Role;
        }
      }
      return {
        phase: s.phase,
        round: s.round,
        totalRounds: TOTAL_ROUNDS,
        phaseEndsAt: s.phaseEndsAt,
        phaseMs: s.phaseMs,
        myRole: s.roles[viewer] as Role,
        known,
        raja,
        mantri,
        candidates: mantri === null ? [] : candidatesOf(s),
        scores: { ...s.scores },
        history: s.history,
      };
    },

    isOver: (s) => s.phase === 'OVER',

    getResults(s) {
      return {
        placements: rankByScore(s.seats, s.scores),
        stats: Object.fromEntries(s.seats.map((seat) => [seat, { score: s.scores[seat] ?? 0 }])),
      };
    },

    bot: {
      createMemory: () => null,
      observe: (memory) => memory,
      /**
       * The only decision in RMCS is the Mantri's guess between two players the
       * bot knows nothing about, so a uniformly random guess is the honest
       * strategy — it never looks at hidden roles.
       */
      decide(view, _memory, ctx) {
        if (view.phase !== 'GUESSING' || view.mantri !== ctx.seat) return null;
        return {
          kind: 'ACTION',
          action: { type: 'GUESS', target: ctx.rng.pick(view.candidates) },
          thinkMs: ctx.rng.int(thinkMin, thinkMax),
        };
      },
    },
  };
}

export const rmcsGame = createRmcsGame();

/**
 * Leak-checker helper: shuffles the roles hidden from `viewer` among the seats
 * that hold them. `viewer`'s view must not change.
 */
export function perturbRmcsHidden(s: RmcsState, viewer: SeatIndex, rng: SeededRng): RmcsState {
  const idx = phaseIndex(s.phase);
  if (idx >= phaseIndex('ROUND_RESULT')) return s;
  const revealed = new Set<number>([viewer]);
  if (idx >= phaseIndex('REVEAL_RAJA')) revealed.add(seatWithRole(s.roles, 'RAJA'));
  if (idx >= phaseIndex('REVEAL_MANTRI')) revealed.add(seatWithRole(s.roles, 'MANTRI'));
  const hidden = s.seats.filter((seat) => !revealed.has(seat));
  if (hidden.length < 2) return s;
  const shuffled = rng.shuffle(hidden.map((seat) => s.roles[seat] as Role));
  const roles = { ...s.roles };
  hidden.forEach((seat, i) => {
    roles[seat] = shuffled[i] as Role;
  });
  return { ...s, roles };
}
