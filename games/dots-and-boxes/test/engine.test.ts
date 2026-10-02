import { createRng, type StepCtx, type Transition } from '@cg/game-sdk';
import { deepFreeze, simulateMatch } from '@cg/game-sdk/testing';
import { describe, expect, it } from 'vitest';
import { chainsOf, createDotsAndBoxesGame, dotsAndBoxesGame } from '../src/server';
import {
  allEdges,
  boxCount,
  boxesOf,
  edgeCount,
  edgeId,
  indexOf,
  isDrawn,
  isSafe,
  nearestFreeEdge,
  parseEdge,
  sidesDrawn,
  sidesOf,
  type DotsEvent,
  type DotsState,
  type Edge,
  type EdgeId,
} from '../src/shared';

type T = Transition<DotsState, DotsEvent>;
const game = dotsAndBoxesGame;
const ctx = (now = 1000, seed = 7): StepCtx => ({ now, rng: createRng(seed) });
const start = (seats = [0, 1], grid: 4 | 5 | 7 = 4, seed = 7) =>
  deepFreeze(game.setup(seats, { grid }, ctx(1000, seed)));
const move = (s: DotsState, edge: string, seat = s.turn): T =>
  deepFreeze(game.applyAction(s, seat, { type: 'DRAW', edge: edge as EdgeId }, ctx(2000)));
const types = (t: T) => t.events.map((e) => e.event.type);

/** A state with the given lines already drawn (by seat 0), turn on `turn`. */
function withLines(edges: string[], turn = 0, n = 4, seats = [0, 1]): DotsState {
  const s = start(seats, n as 4).state;
  const h = [...s.h];
  const v = [...s.v];
  for (const id of edges) {
    const e = parseEdge(id, n) as Edge;
    (e.o === 'h' ? h : v)[indexOf(e, n)] = 0;
  }
  return deepFreeze({ ...s, h, v, turn });
}

describe('grid', () => {
  it.each([
    [4, 25, 40, 16],
    [5, 36, 60, 25],
    [7, 64, 112, 49],
  ])('%i×%i boxes → %i dots, %i lines, %i boxes', (n, dots, edges, boxes) => {
    expect((n + 1) * (n + 1)).toBe(dots);
    expect(edgeCount(n)).toBe(edges);
    expect(allEdges(n)).toHaveLength(edges);
    expect(boxCount(n)).toBe(boxes);
    expect(new Set(allEdges(n).map((e) => edgeId(e.o, e.r, e.c))).size).toBe(edges);
  });

  it('parses edge ids and rejects anything out of the grid', () => {
    expect(parseEdge('h:0:0', 4)).toEqual({ o: 'h', r: 0, c: 0 });
    expect(parseEdge('h:4:3', 4)).toEqual({ o: 'h', r: 4, c: 3 });
    expect(parseEdge('v:3:4', 4)).toEqual({ o: 'v', r: 3, c: 4 });
    for (const bad of [
      'h:0:4',
      'h:5:0',
      'v:4:0',
      'v:0:5',
      'x:0:0',
      'h:-1:0',
      'h:0',
      'h:0:0:0',
      '',
    ]) {
      expect(parseEdge(bad, 4), bad).toBeNull();
    }
  });

  it('knows which boxes a line borders and the four sides of a box', () => {
    expect(boxesOf({ o: 'h', r: 0, c: 1 }, 4)).toEqual([1]); // top edge: one box
    expect(boxesOf({ o: 'h', r: 2, c: 1 }, 4)).toEqual([5, 9]); // inner: two boxes
    expect(boxesOf({ o: 'v', r: 1, c: 0 }, 4)).toEqual([4]);
    expect(boxesOf({ o: 'v', r: 1, c: 2 }, 4)).toEqual([5, 6]);
    expect(sidesOf(1, 2).map((e) => edgeId(e.o, e.r, e.c))).toEqual([
      'h:1:2',
      'h:2:2',
      'v:1:2',
      'v:1:3',
    ]);
  });
});

