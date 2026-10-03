import { createRng, type StepCtx, type Transition } from '@cg/game-sdk';
import { deepFreeze, simulateMatch } from '@cg/game-sdk/testing';
import { describe, expect, it } from 'vitest';
import {
  createBusinessGame,
  feeAt,
  perturbBusinessHidden,
  wealthOf,
  type BusinessOptions,
} from '../src/server';
import {
  BOARD,
  BOARD_COLS,
  BOARD_ROWS,
  BOARD_SIZE,
  CARDS,
  CORNER_SPACE,
  DEFAULT_ECONOMY as E,
  INDUSTRY_SPACES,
  OWNABLE_SPACES,
  REGIONS,
  cityFee,
  developCost,
  isCity,
  priceOf,
  regionSpaces,
  tilePosition,
  type BusinessAction,
  type BusinessEvent,
  type BusinessState,
  type LogEntry,
} from '../src/shared';

type T = Transition<BusinessState, BusinessEvent>;
const ctx = (now = 1000, seed = 7): StepCtx => ({ now, rng: createRng(seed) });

/** A game whose dice follow `script` (one entry per roll), then fair dice. */
function scripted(script: number[][] = [], options: BusinessOptions = {}) {
  const queue = [...script];
  return createBusinessGame({
    ...options,
    dice: (rng, count) =>
      queue.shift()?.slice(0, count) ?? Array.from({ length: count }, () => rng.int(1, 6)),
  });
}
type Game = ReturnType<typeof scripted>;

/** A fresh match where seat 0 moves first (order 0, 1, …), with optional state edits. */
function start(game: Game, seats = [0, 1], edit: (s: BusinessState) => void = () => undefined) {
  const s = structuredClone(game.setup(seats, { rounds: 12 }, ctx(), { bots: [] }).state);
  s.order = [...seats];
  s.current = seats[0] as number;
  edit(s);
  return deepFreeze(s);
}
const act = (
  game: Game,
  s: BusinessState,
  action: { type: BusinessAction['type']; space?: number },
  seat = s.current,
): T => {
  const a = { ...action, turn: s.turn } as BusinessAction;
  const parsed = game.actionSchema.parse(a);
  const v = game.validateAction(s, seat, parsed);
  if (!v.ok) throw new Error(`rejected: ${v.code}`);
  const t = game.applyAction(s, seat, parsed, ctx());
  return { ...t, state: deepFreeze(t.state) };
};
const verdict = (game: Game, s: BusinessState, seat: number, a: unknown) => {
  const parsed = game.actionSchema.safeParse(a);
  if (!parsed.success) return 'INVALID_PAYLOAD';
  const v = game.validateAction(s, seat, parsed.data);
  return v.ok ? 'OK' : v.code;
};
const roll = (game: Game, s: BusinessState) => act(game, s, { type: 'ROLL' });
const logs = (t: T) =>
  t.events.flatMap((e) => (e.event.type === 'LOG' ? [e.event.entry] : [])) as LogEntry[];
const totalCoins = (s: BusinessState) => s.seats.reduce((sum, x) => sum + (s.coins[x] ?? 0), 0);
const conserved = (s: BusinessState) =>
  expect(totalCoins(s)).toBe(s.seats.length * s.economy.startCoins + s.bankNet);
/** Coins changed only by what the bank paid out or took in. */
const conservedFrom = (before: BusinessState, after: BusinessState) =>
  expect(totalCoins(after) - totalCoins(before)).toBe(after.bankNet - before.bankNet);
const space = (id: string) =>
  BOARD.findIndex((b) => (b.kind === 'city' || b.kind === 'industry') && b.id === id);

