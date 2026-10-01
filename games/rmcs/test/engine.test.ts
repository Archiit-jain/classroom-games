import { createRng, eventsForSeat, type StepCtx } from '@cg/game-sdk';
import { assertNoViewLeak, deepFreeze, simulateMatch } from '@cg/game-sdk/testing';
import { describe, expect, it } from 'vitest';
import {
  candidatesOf,
  createRmcsGame,
  perturbRmcsHidden,
  rankByScore,
  rmcsGame,
  scoreRound,
  seatWithRole,
} from '../src/server';
import {
  ROLES,
  ROUND_TOTAL,
  TOTAL_ROUNDS,
  type RmcsEvent,
  type RmcsState,
  type Role,
} from '../src/shared';

const ctx = (now = 10_000, seed = 7): StepCtx => ({ now, rng: createRng(seed) });
const SEATS = [0, 1, 2, 3];

function start(seed = 7) {
  const t = rmcsGame.setup(SEATS, {}, ctx(10_000, seed));
  return { ...t, state: deepFreeze(t.state) };
}

/** A GUESSING state with fixed roles (seat → role) for deterministic rule tests. */
function guessingState(roles: Record<number, Role>, extra: Partial<RmcsState> = {}): RmcsState {
  const s = start().state;
  return deepFreeze({
    ...s,
    roles,
    phase: 'GUESSING',
    phaseMs: 30_000,
    phaseEndsAt: 40_000,
    ...extra,
  });
}

const ROLES_A: Record<number, Role> = { 0: 'RAJA', 1: 'MANTRI', 2: 'CHOR', 3: 'SIPAHI' };

describe('dealing', () => {
  it('needs exactly four seats', () => {
    expect(() => rmcsGame.setup([0, 1, 2], {}, ctx())).toThrow(/exactly 4/);
  });

  it('deals each role once and tells each seat only its own role', () => {
    const { state, events, timers } = start();
    expect(Object.values(state.roles).sort()).toEqual([...ROLES].sort());
    expect(state).toMatchObject({ phase: 'DEALING', round: 1, phaseMs: 2000, phaseEndsAt: 12_000 });
    expect(timers).toEqual([{ set: 'phase', ms: 2000 }]);
    for (const seat of SEATS) {
      const dealt = eventsForSeat(events, seat).filter((e) => e.type === 'ROLE_DEALT');
      expect(dealt).toEqual([{ type: 'ROLE_DEALT', role: state.roles[seat] }]);
    }
  });

  it('is reproducible from the seed and varies across seeds', () => {
    expect(start(1).state.roles).toEqual(start(1).state.roles);
    const distinct = new Set(
      Array.from({ length: 20 }, (_, i) => JSON.stringify(start(i).state.roles)),
    );
    expect(distinct.size).toBeGreaterThan(5);
  });
});

describe('phase flow', () => {
  it('reveals the Raja, then the Mantri, then opens a 30 s guess', () => {
    const s0 = start().state;
    const raja = seatWithRole(s0.roles, 'RAJA');
    const mantri = seatWithRole(s0.roles, 'MANTRI');

    const t1 = rmcsGame.onTimer(s0, 'phase', ctx(12_000));
    expect(t1.state.phase).toBe('REVEAL_RAJA');
    expect(t1.events.map((e) => e.event)).toEqual([{ type: 'RAJA_REVEALED', seat: raja }]);

    const t2 = rmcsGame.onTimer(t1.state, 'phase', ctx(14_000));
    expect(t2.state.phase).toBe('REVEAL_MANTRI');
    expect(t2.events.map((e) => e.event)).toEqual([{ type: 'MANTRI_REVEALED', seat: mantri }]);

    const t3 = rmcsGame.onTimer(t2.state, 'phase', ctx(16_000));
    expect(t3.state).toMatchObject({ phase: 'GUESSING', phaseMs: 30_000, phaseEndsAt: 46_000 });
    expect(t3.timers).toEqual([{ set: 'phase', ms: 30_000 }]);
    expect(t3.events.map((e) => e.event)).toEqual([
      { type: 'GUESSING_STARTED', mantri, deadline: 46_000 },
    ]);
  });

  it('shows the result for 4 s, then deals the next round', () => {
    const resolved = rmcsGame.applyAction(
      guessingState(ROLES_A),
      1,
      { type: 'GUESS', target: 2 },
      ctx(),
    );
    expect(resolved.state).toMatchObject({ phase: 'ROUND_RESULT', phaseMs: 4000 });
    const next = rmcsGame.onTimer(resolved.state, 'phase', ctx());
    expect(next.state).toMatchObject({ phase: 'DEALING', round: 2 });
  });

  it('ends after round 10 with the final scores', () => {
    const last = guessingState(ROLES_A, { round: TOTAL_ROUNDS });
    const resolved = rmcsGame.applyAction(last, 1, { type: 'GUESS', target: 2 }, ctx());
    const over = rmcsGame.onTimer(resolved.state, 'phase', ctx());
    expect(over.state.phase).toBe('OVER');
    expect(rmcsGame.isOver(over.state)).toBe(true);
    expect(over.events.map((e) => e.event.type)).toEqual(['MATCH_OVER']);
    expect(over.timers).toBeUndefined();
  });
});

