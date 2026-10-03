import { createRng, type StepCtx, type Transition } from '@cg/game-sdk';
import { deepFreeze, simulateMatch } from '@cg/game-sdk/testing';
import { describe, expect, it } from 'vitest';
import {
  borrowLimit,
  canBorrow,
  createBusinessGame,
  perturbBusinessHidden,
  rentAt,
  wealthOf,
  type BusinessOptions,
} from '../src/server';
import {
  ASSET_SPACES,
  BOARD,
  BOARD_SIZE,
  CITY_SPACES,
  CORNER_SPACE,
  DEFAULT_ECONOMY as E,
  EVENT_SUMS,
  TRANSPORT_SPACES,
  baseRent,
  buildCost,
  cellOf,
  eventOutcome,
  groupSpaces,
  isGood,
  priceOf,
  sideOf,
  type BusinessAction,
  type BusinessEvent,
  type BusinessState,
  type LogEntry,
} from '../src/shared';

type T = Transition<BusinessState, BusinessEvent>;
const ctx = (now = 1000, seed = 7): StepCtx => ({ now, rng: createRng(seed) });

/** A game whose dice follow `script` (one pair per roll), then fair dice. */
function scripted(script: [number, number][] = [], options: BusinessOptions = {}) {
  const queue = [...script];
  return createBusinessGame({
    ...options,
    dice: (rng) => queue.shift() ?? [rng.int(1, 6), rng.int(1, 6)],
  });
}
type Game = ReturnType<typeof scripted>;
const SETTINGS = { rounds: 15, board: 'india-classic', eventFrequency: 'normal' } as const;

/** A fresh match where seat 0 moves first, with optional edits. */
function start(game: Game, seats = [0, 1], edit: (s: BusinessState) => void = () => undefined) {
  const s = structuredClone(game.setup(seats, SETTINGS, ctx(), { bots: [] }).state);
  s.order = [...seats];
  s.current = seats[0] as number;
  edit(s);
  return deepFreeze(s);
}
type Act = { type: BusinessAction['type'] } & Record<string, unknown>;
const act = (game: Game, s: BusinessState, action: Act, seat = s.current): T => {
  const a = { turn: s.turn, ...action } as BusinessAction;
  const parsed = game.actionSchema.parse(a);
  const v = game.validateAction(s, seat, parsed);
  if (!v.ok) throw new Error(`rejected ${a.type}: ${v.code}`);
  const t = game.applyAction(s, seat, parsed, ctx());
  return { ...t, state: deepFreeze(t.state) };
};
const verdict = (game: Game, s: BusinessState, seat: number, a: Record<string, unknown>) => {
  const parsed = game.actionSchema.safeParse({ turn: s.turn, ...a });
  if (!parsed.success) return 'INVALID_PAYLOAD';
  const v = game.validateAction(s, seat, parsed.data);
  return v.ok ? 'OK' : v.code;
};
const timer = (game: Game, s: BusinessState): T => {
  const t = game.onTimer(s, 'phase', ctx());
  return { ...t, state: deepFreeze(t.state) };
};
const logs = (t: T) =>
  t.events.flatMap((e) => (e.event.type === 'LOG' ? [e.event.entry] : [])) as LogEntry[];
const cash = (s: BusinessState, seat: number) => s.players[seat]?.cash ?? 0;
const totalCash = (s: BusinessState) => s.seats.reduce((n, x) => n + cash(s, x), 0);
/** Money only enters or leaves through the bank. */
const conserved = (before: BusinessState, after: BusinessState) =>
  expect(totalCash(after) - totalCash(before)).toBe(after.bankNet - before.bankNet);
const space = (id: string) =>
  BOARD.findIndex((b) => (b.kind === 'city' || b.kind === 'transport') && b.id === id);
const at = (s: BusinessState, seat: number, i: number) => {
  (s.players[seat] as { position: number }).position = i;
};
const own = (s: BusinessState, seat: number, i: number, level = 0) => {
  s.owner[i] = seat;
  s.level[i] = level;
};

