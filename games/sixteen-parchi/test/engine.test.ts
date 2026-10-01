import { createRng, eventsForSeat, type Scoped, type StepCtx, type Transition } from '@cg/game-sdk';
import { deepFreeze, simulateMatch } from '@cg/game-sdk/testing';
import { describe, expect, it } from 'vitest';
import {
  checkParchiInvariant,
  createSixteenParchiGame,
  perturbParchiHidden,
  safePick,
  sixteenParchiGame,
  type ParchiOptions,
} from '../src/server';
import {
  CATEGORIES,
  CATEGORY_IDS,
  largestGroup,
  nextActive,
  previousActive,
  type Chit,
  type ParchiEvent,
  type ParchiState,
} from '../src/shared';

type T = Transition<ParchiState, ParchiEvent>;

const SEATS = [0, 1, 2, 3];
const FRUITS = { category: 'fruits' };
const [M, B, A, G] = ['mango', 'banana', 'apple', 'grapes'] as const;
const ctx = (now: number, seed = 7): StepCtx => ({ now, rng: createRng(seed) });

/** A game whose deal is fixed: seat 0 gets deck[0..3], seat 1 deck[4..7], … */
const rigged = (deck: string[], options: ParchiOptions = {}) =>
  createSixteenParchiGame({ ...options, deck: () => deck });

const frozen = (t: T): T => ({ ...t, state: deepFreeze(t.state) });
const start = (game = sixteenParchiGame, settings = FRUITS, seed = 7) =>
  frozen(game.setup(SEATS, settings, ctx(10_000, seed)));
const tick = (game: typeof sixteenParchiGame, s: ParchiState, now = s.phaseEndsAt, seed = 11) =>
  frozen(game.onTimer(s, 'phase', ctx(now, seed)));
const act = (
  game: typeof sixteenParchiGame,
  s: ParchiState,
  seat: number,
  action: Parameters<typeof sixteenParchiGame.applyAction>[2],
) => {
  const verdict = game.validateAction(s, seat, action);
  if (!verdict.ok) throw new Error(`rejected: ${verdict.code}`);
  return frozen(game.applyAction(s, seat, action, ctx(s.phaseEndsAt - 1000)));
};
const items = (hand: readonly Chit[] | undefined) => (hand ?? []).map((c) => c.item).sort();
const types = (events: Scoped<ParchiEvent>[], seat: number) =>
  eventsForSeat(events, seat).map((e) => e.type);

/** Nobody starts with four of a kind; every seat holds two pairs. */
const MIXED = [M, M, B, B, B, B, A, A, A, A, G, G, G, G, M, M];
/** Seats 0 and 2 start with full sets (mango, apple); 1 and 3 do not. */
const TWO_LUCKY = [M, M, M, M, B, B, G, G, A, A, A, A, B, B, G, G];
/** Everyone starts with a full set. */
const ALL_LUCKY = [M, M, M, M, B, B, B, B, A, A, A, A, G, G, G, G];

describe('dealing', () => {
  it('needs exactly four seats', () => {
    expect(() => sixteenParchiGame.setup([0, 1, 2], FRUITS, ctx(0))).toThrow(/exactly 4/);
  });

  it('deals 16 slips — four items × four copies, four each — and tells each seat only its hand', () => {
    const { state, events, timers } = start();
    expect(state).toMatchObject({ phase: 'DEALING', categoryId: 'fruits', phaseMs: 2000 });
    expect(timers).toEqual([{ set: 'phase', ms: 2000 }]);
    const all = SEATS.flatMap((seat) => items(state.hands[seat]));
    expect(all.sort()).toEqual([A, A, A, A, B, B, B, B, G, G, G, G, M, M, M, M]);
    for (const seat of SEATS) {
      expect(state.hands[seat]).toHaveLength(4);
      expect(eventsForSeat(events, seat)).toEqual([{ type: 'DEALT', hand: state.hands[seat] }]);
    }
    checkParchiInvariant(state);
  });

  it('gives every slip a unique opaque handle', () => {
    const { state } = start();
    const handles = SEATS.flatMap((seat) => (state.hands[seat] ?? []).map((c) => c.handle));
    expect(new Set(handles).size).toBe(16);
    for (const h of handles) expect(h).toMatch(/^p[a-z2-9]{7}$/);
  });

  it('picks a seeded random category for RANDOM and honours a chosen one', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const a = start(sixteenParchiGame, { category: 'RANDOM' }, seed).state.categoryId;
      expect(start(sixteenParchiGame, { category: 'RANDOM' }, seed).state.categoryId).toBe(a);
      seen.add(a);
    }
    expect(seen.size).toBeGreaterThan(3);
    for (const id of CATEGORY_IDS)
      expect(start(sixteenParchiGame, { category: id }).state.categoryId).toBe(id);
  });

  it('only accepts known categories in settings', () => {
    const schema = sixteenParchiGame.settingsSchema;
    expect(schema.safeParse({ category: 'RANDOM' }).success).toBe(true);
    expect(schema.safeParse({ category: 'ocean' }).success).toBe(true);
    expect(schema.safeParse({ category: 'brands' }).success).toBe(false);
    expect(schema.safeParse({ category: 'ocean', extra: 1 }).success).toBe(false);
  });
});

