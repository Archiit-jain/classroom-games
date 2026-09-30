import { describe, expect, it } from 'vitest';
import { eventsForSeat } from '../src/audience';
import { createRng } from '../src/rng';
import {
  createFixtureGame,
  fixtureGame,
  perturbFixtureHidden,
  type FixtureEvent,
  type FixtureState,
} from '../src/fixture';
import { assertNoViewLeak, deepFreeze, simulateMatch } from '../src/testing';

const ctx = (now = 1_000) => ({ now, rng: createRng(99) });

function setup(seats = [0, 1, 2]) {
  const t = fixtureGame.setup(seats, fixtureGame.defaultSettings, ctx());
  return { ...t, state: deepFreeze(t.state) };
}

describe('fixture game rules', () => {
  it('deals each seat a private lucky number and starts seat 0', () => {
    const { state, events, timers } = setup();
    expect(state.turn).toBe(0);
    expect(timers).toEqual([{ set: 'turn', ms: 10_000 }]);
    for (const seat of [0, 1, 2]) {
      const mine = eventsForSeat(events, seat).filter((e) => e.type === 'LUCKY_DEALT');
      expect(mine).toEqual([{ type: 'LUCKY_DEALT', lucky: state.lucky[seat] }]);
    }
  });

  it('rejects moves out of turn', () => {
    const { state } = setup();
    expect(fixtureGame.validateAction(state, 1, { type: 'ADD', amount: 1 })).toEqual({
      ok: false,
      code: 'NOT_YOUR_TURN',
    });
    expect(fixtureGame.validateAction(state, 0, { type: 'ADD', amount: 3 })).toEqual({ ok: true });
  });

  it('rejects malformed actions through its schema', () => {
    expect(fixtureGame.actionSchema.safeParse({ type: 'ADD', amount: 4 }).success).toBe(false);
    expect(fixtureGame.actionSchema.safeParse({ type: 'ADD', amount: 1, extra: 1 }).success).toBe(
      false,
    );
  });

  it('advances the counter and passes the turn', () => {
    const { state } = setup();
    const t = fixtureGame.applyAction(state, 0, { type: 'ADD', amount: 3 }, ctx(2_000));
    expect(t.state.counter).toBe(3);
    expect(t.state.turn).toBe(1);
    expect(t.state.turnDeadline).toBe(12_000);
    expect(t.timers).toEqual([{ set: 'turn', ms: 10_000 }]);
  });

  it('ends the match when the target is reached', () => {
    const { state } = setup();
    const nearEnd: FixtureState = deepFreeze({ ...state, counter: 13, turn: 2 });
    const t = fixtureGame.applyAction(nearEnd, 2, { type: 'ADD', amount: 2 }, ctx());
    expect(fixtureGame.isOver(t.state)).toBe(true);
    expect(t.state.winner).toBe(2);
    expect(t.timers).toEqual([{ clear: 'turn' }]);
    expect(fixtureGame.getResults(t.state).placements).toEqual([
      { seat: 0, place: 2 },
      { seat: 1, place: 2 },
      { seat: 2, place: 1 },
    ]);
  });

  it('auto-plays on timeout and asks the platform to mark a repeatedly idle seat', () => {
    const game = createFixtureGame({ idleAfterTimeouts: 2 });
    const first = game.setup([0, 1], game.defaultSettings, ctx());
    let state = first.state;
    // Seat 0 times out, seat 1 plays, seat 0 times out again → idle request.
    const t1 = game.onTimer(state, 'turn', ctx());
    expect(t1.requests).toEqual([]);
    expect(t1.state.lastMove).toEqual({ seat: 0, amount: 1, auto: true });
    state = game.applyAction(t1.state, 1, { type: 'ADD', amount: 1 }, ctx()).state;
    const t2 = game.onTimer(state, 'turn', ctx());
    expect(t2.requests).toEqual([{ type: 'MARK_IDLE', seat: 0 }]);
  });

  it('never reveals other lucky numbers before the end', () => {
    const { state } = setup();
    const view = fixtureGame.getPlayerView(state, 1);
    expect(view.yourLucky).toBe(state.lucky[1]);
    expect(view.revealedLucky).toBeNull();
    const rng = createRng(5);
    for (const seat of [0, 1, 2])
      assertNoViewLeak(fixtureGame, state, seat, perturbFixtureHidden, rng);
  });

  it('the leak checker catches a leaking view', () => {
    const leaky = { ...fixtureGame, getPlayerView: (s: FixtureState) => ({ all: s.lucky }) };
    const { state } = setup();
    expect(() => assertNoViewLeak(leaky, state, 0, perturbFixtureHidden, createRng(1))).toThrow(
      /View leak/,
    );
  });
});

describe('fixture game fuzzing (bot vs bot)', () => {
  it('plays 300 seeded matches that all terminate without leaks', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const seats = 2 + (seed % 3);
      const run = simulateMatch<FixtureState, FixtureEvent>(fixtureGame, {
        seats,
        seed,
        perturbHidden: perturbFixtureHidden,
        invariant: (s) => {
          if (s.counter < 0 || s.counter > s.target + 2) throw new Error('counter out of range');
        },
      });
      expect(run.results.placements.filter((p) => p.place === 1)).toHaveLength(1);
    }
  });

  it('terminates on timers alone when nobody acts', () => {
    const run = simulateMatch<FixtureState, FixtureEvent>(fixtureGame, {
      seats: 3,
      seed: 11,
      botsAct: false,
    });
    expect(run.state.phase).toBe('OVER');
    expect(run.requests.length).toBeGreaterThan(0);
  });

  it('is fully reproducible from its seed', () => {
    const a = simulateMatch<FixtureState, FixtureEvent>(fixtureGame, { seats: 4, seed: 1234 });
    const b = simulateMatch<FixtureState, FixtureEvent>(fixtureGame, { seats: 4, seed: 1234 });
    expect(a.state).toEqual(b.state);
    expect(a.delivered).toEqual(b.delivered);
  });

  it('only delivers a lucky number to its owner', () => {
    const run = simulateMatch<FixtureState, FixtureEvent>(fixtureGame, { seats: 3, seed: 8 });
    for (const [seat, events] of run.delivered.entries()) {
      const dealt = events.filter((e) => e.type === 'LUCKY_DEALT');
      expect(dealt).toHaveLength(1);
      expect(dealt[0]).toEqual({ type: 'LUCKY_DEALT', lucky: run.state.lucky[seat] });
    }
  });
});