describe('guessing rules', () => {
  const s = guessingState(ROLES_A);

  it('only the Mantri may guess, only during GUESSING, only one of the two candidates', () => {
    expect(rmcsGame.validateAction(s, 0, { type: 'GUESS', target: 2 })).toEqual({
      ok: false,
      code: 'NOT_YOUR_TURN',
    });
    expect(rmcsGame.validateAction(s, 2, { type: 'GUESS', target: 3 })).toEqual({
      ok: false,
      code: 'NOT_YOUR_TURN',
    });
    expect(rmcsGame.validateAction(s, 1, { type: 'GUESS', target: 0 })).toEqual({
      ok: false,
      code: 'ILLEGAL_ACTION',
    });
    expect(rmcsGame.validateAction(s, 1, { type: 'GUESS', target: 1 })).toEqual({
      ok: false,
      code: 'ILLEGAL_ACTION',
    });
    expect(rmcsGame.validateAction(s, 1, { type: 'GUESS', target: 9 })).toEqual({
      ok: false,
      code: 'ILLEGAL_ACTION',
    });
    expect(rmcsGame.validateAction(s, 1, { type: 'GUESS', target: 3 })).toEqual({ ok: true });
    expect(
      rmcsGame.validateAction({ ...s, phase: 'REVEAL_MANTRI' }, 1, { type: 'GUESS', target: 2 }),
    ).toEqual({
      ok: false,
      code: 'INVALID_PHASE',
    });
  });

  it('rejects malformed actions through the schema', () => {
    expect(rmcsGame.actionSchema.safeParse({ type: 'GUESS', target: 1.5 }).success).toBe(false);
    expect(rmcsGame.actionSchema.safeParse({ type: 'GUESS' }).success).toBe(false);
    expect(rmcsGame.actionSchema.safeParse({ type: 'GUESS', target: 2, extra: 1 }).success).toBe(
      false,
    );
  });

  it('scores a correct guess: Raja 1000, Mantri 800, Sipahi 500, Chor 0', () => {
    const t = rmcsGame.applyAction(s, 1, { type: 'GUESS', target: 2 }, ctx());
    expect(t.state.history.at(-1)).toMatchObject({ correct: true, auto: false, target: 2 });
    expect(t.state.history.at(-1)?.deltas).toEqual({ 0: 1000, 1: 800, 2: 0, 3: 500 });
    expect(t.events.map((e) => e.event.type)).toEqual(['GUESS_MADE', 'ROUND_RESOLVED']);
  });

  it('scores a wrong guess: the Chor takes the Mantri’s 800', () => {
    const t = rmcsGame.applyAction(s, 1, { type: 'GUESS', target: 3 }, ctx());
    expect(t.state.history.at(-1)).toMatchObject({ correct: false });
    expect(t.state.history.at(-1)?.deltas).toEqual({ 0: 1000, 1: 0, 2: 800, 3: 500 });
  });

  it('every possible round distributes exactly 2300 points', () => {
    for (const correct of [true, false]) {
      const deltas = scoreRound(ROLES_A, correct);
      expect(Object.values(deltas).reduce((a, b) => a + b, 0)).toBe(ROUND_TOTAL);
    }
  });

  it('guesses at random for a Mantri who runs out of time', () => {
    const picks = new Set<number>();
    for (let seed = 0; seed < 30; seed++) {
      const t = rmcsGame.onTimer(s, 'phase', ctx(40_000, seed));
      const last = t.state.history.at(-1);
      expect(last?.auto).toBe(true);
      expect(candidatesOf(s)).toContain(last?.target);
      picks.add(last?.target as number);
    }
    expect([...picks].sort()).toEqual([2, 3]);
  });

  it('asks for a bot after two consecutive timeouts by the same player, and resets on a real guess', () => {
    const once = rmcsGame.onTimer(s, 'phase', ctx());
    expect(once.requests).toEqual([]);
    expect(once.state.timeouts[1]).toBe(1);
    const twice = rmcsGame.onTimer(
      guessingState(ROLES_A, { timeouts: once.state.timeouts }),
      'phase',
      ctx(),
    );
    expect(twice.requests).toEqual([{ type: 'MARK_IDLE', seat: 1 }]);
    const guessed = rmcsGame.applyAction(
      guessingState(ROLES_A, { timeouts: once.state.timeouts }),
      1,
      { type: 'GUESS', target: 2 },
      ctx(),
    );
    expect(guessed.state.timeouts[1]).toBe(0);
    expect(rmcsGame.onSeatChange(twice.state, 1, 'BOT_TOOK_OVER', ctx()).state.timeouts[1]).toBe(0);
  });
});