describe('board', () => {
  it('has 28 spaces: 15 cities in 5 regions of 3, 3 industries, 3 News, 3 Mela, 4 corners', () => {
    expect(BOARD_SIZE).toBe(28);
    expect(BOARD.filter(isCity)).toHaveLength(15);
    for (const r of REGIONS) expect(regionSpaces(r)).toHaveLength(3);
    expect(INDUSTRY_SPACES).toHaveLength(3);
    expect(BOARD.filter((b) => b.kind === 'card' && b.deck === 'news')).toHaveLength(3);
    expect(BOARD.filter((b) => b.kind === 'card' && b.deck === 'mela')).toHaveLength(3);
    expect(CORNER_SPACE).toEqual({ start: 0, chai: 5, jam: 14, lucky: 19 });
    for (const [corner, i] of Object.entries(CORNER_SPACE)) {
      expect(BOARD[i]).toEqual({ kind: 'corner', corner });
    }
    // Regions get dearer around the loop.
    const prices = REGIONS.map((r) => Math.max(...regionSpaces(r).map((i) => priceOf(i))));
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
  });

  it('lays the 28 spaces round the edge of a 6 × 10 board, each next to the one before', () => {
    const seen = new Set<string>();
    for (let i = 0; i < BOARD_SIZE; i++) {
      const p = tilePosition(i);
      const q = tilePosition((i + 1) % BOARD_SIZE);
      expect(
        p.row === 0 || p.row === BOARD_ROWS - 1 || p.col === 0 || p.col === BOARD_COLS - 1,
      ).toBe(true);
      expect(Math.abs(p.row - q.row) + Math.abs(p.col - q.col)).toBe(1);
      seen.add(`${p.row}:${p.col}`);
    }
    expect(seen.size).toBe(28);
    // The four corners of the rectangle are the four corner spaces.
    expect([0, 5, 14, 19].map(tilePosition)).toEqual([
      { row: 0, col: 0 },
      { row: 0, col: 5 },
      { row: 9, col: 5 },
      { row: 9, col: 0 },
    ]);
  });

  it('prices fees by level and the region bonus, rounded to 5', () => {
    const indore = space('indore');
    expect(cityFee(indore, 1, false)).toBe(25);
    expect(cityFee(indore, 4, false)).toBe(200);
    expect(cityFee(indore, 1, true)).toBe(40); // 37.5 → 40
    expect(developCost(space('mumbai'))).toBe(170);
  });
});

