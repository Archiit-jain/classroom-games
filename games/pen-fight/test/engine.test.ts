import { createRng, type StepCtx, type Transition } from '@cg/game-sdk';
import { deepFreeze, simulateMatch } from '@cg/game-sdk/testing';
import { describe, expect, it } from 'vitest';
import { createPenFightGame, penFightGame, simulateShot } from '../src/server';
import {
  ANGLE_SCALE,
  deskAfter,
  outsideDesk,
  placesOf,
  type Elimination,
  type FightEvent,
  type FightState,
  type Pen,
} from '../src/shared';

type T = Transition<FightState, FightEvent>;
const game = penFightGame;
const ctx = (now: number, seed = 7): StepCtx => ({ now, rng: createRng(seed) });
const frozen = (t: T): T => ({ ...t, state: deepFreeze(t.state) });
const start = (n = 4, seed = 7) =>
  frozen(
    game.setup(
      Array.from({ length: n }, (_, i) => i),
      {},
      ctx(10_000, seed),
    ),
  );
const timeout = (s: FightState) => frozen(game.onTimer(s, 'phase', ctx(s.phaseEndsAt)));
const flick = (s: FightState, shot = { anchor: 0, angle: 0, power: 0.05 }) =>
  frozen(game.applyAction(s, s.active, { type: 'FLICK', ...shot }, ctx(s.phaseEndsAt - 5000)));
const types = (t: T) => t.events.map((e) => e.event.type);
const QUARTER = Math.round((Math.PI / 2) * ANGLE_SCALE);

/** Puts pens where a test needs them (everything else from a real setup). */
function table(pens: [number, number, number?][], seed = 7): FightState {
  const s = start(pens.length, seed).state;
  return deepFreeze({
    ...s,
    pens: pens.map(([x, y, a], seat) => ({ seat, x, y, a: a ?? QUARTER, alive: true })),
  });
}

describe('setup and turns', () => {
  it('needs 2–4 players', () => {
    expect(() => game.setup([0], {}, ctx(0))).toThrow(/2–4/);
    expect(() => game.setup([0, 1, 2, 3, 4], {}, ctx(0))).toThrow(/2–4/);
  });

  it('places pens symmetrically inside the desk with a seeded order and facing', () => {
    for (const n of [2, 3, 4]) {
      const t = start(n, 3);
      const s = t.state;
      expect([...s.order].sort()).toEqual(s.seats);
      expect(s.pens.every((p) => p.alive && !outsideDesk(p.x, p.y, s.boundary))).toBe(true);
      // Symmetric: the spots' centre is the desk's centre.
      expect(Math.abs(s.pens.reduce((t2, p) => t2 + p.x, 0))).toBeLessThan(10);
      expect(s).toMatchObject({ phase: 'AIMING', round: 1, active: s.order[0], phaseMs: 15_000 });
      expect(types(t)).toEqual(['TURN_STARTED']);
      expect(start(n, 3).state).toEqual(s); // same seed → same table
    }
    expect(start(4, 1).state.order).not.toEqual(start(4, 2).state.order);
  });

  it('accepts a flick only from the active seat while aiming', () => {
    const s = start().state;
    const other = s.order[1] as number;
    expect(game.validateAction(s, other, { type: 'FLICK', anchor: 0, angle: 0, power: 1 })).toEqual(
      {
        ok: false,
        code: 'NOT_YOUR_TURN',
      },
    );
    const playing = flick(s).state;
    expect(playing.phase).toBe('PLAYBACK');
    expect(
      game.validateAction(playing, playing.active, {
        type: 'FLICK',
        anchor: 0,
        angle: 0,
        power: 1,
      }),
    ).toEqual({
      ok: false,
      code: 'INVALID_PHASE',
    });
  });

  it('validates the action shape and clamps / normalises / quantises the values', () => {
    const schema = game.actionSchema;
    expect(
      schema.safeParse({ type: 'FLICK', anchor: 0, angle: 0, power: Number.NaN }).success,
    ).toBe(false);
    expect(schema.safeParse({ type: 'FLICK', anchor: 0, angle: 0, power: Infinity }).success).toBe(
      false,
    );
    expect(schema.safeParse({ type: 'FLICK', anchor: 0, angle: 0 }).success).toBe(false);
    expect(schema.safeParse({ type: 'FLICK', anchor: 0, angle: 0, power: 1, x: 1 }).success).toBe(
      false,
    );
    const t = flick(start().state, { anchor: 7, angle: 4 * Math.PI + 0.123456789, power: -3 });
    const shot = t.events.find((e) => e.event.type === 'SHOT_PLAYED')?.event;
    expect(shot).toMatchObject({ shot: { anchor: 1, angle: 0.1235, power: 0.05 } });
  });

  it('plays the shot at once and holds for the replay + 0.5 s', () => {
    const s = start().state;
    const t = flick(s, { anchor: 0, angle: 0.4, power: 0.8 });
    const shot = t.events[0]?.event as Extract<FightEvent, { type: 'SHOT_PLAYED' }>;
    expect(shot.type).toBe('SHOT_PLAYED');
    expect(t.events[0]?.to).toBe('ALL');
    expect(shot.durationMs).toBe(Math.round((shot.steps / 60) * 1000));
    expect(t.state.phaseMs).toBe(shot.durationMs + 500);
    expect(t.timers).toEqual([{ set: 'phase', ms: shot.durationMs + 500 }]);
    // The keyframes come from the same simulation that produced the state.
    const again = simulateShot(s.pens, s.boundary, s.active, shot.shot);
    expect(t.state.pens).toEqual(again.final);
    expect(shot.frames).toEqual(again.frames);
  });

  it('gives every alive pen one turn per round, in the seeded order', () => {
    let s = start(3, 5).state;
    const turns: number[] = [];
    while (s.round <= 2) {
      turns.push(s.active);
      s = timeout(s).state;
    }
    expect(turns).toEqual([...s.order, ...s.order]);
  });
});