describe('touch / mouse picking', () => {
  const empty = withLines([]);
  const lines = { n: empty.n, h: empty.h, v: empty.v };
  const id = (e: Edge | null) => (e ? edgeId(e.o, e.r, e.c) : null);

  it('picks the nearest free line from anywhere around it', () => {
    expect(id(nearestFreeEdge(lines, 1.5, 0.05))).toBe('h:0:1'); // right on it
    expect(id(nearestFreeEdge(lines, 1.5, 0.3))).toBe('h:0:1'); // a third of a cell away
    expect(id(nearestFreeEdge(lines, 2.3, 1.5))).toBe('v:1:2');
  });

  it('skips drawn lines: a touch near one picks the nearest free line, or nothing if unclear', () => {
    const drawn = withLines(['h:0:1']);
    const l = { n: drawn.n, h: drawn.h, v: drawn.v };
    expect(id(nearestFreeEdge(l, 1.2, 0.3))).toBe('v:0:1'); // clearly nearer the left side
    expect(nearestFreeEdge(l, 1.5, 0.3)).toBeNull(); // between two free sides: unclear
    const boxed = withLines(['h:0:1', 'h:1:1', 'v:0:1', 'v:0:2']);
    expect(
      id(nearestFreeEdge({ n: boxed.n, h: boxed.h, v: boxed.v }, 1.5, 0.5, { maxDistance: 0.6 })),
    ).toBeNull();
  });

  it('is ambiguous (picks nothing) at a box centre or a dot, and far outside', () => {
    expect(nearestFreeEdge(lines, 1.5, 1.5)).toBeNull(); // box centre: four lines equally near
    expect(nearestFreeEdge(lines, 2, 2)).toBeNull(); // a dot
    expect(nearestFreeEdge(lines, -2, -2)).toBeNull(); // off the paper
    // Just off-centre towards one side: that side.
    expect(id(nearestFreeEdge(lines, 1.5, 1.2))).toBe('h:1:1');
  });
});

