import {
  toAll,
  type GameModule,
  type RuntimeRequest,
  type SeededRng,
  type StepCtx,
  type Transition,
} from '@cg/game-sdk';
import { z } from 'zod';
import {
  boxCount,
  boxesOf,
  edgeId,
  freeEdges,
  indexOf,
  isSafe,
  parseEdge,
  sidesDrawn,
  sidesOf,
  wouldComplete,
  type Edge,
  type Lines,
} from '../shared/grid';
import {
  DEFAULT_GRID,
  GRID_SIZES,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type DotsAction,
  type DotsEvent,
  type DotsSettings,
  type DotsState,
  type DotsView,
  type EdgeId,
  type SeatMap,
} from '../shared/types';

export const DOTS_AND_BOXES_GAME_ID = 'dots-and-boxes';
const AFK_TIMER = 'afk';

export interface DotsOptions {
  /** Multiplies every duration (dev/e2e speed-ups; production uses 1). */
  timeScale?: number;
  /** Inactivity on your own turn before a bot plays your seat (play-test value). */
  afkMs?: number;
  /** Bot thinking time on a fresh turn, and per extra move inside a chain (ms). */
  botThinkMs?: [number, number];
  botChainMs?: [number, number];
  /** Bot mistakes: an unsafe line when few safe ones are left; a random chain to give away. */
  botBlunder?: number;
  botWrongChain?: number;
}

type T = Transition<DotsState, DotsEvent>;

/** Standard competition ranking: equal scores share a place. */
const rank = (seats: number[], scores: SeatMap<number>) =>
  seats.map((seat) => ({
    seat,
    place: 1 + seats.filter((o) => (scores[o] ?? 0) > (scores[seat] ?? 0)).length,
  }));

/**
 * Groups the unclaimed boxes into chains/loops: boxes joined through a free side
 * they share. Used by the bot once every free line gives something away.
 */