describe('selecting', () => {
  const game = rigged(MIXED);
  const selecting = () => tick(game, start(game).state);

  it('starts after the deal with a 10 s timer', () => {
    const t = selecting();
    expect(t.state.phase).toBe('SELECTING');
    expect(t.timers).toEqual([{ set: 'phase', ms: 10_000 }]);
  });

  it('accepts only a slip from your own hand, only while selecting', () => {
    const s = selecting().state;
    const mine = (s.hands[0] as Chit[])[0] as Chit;
    const theirs = (s.hands[1] as Chit[])[0] as Chit;
    expect(game.validateAction(s, 0, { type: 'SELECT', handle: mine.handle })).toEqual({
      ok: true,
    });
    expect(game.validateAction(s, 0, { type: 'SELECT', handle: theirs.handle })).toEqual({
      ok: false,
      code: 'ILLEGAL_ACTION',
    });
    expect(
      game.validateAction(start(game).state, 0, { type: 'SELECT', handle: mine.handle }),
    ).toEqual({
      ok: false,
      code: 'INVALID_PHASE',
    });
  });

  it('tells others only that you selected — once — and lets you swap privately', () => {
    let s = selecting().state;
    const [first, second] = s.hands[0] as Chit[];
    let t = act(game, s, 0, { type: 'SELECT', handle: (first as Chit).handle });
    expect(types(t.events, 0)).toEqual(['SEAT_SELECTED', 'MY_SELECTION']);
    expect(types(t.events, 1)).toEqual(['SEAT_SELECTED']);
    s = t.state;
    t = act(game, s, 0, { type: 'SELECT', handle: (second as Chit).handle });
    expect(types(t.events, 0)).toEqual(['MY_SELECTION']);
    expect(types(t.events, 1)).toEqual([]);
    const own = game.getPlayerView(t.state, 0);
    const other = game.getPlayerView(t.state, 1);
    expect(own.mySelection).toBe((second as Chit).handle);
    expect(other.mySelection).toBeNull();
    expect(other.selected).toEqual([0]);
    expect(JSON.stringify(other)).not.toContain((second as Chit).handle);
  });

  it('settles 300 ms after the last missing choice', () => {
    let s = selecting().state;
    for (const seat of [0, 1, 2])
      s = act(game, s, seat, {
        type: 'SELECT',
        handle: (s.hands[seat] as Chit[])[0]!.handle,
      }).state;
    const last = act(game, s, 3, { type: 'SELECT', handle: (s.hands[3] as Chit[])[0]!.handle });
    expect(last.timers).toEqual([{ set: 'phase', ms: 300 }]);
    const change = act(game, last.state, 0, {
      type: 'SELECT',
      handle: (s.hands[0] as Chit[])[1]!.handle,
    });
    expect(change.timers).toBeUndefined();
  });
});