describe('timeouts and idle', () => {
  it('skips the turn at the timeout and asks for a bot after 3 skips in a row', () => {
    let s = start(2).state;
    const requests: unknown[] = [];
    const first = s.active;
    for (let i = 0; i < 6; i++) {
      const t = timeout(s);
      if (i === 0) expect(types(t)).toEqual(['TURN_SKIPPED', 'TURN_STARTED']);
      requests.push(...(t.requests ?? []));
      s = t.state;
    }
    expect(s.skips[first]).toBe(3);
    expect(requests).toContainEqual({ type: 'MARK_IDLE', seat: first });
    expect(requests).toHaveLength(2); // once per seat
  });

  it('resets the skip count on a flick, a bot takeover or a reclaim', () => {
    let s = timeout(timeout(start(2).state).state).state; // each seat skipped once
    const seat = s.active;
    expect(s.skips[seat]).toBe(1);
    expect(game.onSeatChange(s, seat, 'RECLAIMED', ctx(0)).state.skips[seat]).toBe(0);
    expect(game.onSeatChange(s, seat, 'BOT_TOOK_OVER', ctx(0)).state.skips[seat]).toBe(0);
    s = flick(s).state;
    expect(s.skips[seat]).toBe(0);
  });
});

describe('elimination and ranking', () => {
  it('removes a knocked-out pen from the round and ranks it by elimination order', () => {
    // Seat order is seeded; aim the active pen at a pen right by the edge.
    const base = table([
      [2000, 0],
      [4300, 0],
      [-3000, 2000],
      [-3000, -2000],
    ]);
    const s = deepFreeze({ ...base, active: 0, queue: [2, 1, 3], order: [0, 2, 1, 3] });
    const t = flick(s, { anchor: 0, angle: 0, power: 0.5 });
    expect(t.state.lastShot).toEqual({ seat: 0, eliminated: [1] });
    expect(t.state.knockouts[0]).toBe(1);
    expect(game.getPlayerView(t.state, 3).places).toEqual({ 1: 4 });
    const next = timeout(t.state).state; // the hold ends
    expect(next.active).toBe(2);
    expect(next.queue).toEqual([3]); // seat 1 is gone from the round
  });

  it('ends the match when one pen is left and ranks the others in reverse order', () => {
    const base = table([
      [2500, 0],
      [4300, 0],
    ]);
    const s = deepFreeze({ ...base, active: 0, queue: [1], order: [0, 1] });
    const t = flick(s, { anchor: 0, angle: 0, power: 0.8 });
    const over = timeout(t.state);
    expect(over.state.phase).toBe('OVER');
    expect(types(over)).toEqual(['MATCH_OVER']);
    expect(game.getResults(over.state)).toEqual({
      placements: [
        { seat: 0, place: 1 },
        { seat: 1, place: 2 },
      ],
      stats: { 0: { knockouts: 1 }, 1: { knockouts: 0 } },
    });
  });

  it('applies the tie-breaks: later tick ranks higher, same shrink → closer to centre, exact ties share', () => {
    const pens: Pen[] = [0, 1, 2, 3].map((seat) => ({ seat, x: 0, y: 0, a: 0, alive: false }));
    const e = (
      seat: number,
      seq: number,
      cause: Elimination['cause'],
      tick: number,
      dist: number,
    ) => ({ seat, seq, cause, tick, dist, by: null, round: 1 }) satisfies Elimination;
    expect(
      placesOf(pens, [
        e(0, 1, 'SHOT', 40, 0),
        e(1, 1, 'SHOT', 55, 0),
        e(2, 2, 'SHRINK', 0, 3000),
        e(3, 2, 'SHRINK', 0, 2000),
      ]),
    ).toEqual([
      { seat: 0, place: 4 },
      { seat: 1, place: 3 },
      { seat: 2, place: 2 },
      { seat: 3, place: 1 },
    ]);
    expect(placesOf(pens.slice(0, 2), [e(0, 1, 'SHOT', 40, 0), e(1, 1, 'SHOT', 40, 0)])).toEqual([
      { seat: 0, place: 1 },
      { seat: 1, place: 1 },
    ]);
  });
});

