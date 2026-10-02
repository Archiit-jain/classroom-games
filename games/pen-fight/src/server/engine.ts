import {
  toAll,
  type GameModule,
  type RuntimeRequest,
  type Scoped,
  type SeededRng,
  type StepCtx,
  type Transition,
} from '@cg/game-sdk';
import { z } from 'zod';
import { deskAfter, outsideDesk, placesOf } from '../shared/table';
import {
  ANGLE_SCALE,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PHYSICS_HZ,
  POS_SCALE,
  type Boundary,
  type Elimination,
  type FightAction,
  type FightEvent,
  type FightSettings,
  type FightState,
  type FightTiming,
  type FightView,
  type Pen,
  type SeatMap,
  type Shot,
} from '../shared/types';
import { DEFAULT_PHYSICS, simulateShot, type PhysicsParams, type ShotResult } from './physics';

export const PEN_FIGHT_GAME_ID = 'pen-fight';
const PHASE_TIMER = 'phase';

/** Spec §13 / Appendix A (aim 15 s, replay + 0.5 s); the shrink hold is a play-test value. */
export const DEFAULT_TIMING: FightTiming = { aimMs: 15_000, afterReplayMs: 500, shrinkMs: 1500 };

export interface BotOptions {
  /** Candidate shots simulated per decision (spec: up to 24). */
  candidates: number;
  thinkMs: [number, number];
  /** Human-like error added to the chosen shot. */
  aimNoiseDeg: number;
  powerNoise: number;
}

export const DEFAULT_BOT: BotOptions = {
  candidates: 24,
  thinkMs: [800, 2500],
  aimNoiseDeg: 2.5,
  powerNoise: 0.05,
};

export interface FightOptions {
  /** Multiplies every duration (dev/e2e speed-ups; production uses 1). */
  timeScale?: number;
  timing?: Partial<FightTiming>;
  /** Physics constants — play-test values (design §14). */
  physics?: Partial<PhysicsParams>;
  /** Weakest flick (a zero flick is pointless). */
  minPower?: number;
  /** Full rounds without an elimination before sudden death arms (spec: 10). */
  quietRoundsToArm?: number;
  /** Consecutive skipped turns before the seat is handed to a bot (spec: 3). */
  idleAfterSkips?: number;
  bot?: Partial<BotOptions>;
}

type T = Transition<FightState, FightEvent>;
type Ev = Scoped<FightEvent>;

/** Starting spots (world units) for 2, 3 and 4 pens, symmetric about the centre. */
const SPOTS: Record<number, [number, number][]> = {
  2: [
    [-3, 0],
    [3, 0],
  ],
  3: [
    [0, -2.3],
    [2.8, 1.6],
    [-2.8, 1.6],
  ],
  4: [
    [-3, -2],
    [3, -2],
    [3, 2],
    [-3, 2],
  ],
};

const TURN = 2 * Math.PI;
/** Angle normalised to (−π, π]. */
const normAngle = (a: number) => {
  const r = ((((a + Math.PI) % TURN) + TURN) % TURN) - Math.PI;
  return r === -Math.PI ? Math.PI : r;
};
const quant = (v: number) => Math.round(v * 10_000) / 10_000;

/** Distance (world units) from a pen's centre to the nearest edge of a desk. */
function edgeDistance(pen: Pen, b: Boundary): number {
  return Math.min(b.w / 2 - Math.abs(pen.x), b.h / 2 - Math.abs(pen.y)) / POS_SCALE;
}