describe('board (frozen structure)', () => {
  it('has 36 spaces: 4 corners, 22 cities in groups 6/6/5/5, 6 transports, 4 events', () => {
    expect(BOARD_SIZE).toBe(36);
    expect(CORNER_SPACE).toEqual({ start: 0, jail: 9, club: 18, resort: 27 });
    for (const [corner, i] of Object.entries(CORNER_SPACE)) {
      expect(BOARD[i]).toEqual({ kind: 'corner', corner });
    }
    expect(CITY_SPACES).toHaveLength(22);
    expect(['A', 'B', 'C', 'D'].map((g) => groupSpaces(g as 'A').length)).toEqual([6, 6, 5, 5]);
    expect(TRANSPORT_SPACES.map((i) => (BOARD[i] as { id: string }).id).sort()).toEqual([
      'airways',
      'petroleum',
      'railways',
      'roadways',
      'satellite',
      'waterways',
    ]);
    const events = BOARD.flatMap((b, i) => (b.kind === 'event' ? [{ i, deck: b.deck }] : []));
    expect(events.map((e) => e.deck)).toEqual(['chance', 'chest', 'chance', 'chest']);
    expect(events.map((e) => sideOf(e.i))).toEqual([0, 1, 2, 3]);
    for (const e of events) {
      expect(BOARD[e.i - 1]?.kind).not.toBe('event');
      expect(BOARD[(e.i + 1) % 36]?.kind).not.toBe('event');
    }
    for (const city of [
      'delhi',
      'mumbai',
      'bengaluru',
      'hyderabad',
      'chennai',
      'kolkata',
      'jaipur',
      'lucknow',
      'goa',
      'patna',
      'jammu',
    ]) {
      expect(space(city), city).toBeGreaterThan(0);
    }
  });

  it('lays the spaces round a square, START bottom-left, clockwise, each next to the last', () => {
    expect(cellOf(0)).toEqual({ row: 9, col: 0 });
    expect(cellOf(9)).toEqual({ row: 0, col: 0 });
    expect(cellOf(18)).toEqual({ row: 0, col: 9 });
    expect(cellOf(27)).toEqual({ row: 9, col: 9 });
    const seen = new Set<string>();
    for (let i = 0; i < 36; i++) {
      const p = cellOf(i);
      const q = cellOf((i + 1) % 36);
      expect(Math.abs(p.row - q.row) + Math.abs(p.col - q.col)).toBe(1);
      seen.add(`${p.row}:${p.col}`);
    }
    expect(seen.size).toBe(36);
  });
});