describe('sudden death', () => {
  /** Plays rounds by letting every turn time out (no eliminations). */
  function skipRounds(s: FightState, rounds: number) {
    const events: FightEvent[] = [];
    const target = s.round + rounds;
    while (s.round < target && s.phase !== 'OVER') {
      const t = timeout(s);
      events.push(...t.events.map((e) => e.event));
      s = t.state;
    }
    return { s, events };
  }

  it('arms after 10 full rounds without an elimination, previews for a round, then shrinks 6 % each round', () => {
    const { s: armed, events } = skipRounds(start(3, 2).state, 10);
    expect(armed.round).toBe(11);
    expect(armed.suddenDeath).toBe(true);
    expect(armed.boundary).toEqual(deskAfter(0)); // not yet: preview first
    expect(armed.preview).toEqual({ w: 9400, h: 6580 });
    expect(events).toContainEqual({ type: 'SUDDEN_DEATH_ARMED', next: { w: 9400, h: 6580 } });

    const { s: shrunk, events: later } = skipRounds(armed, 1);
    expect(shrunk.phase).toBe('SHRINKING');
    expect(shrunk.boundary).toEqual({ w: 9400, h: 6580 });
    expect(shrunk.preview).toEqual({ w: 8800, h: 6160 });
    expect(later).toContainEqual({
      type: 'DESK_SHRUNK',
      boundary: { w: 9400, h: 6580 },
      eliminated: [],
      next: { w: 8800, h: 6160 },
    });
    expect(timeout(shrunk).state.phase).toBe('AIMING');
  });

  it('eliminates pens left outside by a shrink, ranks them by distance, and always terminates', () => {
    let s = start(3, 2).state;
    const shrinks: Extract<FightEvent, { type: 'DESK_SHRUNK' }>[] = [];
    for (let i = 0; i < 2000 && s.phase !== 'OVER'; i++) {
      const t = timeout(s);
      for (const e of t.events) if (e.event.type === 'DESK_SHRUNK') shrinks.push(e.event);
      s = t.state;
    }
    expect(s.phase).toBe('OVER');
    expect(s.round).toBeLessThanOrEqual(10 + 1 + 17 + 1);
    // 3 pens at their spots: the top pen (0, −2.3) leaves at the 6th shrink, then both others
    // (same distance from the centre) at the 8th — they share first place.
    const out = shrinks.filter((e) => e.eliminated.length > 0);
    expect(out.map((e) => e.eliminated.length)).toEqual([1, 2]);
    const places = game
      .getResults(s)
      .placements.map((p) => p.place)
      .sort();
    expect(places).toEqual([1, 1, 3]);
  });

  it('resets the quiet-round count on an elimination before it arms, and never disarms', () => {
    const quiet = deepFreeze({ ...start(3).state, quietRounds: 9, eliminatedThisRound: true });
    let s = quiet;
    while (s.round === quiet.round) s = timeout(s).state;
    expect(s.quietRounds).toBe(0);
    expect(s.suddenDeath).toBe(false);
    const armed = deepFreeze({
      ...start(3).state,
      suddenDeath: true,
      preview: deskAfter(1),
      eliminatedThisRound: true,
    });
    s = armed;
    while (s.round === armed.round) s = timeout(s).state;
    expect(s.suddenDeath).toBe(true);
    expect(s.phase).toBe('SHRINKING');
  });
});

