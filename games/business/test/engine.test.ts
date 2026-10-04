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
  HOTEL,
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
  type Group,
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

const S0 = E.startCash;
const scaledFx = (deck: 'chance' | 'chest', sum: number) => eventOutcome(deck, sum, E).effect;
const amountOf = (deck: 'chance' | 'chest', sum: number) => {
  const fx = scaledFx(deck, sum);
  return 'amount' in fx ? fx.amount : 0;
};

describe('board (frozen structure)', () => {
  it('has 36 spaces: corners 0 START, 9 CLUB, 18 RESORT, 27 JAIL; 22 cities; 6 transports; 4 events', () => {
    expect(BOARD_SIZE).toBe(36);
    expect(CORNER_SPACE).toEqual({ start: 0, club: 9, resort: 18, jail: 27 });
    for (const [corner, i] of Object.entries(CORNER_SPACE)) {
      expect(BOARD[i]).toEqual({ kind: 'corner', corner });
    }
    const members = (g: Group) =>
      groupSpaces(g)
        .map((i) => (BOARD[i] as { id: string }).id)
        .sort();
    expect(CITY_SPACES).toHaveLength(22);
    expect(members('A')).toEqual(['chandigarh', 'dehradun', 'delhi', 'jaipur', 'jammu', 'lucknow']);
    expect(members('B')).toEqual([
      'bengaluru',
      'chennai',
      'hyderabad',
      'kochi',
      'thiruvananthapuram',
      'visakhapatnam',
    ]);
    expect(members('C')).toEqual(['bhubaneswar', 'guwahati', 'kolkata', 'patna', 'ranchi']);
    expect(members('D')).toEqual(['ahmedabad', 'goa', 'mumbai', 'pune', 'surat']);
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
  });

  it('mixes the four groups round every side; the arrangement is fixed for every match', () => {
    for (const side of [0, 1, 2, 3]) {
      const groups = CITY_SPACES.filter((i) => sideOf(i) === side).map(
        (i) => (BOARD[i] as { group: Group }).group,
      );
      expect(new Set(groups).size, `side ${side}`).toBeGreaterThanOrEqual(3);
    }
    // The exact v1 order (a fixed board, never reshuffled).
    expect(
      BOARD.map((b) =>
        b.kind === 'city' || b.kind === 'transport' ? b.id : b.kind === 'event' ? b.deck : b.corner,
      ),
    ).toEqual([
      'start',
      'patna',
      'dehradun',
      'roadways',
      'kochi',
      'chance',
      'ranchi',
      'railways',
      'surat',
      'club',
      'guwahati',
      'jammu',
      'thiruvananthapuram',
      'chest',
      'goa',
      'waterways',
      'bhubaneswar',
      'visakhapatnam',
      'resort',
      'lucknow',
      'ahmedabad',
      'petroleum',
      'kolkata',
      'chance',
      'chandigarh',
      'satellite',
      'chennai',
      'jail',
      'pune',
      'hyderabad',
      'jaipur',
      'chest',
      'bengaluru',
      'mumbai',
      'airways',
      'delhi',
    ]);
    const a = createBusinessGame().setup([0, 1], SETTINGS, ctx(1000, 1), { bots: [] }).state;
    const b = createBusinessGame().setup([0, 1], SETTINGS, ctx(1000, 99), { bots: [] }).state;
    expect(a.owner).toEqual(b.owner);
    expect(a.level).toEqual(b.level);
  });

  it('lays it out anti-clockwise from START at the bottom-right: up, left, down, right', () => {
    expect(cellOf(0)).toEqual({ row: 9, col: 9 }); // bottom-right
    expect(cellOf(1)).toEqual({ row: 8, col: 9 }); // directly above START
    expect(cellOf(9)).toEqual({ row: 0, col: 9 }); // top-right
    expect(cellOf(18)).toEqual({ row: 0, col: 0 }); // top-left
    expect(cellOf(27)).toEqual({ row: 9, col: 0 }); // bottom-left
    expect(cellOf(35)).toEqual({ row: 9, col: 8 }); // directly left of START
    const seen = new Set<string>();
    const dirs: string[] = [];
    let area = 0;
    for (let i = 0; i < 36; i++) {
      const p = cellOf(i);
      const q = cellOf((i + 1) % 36);
      // Every next space is a physical neighbour.
      expect(Math.abs(p.row - q.row) + Math.abs(p.col - q.col), `${i}→${i + 1}`).toBe(1);
      seen.add(`${p.row}:${p.col}`);
      const dir = q.row < p.row ? 'up' : q.row > p.row ? 'down' : q.col < p.col ? 'left' : 'right';
      if (dirs.at(-1) !== dir) dirs.push(dir);
      area += p.col * -q.row - q.col * -p.row; // shoelace with y pointing up
    }
    expect(seen.size).toBe(36);
    expect(dirs).toEqual(['up', 'left', 'down', 'right']);
    expect(area).toBeGreaterThan(0); // positive = anti-clockwise
  });

  it('prices: cheapest city ₹1,500, Airways ₹10,500 the dearest asset, a spread-out curve', () => {
    const cityPrices = CITY_SPACES.map((i) => priceOf(i));
    expect(Math.min(...cityPrices)).toBe(1500);
    expect(priceOf(space('airways'))).toBe(10_500);
    expect(Math.max(...ASSET_SPACES.map((i) => priceOf(i)))).toBe(10_500);
    expect(cityPrices.filter((p) => p >= 2000 && p <= 3000).length).toBeLessThanOrEqual(5);
    expect(Math.max(...cityPrices) / Math.min(...cityPrices)).toBeGreaterThan(6);
  });
});