describe('dice, movement and corners', () => {
  it('starts everyone on START with ₹10,500; draws the first player; custom rounds 5–40', () => {
    const game = scripted();
    const s = game.setup([0, 1, 2], SETTINGS, ctx(), { bots: [] }).state;
    for (const x of [0, 1, 2])
      expect(s.players[x]).toMatchObject({ cash: 10_500, position: 0, debt: 0 });
    expect(game.settingsSchema.safeParse({ ...SETTINGS, rounds: 23 }).success).toBe(true);
    expect(game.settingsSchema.safeParse({ ...SETTINGS, rounds: 4 }).success).toBe(false);
    expect(game.settingsSchema.safeParse({ ...SETTINGS, rounds: 41 }).success).toBe(false);
    expect(game.settingsSchema.safeParse({ ...SETTINGS, board: 'other' }).success).toBe(false);
    const firsts = new Set<number>();
    for (let seed = 1; seed <= 30; seed++) {
      firsts.add(
        game.setup([0, 1, 2, 3], SETTINGS, ctx(1000, seed), { bots: [] }).state.order[0] as number,
      );
    }
    expect(firsts.size).toBe(4);
  });

  it('rolls two dice (2–12), moves through every space, no extra turn for doubles', () => {
    const game = scripted([[3, 3]]);
    const s = start(game);
    const t = act(game, s, { type: 'ROLL' });
    const rolled = t.events.find((e) => e.event.type === 'ROLLED')?.event;
    expect(rolled).toMatchObject({ dice: [3, 3], from: 0, to: 6, path: [1, 2, 3, 4, 5, 6] });
    // Doubles: the turn ends normally (Guwahati is for sale → decide, then the next player).
    const next = act(game, t.state, { type: 'SKIP' });
    expect(next.state.phase).toBe('HOLD'); // the board catches up, then the next player
    expect(timer(game, next.state).state.current).toBe(1);
    const fair = createBusinessGame();
    for (let seed = 1; seed <= 100; seed++) {
      const r = fair.applyAction(start(scripted()), 0, { type: 'ROLL', turn: 1 }, ctx(1000, seed));
      const d = r.state.lastRoll?.dice ?? [];
      expect(d).toHaveLength(2);
      expect(d[0]! + d[1]!).toBeGreaterThanOrEqual(2);
      expect(d[0]! + d[1]!).toBeLessThanOrEqual(12);
    }
  });

  it('pays ₹1,500 when passing or landing on START', () => {
    const game = scripted([[2, 2]]);
    const s = start(game, [0, 1], (x) => at(x, 0, 32));
    const t = act(game, s, { type: 'ROLL' });
    expect(logs(t)).toContainEqual({ type: 'SALARY', seat: 0, amount: 1500 });
    expect(t.state.players[0]?.position).toBe(0);
    conserved(s, t.state);
  });

  it('CLUB collects ₹200 from every other player; RESORT pays ₹200 to every other player', () => {
    const game = scripted([
      [4, 5],
      [4, 5],
    ]);
    const club = act(
      game,
      start(game, [0, 1, 2], (x) => at(x, 0, 9)),
      { type: 'ROLL' },
    );
    expect([0, 1, 2].map((x) => cash(club.state, x))).toEqual([10_900, 10_300, 10_300]);
    const resort = act(
      game,
      start(game, [0, 1, 2], (x) => at(x, 0, 18)),
      { type: 'ROLL' },
    );
    expect([0, 1, 2].map((x) => cash(resort.state, x))).toEqual([10_100, 10_700, 10_700]);
  });

  it('JAIL: pay ₹500, or lose the next roll', () => {
    const game = scripted([
      [4, 5],
      [1, 0],
    ]);
    const s = start(game, [0, 1], (x) => at(x, 0, 0));
    const jail = act(game, s, { type: 'ROLL' });
    expect(jail.state.decision).toEqual({ kind: 'JAIL', space: 9, cost: 500 });
    expect(verdict(game, jail.state, 0, { type: 'SKIP' })).toBe('ILLEGAL_ACTION');
    const paid = act(game, jail.state, { type: 'JAIL_PAY' });
    expect(cash(paid.state, 0)).toBe(10_000);
    const waited = act(game, jail.state, { type: 'JAIL_WAIT' });
    expect(waited.state.players[0]?.skipNext).toBe(true);
    // Seat 1's turn, then seat 0's turn is skipped.
    let x = timer(game, waited.state).state; // → seat 1
    x = act(game, x, { type: 'ROLL' }, 1).state; // Patna: an offer
    x = timer(game, timer(game, x).state).state; // declined (timeout), then seat 0…
    expect(x.current).toBe(0);
    expect(x.phase).toBe('HOLD');
    expect(x.log.at(-1)).toEqual({ type: 'TURN_SKIPPED', seat: 0 });
    expect(timer(game, x).state.current).toBe(1);
  });

  it('ends after the configured number of rounds, nobody eliminated', () => {
    const game = scripted();
    let s = start(game, [0, 1], (x) => (x.rounds = 5));
    for (let k = 0; k < 400 && s.phase !== 'OVER'; k++) s = timer(game, s).state;
    expect(s.phase).toBe('OVER');
    expect(s.round).toBe(6);
    expect(game.getResults(s).placements).toHaveLength(2);
  });
});