describe('bot', () => {
  const bot = (s: FightState, seed: number, now = s.phaseEndsAt - 15_000) =>
    game.bot.decide(game.getPlayerView(s, s.active), null, {
      seat: s.active,
      now,
      rng: createRng(seed),
    });

  it('only acts on its own aim, with a valid flick, before the deadline', () => {
    const s = start().state;
    expect(
      game.bot.decide(game.getPlayerView(s, 0), null, {
        seat: s.order[1] as number,
        now: 0,
        rng: createRng(1),
      }),
    ).toBeNull();
    const d = bot(s, 1);
    expect(d?.kind).toBe('ACTION');
    if (d?.kind !== 'ACTION') return;
    expect(game.actionSchema.safeParse(d.action).success).toBe(true);
    expect(game.validateAction(s, s.active, d.action)).toEqual({ ok: true });
    expect(d.thinkMs).toBeGreaterThanOrEqual(800);
    expect(bot(s, 1, s.phaseEndsAt - 1000)?.thinkMs).toBeLessThanOrEqual(600);
  });

  it('usually knocks out a pen sitting by the edge, and never flicks itself off when it need not', () => {
    const s = deepFreeze({
      ...table([
        [2000, 0],
        [4200, 0],
        [-3000, 2500],
      ]),
      active: 0,
      queue: [1, 2],
      order: [0, 1, 2],
    });
    let knockouts = 0;
    for (let seed = 0; seed < 20; seed++) {
      const d = bot(s, seed);
      if (d?.kind !== 'ACTION') throw new Error('expected a flick');
      const t = game.applyAction(s, 0, d.action, ctx(0));
      if (t.state.lastShot?.eliminated.includes(1)) knockouts++;
      expect(t.state.lastShot?.eliminated).not.toContain(0);
    }
    expect(knockouts).toBeGreaterThanOrEqual(14);
  });

  it('searches 24 candidate shots within the time budget', () => {
    const s = start(4, 9).state;
    for (let i = 0; i < 5; i++) bot(s, i); // warm up
    const times: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      bot(s, i);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    // A regression guard, not the budget itself: other test files share the CPU, so a
    // wall-clock limit of 20 ms would be flaky here. The 20 ms budget is measured on its
    // own (design §15: p50 ≈ 13–15 ms, p95 ≈ 16–18 ms); this catches a several-fold slowdown.
    const quartile = times[7] as number;
    expect(quartile, `fastest-quartile decision took ${quartile.toFixed(1)} ms`).toBeLessThan(50);
  });
});

describe('complete matches', () => {
  it('plays hundreds of seeded bot-vs-bot matches to the end with valid tables and results', () => {
    let suddenDeath = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const seats = 2 + (seed % 3);
      const r = simulateMatch<FightState, FightEvent>(game, {
        seats,
        seed,
        invariant: (s) => {
          for (const p of s.pens)
            if (p.alive) expect(outsideDesk(p.x, p.y, s.boundary)).toBe(false);
          expect(s.pens.filter((p) => !p.alive)).toHaveLength(s.eliminations.length);
        },
        perturbHidden: (s) => s, // everything is public
      });
      expect(r.state.pens.filter((p) => p.alive).length).toBeLessThanOrEqual(1);
      if (r.state.suddenDeath) suddenDeath++;
    }
    expect(suddenDeath).toBeGreaterThan(0); // some bot matches do reach sudden death
  });

  it('replays exactly from the same seed', () => {
    const a = simulateMatch<FightState, FightEvent>(game, { seats: 4, seed: 42 });
    const b = simulateMatch<FightState, FightEvent>(game, { seats: 4, seed: 42 });
    expect(a.state).toEqual(b.state);
    expect(a.delivered).toEqual(b.delivered);
  });

  it('ends matches where nobody ever flicks (all timeouts) through sudden death', () => {
    const g = createPenFightGame();
    const r = simulateMatch<FightState, FightEvent>(g, { seats: 4, seed: 3, botsAct: false });
    expect(r.state.phase).toBe('OVER');
    expect(r.state.suddenDeath).toBe(true);
    expect(r.requests.filter((q) => q.type === 'MARK_IDLE')).toHaveLength(4);
  });
});