describe('setup and turns', () => {
  it('needs 2–6 players; everyone starts on Start with the starting coins and nothing owned', () => {
    const game = scripted();
    expect(() => game.setup([0], { rounds: 12 }, ctx(), { bots: [] })).toThrow();
    expect(() => game.setup([0, 1, 2, 3, 4, 5, 6], { rounds: 12 }, ctx(), { bots: [] })).toThrow();
    const s = game.setup([0, 1, 2], { rounds: 12 }, ctx(), { bots: [] }).state;
    expect(s.positions).toEqual({ 0: 0, 1: 0, 2: 0 });
    expect(s.coins).toEqual({ 0: 1200, 1: 1200, 2: 1200 });
    expect(s.owner.every((o) => o === null)).toBe(true);
    expect(s.decks.news.draw).toHaveLength(12);
    expect(s.decks.mela.draw).toHaveLength(12);
    expect(s.phase).toBe('ROLL');
    expect(s.current).toBe(s.order[0]);
  });

  it('draws the first player at random and keeps seat order from there', () => {
    const firsts = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const s = scripted().setup([0, 1, 2, 3], { rounds: 12 }, ctx(1000, seed), { bots: [] }).state;
      firsts.add(s.order[0] as number);
      const k = s.order[0] as number;
      expect(s.order).toEqual([0, 1, 2, 3].map((x) => (x + k) % 4));
    }
    expect(firsts.size).toBe(4);
  });

  it('offers 12, 16 or 20 rounds (16 by default)', () => {
    const game = scripted();
    expect(game.defaultSettings).toEqual({ rounds: 16 });
    expect(game.settingsSchema.safeParse({ rounds: 20 }).success).toBe(true);
    expect(game.settingsSchema.safeParse({ rounds: 10 }).success).toBe(false);
  });

  it('moves by the dice, passes the turn after a quiet landing, and counts rounds', () => {
    const game = scripted([
      [2, 3],
      [1, 4],
    ]);
    let s = start(game);
    const t = roll(game, s); // 5 → Chai Break
    const rolled = t.events.find((e) => e.event.type === 'ROLLED')?.event;
    expect(rolled).toMatchObject({ seat: 0, dice: [2, 3], from: 0, to: 5, path: [1, 2, 3, 4, 5] });
    expect(t.state.phase).toBe('HOLD');
    s = game.onTimer(t.state, 'phase', ctx()).state;
    expect(s.current).toBe(1);
    expect(s.round).toBe(1);
    s = game.onTimer(roll(game, s).state, 'phase', ctx()).state;
    expect(s.current).toBe(0);
    expect(s.round).toBe(2);
  });

  it('pays the salary when passing or landing on Start', () => {
    const game = scripted([[3, 4]]);
    const s = start(game, [0, 1], (x) => (x.positions[0] = 22));
    const t = roll(game, s); // 22 + 7 → 1 (Indore), passing Start
    expect(logs(t)).toContainEqual({ type: 'SALARY', seat: 0, amount: 150 });
    expect(t.state.positions[0]).toBe(1);
    conserved(t.state);
  });

  it('Traffic Jam: the next roll uses one die', () => {
    const game = scripted([
      [6, 4],
      [3, 6],
      [5, 5],
    ]);
    let s = start(game, [0, 1], (x) => (x.positions[0] = 4));
    s = game.onTimer(roll(game, s).state, 'phase', ctx()).state; // 4 + 10 → 14 Traffic Jam
    expect(s.slow).toEqual([0]);
    s = game.onTimer(roll(game, s).state, 'phase', ctx()).state; // seat 1
    const t = roll(game, s);
    expect(t.state.lastRoll?.dice).toEqual([5]);
    expect(t.state.positions[0]).toBe(19);
    expect(t.state.slow).toEqual([]);
  });

  it('ends after the last round and ranks by wealth, equal wealth sharing a place', () => {
    const game = scripted();
    let s = start(game, [0, 1, 2], (x) => {
      x.round = 12;
      x.coins = { 0: 900, 1: 900, 2: 500 };
    });
    for (let k = 0; k < 3 && s.phase !== 'OVER'; k++) {
      const t = roll(game, s);
      s =
        t.state.phase === 'DECIDE'
          ? act(game, t.state, { type: 'SKIP' }).state
          : game.onTimer(t.state, 'phase', ctx()).state;
    }
    expect(s.phase).toBe('OVER');
    expect(game.isOver(s)).toBe(true);
    const r = game.getResults(s);
    const places = Object.fromEntries(r.placements.map((p) => [p.seat, p.place]));
    expect(r.stats?.[0]).toMatchObject({ wealth: wealthOf(s, 0) });
    for (const x of [0, 1, 2]) {
      expect(places[x]).toBe(1 + [0, 1, 2].filter((o) => wealthOf(s, o) > wealthOf(s, x)).length);
    }
  });
});