describe('buying, rent and development', () => {
  it('offers BUY / DON’T BUY; buying records ownership and property spending', () => {
    const game = scripted([
      [1, 0],
      [1, 0],
    ]);
    const s = start(game);
    const t = act(game, s, { type: 'ROLL' });
    expect(t.state.decision).toEqual({ kind: 'BUY', space: 1, cost: 600 });
    const b = act(game, t.state, { type: 'BUY', space: 1 });
    expect(b.state.owner[1]).toBe(0);
    expect(cash(b.state, 0)).toBe(9900);
    expect(b.state.players[0]?.spend).toEqual({ property: 600, development: 0, transport: 0 });
    conserved(s, b.state);
    const no = act(game, t.state, { type: 'SKIP' });
    expect(no.state.owner[1]).toBeNull();
  });

  it('records transport purchases as transport spending', () => {
    const game = scripted([[2, 1]]);
    const t = act(game, act(game, start(game), { type: 'ROLL' }).state, { type: 'BUY', space: 3 });
    expect(t.state.players[0]?.spend).toEqual({
      property: 0,
      development: 0,
      transport: E.transportPrice,
    });
  });

  it('charges rent by level, doubled with 3+ cities of a group; shows it before paying', () => {
    const game = scripted([[1, 0]]);
    const patna = space('patna');
    const s = start(game, [0, 1], (x) => own(x, 1, patna, 2));
    expect(rentAt(s, patna)).toBe(baseRent(patna) * 6);
    const t = act(game, s, { type: 'ROLL' });
    expect(logs(t)).toContainEqual({
      type: 'PAID',
      from: 0,
      to: 1,
      amount: baseRent(patna) * 6,
      reason: 'rent',
      space: patna,
      writtenOff: 0,
    });
    conserved(s, t.state);
    const group = start(game, [0, 1], (x) => {
      for (const i of [1, 2]) own(x, 1, i);
      own(x, 1, space('kolkata'));
    });
    expect(rentAt(group, patna)).toBe(baseRent(patna) * 2);
    const two = start(game, [0, 1], (x) => {
      own(x, 1, 1);
      own(x, 1, 2);
    });
    expect(rentAt(two, patna)).toBe(baseRent(patna));
    const all = start(game, [0, 1], (x) => {
      for (const i of groupSpaces('C')) own(x, 1, i);
    });
    expect(rentAt(all, patna)).toBe(baseRent(patna) * 2); // no further multiplier
  });

  it('builds houses then a hotel only when landing on your own city — one or more levels at once', () => {
    const game = scripted([
      [1, 0],
      [1, 0],
      [1, 0],
    ]);
    const s = start(game, [0, 1], (x) => own(x, 0, 1, 2));
    const t = act(game, s, { type: 'ROLL' });
    expect(t.state.decision).toEqual({ kind: 'BUILD', space: 1, cost: buildCost(1, 2) });
    const up = act(game, t.state, { type: 'BUILD', space: 1, levels: 2 });
    expect(up.state.level[1]).toBe(4); // house 3, then the hotel
    expect(up.state.players[0]?.spend.development).toBe(buildCost(1, 2) + buildCost(1, 3));
    expect(verdict(game, t.state, 0, { type: 'BUILD', space: 1, levels: 3 })).toBe(
      'ILLEGAL_ACTION',
    );
    const hotel = start(game, [0, 1], (x) => own(x, 0, 1, 4));
    expect(act(game, hotel, { type: 'ROLL' }).state.phase).toBe('HOLD');
    const poor = act(
      game,
      start(game, [0, 1], (x) => {
        own(x, 0, 1, 0);
        (x.players[0] as { cash: number }).cash = 100;
      }),
      { type: 'ROLL' },
    );
    expect(verdict(game, poor.state, 0, { type: 'BUILD', space: 1, levels: 1 })).toBe(
      'ILLEGAL_ACTION',
    );
  });

  it('charges transport rent by how many transports the owner holds', () => {
    const game = scripted([[2, 1]]);
    for (const n of [1, 2, 3, 6]) {
      const s = start(game, [0, 1], (x) => {
        for (const i of TRANSPORT_SPACES.slice(0, n)) own(x, 1, i);
      });
      expect(rentAt(s, 3)).toBe(E.transportRent[n - 1]);
    }
  });
});