describe('dice, movement and corners', () => {
  it('starts everyone on START with ₹65,000; draws the first player; custom rounds 5–40', () => {
    const game = scripted();
    const s = game.setup([0, 1, 2], SETTINGS, ctx(), { bots: [] }).state;
    for (const x of [0, 1, 2])
      expect(s.players[x]).toMatchObject({ cash: 65_000, position: 0, debt: 0 });
    expect(game.settingsSchema.safeParse({ ...SETTINGS, rounds: 23 }).success).toBe(true);
    expect(game.settingsSchema.safeParse({ ...SETTINGS, rounds: 4 }).success).toBe(false);
    expect(game.settingsSchema.safeParse({ ...SETTINGS, rounds: 41 }).success).toBe(false);
    const firsts = new Set<number>();
    for (let seed = 1; seed <= 30; seed++) {
      firsts.add(
        game.setup([0, 1, 2, 3], SETTINGS, ctx(1000, seed), { bots: [] }).state.order[0] as number,
      );
    }
    expect(firsts.size).toBe(4);
  });

  it('moves space by space: the path holds every intermediate space; one roll = one space', () => {
    const one = act(scripted([[1, 0]]), start(scripted()), { type: 'ROLL' });
    expect(one.events.find((e) => e.event.type === 'ROLLED')?.event).toMatchObject({
      from: 0,
      to: 1,
      path: [1],
    });
    const game = scripted([[3, 3]]);
    const t = act(game, start(game), { type: 'ROLL' });
    const rolled = t.events.find((e) => e.event.type === 'ROLLED')?.event;
    expect(rolled).toMatchObject({ dice: [3, 3], from: 0, to: 6, path: [1, 2, 3, 4, 5, 6] });
    expect(t.state.players[0]?.position).toBe(6);
    // The landing decision waits for the dice and every hop.
    const timing = t.state.timing;
    expect(t.state.phaseMs).toBe(
      timing.diceMs + 6 * timing.hopMs + timing.landingMs + timing.turnMs,
    );
    // Doubles: no extra turn.
    const next = act(game, t.state, { type: 'SKIP' });
    expect(timer(game, next.state).state.current).toBe(1);
    const fair = createBusinessGame();
    for (let seed = 1; seed <= 100; seed++) {
      const r = fair.applyAction(start(scripted()), 0, { type: 'ROLL', turn: 1 }, ctx(1000, seed));
      const d = r.state.lastRoll?.dice ?? [];
      expect(d[0]! + d[1]!).toBeGreaterThanOrEqual(2);
      expect(d[0]! + d[1]!).toBeLessThanOrEqual(12);
    }
  });

  it('wraps from 35 to 0, paying ₹1,500 once when passing START', () => {
    const game = scripted([[2, 2]]);
    const s = start(game, [0, 1], (x) => at(x, 0, 33));
    const t = act(game, s, { type: 'ROLL' });
    expect(t.events.find((e) => e.event.type === 'ROLLED')?.event).toMatchObject({
      from: 33,
      to: 1,
      path: [34, 35, 0, 1],
    });
    expect(logs(t).filter((e) => e.type === 'SALARY')).toEqual([
      { type: 'SALARY', seat: 0, amount: 1500 },
    ]);
    conserved(s, t.state);
  });

  it('CLUB (9) collects ₹200 from each; RESORT (18) pays ₹200 to each; JAIL (27) pay ₹500 or wait', () => {
    const game = scripted([
      [4, 5],
      [4, 5],
      [4, 5],
    ]);
    const club = act(game, start(game, [0, 1, 2]), { type: 'ROLL' });
    expect([0, 1, 2].map((x) => cash(club.state, x))).toEqual([S0 + 400, S0 - 200, S0 - 200]);
    const resort = act(
      game,
      start(game, [0, 1, 2], (x) => at(x, 0, 9)),
      { type: 'ROLL' },
    );
    expect([0, 1, 2].map((x) => cash(resort.state, x))).toEqual([S0 - 400, S0 + 200, S0 + 200]);
    const jail = act(
      game,
      start(game, [0, 1], (x) => at(x, 0, 18)),
      { type: 'ROLL' },
    );
    expect(jail.state.decision).toEqual({ kind: 'JAIL', space: 27, cost: 500 });
    expect(cash(act(game, jail.state, { type: 'JAIL_PAY' }).state, 0)).toBe(S0 - 500);
    expect(act(game, jail.state, { type: 'JAIL_WAIT' }).state.players[0]?.skipNext).toBe(true);
  });

  it('ends after the configured number of rounds, nobody eliminated', () => {
    const game = scripted();
    let s = start(game, [0, 1], (x) => (x.rounds = 5));
    for (let k = 0; k < 400 && s.phase !== 'OVER'; k++) s = timer(game, s).state;
    expect(s.phase).toBe('OVER');
    expect(game.getResults(s).placements).toHaveLength(2);
  });
});