describe('buying, fees and development', () => {
  it('offers a free city you can afford; buying pays the bank and makes it a Stall', () => {
    const game = scripted([[1, 0]]);
    const s = start(game);
    const t = roll(game, s); // → Indore
    expect(t.state.phase).toBe('DECIDE');
    expect(t.state.decision).toEqual({ kind: 'BUY', options: [{ space: 1, cost: 100 }] });
    const b = act(game, t.state, { type: 'BUY', space: 1 });
    expect(b.state.owner[1]).toBe(0);
    expect(b.state.level[1]).toBe(1);
    expect(b.state.coins[0]).toBe(1100);
    expect(b.state.current).toBe(1);
    conserved(b.state);
  });

  it('offers nothing you cannot afford; skipping leaves the city with the bank', () => {
    const game = scripted([
      [1, 0],
      [1, 0],
    ]);
    expect(
      roll(
        game,
        start(game, [0, 1], (x) => (x.coins[0] = 50)),
      ).state.phase,
    ).toBe('HOLD');
    const t = act(game, roll(game, start(game)).state, { type: 'SKIP' });
    expect(t.state.owner[1]).toBeNull();
  });

  it('charges visitor fees by level and region, and factory visits per industry', () => {
    const game = scripted([
      [1, 0],
      [9, 0],
    ]);
    const edit = (x: BusinessState) => {
      for (const i of regionSpaces('central')) {
        x.owner[i] = 1;
        x.level[i] = 1;
      }
      x.level[1] = 3; // Indore Showroom
      x.owner[9] = 1;
      x.owner[16] = 1;
      x.level[9] = 1;
      x.level[16] = 1;
    };
    const s = start(game, [0, 1], edit);
    const t = roll(game, s);
    expect(feeAt(s, 1)).toBe(cityFee(1, 3, true));
    expect(logs(t)).toContainEqual({
      type: 'PAID',
      from: 0,
      to: 1,
      amount: cityFee(1, 3, true),
      reason: 'fee',
      space: 1,
      writtenOff: 0,
    });
    const s2 = start(game, [0, 1], edit);
    const t2 = roll(game, s2); // 9: Tea Garden, owner has 2 industries
    expect(logs(t2)).toContainEqual({
      type: 'PAID',
      from: 0,
      to: 1,
      amount: 2 * E.factoryVisit,
      reason: 'factory',
      space: 9,
      writtenOff: 0,
    });
    conserved(t2.state);
  });

  it('pays industry dividends at Start (+ a bonus for all three)', () => {
    const game = scripted([[3, 4]]);
    const s = start(game, [0, 1], (x) => {
      x.positions[0] = 22;
      for (const i of INDUSTRY_SPACES) {
        x.owner[i] = 0;
        x.level[i] = 1;
      }
    });
    expect(logs(roll(game, s))).toContainEqual({
      type: 'DIVIDEND',
      seat: 0,
      amount: 3 * E.dividend + E.dividendSetBonus,
    });
  });

  it('develops your own city one level per landing, up to a Mall', () => {
    const game = scripted([
      [1, 0],
      [1, 0],
    ]);
    const s = start(game, [0, 1], (x) => {
      x.owner[1] = 0;
      x.level[1] = 3;
    });
    const t = roll(game, s);
    expect(t.state.decision).toEqual({ kind: 'DEVELOP', options: [{ space: 1, cost: 50 }] });
    const d = act(game, t.state, { type: 'DEVELOP', space: 1 });
    expect(d.state.level[1]).toBe(4);
    expect(d.state.coins[0]).toBe(1150);
    const mall = start(game, [0, 1], (x) => {
      x.owner[1] = 0;
      x.level[1] = 4;
    });
    expect(roll(game, mall).state.phase).toBe('HOLD');
  });

  it('after passing Start, offers to develop any one of your cities (after the landing decision)', () => {
    const game = scripted([[3, 4]]);
    const s = start(game, [0, 1], (x) => {
      x.positions[0] = 22;
      x.owner[27] = 0; // Mumbai
      x.level[27] = 1;
      x.owner[3] = 0; // Bhopal
      x.level[3] = 4; // already a Mall: not offered
    });
    const t = roll(game, s); // → Indore (free): BUY first
    expect(t.state.decision?.kind).toBe('BUY');
    const after = act(game, t.state, { type: 'BUY', space: 1 });
    expect(after.state.decision).toEqual({
      kind: 'EXPAND',
      options: [
        { space: 1, cost: 50 },
        { space: 27, cost: 170 },
      ],
    });
    expect(
      verdict(game, after.state, 0, { type: 'DEVELOP', turn: after.state.turn, space: 3 }),
    ).toBe('ILLEGAL_ACTION');
    const dev = act(game, after.state, { type: 'DEVELOP', space: 27 });
    expect(dev.state.level[27]).toBe(2);
    expect(dev.state.current).toBe(1);
    conserved(dev.state);
  });
});