describe('events: the dice sum decides (frozen)', () => {
  it('has one outcome per sum 2–12 per deck with the frozen parity', () => {
    for (const deck of ['chance', 'chest'] as const) {
      for (const sum of EVENT_SUMS) {
        const o = eventOutcome(deck, sum);
        expect(o.good).toBe(deck === 'chance' ? sum % 2 === 0 : sum % 2 === 1);
        expect(isGood(deck, sum)).toBe(o.good);
        expect(o.effect).toBeDefined();
      }
    }
  });

  it('applies every outcome from a real event roll', () => {
    const before = (deck: 'chance' | 'chest') =>
      start(scripted(), [0, 1, 2], (x) => {
        at(x, 0, deck === 'chance' ? 3 : 11);
        own(x, 0, space('kochi'), 1);
        own(x, 0, space('chennai'), 4);
      });
    const outcomes: Record<string, (s: BusinessState, t: T) => void> = {
      'chance:2': (_s, t) => expect(cash(t.state, 0)).toBe(12_000),
      'chance:3': (_s, t) => expect(cash(t.state, 0)).toBe(9500),
      'chance:4': (_s, t) =>
        expect([0, 1, 2].map((x) => cash(t.state, x))).toEqual([10_900, 10_300, 10_300]),
      'chance:5': (_s, t) =>
        expect([0, 1, 2].map((x) => cash(t.state, x))).toEqual([9900, 10_800, 10_800]),
      'chance:6': (_s, t) => expect(cash(t.state, 0)).toBe(11_000),
      'chance:7': (_s, t) => expect(cash(t.state, 0)).toBe(10_300),
      'chance:8': (_s, t) => expect(t.state.level[space('kochi')]).toBe(2),
      'chance:9': (_s, t) => expect(t.state.players[0]?.skipNext).toBe(true),
      'chance:10': (_s, t) => {
        expect(t.state.players[0]?.position).toBe(0);
        expect(cash(t.state, 0)).toBe(12_000);
      },
      'chance:11': (_s, t) => expect(cash(t.state, 0)).toBe(10_500 - 100 - 250),
      'chance:12': (_s, t) => expect(cash(t.state, 0)).toBe(11_500),
      'chest:2': (_s, t) => expect(cash(t.state, 0)).toBe(9000),
      'chest:3': (_s, t) => expect(cash(t.state, 0)).toBe(11_500),
      'chest:4': (_s, t) =>
        expect([0, 1, 2].map((x) => cash(t.state, x))).toEqual([10_100, 10_700, 10_700]),
      'chest:5': (_s, t) =>
        expect([0, 1, 2].map((x) => cash(t.state, x))).toEqual([10_800, 10_350, 10_350]),
      'chest:6': (_s, t) => expect(cash(t.state, 0)).toBe(10_100),
      'chest:7': (_s, t) => expect(cash(t.state, 0)).toBe(10_800),
      'chest:8': (_s, t) => expect(t.state.players[0]?.noBuyNext).toBe(true),
      'chest:9': (_s, t) => expect(t.state.players[0]?.rentHoliday).toBe(true),
      'chest:10': (_s, t) => expect(t.state.players[0]?.skipNext).toBe(true),
      'chest:11': (_s, t) => expect(t.state.level[space('kochi')]).toBe(2),
      'chest:12': (_s, t) => expect(cash(t.state, 0)).toBe(9700),
    };
    for (const deck of ['chance', 'chest'] as const) {
      for (const sum of EVENT_SUMS) {
        const half = Math.floor(sum / 2);
        const game = scripted([
          [2, 0],
          [half, sum - half],
        ]);
        const s = before(deck);
        const moved = act(game, s, { type: 'ROLL' }); // two steps onto the event space
        expect(moved.state.phase, `${deck}:${sum}`).toBe('EVENT');
        const t = act(game, moved.state, { type: 'EVENT_ROLL' });
        expect(t.state.lastEvent).toMatchObject({ deck, sum, good: isGood(deck, sum) });
        outcomes[`${deck}:${sum}`]?.(s, t);
        conserved(s, t.state);
      }
    }
  });

  it('a rent holiday waives the next rent; "cannot buy" blocks the next turn’s offer', () => {
    const game = scripted([
      [1, 0],
      [1, 0],
    ]);
    const holiday = start(game, [0, 1], (x) => {
      own(x, 1, 1, 3);
      (x.players[0] as { rentHoliday: boolean }).rentHoliday = true;
    });
    const t = act(game, holiday, { type: 'ROLL' });
    expect(cash(t.state, 0)).toBe(10_500);
    expect(logs(t).some((e) => e.type === 'RENT_WAIVED')).toBe(true);
    const blocked = start(game, [0, 1], (x) => {
      (x.players[0] as { noBuyActive: boolean }).noBuyActive = true;
    });
    expect(act(game, blocked, { type: 'ROLL' }).state.decision).toBeNull();
  });
});