describe('what each player can see', () => {
  it('reveals roles only as the rules allow', () => {
    let s = start().state;
    const raja = seatWithRole(s.roles, 'RAJA');
    const mantri = seatWithRole(s.roles, 'MANTRI');
    const chor = seatWithRole(s.roles, 'CHOR');
    const sipahi = seatWithRole(s.roles, 'SIPAHI');

    const knownBy = (seat: number) =>
      Object.keys(rmcsGame.getPlayerView(s, seat).known).map(Number).sort();

    // DEALING: only your own role.
    for (const seat of SEATS) expect(knownBy(seat)).toEqual([seat]);
    expect(rmcsGame.getPlayerView(s, chor)).toMatchObject({
      myRole: 'CHOR',
      raja: null,
      mantri: null,
      candidates: [],
    });

    s = rmcsGame.onTimer(s, 'phase', ctx()).state; // REVEAL_RAJA
    expect(knownBy(chor)).toEqual([raja, chor].sort());

    s = rmcsGame.onTimer(s, 'phase', ctx()).state; // REVEAL_MANTRI
    expect(knownBy(sipahi)).toEqual([raja, mantri, sipahi].sort());
    expect(rmcsGame.getPlayerView(s, raja).candidates.sort()).toEqual([chor, sipahi].sort());
    // The Raja must not learn which candidate is the Chor.
    expect(rmcsGame.getPlayerView(s, raja).known[chor]).toBeUndefined();

    s = rmcsGame.onTimer(s, 'phase', ctx()).state; // GUESSING
    expect(knownBy(mantri)).toEqual([raja, mantri].sort());

    s = rmcsGame.applyAction(s, mantri, { type: 'GUESS', target: chor }, ctx()).state; // ROUND_RESULT
    for (const seat of SEATS) expect(knownBy(seat)).toEqual(SEATS);
  });

  it('never leaks hidden roles in any phase (perturbation check)', () => {
    const rng = createRng(3);
    let s = start().state;
    for (let step = 0; step < 4; step++) {
      for (const seat of SEATS) assertNoViewLeak(rmcsGame, s, seat, perturbRmcsHidden, rng);
      s = rmcsGame.onTimer(s, 'phase', ctx()).state;
    }
  });
});

describe('results', () => {
  it('ranks by total score; ties share a place', () => {
    expect(rankByScore([0, 1, 2, 3], { 0: 5000, 1: 7000, 2: 5000, 3: 1000 })).toEqual([
      { seat: 0, place: 2 },
      { seat: 1, place: 1 },
      { seat: 2, place: 2 },
      { seat: 3, place: 4 },
    ]);
  });

  it('reports each seat’s score as a result stat', () => {
    const s = guessingState(ROLES_A, { scores: { 0: 3000, 1: 2000, 2: 4000, 3: 0 } });
    expect(rmcsGame.getResults(s)).toEqual({
      placements: [
        { seat: 0, place: 2 },
        { seat: 1, place: 3 },
        { seat: 2, place: 1 },
        { seat: 3, place: 4 },
      ],
      stats: { 0: { score: 3000 }, 1: { score: 2000 }, 2: { score: 4000 }, 3: { score: 0 } },
    });
  });
});