describe('passing', () => {
  const game = rigged(MIXED);

  it('moves every selected slip one seat clockwise at once, re-keyed for the receiver', () => {
    let s = tick(game, start(game).state).state;
    const sent: Record<number, Chit> = {};
    for (const seat of SEATS) {
      const chit = (s.hands[seat] as Chit[])[seat % 4] as Chit;
      sent[seat] = chit;
      s = act(game, s, seat, { type: 'SELECT', handle: chit.handle }).state;
    }
    const t = tick(game, s);
    expect(t.state).toMatchObject({ phase: 'PASSING', cycle: 1, phaseMs: 1200 });
    for (const from of SEATS) {
      const to = (from + 1) % 4;
      const out = sent[from] as Chit;
      expect(t.state.hands[from]?.some((c) => c.handle === out.handle)).toBe(false);
      const received = eventsForSeat(t.events, to).find((e) => e.type === 'CHIT_RECEIVED');
      expect(received).toMatchObject({ item: out.item, from });
      expect(received && 'handle' in received && received.handle).not.toBe(out.handle);
      expect(eventsForSeat(t.events, from)).toContainEqual({
        type: 'CHIT_SENT',
        handle: out.handle,
        to,
      });
    }
    // Public pass news carries seats only — never items or handles.
    const pass = t.events.find((e) => e.event.type === 'PASS_RESOLVED');
    expect(pass?.to).toBe('ALL');
    expect(JSON.stringify(pass)).not.toMatch(/mango|banana|apple|grapes|"p[a-z2-9]{7}"/);
    for (const seat of SEATS) expect(t.state.hands[seat]).toHaveLength(4);
    checkParchiInvariant(t.state);
  });

  it('skips finished seats', () => {
    expect(nextActive([0, 2, 3], 0)).toBe(2);
    expect(nextActive([0, 2, 3], 3)).toBe(0);
    expect(previousActive([0, 2, 3], 2)).toBe(0);
    expect(previousActive([0, 2, 3], 0)).toBe(3);
    expect(nextActive([1, 3], 3)).toBe(1);
  });

  it('auto-picks for missing players, privately telling them which slip went', () => {
    const s = tick(game, start(game).state).state;
    const t = tick(game, s);
    for (const seat of SEATS) {
      const mine = eventsForSeat(t.events, seat);
      expect(mine.filter((e) => e.type === 'MY_SELECTION')).toEqual([
        expect.objectContaining({ type: 'MY_SELECTION', auto: true }),
      ]);
    }
    expect(t.state.autoPicks).toEqual({ 0: 1, 1: 1, 2: 1, 3: 1 });
  });
});

describe('safe auto-pick (also the bot)', () => {
  const hand = (...its: string[]): Chit[] => its.map((item, i) => ({ handle: `h${i}`, item }));

  it('passes from the item held fewest, never from the biggest group', () => {
    for (let seed = 0; seed < 50; seed++) {
      const rng = createRng(seed);
      expect(safePick(hand(M, M, M, B), rng).item).toBe(B);
      expect([B, A]).toContain(safePick(hand(M, M, B, A), rng).item);
    }
  });

  it('breaks ties with the seeded RNG', () => {
    const picks = new Set<string>();
    for (let seed = 0; seed < 40; seed++)
      picks.add(safePick(hand(M, M, B, B), createRng(seed)).item);
    expect(picks).toEqual(new Set([M, B]));
    expect(safePick(hand(M, M, B, B), createRng(3))).toEqual(
      safePick(hand(M, M, B, B), createRng(3)),
    );
  });
});

describe('idle', () => {
  it('asks for a bot after 3 consecutive auto-picks; choosing yourself resets the count', () => {
    const game = rigged(MIXED, { cycleCap: 50 });
    let s = start(game).state;
    s = tick(game, s).state; // → SELECTING
    const requests: unknown[] = [];
    for (let cycle = 1; cycle <= 3; cycle++) {
      if (cycle === 2) {
        s = act(game, s, 1, { type: 'SELECT', handle: (s.hands[1] as Chit[])[0]!.handle }).state;
      }
      const passed = tick(game, s);
      requests.push(...(passed.requests ?? []));
      s = passed.state;
      s = tick(game, s).state; // PASSING → next phase
      expect(s.phase).toBe('SELECTING'); // this deal and seed never complete a set in 3 passes
    }
    expect(requests).toEqual(
      expect.arrayContaining([
        { type: 'MARK_IDLE', seat: 0 },
        { type: 'MARK_IDLE', seat: 2 },
        { type: 'MARK_IDLE', seat: 3 },
      ]),
    );
    expect(requests).not.toContainEqual({ type: 'MARK_IDLE', seat: 1 });
    expect(s.autoPicks[1]).toBe(1);
  });

  it('resets the count when a bot takes over or the player returns', () => {
    const s = deepFreeze({ ...start().state, autoPicks: { 0: 2, 1: 0, 2: 0, 3: 0 } });
    const t = sixteenParchiGame.onSeatChange(s, 0, 'BOT_TOOK_OVER', ctx(0));
    expect(t.state.autoPicks[0]).toBe(0);
  });
});