describe('loans, raising money and insolvency', () => {
  it('lends in ₹1,000 steps with a 10 % fee, several times, up to the limit; repays early', () => {
    const game = scripted();
    let s = start(game, [0, 1], (x) => own(x, 0, 35, 0));
    expect(borrowLimit(s, 0)).toBe(3000 + 1400);
    expect(canBorrow(s, 0)).toBe(4000);
    s = act(game, s, { type: 'LOAN', amount: 1000 }).state;
    s = act(game, s, { type: 'LOAN', amount: 2000 }).state;
    expect(s.players[0]).toMatchObject({ cash: 13_500, debt: 3300 });
    s = act(game, s, { type: 'LOAN', amount: 1000 }).state; // debt 4,400 = the limit
    expect(verdict(game, s, 0, { type: 'LOAN', amount: 1000 })).toBe('ILLEGAL_ACTION');
    expect(verdict(game, s, 0, { type: 'LOAN', amount: 500 })).toBe('ILLEGAL_ACTION');
    s = act(game, s, { type: 'REPAY', amount: 1300 }).state;
    expect(s.players[0]).toMatchObject({ cash: 13_200, debt: 3100 });
    const last = start(game, [0, 1], (x) => (x.round = x.rounds));
    expect(canBorrow(last, 0)).toBe(0);
  });

  it('opens Raise money for an unpayable rent; selling covers it and pays automatically', () => {
    const game = scripted([[1, 0]]);
    const s = start(game, [0, 1], (x) => {
      own(x, 1, 1, 4);
      (x.players[0] as { cash: number }).cash = 100;
      own(x, 0, 35, 4);
    });
    const due = rentAt(s, 1);
    const t = act(game, s, { type: 'ROLL' });
    expect(t.state.phase).toBe('RAISE');
    expect(t.state.raise?.total).toBe(due);
    expect(verdict(game, t.state, 0, { type: 'ROLL' })).toBe('INVALID_PHASE');
    const sold = act(game, t.state, { type: 'SELL_ASSET', space: 35 });
    expect(sold.state.owner[35]).toBeNull();
    expect(sold.state.phase).toBe('HOLD');
    expect(cash(sold.state, 1)).toBe(10_500 + due);
    conserved(s, sold.state);
    // Cumulative spending is a record; sales never reduce it.
    const spent = start(game, [0, 1], (x) => {
      (x.players[0] as { spend: { property: number } }).spend.property = 2800;
    });
    expect(wealthOf(spent, 0).property).toBe(2800);
  });

  it('lets the bank handle it (timeout): loans, buildings, assets, then INSOLVENT and still playing', () => {
    const game = scripted([[1, 0]]);
    const s = start(game, [0, 1], (x) => {
      own(x, 1, 1, 4);
      (x.players[0] as { cash: number }).cash = 0;
      x.economy = { ...x.economy, loanBase: 0 };
    });
    const t = act(game, s, { type: 'ROLL' });
    const done = timer(game, t.state);
    expect(done.state.players[0]).toMatchObject({ cash: 0, debt: 0, insolvent: true });
    expect(logs(done).some((e) => e.type === 'INSOLVENT')).toBe(true);
    conserved(s, done.state);
    // Still in the match: their turns keep coming.
    let x = timer(game, done.state).state;
    expect(x.current).toBe(1);
    for (let k = 0; k < 5 && x.current !== 0; k++) x = timer(game, x).state;
    expect(x.current).toBe(0);
    expect(x.phase).toBe('ROLL');
  });

  it('repays debt from cash at the end, so loans add no final wealth', () => {
    const game = scripted();
    let s = start(game, [0, 1], (x) => (x.rounds = 5));
    s = act(game, s, { type: 'LOAN', amount: 2000 }).state;
    for (let k = 0; k < 400 && s.phase !== 'OVER'; k++) s = timer(game, s).state;
    expect(s.players[0]?.debt).toBe(0);
    expect(s.log.some((e) => e.type === 'SETTLED' && e.seat === 0 && e.repaid === 2200)).toBe(true);
  });
});