describe('rules', () => {
  it('needs 2–4 players and starts with a seeded first player, every line free', () => {
    expect(() => game.setup([0], { grid: 5 }, ctx())).toThrow(/2–4/);
    expect(() => game.setup([0, 1, 2, 3, 4], { grid: 5 }, ctx())).toThrow(/2–4/);
    const t = start([0, 1, 2], 5, 3);
    expect(t.state.phase).toBe('PLAYING');
    expect([0, 1, 2]).toContain(t.state.turn);
    expect(t.state.h.every((x) => x === null) && t.state.v.every((x) => x === null)).toBe(true);
    expect(t.state.boxes).toHaveLength(25);
    expect(t.timers).toEqual([{ set: 'afk', ms: 90_000 }]);
    const firsts = new Set(
      Array.from({ length: 30 }, (_, i) => start([0, 1, 2, 3], 4, i).state.turn),
    );
    expect(firsts.size).toBeGreaterThan(1);
  });

  it('defaults to 5×5 and offers only 4×4, 5×5 and 7×7', () => {
    expect(game.defaultSettings).toEqual({ grid: 5 });
    for (const grid of [4, 5, 7])
      expect(game.settingsSchema.safeParse({ grid }).success).toBe(true);
    for (const grid of [3, 6, 8, '5'])
      expect(game.settingsSchema.safeParse({ grid }).success).toBe(false);
  });

  it('passes the turn when no box is completed', () => {
    const s = withLines([], 0);
    const t = move(s, 'h:0:0');
    expect(t.state.turn).toBe(1);
    expect(t.state.chain).toBe(0);
    expect(types(t)).toEqual(['EDGE_DRAWN', 'TURN']);
    expect(t.events.at(-1)?.event).toEqual({ type: 'TURN', seat: 1, again: false });
  });

  it('completing a box claims it and grants another turn', () => {
    const s = withLines(['h:0:0', 'h:1:0', 'v:0:0'], 1);
    const t = move(s, 'v:0:1');
    expect(t.state.boxes[0]).toBe(1);
    expect(t.state.scores[1]).toBe(1);
    expect(t.state.turn).toBe(1);
    expect(t.state.chain).toBe(1);
    expect(t.events.map((e) => e.event)).toEqual([
      { type: 'EDGE_DRAWN', edge: 'v:0:1', seat: 1 },
      { type: 'BOXES_CLAIMED', seat: 1, boxes: [0], chain: 1 },
      { type: 'TURN', seat: 1, again: true },
    ]);
  });

  it('one line can close two boxes at once; the chain keeps counting until the turn passes', () => {
    const s = withLines(['h:0:0', 'h:1:0', 'v:0:0', 'h:0:1', 'h:1:1', 'v:0:2'], 0);
    const t = move(s, 'v:0:1');
    expect(t.state.boxes.slice(0, 2)).toEqual([0, 0]);
    expect(t.state.scores[0]).toBe(2);
    expect(t.state.chain).toBe(2);
    const quiet = move(t.state, 'h:4:3');
    expect(quiet.state.turn).toBe(1);
    expect(quiet.state.chain).toBe(0);
  });

  it('rejects wrong-player, occupied, malformed and out-of-range lines, and moves after the end', () => {
    const s = withLines(['h:0:0'], 0);
    expect(game.validateAction(s, 1, { type: 'DRAW', edge: 'h:1:0' })).toEqual({
      ok: false,
      code: 'NOT_YOUR_TURN',
    });
    expect(game.validateAction(s, 0, { type: 'DRAW', edge: 'h:0:0' })).toEqual({
      ok: false,
      code: 'ILLEGAL_ACTION',
    });
    expect(game.validateAction(s, 0, { type: 'DRAW', edge: 'h:9:9' as EdgeId })).toEqual({
      ok: false,
      code: 'ILLEGAL_ACTION',
    });
    const over = deepFreeze({ ...s, phase: 'OVER' as const });
    expect(game.validateAction(over, 0, { type: 'DRAW', edge: 'h:1:0' })).toEqual({
      ok: false,
      code: 'INVALID_PHASE',
    });
  });

  it('accepts only a line id — claimed boxes, scores or extra turns cannot be sent', () => {
    const schema = game.actionSchema;
    expect(schema.safeParse({ type: 'DRAW', edge: 'v:2:3' }).success).toBe(true);
    for (const forged of [
      { type: 'DRAW', edge: 'v:2:3', boxes: [0] },
      { type: 'DRAW', edge: 'v:2:3', score: 99 },
      { type: 'DRAW', edge: 'v:2:3', again: true },
      { type: 'CLAIM', box: 0 },
      { type: 'DRAW', edge: 'v:2:3; DROP' },
      { type: 'DRAW' },
    ]) {
      expect(schema.safeParse(forged).success, JSON.stringify(forged)).toBe(false);
    }
  });

  it('ends when the last box is claimed, ranking by boxes with shared places for ties', () => {
    // 4×4: every line but the last drawn, boxes split 8–7 with one left.
    const n = 4;
    let s = withLines(
      allEdges(n)
        .map((e) => edgeId(e.o, e.r, e.c))
        .filter((id) => id !== 'v:3:4'),
      1,
    );
    const boxes = s.boxes.map((_, i) => (i === 15 ? null : i < 8 ? 0 : 1));
    s = deepFreeze({ ...s, boxes, scores: { 0: 8, 1: 7 } });
    const t = move(s, 'v:3:4');
    expect(t.state.phase).toBe('OVER');
    expect(types(t)).toEqual(['EDGE_DRAWN', 'BOXES_CLAIMED', 'MATCH_OVER']);
    expect(t.timers).toEqual([{ clear: 'afk' }]);
    expect(game.getResults(t.state)).toEqual({
      placements: [
        { seat: 0, place: 1 },
        { seat: 1, place: 1 },
      ],
      stats: { 0: { boxes: 8 }, 1: { boxes: 8 } },
    });
  });

  it('hands an inactive player’s seat to a bot after the inactivity time (no turn timer)', () => {
    const s = start([0, 1], 4).state;
    const t = game.onTimer(s, 'afk', ctx(s.turnStartedAt + 90_000));
    expect(t.requests).toEqual([{ type: 'MARK_IDLE', seat: s.turn }]);
    expect(t.state).toBe(s); // no forced move
    expect(
      createDotsAndBoxesGame({ afkMs: 30_000 }).setup([0, 1], { grid: 4 }, ctx()).timers,
    ).toEqual([{ set: 'afk', ms: 30_000 }]);
  });
});