describe('buying, rent, development and transport', () => {
  it('offers BUY / SKIP; buying records ownership and property spending', () => {
    const game = scripted([[1, 0]]);
    const s = start(game);
    const t = act(game, s, { type: 'ROLL' });
    expect(t.state.decision).toEqual({ kind: 'BUY', space: 1, cost: 1500 });
    const b = act(game, t.state, { type: 'BUY', space: 1 });
    expect(b.state.owner[1]).toBe(0);
    expect(cash(b.state, 0)).toBe(S0 - 1500);
    expect(b.state.players[0]?.spend).toEqual({ property: 1500, development: 0, transport: 0 });
    conserved(s, b.state);
    expect(act(game, t.state, { type: 'SKIP' }).state.owner[1]).toBeNull();
  });

  it('charges rent by level, doubled with 3+ cities of a group', () => {
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
    const east = groupSpaces('C');
    const owning = (n: number) =>
      start(game, [0, 1], (x) => {
        for (const i of east.slice(0, n)) own(x, 1, i);
      });
    expect(rentAt(owning(2), patna)).toBe(baseRent(patna));
    expect(rentAt(owning(3), patna)).toBe(baseRent(patna) * 2);
    expect(rentAt(owning(5), patna)).toBe(baseRent(patna) * 2);
  });

  it('builds one level per BUILD action — House 1 → 2 → 3 → Hotel — until done, broke or hotel', () => {
    const game = scripted([
      [1, 0],
      [1, 0],
    ]);
    const s = start(game, [0, 1], (x) => own(x, 0, 1, 1));
    const t = act(game, s, { type: 'ROLL' });
    expect(t.state.decision).toEqual({ kind: 'BUILD', space: 1, cost: buildCost(1, 1) });
    expect(verdict(game, t.state, 0, { type: 'BUILD', space: 1, levels: 3 })).toBe(
      'INVALID_PAYLOAD',
    );
    const h2 = act(game, t.state, { type: 'BUILD', space: 1 });
    expect(h2.state.level[1]).toBe(2);
    expect(h2.state.phase).toBe('DECIDE'); // the offer stays open for the next level
    expect(h2.state.decision).toMatchObject({ kind: 'BUILD', cost: buildCost(1, 2), built: 1 });
    const h3 = act(game, h2.state, { type: 'BUILD', space: 1 });
    const hotel = act(game, h3.state, { type: 'BUILD', space: 1 });
    expect(hotel.state.level[1]).toBe(HOTEL);
    expect(hotel.state.phase).toBe('HOLD'); // nothing above the hotel
    expect(hotel.state.players[0]?.spend.development).toBe(
      buildCost(1, 1) + buildCost(1, 2) + buildCost(1, 3),
    );
    const done = act(game, h2.state, { type: 'SKIP' });
    expect(done.state.level[1]).toBe(2);
    expect(logs(done).some((e) => e.type === 'DECLINED')).toBe(false);
    // Can't afford the next level: the offer closes after the build.
    const g1 = scripted([[1, 0]]);
    const g1b = scripted([[1, 0]]);
    const poor = act(
      g1,
      start(g1, [0, 1], (x) => {
        own(x, 0, 1, 0);
        (x.players[0] as { cash: number }).cash = buildCost(1, 0);
      }),
      { type: 'ROLL' },
    );
    expect(act(g1, poor.state, { type: 'BUILD', space: 1 }).state.phase).toBe('HOLD');
    expect(
      act(
        g1b,
        start(g1b, [0, 1], (x) => own(x, 0, 1, HOTEL)),
        { type: 'ROLL' },
      ).state.phase,
    ).toBe('HOLD');
  });

  it('transports: own price, own fixed rent (not by count), never built on', () => {
    const game = scripted([[2, 1]]);
    const roadways = space('roadways');
    expect(roadways).toBe(3);
    const t = act(game, act(game, start(game), { type: 'ROLL' }).state, {
      type: 'BUY',
      space: roadways,
    });
    expect(t.state.players[0]?.spend).toEqual({ property: 0, development: 0, transport: 3000 });
    for (const n of [1, 3, 6]) {
      const s = start(game, [0, 1], (x) => {
        own(x, 1, roadways);
        for (const i of TRANSPORT_SPACES.filter((k) => k !== roadways).slice(0, n - 1))
          own(x, 1, i);
      });
      expect(rentAt(s, roadways)).toBe(E.transportRent.roadways);
      if (n === 6) expect(rentAt(s, space('airways'))).toBe(E.transportRent.airways);
    }
    // Landing on your own transport: no building offer.
    const g2 = scripted([[2, 1]]);
    const mine = act(
      g2,
      start(g2, [0, 1], (x) => own(x, 0, roadways)),
      { type: 'ROLL' },
    );
    expect(mine.state.decision).toBeNull();
    expect(mine.state.phase).toBe('HOLD');
    expect(verdict(game, mine.state, 0, { type: 'BUILD', space: roadways })).toBe('INVALID_PHASE');
  });
});