describe('claims', () => {
  it('opens the claim window at once for a lucky opening hand, telling only the holders', () => {
    const game = rigged(TWO_LUCKY);
    const t = tick(game, start(game).state);
    expect(t.state).toMatchObject({ phase: 'CLAIM_WINDOW', eligible: [0, 2], phaseMs: 6000 });
    expect(types(t.events, 0)).toEqual(['CLAIM_WINDOW_OPENED', 'YOU_CAN_CLAIM']);
    expect(types(t.events, 1)).toEqual(['CLAIM_WINDOW_OPENED']);
    expect(game.getPlayerView(t.state, 0).canClaim).toBe(true);
    expect(game.getPlayerView(t.state, 1).canClaim).toBe(false);
    expect(JSON.stringify(game.getPlayerView(t.state, 1))).not.toMatch(/"eligible"/);
  });

  it('ranks simultaneous claims by arrival and keeps the window open for the other holder', () => {
    const game = rigged(TWO_LUCKY);
    let s = tick(game, start(game).state).state;
    const first = act(game, s, 2, { type: 'CLAIM' });
    expect(first.events.map((e) => e.event)).toEqual([
      { type: 'CLAIM_ACCEPTED', seat: 2, place: 1, items: [A, A, A, A], reason: 'CLAIM' },
      { type: 'CIRCLE_CHANGED', active: [0, 1, 3] },
    ]);
    expect(first.state.phase).toBe('CLAIM_WINDOW');
    s = first.state;
    const second = act(game, s, 0, { type: 'CLAIM' });
    expect(second.state.finishes.map((f) => [f.seat, f.place])).toEqual([
      [2, 1],
      [0, 2],
    ]);
    // Everyone eligible has claimed: short hold, then selecting resumes with two players.
    expect(second.state.phase).toBe('CLAIM_HOLD');
    expect(second.timers).toEqual([{ set: 'phase', ms: 1500 }]);
    const next = tick(game, second.state);
    expect(next.state).toMatchObject({ phase: 'SELECTING', active: [1, 3] });
    checkParchiInvariant(next.state);
  });

  it('refuses false, repeated and out-of-window claims', () => {
    const game = rigged(TWO_LUCKY);
    const s = tick(game, start(game).state).state;
    expect(game.validateAction(s, 1, { type: 'CLAIM' })).toEqual({
      ok: false,
      code: 'NOT_ELIGIBLE',
    });
    const claimed = act(game, s, 0, { type: 'CLAIM' }).state;
    expect(game.validateAction(claimed, 0, { type: 'CLAIM' })).toEqual({
      ok: false,
      code: 'NOT_ELIGIBLE',
    });
    const mixed = rigged(MIXED);
    const selecting = tick(mixed, start(mixed).state).state;
    expect(mixed.validateAction(selecting, 0, { type: 'CLAIM' })).toEqual({
      ok: false,
      code: 'NOT_ELIGIBLE',
    });
  });

  it('auto-claims unclaimed full sets in a seeded order when the window ends', () => {
    const game = rigged(TWO_LUCKY);
    const s = tick(game, start(game).state).state;
    const a = tick(game, s, s.phaseEndsAt, 5);
    const b = tick(game, s, s.phaseEndsAt, 5);
    expect(a.state.finishes).toEqual(b.state.finishes);
    expect(a.state.finishes.map((f) => f.reason)).toEqual(['AUTO_CLAIM', 'AUTO_CLAIM']);
    expect(a.state.finishes.map((f) => f.seat).sort()).toEqual([0, 2]);
    expect(a.state.phase).toBe('CLAIM_HOLD');
  });

  it('gives the last player the final place and ends the match', () => {
    const game = rigged(ALL_LUCKY);
    let s = tick(game, start(game).state).state;
    expect(s.eligible).toEqual([0, 1, 2, 3]);
    s = act(game, s, 3, { type: 'CLAIM' }).state;
    s = act(game, s, 1, { type: 'CLAIM' }).state;
    const end = act(game, s, 0, { type: 'CLAIM' });
    expect(end.state.phase).toBe('OVER');
    expect(end.state.finishes.map((f) => [f.seat, f.place, f.reason])).toEqual([
      [3, 1, 'CLAIM'],
      [1, 2, 'CLAIM'],
      [0, 3, 'CLAIM'],
      [2, 4, 'LAST'],
    ]);
    expect(end.events.at(-1)?.event).toEqual({
      type: 'MATCH_OVER',
      placements: [
        { seat: 3, place: 1 },
        { seat: 1, place: 2 },
        { seat: 0, place: 3 },
        { seat: 2, place: 4 },
      ],
      endedByCap: false,
    });
    expect(game.isOver(end.state)).toBe(true);
    expect(game.getResults(end.state).placements).toHaveLength(4);
    checkParchiInvariant(end.state);
  });
});