describe('auctions (owner-initiated) and trading', () => {
  const owned = (game: Game) =>
    start(game, [0, 1, 2], (x) => {
      own(x, 0, space('mumbai'), 2);
    });

  it('auctions an owned asset (with buildings): others bid, the seller can’t, the winner pays', () => {
    const game = scripted();
    const s = owned(game);
    const mumbai = space('mumbai');
    expect(verdict(game, s, 0, { type: 'AUCTION_START', space: 1 })).toBe('ILLEGAL_ACTION');
    let x = act(game, s, { type: 'AUCTION_START', space: mumbai }).state;
    expect(x.phase).toBe('AUCTION');
    const open = x.auction?.open as number;
    expect(open).toBe(
      Math.round(((priceOf(mumbai) + buildCost(mumbai, 0) + buildCost(mumbai, 1)) * 0.5) / 100) *
        100,
    );
    expect(verdict(game, x, 0, { type: 'BID', amount: open })).toBe('NOT_ELIGIBLE');
    expect(verdict(game, x, 1, { type: 'BID', amount: open - 100 })).toBe('ILLEGAL_ACTION');
    x = act(game, x, { type: 'BID', amount: open }, 1).state;
    expect(verdict(game, x, 2, { type: 'BID', amount: open })).toBe('ILLEGAL_ACTION');
    x = act(game, x, { type: 'BID', amount: open + 500 }, 2).state;
    const done = timer(game, x);
    expect(done.state.owner[mumbai]).toBe(2);
    expect(done.state.level[mumbai]).toBe(2);
    expect(cash(done.state, 0)).toBe(10_500 + open + 500);
    expect(done.state.players[2]?.spend.property).toBe(open + 500);
    expect(done.state.phase).toBe('ROLL');
    // One auction per turn, and a 3-round lock on the asset.
    expect(verdict(game, done.state, 0, { type: 'AUCTION_START', space: mumbai })).toBe(
      'ILLEGAL_ACTION',
    );
    expect(done.state.lockedUntil[mumbai]).toBe(done.state.round + 3);
    conserved(s, done.state);
  });

  it('extends a late bid to 5 s and stops at 30 s; no bid leaves the asset with the seller', () => {
    const game = scripted();
    const s = act(game, owned(game), { type: 'AUCTION_START', space: space('mumbai') }).state;
    const late = game.applyAction(
      s,
      1,
      { type: 'BID', turn: s.turn, amount: s.auction!.open },
      ctx(1000 + 14_000),
    );
    expect(late.state.auction?.endsAt).toBe(1000 + 14_000 + 5000);
    const unsold = timer(game, s);
    expect(unsold.state.owner[space('mumbai')]).toBe(0);
    expect(logs(unsold)).toContainEqual({
      type: 'AUCTION_UNSOLD',
      seller: 0,
      space: space('mumbai'),
    });
  });

  it('trades only when both confirm; re-checks at acceptance; cash paid counts as spending', () => {
    const game = scripted();
    const s = start(game, [0, 1], (x) => own(x, 1, 1));
    const offer = {
      type: 'TRADE_PROPOSE' as const,
      to: 1,
      give: { cash: 900, assets: [] },
      get: { cash: 0, assets: [1] },
    };
    expect(verdict(game, s, 0, { ...offer, get: { cash: 0, assets: [2] } })).toBe('ILLEGAL_ACTION');
    expect(verdict(game, s, 0, { ...offer, give: { cash: 99_999, assets: [] } })).toBe(
      'ILLEGAL_ACTION',
    );
    const proposed = act(game, s, offer).state;
    expect(proposed.phase).toBe('TRADE');
    expect(verdict(game, proposed, 0, { type: 'TRADE_ANSWER', accept: true })).toBe('NOT_ELIGIBLE');
    const yes = act(game, proposed, { type: 'TRADE_ANSWER', accept: true }, 1).state;
    expect(yes.owner[1]).toBe(0);
    expect([cash(yes, 0), cash(yes, 1)]).toEqual([9600, 11_400]);
    expect(yes.players[0]?.spend.property).toBe(900);
    expect(yes.phase).toBe('ROLL');
    const no = act(game, proposed, { type: 'TRADE_ANSWER', accept: false }, 1).state;
    expect(no.owner[1]).toBe(1);
    expect(timer(game, proposed).state.owner[1]).toBe(1); // timeout = declined
  });
});