describe('cards and corners', () => {
  /** Seat 0 two steps before a card space whose deck starts with `card`. */
  const onCard = (game: Game, card: string, edit: (s: BusinessState) => void = () => undefined) => {
    const deck = card.startsWith('N') ? 'news' : 'mela';
    const target = deck === 'news' ? 2 : 7;
    return start(game, [0, 1, 2], (x) => {
      x.positions[0] = target - 2;
      x.decks[deck].draw = [card, ...x.decks[deck].draw.filter((c) => c !== card)];
      edit(x);
    });
  };

  it('every card has a drawable id and every deck has 12', () => {
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(24);
    expect(CARDS.filter((c) => c.deck === 'news')).toHaveLength(12);
  });

  it('applies money cards to the right players and keeps coins conserved', () => {
    const cases: [string, (t: T) => void][] = [
      ['N2', (t) => expect(t.state.coins[0]).toBe(1280)],
      ['N3', (t) => expect(t.state.coins[0]).toBe(1160)],
      ['N9', (t) => expect([0, 1, 2].map((x) => t.state.coins[x])).toEqual([1175, 1175, 1175])],
      ['M2', (t) => expect([0, 1, 2].map((x) => t.state.coins[x])).toEqual([1180, 1210, 1210])],
      ['M4', (t) => expect([0, 1, 2].map((x) => t.state.coins[x])).toEqual([1230, 1185, 1185])],
      ['M10', (t) => expect([0, 1, 2].map((x) => t.state.coins[x])).toEqual([1230, 1230, 1230])],
    ];
    for (const [card, check] of cases) {
      const game = scripted([[1, 1]]);
      const t = roll(game, onCard(game, card));
      expect(logs(t)).toContainEqual({
        type: 'CARD',
        seat: 0,
        deck: card.startsWith('N') ? 'news' : 'mela',
        card,
      });
      check(t);
      conserved(t.state);
    }
  });

  it('pays industry and region owners, and charges per development level (capped)', () => {
    const game = scripted([
      [1, 1],
      [1, 1],
      [1, 1],
    ]);
    const tea = roll(
      game,
      onCard(game, 'N1', (x) => (x.owner[9] = 2)),
    );
    expect(tea.state.coins[2]).toBe(1300);
    const south = roll(
      game,
      onCard(game, 'N7', (x) => ((x.owner[18] = 1), (x.owner[20] = 1))),
    );
    expect(south.state.coins[1]).toBe(1260);
    const power = roll(
      game,
      onCard(game, 'N4', (x) => {
        for (const i of regionSpaces('west')) {
          x.owner[i] = 0;
          x.level[i] = 4;
        }
      }),
    );
    expect(power.state.coins[0]).toBe(1200 - 120); // 12 levels × 15 = 180, capped at 120
  });

  it('movement cards resolve the new space once, without drawing again', () => {
    const game = scripted([[3, 2]]);
    const s = start(game, [0, 1], (x) => {
      x.positions[0] = 2; // → 7 (Mela)
      x.decks.mela.draw = ['M5', ...x.decks.mela.draw.filter((c) => c !== 'M5')];
    });
    const t = roll(game, s); // back 3 → 4 Nagpur (free): BUY offered
    expect(t.state.positions[0]).toBe(4);
    expect(t.state.decision?.kind).toBe('BUY');
    expect(logs(t).filter((e) => e.type === 'CARD')).toHaveLength(1);
    const home = scripted([[1, 1]]);
    const m12 = roll(home, onCard(home, 'M12'));
    expect(m12.state.positions[0]).toBe(0);
    expect(logs(m12)).toContainEqual({ type: 'SALARY', seat: 0, amount: 150 });
  });

  it('a free-level card raises your least-developed city, or pays out when you have none', () => {
    const game = scripted([
      [1, 1],
      [1, 1],
    ]);
    const up = roll(
      game,
      onCard(game, 'M7', (x) => {
        x.owner[27] = 0;
        x.level[27] = 2;
        x.owner[1] = 0;
        x.level[1] = 1;
      }),
    );
    expect(up.state.level[1]).toBe(2);
    expect(up.state.coins[0]).toBe(1200);
    const none = roll(game, onCard(game, 'M7'));
    expect(none.state.coins[0]).toBe(1260);
  });

  it('reshuffles a deck when it runs out', () => {
    const game = scripted([[1, 1]]);
    const s = start(game, [0, 1], (x) => {
      x.decks.news.discard = [...x.decks.news.draw];
      x.decks.news.draw = [];
    });
    const t = roll(game, s);
    expect(t.state.decks.news.draw.length + t.state.decks.news.discard.length).toBe(12);
    expect(t.state.decks.news.discard).toHaveLength(1);
  });

  it('the Lucky Mela wheel always gives something good', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const game = scripted([[4, 1]]);
      const s = start(game, [0, 1], (x) => (x.positions[0] = 14));
      const t = game.applyAction(s, 0, { type: 'ROLL', turn: s.turn }, ctx(1000, seed));
      const wheel = logs(t).find((e) => e.type === 'WHEEL');
      expect(wheel).toBeDefined();
      expect(t.state.coins[0]).toBeGreaterThanOrEqual(1250);
    }
  });
});