describe('bot', () => {
  const decide = (s: DotsState, seed: number) => {
    const d = game.bot.decide(s, null, { seat: s.turn, now: 0, rng: createRng(seed) });
    return d?.kind === 'ACTION' ? d.action.edge : null;
  };

  it('only moves on its own turn, and always takes an available box (two at once first)', () => {
    const s = withLines(
      ['h:0:0', 'h:1:0', 'v:0:0', 'h:0:2', 'h:1:2', 'v:0:2', 'h:0:3', 'h:1:3', 'v:0:4'],
      0,
    );
    expect(game.bot.decide(s, null, { seat: 1, now: 0, rng: createRng(1) })).toBeNull();
    for (let seed = 0; seed < 20; seed++) expect(decide(s, seed)).toMatch(/^v:0:(1|3)$/);
    // 'v:0:3' closes boxes 2 and 3 at once.
    const double = withLines(['h:0:2', 'h:1:2', 'v:0:2', 'h:0:3', 'h:1:3', 'v:0:4', 'h:0:0'], 0);
    for (let seed = 0; seed < 20; seed++) expect(decide(double, seed)).toBe('v:0:3');
  });

  it('plays safe lines while there are any (never hands over a box needlessly)', () => {
    const s = withLines(['h:0:0', 'v:0:0'], 0); // box 0 has two sides: its other sides are unsafe
    for (let seed = 0; seed < 40; seed++) {
      const edge = decide(s, seed) as string;
      const e = parseEdge(edge, 4) as Edge;
      const lines = { n: 4, h: s.h, v: s.v };
      expect(
        boxesOf(e, 4).every((b) => sidesDrawn(lines, b) < 2),
        edge,
      ).toBe(true);
    }
  });

  it('when nothing is safe, gives away the smallest chain most of the time', () => {
    // Endgame on 4×4: a lone box in the top-left corner (two outer sides free) and a
    // 3-box chain along the bottom right; every other box is already owned.
    const n = 4;
    const free = new Set(['h:0:0', 'v:0:0', 'h:4:1', 'v:3:2', 'v:3:3', 'v:3:4']);
    let s = withLines(
      allEdges(n)
        .map((e) => edgeId(e.o, e.r, e.c))
        .filter((id) => !free.has(id)),
      0,
    );
    const boxes = s.boxes.map((_, b) => ([0, 13, 14, 15].includes(b) ? null : 1));
    s = deepFreeze({ ...s, boxes });
    const lines = { n, h: s.h, v: s.v };
    expect(allEdges(n).filter((e) => !isDrawn(lines, e) && isSafe(lines, e))).toEqual([]);
    expect(
      chainsOf(lines, boxes)
        .map((c) => c.length)
        .sort(),
    ).toEqual([1, 3]);
    let gaveSmallest = 0;
    for (let seed = 0; seed < 200; seed++) {
      const edge = decide(s, seed) as string;
      expect(free.has(edge)).toBe(true);
      if (edge === 'h:0:0' || edge === 'v:0:0') gaveSmallest++;
    }
    expect(gaveSmallest).toBeGreaterThan(150); // ≈ 90 %
    expect(gaveSmallest).toBeLessThan(200); // and sometimes it misjudges (beatable)
  });

  it('plays seeded bot-vs-bot matches on every grid to the end with consistent boards', () => {
    for (const grid of [4, 5, 7] as const) {
      for (let seed = 1; seed <= 25; seed++) {
        const seats = 2 + (seed % 3);
        const r = simulateMatch<DotsState, DotsEvent>(createDotsAndBoxesGame(), {
          seats,
          seed,
          settings: { grid },
          perturbHidden: (s) => s, // everything is public
          invariant: (s) => {
            const lines = { n: s.n, h: s.h, v: s.v };
            s.boxes.forEach((owner, b) => expect(owner !== null).toBe(sidesDrawn(lines, b) === 4));
            const owned = s.boxes.filter((b) => b !== null).length;
            expect(Object.values(s.scores).reduce((a, b) => a + b, 0)).toBe(owned);
          },
        });
        expect(r.state.phase).toBe('OVER');
        expect(
          allEdges(grid).every((e) => isDrawn({ n: grid, h: r.state.h, v: r.state.v }, e)),
        ).toBe(true);
        expect(r.state.moves).toBe(edgeCount(grid));
      }
    }
  });
});