describe('safety cap', () => {
  it('ends after the cap, ranking by the largest same-item group with a seeded tie-break', () => {
    const game = rigged(MIXED, { cycleCap: 1 });
    let s = tick(game, start(game).state).state; // SELECTING
    s = tick(game, s).state; // pass 1 (auto-picks)
    const end = tick(game, s); // cap reached → no more selecting (no set can complete in one pass)
    expect(end.state.phase).toBe('OVER');
    expect(end.state.endedByCap).toBe(true);
    const groups = end.state.finishes.map((f) =>
      largestGroup(f.items.map((item) => ({ handle: '', item }))),
    );
    expect([...groups].sort((x, y) => y - x)).toEqual(groups);
    expect(end.state.finishes.every((f) => f.reason === 'CAP')).toBe(true);
    expect(end.events.at(-1)?.event).toMatchObject({ type: 'MATCH_OVER', endedByCap: true });
    checkParchiInvariant(end.state);
  });
});

describe('content pack', () => {
  it('has ten categories of four distinct, uniquely named items', () => {
    expect(CATEGORIES).toHaveLength(10);
    const ids = CATEGORIES.flatMap((c) => c.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CATEGORIES) {
      expect(c.items).toHaveLength(4);
      expect(new Set(c.items.map((i) => i.accent)).size).toBe(4);
    }
  });
});

describe('fuzzing and hidden information', () => {
  it('plays 300 seeded bot matches: invariants hold, nothing leaks, everyone is placed', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const result = simulateMatch<ParchiState, ParchiEvent>(sixteenParchiGame, {
        seats: 4,
        seed,
        settings: { category: 'RANDOM' },
        invariant: checkParchiInvariant,
        perturbHidden: perturbParchiHidden,
      });
      expect(result.results.placements.map((p) => p.place).sort()).toEqual([1, 2, 3, 4]);
      expect(result.requests).toEqual([]); // bots always choose in time
    }
  });

  it('ends even when nobody ever acts (auto-picks, auto-claims or the cap)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const result = simulateMatch<ParchiState, ParchiEvent>(sixteenParchiGame, {
        seats: 4,
        seed,
        botsAct: false,
        invariant: checkParchiInvariant,
      });
      expect(result.results.placements).toHaveLength(4);
      for (const seat of SEATS) {
        const idle = result.requests.filter((r) => r.seat === seat);
        expect(idle.length).toBeLessThanOrEqual(1);
      }
    }
  });

  it('never sends a seat an item or a handle it may not know', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const { delivered } = simulateMatch<ParchiState, ParchiEvent>(sixteenParchiGame, {
        seats: 4,
        seed,
      });
      const seenBy = SEATS.map(() => new Set<string>());
      SEATS.forEach((seat) => {
        const mine = seenBy[seat] as Set<string>;
        for (const e of delivered[seat] ?? []) {
          switch (e.type) {
            case 'DEALT':
              for (const c of e.hand) mine.add(c.handle);
              break;
            case 'CHIT_RECEIVED':
              mine.add(e.handle);
              break;
            case 'MY_SELECTION':
            case 'CHIT_SENT':
              expect(mine.has(e.handle)).toBe(true);
              break;
            case 'CLAIM_ACCEPTED':
            case 'MATCH_OVER':
              break; // public by design (the finished set is revealed)
            default:
              expect(JSON.stringify(e)).not.toMatch(/"items?"|"hand"|"handle"/);
          }
        }
      });
      // Re-keying: no handle is ever shown to two different seats.
      for (const a of SEATS) {
        for (const b of SEATS) {
          if (a >= b) continue;
          const shared = [...(seenBy[a] as Set<string>)].filter((h) =>
            (seenBy[b] as Set<string>).has(h),
          );
          expect(shared).toEqual([]);
        }
      }
    }
  });
});