describe('bot', () => {
  it('only acts as the Mantri during GUESSING, and always picks a candidate', () => {
    const s = guessingState(ROLES_A);
    const bot = createRmcsGame({ botThinkMs: [100, 200] }).bot;
    for (const seat of [0, 2, 3]) {
      expect(
        bot.decide(rmcsGame.getPlayerView(s, seat), null, { seat, now: 0, rng: createRng(1) }),
      ).toBeNull();
    }
    for (let seed = 0; seed < 20; seed++) {
      const decision = bot.decide(rmcsGame.getPlayerView(s, 1), null, {
        seat: 1,
        now: 0,
        rng: createRng(seed),
      });
      expect(decision?.kind).toBe('ACTION');
      if (decision?.kind === 'ACTION') {
        expect([2, 3]).toContain(decision.action.target);
        expect(decision.thinkMs).toBeGreaterThanOrEqual(100);
        expect(decision.thinkMs).toBeLessThanOrEqual(200);
      }
    }
  });
});

describe('fuzzing: whole matches with bots', () => {
  const invariant = (s: RmcsState) => {
    if (s.round > 0 && Object.values(s.roles).sort().join() !== [...ROLES].sort().join()) {
      throw new Error('roles are not a permutation');
    }
    const total = Object.values(s.scores).reduce((a, b) => a + b, 0);
    if (total !== ROUND_TOTAL * s.history.length) throw new Error(`score total ${total} is wrong`);
    for (const r of s.history) {
      if (Object.values(r.deltas).reduce((a, b) => a + b, 0) !== ROUND_TOTAL)
        throw new Error('round total');
    }
    if (s.round > TOTAL_ROUNDS) throw new Error('too many rounds');
  };

  it('plays 200 seeded matches: 10 rounds, 23 000 points, no leaks', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const run = simulateMatch<RmcsState, RmcsEvent>(rmcsGame, {
        seats: 4,
        seed,
        invariant,
        perturbHidden: perturbRmcsHidden,
      });
      expect(run.state.history).toHaveLength(TOTAL_ROUNDS);
      expect(Object.values(run.state.scores).reduce((a, b) => a + b, 0)).toBe(
        ROUND_TOTAL * TOTAL_ROUNDS,
      );
      expect(run.results.placements).toHaveLength(4);
    }
  });

  it('finishes on timers alone (nobody guesses) and asks for bots', () => {
    const run = simulateMatch<RmcsState, RmcsEvent>(rmcsGame, {
      seats: 4,
      seed: 5,
      botsAct: false,
      invariant,
    });
    expect(run.state.phase).toBe('OVER');
    expect(run.state.history.every((r) => r.auto)).toBe(true);
    expect(run.requests.length).toBeGreaterThan(0);
  });

  it('delivers each dealt role only to its owner, every round', () => {
    const run = simulateMatch<RmcsState, RmcsEvent>(rmcsGame, { seats: 4, seed: 42 });
    for (const [seat, events] of run.delivered.entries()) {
      const dealt = events.filter((e) => e.type === 'ROLE_DEALT');
      expect(dealt).toHaveLength(TOTAL_ROUNDS);
      dealt.forEach((e, round) => {
        expect(e).toEqual({ type: 'ROLE_DEALT', role: run.state.history[round]?.roles[seat] });
      });
    }
  });

  it('is fully reproducible from its seed', () => {
    const a = simulateMatch<RmcsState, RmcsEvent>(rmcsGame, { seats: 4, seed: 99 });
    const b = simulateMatch<RmcsState, RmcsEvent>(rmcsGame, { seats: 4, seed: 99 });
    expect(a.state).toEqual(b.state);
  });
});

describe('time scale', () => {
  it('scales every phase and the bot delay', () => {
    const fast = createRmcsGame({ timeScale: 0.1 });
    const t = fast.setup(SEATS, {}, ctx());
    expect(t.state.timing).toEqual({ dealMs: 200, revealMs: 200, guessMs: 3000, resultMs: 400 });
  });
});