describe('server authority', () => {
  it('rejects wrong-turn, stale, forged and post-game actions', () => {
    const game = scripted([[1, 0]]);
    const s = start(game);
    expect(verdict(game, s, 1, { type: 'ROLL' })).toBe('NOT_YOUR_TURN');
    expect(game.validateAction(s, 0, { type: 'ROLL', turn: s.turn - 1 })).toEqual({
      ok: false,
      code: 'INVALID_PHASE',
    });
    for (const forged of [
      { type: 'ROLL', dice: [6, 6] },
      { type: 'BUY', space: 1, price: 0 },
      { type: 'BUY', space: 99 },
      { type: 'SKIP', cash: 99_999 },
      { type: 'LOAN', amount: -1000 },
      {
        type: 'TRADE_PROPOSE',
        to: 1,
        give: { cash: 0, assets: [], debt: 1 },
        get: { cash: 0, assets: [] },
      },
    ]) {
      expect(verdict(game, s, 0, forged), JSON.stringify(forged)).toBe('INVALID_PAYLOAD');
    }
    expect(verdict(game, s, 0, { type: 'BUY', space: 1 })).toBe('INVALID_PHASE');
    const t = act(game, s, { type: 'ROLL' });
    expect(verdict(game, t.state, 0, { type: 'BUY', space: 2 })).toBe('ILLEGAL_ACTION');
    const over = start(game, [0, 1], (x) => (x.phase = 'OVER'));
    expect(verdict(game, over, 0, { type: 'ROLL' })).toBe('INVALID_PHASE');
  });

  it('times out safely after 30 s: rolls, declines, waits at Jail; three in a row → bot', () => {
    const game = scripted([
      [1, 0],
      [1, 0],
      [1, 0],
      [1, 0],
    ]);
    expect(start(game).phaseMs).toBe(30_000);
    let s = start(game);
    const requests = [];
    for (let k = 0; k < 10 && requests.length === 0; k++) {
      const t = timer(game, s);
      requests.push(...(t.requests ?? []));
      s = t.state;
    }
    expect(requests).toEqual([{ type: 'MARK_IDLE', seat: 0 }]);
    expect(s.owner.every((o) => o === null)).toBe(true);
  });
});

describe('final wealth (frozen formula) and bots', () => {
  it('is cash + cumulative spending on properties, buildings and transport', () => {
    const s = start(scripted(), [0, 1], (x) => {
      x.players[0] = {
        ...x.players[0]!,
        cash: 5000,
        spend: { property: 3000, development: 1200, transport: 1500 },
      };
    });
    expect(wealthOf(s, 0)).toEqual({
      cash: 5000,
      property: 3000,
      development: 1200,
      transport: 1500,
      total: 10_700,
    });
  });

  it('bots play complete matches through the same actions; money stays accounted for', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const r = simulateMatch<BusinessState, BusinessEvent>(createBusinessGame(), {
        seats: 2 + (seed % 5),
        seed,
        settings: { ...SETTINGS, rounds: 8 },
        perturbHidden: perturbBusinessHidden,
        invariant: (s) => {
          for (const x of s.seats) {
            expect(s.players[x]!.cash).toBeGreaterThanOrEqual(0);
            expect(s.players[x]!.debt).toBeGreaterThanOrEqual(0);
          }
          for (const i of ASSET_SPACES) if (s.owner[i] === null) expect(s.level[i]).toBe(0);
        },
      });
      expect(r.state.phase).toBe('OVER');
      expect(r.state.final).not.toBeNull();
      const start = r.state.seats.length * E.startCash;
      expect(r.state.seats.reduce((n, x) => n + r.state.players[x]!.cash, 0)).toBe(
        start + r.state.bankNet,
      );
    }
  });
});