export function chainsOf(lines: Lines, owned: readonly (number | null)[]): number[][] {
  const n = lines.n;
  const seen = new Set<number>();
  const groups: number[][] = [];
  for (let b = 0; b < n * n; b++) {
    if (owned[b] !== null || seen.has(b)) continue;
    const group: number[] = [];
    const stack = [b];
    seen.add(b);
    while (stack.length > 0) {
      const box = stack.pop() as number;
      group.push(box);
      for (const side of sidesOf(Math.floor(box / n), box % n)) {
        if ((side.o === 'h' ? lines.h : lines.v)[indexOf(side, n)] !== null) continue;
        for (const other of boxesOf(side, n)) {
          if (other !== box && owned[other] === null && !seen.has(other)) {
            seen.add(other);
            stack.push(other);
          }
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

export function createDotsAndBoxesGame(
  options: DotsOptions = {},
): GameModule<DotsState, DotsAction, DotsView, DotsEvent, DotsSettings> {
  const scale = options.timeScale ?? 1;
  const afkMs = Math.round((options.afkMs ?? 90_000) * scale);
  const scaled = (r: [number, number]) => r.map((v) => Math.round(v * scale)) as [number, number];
  const [thinkMin, thinkMax] = scaled(options.botThinkMs ?? [700, 1600]);
  const [chainMin, chainMax] = scaled(options.botChainMs ?? [350, 700]);
  const blunder = options.botBlunder ?? 0.15;
  const wrongChain = options.botWrongChain ?? 0.2;

  const nextSeat = (s: DotsState, seat: number) =>
    s.seats[(s.seats.indexOf(seat) + 1) % s.seats.length] as number;

  const draw = (s: DotsState, seat: number, e: Edge, ctx: StepCtx): T => {
    const n = s.n;
    const h = [...s.h];
    const v = [...s.v];
    (e.o === 'h' ? h : v)[indexOf(e, n)] = seat;
    const lines = { n, h, v };
    // Every bordering box whose four sides are now drawn goes to the mover.
    const closed = boxesOf(e, n).filter((b) => s.boxes[b] === null && sidesDrawn(lines, b) === 4);
    const boxes = [...s.boxes];
    for (const b of closed) boxes[b] = seat;
    const scores = { ...s.scores, [seat]: (s.scores[seat] ?? 0) + closed.length };
    const again = closed.length > 0;
    const chain = again ? s.chain + closed.length : 0;
    const id = edgeId(e.o, e.r, e.c);
    const events = [toAll<DotsEvent>({ type: 'EDGE_DRAWN', edge: id, seat })];
    if (again) events.push(toAll({ type: 'BOXES_CLAIMED', seat, boxes: closed, chain }));
    const base: DotsState = {
      ...s,
      h,
      v,
      boxes,
      scores,
      chain,
      moves: s.moves + 1,
      lastMove: { edge: id, seat, boxes: closed },
    };
    if (boxes.every((b) => b !== null)) {
      return {
        state: { ...base, phase: 'OVER' },
        events: [...events, toAll({ type: 'MATCH_OVER', scores })],
        timers: [{ clear: AFK_TIMER }],
      };
    }
    const turn = again ? seat : nextSeat(s, seat);
    return {
      state: { ...base, turn, turnStartedAt: again ? s.turnStartedAt : ctx.now },
      events: [...events, toAll({ type: 'TURN', seat: turn, again })],
      // The inactivity clock restarts with every move.
      timers: [{ set: AFK_TIMER, ms: s.afkMs }],
    };
  };

  /** The bot's move (also good for tests): capture, else safe, else the smallest chain. */
  function chooseEdge(view: DotsView, rng: SeededRng): Edge | null {
    const lines: Lines = { n: view.n, h: view.h, v: view.v };
    const free = freeEdges(lines);
    if (free.length === 0) return null;
    // 1. Always take what is there — the line closing two boxes first.
    const captures = free
      .map((e) => ({ e, k: wouldComplete(lines, e).length }))
      .filter((x) => x.k > 0)
      .sort((a, b) => b.k - a.k);
    if (captures.length > 0) return (captures[0] as { e: Edge }).e;
    // 2. A safe line (gives nothing away), preferring quiet parts of the board.
    const safe = free.filter((e) => isSafe(lines, e));
    if (safe.length > 0) {
      if (safe.length <= 4 && rng.next() < blunder) {
        const unsafe = free.filter((e) => !isSafe(lines, e));
        if (unsafe.length > 0) return rng.pick(unsafe); // misjudged the board
      }
      const load = (e: Edge) => boxesOf(e, view.n).reduce((t, b) => t + sidesDrawn(lines, b), 0);
      const least = Math.min(...safe.map(load));
      return rng.pick(safe.filter((e) => load(e) === least));
    }
    // 3. Everything gives something away: give the smallest chain (mostly).
    const chains = chainsOf(lines, view.boxes).sort((a, b) => a.length - b.length);
    const target =
      chains.length > 1 && rng.next() < wrongChain ? rng.pick(chains) : (chains[0] as number[]);
    const inChain = free.filter((e) => boxesOf(e, view.n).some((b) => target.includes(b)));
    return rng.pick(inChain.length > 0 ? inChain : free);
  }

  return {
    manifest: {
      id: DOTS_AND_BOXES_GAME_ID,
      version: 1,
      players: { min: MIN_PLAYERS, max: MAX_PLAYERS },
      sync: 'TURN_PHASE',
      bots: { supported: true, canTakeOverSeat: true },
      publicMatch: { targetPlayers: 4, minHumans: 2 },
      reclaim: 'IMMEDIATE',
      layout: { orientation: 'any' },
    },

    settingsSchema: z.strictObject({
      grid: z.union([z.literal(GRID_SIZES[0]), z.literal(GRID_SIZES[1]), z.literal(GRID_SIZES[2])]),
    }),
    defaultSettings: { grid: DEFAULT_GRID },

    // A move is only the line: the server works out boxes, scores and turns.
    actionSchema: z.strictObject({
      type: z.literal('DRAW'),
      edge: z.string().regex(/^[hv]:\d{1,2}:\d{1,2}$/u),
    }) as unknown as z.ZodType<DotsAction>,

    setup(seats, settings, ctx) {
      if (seats.length < MIN_PLAYERS || seats.length > MAX_PLAYERS) {
        throw new Error('Dots & Boxes needs 2–4 players');
      }
      const n = settings.grid;
      const zero = Object.fromEntries(seats.map((seat) => [seat, 0])) as SeatMap<number>;
      const turn = ctx.rng.pick(seats);
      const state: DotsState = {
        phase: 'PLAYING',
        n,
        seats: [...seats],
        turn,
        h: Array.from({ length: (n + 1) * n }, () => null),
        v: Array.from({ length: n * (n + 1) }, () => null),
        boxes: Array.from({ length: boxCount(n) }, () => null),
        scores: zero,
        chain: 0,
        moves: 0,
        lastMove: null,
        turnStartedAt: ctx.now,
        afkMs,
      };
      return {
        state,
        events: [toAll({ type: 'TURN', seat: turn, again: false })],
        timers: [{ set: AFK_TIMER, ms: afkMs }],
      };
    },

    validateAction(s, seat, a) {
      if (s.phase !== 'PLAYING') return { ok: false, code: 'INVALID_PHASE' };
      if (seat !== s.turn) return { ok: false, code: 'NOT_YOUR_TURN' };
      const e = parseEdge(a.edge, s.n);
      if (!e) return { ok: false, code: 'ILLEGAL_ACTION' };
      if (((e.o === 'h' ? s.h : s.v)[indexOf(e, s.n)] ?? null) !== null) {
        return { ok: false, code: 'ILLEGAL_ACTION' };
      }
      return { ok: true };
    },

    applyAction(s, seat, a, ctx) {
      return draw(s, seat, parseEdge(a.edge, s.n) as Edge, ctx);
    },

    onTimer(s, timer) {
      if (timer !== AFK_TIMER || s.phase !== 'PLAYING') return { state: s, events: [] };
      // Nobody moved for a long time: a bot plays this seat (the player can take it back).
      const requests: RuntimeRequest[] = [{ type: 'MARK_IDLE', seat: s.turn }];
      return { state: s, events: [], requests, timers: [{ set: AFK_TIMER, ms: s.afkMs }] };
    },

    onSeatChange(s) {
      return { state: s, events: [] };
    },

    getPlayerView: (s) => s,
    isOver: (s) => s.phase === 'OVER',

    getResults(s) {
      return {
        placements: rank(s.seats, s.scores),
        stats: Object.fromEntries(s.seats.map((seat) => [seat, { boxes: s.scores[seat] ?? 0 }])),
      };
    },

    bot: {
      createMemory: () => null,
      observe: (memory) => memory,
      decide(view, _memory, ctx) {
        if (view.phase !== 'PLAYING' || view.turn !== ctx.seat) return null;
        const e = chooseEdge(view, ctx.rng);
        if (!e) return null;
        const [min, max] = view.chain > 0 ? [chainMin, chainMax] : [thinkMin, thinkMax];
        return {
          kind: 'ACTION',
          action: { type: 'DRAW', edge: edgeId(e.o, e.r, e.c) as EdgeId },
          thinkMs: ctx.rng.int(min, max),
        };
      },
    },
  };
}

export const dotsAndBoxesGame = createDotsAndBoxesGame();