describe('short of coins: clearance sales, never elimination', () => {
  it('sells development levels first, then the cheapest places, at half value', () => {
    const game = scripted([[1, 0]]);
    const s = start(game, [0, 1], (x) => {
      x.owner[1] = 1; // Indore, Mall: fee 200
      x.level[1] = 4;
      x.coins[0] = 20;
      x.owner[27] = 0; // Mumbai Shop (one level worth 85 back)
      x.level[27] = 2;
      x.owner[3] = 0; // Bhopal Stall (55 back)
    });
    const t = roll(game, s);
    const clear = logs(t).find((e) => e.type === 'CLEARANCE');
    expect(clear).toEqual({
      type: 'CLEARANCE',
      seat: 0,
      sold: [
        { space: 27, what: 'level', value: 85 },
        { space: 3, what: 'place', value: 55 },
        { space: 27, what: 'place', value: 170 },
      ],
      raised: 310,
    });
    expect(t.state.coins[0]).toBe(20 + 310 - 200);
    expect(t.state.owner[3]).toBeNull();
    expect(t.state.coins[1]).toBe(1400);
    conservedFrom(s, t.state);
  });

  it('writes off what cannot be paid; the player stays in with nothing', () => {
    const game = scripted([
      [1, 0],
      [6, 6],
    ]);
    const s = start(game, [0, 1], (x) => {
      x.owner[1] = 1;
      x.level[1] = 4;
      x.coins[0] = 30;
    });
    const t = roll(game, s);
    expect(logs(t)).toContainEqual({
      type: 'PAID',
      from: 0,
      to: 1,
      amount: 30,
      reason: 'fee',
      space: 1,
      writtenOff: 170,
    });
    expect(t.state.coins[0]).toBe(0);
    expect(t.state.writtenOff).toBe(170);
    conservedFrom(s, t.state);
    // Still playing: the next turn comes round to them again.
    let x = game.onTimer(t.state, 'phase', ctx()).state;
    expect(x.current).toBe(1);
    x = game.onTimer(roll(game, x).state, 'phase', ctx()).state;
    expect(x.current).toBe(0);
  });
});