export function createPenFightGame(
  options: FightOptions = {},
): GameModule<FightState, FightAction, FightView, FightEvent, FightSettings> {
  const scale = options.timeScale ?? 1;
  const timing: FightTiming = {
    aimMs: Math.round((options.timing?.aimMs ?? DEFAULT_TIMING.aimMs) * scale),
    afterReplayMs: Math.round(
      (options.timing?.afterReplayMs ?? DEFAULT_TIMING.afterReplayMs) * scale,
    ),
    shrinkMs: Math.round((options.timing?.shrinkMs ?? DEFAULT_TIMING.shrinkMs) * scale),
  };
  const physics: PhysicsParams = { ...DEFAULT_PHYSICS, ...options.physics };
  const minPower = options.minPower ?? 0.05;
  const quietToArm = options.quietRoundsToArm ?? 10;
  const idleAfter = options.idleAfterSkips ?? 3;
  const bot: BotOptions = { ...DEFAULT_BOT, ...options.bot };
  const [thinkMin, thinkMax] = bot.thinkMs.map((v) => Math.round(v * scale)) as [number, number];

  /** Validated, clamped and quantised (so a replay from the action log is exact). */
  const normalizeShot = (a: Shot): Shot => ({
    anchor: quant(Math.min(1, Math.max(-1, a.anchor))),
    angle: quant(normAngle(a.angle)),
    power: quant(Math.min(1, Math.max(minPower, a.power))),
  });

  const enter = (s: FightState, phase: FightState['phase'], ms: number, ctx: StepCtx) => ({
    ...s,
    phase,
    phaseMs: ms,
    phaseEndsAt: ctx.now + ms,
  });
  const alive = (s: FightState) => s.pens.filter((p) => p.alive);

  const over = (s: FightState, ctx: StepCtx, events: Ev[], requests: RuntimeRequest[]): T => ({
    state: enter(s, 'OVER', 0, ctx),
    events: [...events, toAll({ type: 'MATCH_OVER' })],
    timers: [{ clear: PHASE_TIMER }],
    requests,
  });

  /** The next seat in this round's queue aims. */
  const startAiming = (
    s: FightState,
    ctx: StepCtx,
    events: Ev[],
    requests: RuntimeRequest[] = [],
  ): T => {
    const [active, ...queue] = s.queue as [number, ...number[]];
    const state = enter({ ...s, active, queue }, 'AIMING', s.timing.aimMs, ctx);
    return {
      state,
      events: [
        ...events,
        toAll({ type: 'TURN_STARTED', seat: active, round: s.round, deadline: state.phaseEndsAt }),
      ],
      timers: [{ set: PHASE_TIMER, ms: s.timing.aimMs }],
      requests,
    };
  };

  /** Applies the previewed desk: pens whose centre is outside are out. */
  const shrink = (s: FightState, ctx: StepCtx, events: Ev[], requests: RuntimeRequest[]): T => {
    const boundary = s.preview ?? s.boundary;
    const shrinks = s.shrinks + 1;
    const seq = s.seq + 1;
    const out: Elimination[] = [];
    const pens = s.pens.map((pen) => {
      if (!pen.alive || !outsideDesk(pen.x, pen.y, boundary)) return pen;
      out.push({
        seat: pen.seat,
        cause: 'SHRINK',
        seq,
        tick: 0,
        dist: Math.round(Math.hypot(pen.x, pen.y)),
        by: null,
        round: s.round,
      });
      return { ...pen, alive: false };
    });
    const next = deskAfter(shrinks + 1);
    const queue = s.order.filter((seat) => pens.some((p) => p.seat === seat && p.alive));
    const state = enter(
      {
        ...s,
        pens,
        boundary,
        preview: next,
        shrinks,
        seq,
        queue,
        eliminations: [...s.eliminations, ...out],
        lastShot: null,
      },
      'SHRINKING',
      s.timing.shrinkMs,
      ctx,
    );
    return {
      state,
      events: [
        ...events,
        toAll({ type: 'DESK_SHRUNK', boundary, eliminated: out.map((e) => e.seat), next }),
      ],
      timers: [{ set: PHASE_TIMER, ms: s.timing.shrinkMs }],
      requests,
    };
  };

  /** After a turn (played or skipped): the next seat, a new round, sudden death, or the end. */
  const advance = (
    s: FightState,
    ctx: StepCtx,
    events: Ev[] = [],
    requests: RuntimeRequest[] = [],
  ): T => {
    if (alive(s).length <= 1) return over(s, ctx, events, requests);
    const queue = s.queue.filter((seat) => s.pens.some((p) => p.seat === seat && p.alive));
    if (queue.length > 0) return startAiming({ ...s, queue }, ctx, events, requests);

    // Round boundary.
    const quietRounds = s.suddenDeath
      ? s.quietRounds
      : s.eliminatedThisRound
        ? 0
        : s.quietRounds + 1;
    const next: FightState = {
      ...s,
      round: s.round + 1,
      quietRounds,
      eliminatedThisRound: false,
      queue: s.order.filter((seat) => s.pens.some((p) => p.seat === seat && p.alive)),
    };
    if (s.suddenDeath) return shrink(next, ctx, events, requests);
    if (quietRounds >= quietToArm) {
      // Arms permanently; the first smaller desk is previewed for this whole round.
      const preview = deskAfter(1);
      return startAiming(
        { ...next, suddenDeath: true, preview },
        ctx,
        [...events, toAll({ type: 'SUDDEN_DEATH_ARMED', next: preview })],
        requests,
      );
    }
    return startAiming(next, ctx, events, requests);
  };

  const flick = (s: FightState, seat: number, shot: Shot, ctx: StepCtx): T => {
    const result = simulateShot(s.pens, s.boundary, seat, shot, physics);
    const seq = s.seq + 1;
    const out: Elimination[] = result.eliminations.map((e) => ({
      seat: e.seat,
      cause: 'SHOT',
      seq,
      tick: e.tick,
      dist: e.dist,
      by: seat,
      round: s.round,
    }));
    const knocked = out.filter((e) => e.seat !== seat).length;
    const durationMs = Math.round((result.steps / PHYSICS_HZ) * 1000);
    const holdMs = Math.round(durationMs * scale) + s.timing.afterReplayMs;
    const state = enter(
      {
        ...s,
        pens: result.final,
        seq,
        eliminations: [...s.eliminations, ...out],
        eliminatedThisRound: s.eliminatedThisRound || out.length > 0,
        skips: { ...s.skips, [seat]: 0 },
        knockouts: { ...s.knockouts, [seat]: (s.knockouts[seat] ?? 0) + knocked },
        lastShot: { seat, eliminated: out.map((e) => e.seat) },
      },
      'PLAYBACK',
      holdMs,
      ctx,
    );
    return {
      state,
      events: [
        toAll({
          type: 'SHOT_PLAYED',
          seat,
          shot,
          start: result.start,
          frames: result.frames,
          steps: result.steps,
          collisions: result.collisions,
          eliminations: result.eliminations.map(({ seat: who, tick }) => ({ seat: who, tick })),
          durationMs,
        }),
      ],
      timers: [{ set: PHASE_TIMER, ms: holdMs }],
    };
  };

  const viewOf = (s: FightState): FightView => {
    const places: SeatMap<number> = {};
    for (const { seat, place } of placesOf(s.pens, s.eliminations)) {
      if (s.phase === 'OVER' || s.eliminations.some((e) => e.seat === seat)) places[seat] = place;
    }
    return {
      phase: s.phase,
      round: s.round,
      order: s.order,
      active: s.active,
      pens: s.pens,
      boundary: s.boundary,
      preview: s.preview,
      suddenDeath: s.suddenDeath,
      quietRounds: s.quietRounds,
      eliminations: s.eliminations,
      places,
      knockouts: s.knockouts,
      lastShot: s.lastShot,
      phaseEndsAt: s.phaseEndsAt,
      phaseMs: s.phaseMs,
    };
  };

  // ───────────────────────────── bot ─────────────────────────────

  /** Up to `bot.candidates` shots: aimed at each opponent (centre, ends, power levels), then random. */
  function candidateShots(view: FightView, me: Pen, rng: SeededRng): Shot[] {
    const shots: Shot[] = [];
    const deg = Math.PI / 180;
    const opponents = view.pens.filter((p) => p.alive && p.seat !== me.seat);
    for (const opp of opponents) {
      const toward = Math.atan2(opp.y - me.y, opp.x - me.x);
      const ends = [1, -1].map((side) => {
        const ex = opp.x + side * Math.cos(opp.a / ANGLE_SCALE) * 500;
        const ey = opp.y + side * Math.sin(opp.a / ANGLE_SCALE) * 500;
        return Math.atan2(ey - me.y, ex - me.x);
      });
      shots.push(
        { angle: toward, power: 0.75, anchor: 0 },
        { angle: toward, power: 0.95, anchor: 0 },
        { angle: toward + 4 * deg, power: 0.95, anchor: 0.3 },
        { angle: toward - 4 * deg, power: 0.95, anchor: -0.3 },
        { angle: ends[0] as number, power: 0.85, anchor: 0 },
        { angle: ends[1] as number, power: 0.85, anchor: 0 },
      );
    }
    while (shots.length < bot.candidates) {
      shots.push({
        angle: rng.next() * TURN - Math.PI,
        power: 0.3 + rng.next() * 0.7,
        anchor: rng.next() - 0.5,
      });
    }
    return shots.slice(0, bot.candidates).map(normalizeShot);
  }

  /** How good an outcome is for `seat`: knock others out, stay on, push them to the edge. */
  function scoreOutcome(view: FightView, seat: number, result: ShotResult): number {
    const desk = view.preview ?? view.boundary;
    let score = 0;
    for (const e of result.eliminations) score += e.seat === seat ? -250 : 100;
    for (const pen of result.final) {
      if (!pen.alive) continue;
      const d = edgeDistance(pen, desk);
      score += pen.seat === seat ? 10 * d : -4 * d;
    }
    return score;
  }

  return {
    manifest: {
      id: PEN_FIGHT_GAME_ID,
      version: 1,
      players: { min: MIN_PLAYERS, max: MAX_PLAYERS },
      sync: 'SIMULATED',
      bots: { supported: true, canTakeOverSeat: true },
      publicMatch: { targetPlayers: 4, minHumans: 2 },
      reclaim: 'IMMEDIATE',
      layout: { orientation: 'any' },
    },

    settingsSchema: z.strictObject({}) as unknown as z.ZodType<FightSettings>,
    defaultSettings: {},

    actionSchema: z.strictObject({
      type: z.literal('FLICK'),
      anchor: z.number().finite(),
      angle: z.number().finite(),
      power: z.number().finite(),
    }),

    setup(seats, _settings, ctx) {
      if (seats.length < MIN_PLAYERS || seats.length > MAX_PLAYERS) {
        throw new Error('Pen Fight needs 2–4 players');
      }
      const order = ctx.rng.shuffle(seats);
      const spots = SPOTS[seats.length] as [number, number][];
      const pens: Pen[] = order.map((seat, i) => {
        const [x, y] = spots[i] as [number, number];
        return {
          seat,
          x: Math.round(x * POS_SCALE),
          y: Math.round(y * POS_SCALE),
          a: Math.round((ctx.rng.next() * TURN - Math.PI) * ANGLE_SCALE),
          alive: true,
        };
      });
      const zero = Object.fromEntries(seats.map((seat) => [seat, 0])) as SeatMap<number>;
      const initial: FightState = {
        phase: 'AIMING',
        seats: [...seats],
        order,
        round: 1,
        queue: [...order],
        active: order[0] as number,
        pens: pens.sort((a, b) => a.seat - b.seat),
        boundary: deskAfter(0),
        preview: null,
        shrinks: 0,
        quietRounds: 0,
        suddenDeath: false,
        eliminatedThisRound: false,
        eliminations: [],
        seq: 0,
        skips: { ...zero },
        knockouts: { ...zero },
        lastShot: null,
        phaseEndsAt: ctx.now,
        phaseMs: 0,
        timing,
      };
      return startAiming(initial, ctx, []);
    },

    validateAction(s, seat) {
      if (s.phase !== 'AIMING') return { ok: false, code: 'INVALID_PHASE' };
      if (seat !== s.active) return { ok: false, code: 'NOT_YOUR_TURN' };
      return { ok: true };
    },

    applyAction(s, seat, a, ctx) {
      return flick(s, seat, normalizeShot(a), ctx);
    },

    onTimer(s, timer, ctx) {
      if (timer !== PHASE_TIMER) return { state: s, events: [] };
      switch (s.phase) {
        case 'AIMING': {
          // Time's up: the turn is skipped (spec), and counts towards idle.
          const skips = (s.skips[s.active] ?? 0) + 1;
          const requests: RuntimeRequest[] =
            skips === idleAfter ? [{ type: 'MARK_IDLE', seat: s.active }] : [];
          return advance(
            { ...s, skips: { ...s.skips, [s.active]: skips }, lastShot: null },
            ctx,
            [toAll({ type: 'TURN_SKIPPED', seat: s.active })],
            requests,
          );
        }
        case 'PLAYBACK':
          return advance(s, ctx);
        case 'SHRINKING':
          if (alive(s).length <= 1) return over(s, ctx, [], []);
          return startAiming(s, ctx, []);
        case 'OVER':
          return { state: s, events: [] };
      }
    },

    onSeatChange(s, seat, change) {
      if (change === 'BOT_TOOK_OVER' || change === 'RECLAIMED') {
        return { state: { ...s, skips: { ...s.skips, [seat]: 0 } }, events: [] };
      }
      return { state: s, events: [] };
    },

    getPlayerView: viewOf,
    isOver: (s) => s.phase === 'OVER',

    getResults(s) {
      return {
        placements: placesOf(s.pens, s.eliminations),
        stats: Object.fromEntries(
          s.seats.map((seat) => [seat, { knockouts: s.knockouts[seat] ?? 0 }]),
        ),
      };
    },

    bot: {
      createMemory: () => null,
      observe: (memory) => memory,
      decide(view, _memory, ctx) {
        if (view.phase !== 'AIMING' || view.active !== ctx.seat) return null;
        const me = view.pens.find((p) => p.seat === ctx.seat && p.alive);
        if (!me) return null;
        const scored = candidateShots(view, me, ctx.rng)
          .map((shot) => ({
            shot,
            score: scoreOutcome(
              view,
              ctx.seat,
              simulateShot(view.pens, view.boundary, ctx.seat, shot, physics, false),
            ),
          }))
          .sort((a, b) => b.score - a.score);
        // Usually the best, sometimes the 2nd or 3rd; then human-like error.
        const roll = ctx.rng.next();
        const pick =
          scored[roll < 0.6 ? 0 : roll < 0.9 ? 1 : 2] ?? (scored[0] as (typeof scored)[0]);
        const noise = (ctx.rng.next() * 2 - 1) * bot.aimNoiseDeg * (Math.PI / 180);
        const noisy = normalizeShot({
          anchor: pick.shot.anchor,
          angle: pick.shot.angle + noise,
          power: pick.shot.power * (1 + (ctx.rng.next() * 2 - 1) * bot.powerNoise),
        });
        // A careful player: the error never turns a safe shot into flicking itself off.
        const selfOut = (shot: Shot) =>
          simulateShot(view.pens, view.boundary, ctx.seat, shot, physics, false).eliminations.some(
            (e) => e.seat === ctx.seat,
          );
        const shot = selfOut(noisy) && !selfOut(pick.shot) ? pick.shot : noisy;
        const timeLeft = view.phaseEndsAt - ctx.now - 400;
        const thinkMs = Math.max(0, Math.min(ctx.rng.int(thinkMin, thinkMax), timeLeft));
        return { kind: 'ACTION', action: { type: 'FLICK', ...shot }, thinkMs };
      },
    },
  };
}

export const penFightGame = createPenFightGame();