describe('events: the dice sum decides (frozen)', () => {
  it('has one outcome per sum 2–12 per deck with the frozen parity', () => {
    for (const deck of ['chance', 'chest'] as const) {
      for (const sum of EVENT_SUMS) {
        const o = eventOutcome(deck, sum);
        expect(o.good).toBe(deck === 'chance' ? sum % 2 === 0 : sum % 2 === 1);
        expect(isGood(deck, sum)).toBe(o.good);
      }
    }
  });

  it('applies every outcome from a real event roll (amounts scaled to the economy)', () => {
    const kochi = space('kochi');
    const chennai = space('chennai');
    const before = (deck: 'chance' | 'chest') =>
      start(scripted(), [0, 1, 2], (x) => {
        at(x, 0, deck === 'chance' ? 3 : 11);
        own(x, 0, kochi, 1);
        own(x, 0, chennai, HOTEL);
      });
    const gain = (deck: 'chance' | 'chest', sum: number) => (_s: BusinessState, t: T) =>
      expect(cash(t.state, 0)).toBe(S0 + amountOf(deck, sum));
    const pay = (deck: 'chance' | 'chest', sum: number) => (_s: BusinessState, t: T) =>
      expect(cash(t.state, 0)).toBe(S0 - amountOf(deck, sum));
    const each =
      (deck: 'chance' | 'chest', sum: number, sign: 1 | -1) => (_s: BusinessState, t: T) =>
        expect([0, 1, 2].map((x) => cash(t.state, x))).toEqual([
          S0 + sign * 2 * amountOf(deck, sum),
          S0 - sign * amountOf(deck, sum),
          S0 - sign * amountOf(deck, sum),
        ]);
    const free = (_s: BusinessState, t: T) => {
      expect(t.state.decision).toEqual({
        kind: 'FREE_BUILD',
        space: t.state.players[0]?.position,
        cost: 0,
        options: [kochi],
      });
    };
    const repairs = scaledFx('chance', 11) as { perHouse: number; perHotel: number };
    const outcomes: Record<string, (s: BusinessState, t: T) => void> = {
      'chance:2': gain('chance', 2),
      'chance:3': pay('chance', 3),
      'chance:4': each('chance', 4, 1),
      'chance:5': each('chance', 5, -1),
      'chance:6': gain('chance', 6),
      'chance:7': pay('chance', 7),
      'chance:8': free,
      'chance:9': (_s, t) => expect(t.state.players[0]?.skipNext).toBe(true),
      'chance:10': (_s, t) => {
        expect(t.state.players[0]?.position).toBe(0);
        expect(cash(t.state, 0)).toBe(S0 + 1500);
      },
      'chance:11': (_s, t) =>
        expect(cash(t.state, 0)).toBe(S0 - repairs.perHouse - repairs.perHotel),
      'chance:12': gain('chance', 12),
      'chest:2': pay('chest', 2),
      'chest:3': gain('chest', 3),
      'chest:4': each('chest', 4, -1),
      'chest:5': each('chest', 5, 1),
      'chest:6': pay('chest', 6),
      'chest:7': gain('chest', 7),
      'chest:8': (_s, t) => expect(t.state.players[0]?.noBuyNext).toBe(true),
      'chest:9': (_s, t) => expect(t.state.players[0]?.rentHoliday).toBe(true),
      'chest:10': (_s, t) => expect(t.state.players[0]?.skipNext).toBe(true),
      'chest:11': free,
      'chest:12': pay('chest', 12),
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

  it('FREE BUILDING: the player picks a city; the level costs ₹0; no city → cash instead', () => {
    const kochi = space('kochi');
    const goa = space('goa');
    const game = scripted([
      [2, 0],
      [4, 4],
    ]);
    const s = start(game, [0, 1], (x) => {
      at(x, 0, 3);
      own(x, 0, kochi, 1);
      own(x, 0, goa, 0);
      own(x, 0, space('roadways'));
    });
    const t = act(game, act(game, s, { type: 'ROLL' }).state, { type: 'EVENT_ROLL' });
    expect(t.state.decision?.options).toEqual([kochi, goa]); // cities only, never transport
    expect(verdict(game, t.state, 0, { type: 'FREE_BUILD', space: space('roadways') })).toBe(
      'ILLEGAL_ACTION',
    );
    expect(verdict(game, t.state, 0, { type: 'SKIP' })).toBe('ILLEGAL_ACTION');
    const picked = act(game, t.state, { type: 'FREE_BUILD', space: goa });
    expect(picked.state.level[goa]).toBe(1);
    expect(picked.state.players[0]?.spend.development).toBe(0);
    expect(rentAt(picked.state, goa)).toBe(baseRent(goa) * 3);
    // Timeout: the least-developed city gets it.
    expect(timer(game, t.state).state.level[goa]).toBe(1);
    // No eligible city: the scaled cash fallback.
    const g3 = scripted([
      [2, 0],
      [4, 4],
    ]);
    const none = act(
      g3,
      start(g3, [0, 1], (x) => at(x, 0, 3)),
      { type: 'ROLL' },
    );
    const paid = act(g3, none.state, { type: 'EVENT_ROLL' });
    expect(cash(paid.state, 0)).toBe(S0 + (scaledFx('chance', 8) as { fallback: number }).fallback);
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
    expect(cash(t.state, 0)).toBe(S0);
    expect(logs(t).some((e) => e.type === 'RENT_WAIVED')).toBe(true);
    const blocked = start(game, [0, 1], (x) => {
      (x.players[0] as { noBuyActive: boolean }).noBuyActive = true;
    });
    expect(act(game, blocked, { type: 'ROLL' }).state.decision).toBeNull();
  });
});

describe('loans, raising money and insolvency', () => {
  it('lends in ₹5,000 steps with a 10 % fee, several times, up to the limit; repays early', () => {
    const game = scripted();
    const delhi = space('delhi');
    let s = start(game, [0, 1], (x) => own(x, 0, delhi, 0));
    expect(borrowLimit(s, 0)).toBe(E.loanBase + priceOf(delhi) / 2);
    expect(canBorrow(s, 0)).toBe(20_000);
    s = act(game, s, { type: 'LOAN', amount: 5000 }).state;
    s = act(game, s, { type: 'LOAN', amount: 10_000 }).state;
    expect(s.players[0]).toMatchObject({ cash: S0 + 15_000, debt: 16_500 });
    expect(verdict(game, s, 0, { type: 'LOAN', amount: 2500 })).toBe('ILLEGAL_ACTION');
    s = act(game, s, { type: 'LOAN', amount: 5000 }).state;
    expect(verdict(game, s, 0, { type: 'LOAN', amount: 5000 })).toBe('ILLEGAL_ACTION');
    s = act(game, s, { type: 'REPAY', amount: 6500 }).state;
    expect(s.players[0]).toMatchObject({ cash: S0 + 20_000 - 6500, debt: 15_500 });
    expect(
      canBorrow(
        start(game, [0, 1], (x) => (x.round = x.rounds)),
        0,
      ),
    ).toBe(0);
  });

  it('opens Raise money for an unpayable rent; selling covers it and pays automatically', () => {
    const game = scripted([[1, 0]]);
    const delhi = space('delhi');
    const s = start(game, [0, 1], (x) => {
      own(x, 1, 1, HOTEL);
      (x.players[0] as { cash: number }).cash = 100;
      own(x, 0, delhi, HOTEL);
    });
    const due = rentAt(s, 1);
    const t = act(game, s, { type: 'ROLL' });
    expect(t.state.phase).toBe('RAISE');
    expect(t.state.raise?.total).toBe(due);
    const sold = act(game, t.state, { type: 'SELL_ASSET', space: delhi });
    expect(sold.state.owner[delhi]).toBeNull();
    expect(sold.state.phase).toBe('HOLD');
    expect(cash(sold.state, 1)).toBe(S0 + due);
    conserved(s, sold.state);
  });

  it('lets the bank handle it: loans, buildings, assets, then INSOLVENT and still playing', () => {
    const game = scripted([[1, 0]]);
    const s = start(game, [0, 1], (x) => {
      own(x, 1, 1, HOTEL);
      (x.players[0] as { cash: number }).cash = 0;
      x.economy = { ...x.economy, loanBase: 0 };
    });
    const done = timer(game, act(game, s, { type: 'ROLL' }).state);
    expect(done.state.players[0]).toMatchObject({ cash: 0, debt: 0, insolvent: true });
    conserved(s, done.state);
    let x = timer(game, done.state).state;
    for (let k = 0; k < 5 && x.current !== 0; k++) x = timer(game, x).state;
    expect(x.current).toBe(0);
    expect(x.phase).toBe('ROLL');
  });

  it('repays debt from cash at the end, so loans add no final wealth', () => {
    const game = scripted();
    let s = start(game, [0, 1], (x) => (x.rounds = 5));
    s = act(game, s, { type: 'LOAN', amount: 5000 }).state;
    for (let k = 0; k < 400 && s.phase !== 'OVER'; k++) s = timer(game, s).state;
    expect(s.players[0]?.debt).toBe(0);
    expect(s.log.some((e) => e.type === 'SETTLED' && e.seat === 0 && e.repaid === 5500)).toBe(true);
  });
});

describe('auctions (owner-initiated) and trading', () => {
  it('auctions an owned asset with its buildings: others bid, the seller can’t, the winner pays', () => {
    const game = scripted();
    const mumbai = space('mumbai');
    const s = start(game, [0, 1, 2], (x) => own(x, 0, mumbai, 2));
    expect(verdict(game, s, 0, { type: 'AUCTION_START', space: 1 })).toBe('ILLEGAL_ACTION');
    let x = act(game, s, { type: 'AUCTION_START', space: mumbai }).state;
    const open = x.auction?.open as number;
    expect(open).toBe(
      Math.round(((priceOf(mumbai) + buildCost(mumbai, 0) + buildCost(mumbai, 1)) * 0.5) / 100) *
        100,
    );
    expect(verdict(game, x, 0, { type: 'BID', amount: open })).toBe('NOT_ELIGIBLE');
    x = act(game, x, { type: 'BID', amount: open }, 1).state;
    x = act(game, x, { type: 'BID', amount: open + 500 }, 2).state;
    const done = timer(game, x);
    expect(done.state.owner[mumbai]).toBe(2);
    expect(done.state.level[mumbai]).toBe(2);
    expect(cash(done.state, 0)).toBe(S0 + open + 500);
    expect(done.state.players[2]?.spend.property).toBe(open + 500);
    expect(done.state.lockedUntil[mumbai]).toBe(done.state.round + 3);
    conserved(s, done.state);
    expect(
      timer(game, act(game, s, { type: 'AUCTION_START', space: mumbai }).state).state.owner[mumbai],
    ).toBe(0);
  });

  it('trades only when both confirm; cash paid counts as spending', () => {
    const game = scripted();
    const s = start(game, [0, 1], (x) => own(x, 1, 1));
    const offer = {
      type: 'TRADE_PROPOSE' as const,
      to: 1,
      give: { cash: 900, assets: [] },
      get: { cash: 0, assets: [1] },
    };
    expect(verdict(game, s, 0, { ...offer, give: { cash: 999_999, assets: [] } })).toBe(
      'ILLEGAL_ACTION',
    );
    const proposed = act(game, s, offer).state;
    const yes = act(game, proposed, { type: 'TRADE_ANSWER', accept: true }, 1).state;
    expect(yes.owner[1]).toBe(0);
    expect([cash(yes, 0), cash(yes, 1)]).toEqual([S0 - 900, S0 + 900]);
    expect(yes.players[0]?.spend.property).toBe(900);
    expect(act(game, proposed, { type: 'TRADE_ANSWER', accept: false }, 1).state.owner[1]).toBe(1);
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
      { type: 'ROLL', to: 30 },
      { type: 'BUY', space: 1, price: 0 },
      { type: 'BUY', space: 99 },
      { type: 'SKIP', cash: 99_999 },
      { type: 'BUILD', space: 1, levels: 4 },
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
    expect(verdict(game, s, 0, { type: 'FREE_BUILD', space: 1 })).toBe('INVALID_PHASE');
    const t = act(game, s, { type: 'ROLL' });
    expect(verdict(game, t.state, 0, { type: 'BUY', space: 2 })).toBe('ILLEGAL_ACTION');
    expect(verdict(game, t.state, 0, { type: 'BUILD', space: 1 })).toBe('ILLEGAL_ACTION');
    const over = start(game, [0, 1], (x) => (x.phase = 'OVER'));
    expect(verdict(game, over, 0, { type: 'ROLL' })).toBe('INVALID_PHASE');
  });

  it('times out safely after 30 s: rolls, declines; three in a row → bot', () => {
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
          for (const i of TRANSPORT_SPACES) expect(s.level[i]).toBe(0);
        },
      });
      expect(r.state.phase).toBe('OVER');
      expect(r.state.seats.reduce((n, x) => n + r.state.players[x]!.cash, 0)).toBe(
        r.state.seats.length * E.startCash + r.state.bankNet,
      );
    }
  });
});