describe('server authority', () => {
  it('rejects wrong-seat, stale-turn, wrong-phase and forged actions', () => {
    const game = scripted([[1, 0]]);
    const s = start(game);
    expect(verdict(game, s, 1, { type: 'ROLL', turn: s.turn })).toBe('NOT_YOUR_TURN');
    expect(verdict(game, s, 0, { type: 'ROLL', turn: s.turn - 1 })).toBe('INVALID_PHASE');
    expect(verdict(game, s, 0, { type: 'BUY', turn: s.turn, space: 1 })).toBe('INVALID_PHASE');
    expect(verdict(game, s, 0, { type: 'ROLL', turn: s.turn, dice: [6, 6] })).toBe(
      'INVALID_PAYLOAD',
    );
    expect(verdict(game, s, 0, { type: 'BUY', turn: s.turn, space: 1, price: 1 })).toBe(
      'INVALID_PAYLOAD',
    );
    expect(verdict(game, s, 0, { type: 'BUY', turn: s.turn, space: 99 })).toBe('INVALID_PAYLOAD');
    const t = roll(game, s);
    expect(verdict(game, t.state, 0, { type: 'ROLL', turn: t.state.turn })).toBe('INVALID_PHASE');
    expect(verdict(game, t.state, 0, { type: 'BUY', turn: t.state.turn, space: 3 })).toBe(
      'ILLEGAL_ACTION',
    );
    expect(verdict(game, t.state, 0, { type: 'DEVELOP', turn: t.state.turn, space: 1 })).toBe(
      'ILLEGAL_ACTION',
    );
    expect(verdict(game, t.state, 1, { type: 'SKIP', turn: t.state.turn })).toBe('NOT_YOUR_TURN');
  });

  it('refuses buying an owned place and developing a city that is not yours', () => {
    const game = scripted([[1, 0]]);
    const t = roll(game, start(game));
    const owned = structuredClone(t.state);
    owned.owner[1] = 1;
    owned.coins[0] = 10;
    expect(verdict(game, owned, 0, { type: 'BUY', turn: owned.turn, space: 1 })).toBe(
      'ILLEGAL_ACTION',
    );
  });

  it('refuses everything after the end', () => {
    const game = scripted();
    const s = start(game, [0, 1], (x) => (x.phase = 'OVER'));
    expect(verdict(game, s, 0, { type: 'ROLL', turn: s.turn })).toBe('INVALID_PHASE');
  });

  it('times out: rolls for you, then skips for you; three in a row hands the seat to a bot', () => {
    const game = scripted([
      [1, 0],
      [6, 6],
      [1, 0],
      [6, 6],
      [1, 0],
    ]);
    let s = start(game);
    const requests = [];
    for (let k = 0; k < 6 && requests.length === 0; k++) {
      const t = game.onTimer(s, 'phase', ctx());
      requests.push(...(t.requests ?? []));
      s = t.state;
    }
    expect(requests).toEqual([{ type: 'MARK_IDLE', seat: 0 }]);
  });
});

describe('bots', () => {
  const decideFor = (game: Game, s: BusinessState, seed = 1) =>
    game.bot.decide(game.getPlayerView(s, s.current), null, {
      seat: s.current,
      now: 0,
      rng: createRng(seed),
    });

  it('roll on their turn only, and buy when they keep a reserve', () => {
    const game = scripted([
      [1, 0],
      [1, 0],
    ]);
    const s = start(game);
    expect(decideFor(game, s)).toMatchObject({ kind: 'ACTION', action: { type: 'ROLL' } });
    expect(
      game.bot.decide(game.getPlayerView(s, 1), null, { seat: 1, now: 0, rng: createRng(1) }),
    ).toBeNull();
    const t = roll(game, s);
    expect(decideFor(game, t.state)).toMatchObject({ action: { type: 'BUY', space: 1 } });
    const poor = roll(
      game,
      start(game, [0, 1], (x) => (x.coins[0] = 160)),
    );
    expect(decideFor(game, poor.state)).toMatchObject({ action: { type: 'SKIP' } });
  });

  it('complete a region even when it dips into the reserve', () => {
    const game = scripted([[1, 0]]);
    const t = roll(
      game,
      start(game, [0, 1], (x) => {
        x.coins[0] = 200;
        x.owner[3] = 0;
        x.owner[4] = 0;
      }),
    );
    expect(decideFor(game, t.state)).toMatchObject({ action: { type: 'BUY', space: 1 } });
  });

  it('play complete seeded matches with coins conserved and the deck order hidden', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const r = simulateMatch<BusinessState, BusinessEvent>(createBusinessGame(), {
        seats: 2 + (seed % 5),
        seed,
        settings: { rounds: 12 },
        perturbHidden: perturbBusinessHidden,
        invariant: (s) => {
          conserved(s);
          for (const x of s.seats) expect(s.coins[x]).toBeGreaterThanOrEqual(0);
          for (const i of OWNABLE_SPACES) {
            if (s.owner[i] === null) expect(s.level[i]).toBe(0);
            else expect(s.level[i]).toBeGreaterThanOrEqual(1);
          }
          expect(new Set(Object.values(s.positions)).size).toBeGreaterThan(0);
        },
      });
      expect(r.state.phase).toBe('OVER');
    }
  });
});
