import {
  toAll,
  toSeats,
  type ChatInputLimit,
  type GameModule,
  type RuntimeRequest,
  type Scoped,
  type SeatIndex,
  type SeededRng,
  type StepCtx,
  type Transition,
} from '@cg/game-sdk';
import { z } from 'zod';
import { WORD_PACK } from '../../content/en';
import {
  fitsPattern,
  hintCap,
  isCloseGuess,
  isCorrectGuess,
  letterPositions,
  normalizeGuess,
  patternOf,
} from '../shared/guess';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  MAX_PLAYERS,
  MAX_POINTS_PER_CHUNK,
  MAX_POINTS_PER_TURN,
  MAX_STROKES_PER_TURN,
  MIN_PLAYERS,
  type DrawAction,
  type DrawEvent,
  type DrawSettings,
  type DrawState,
  type DrawTiming,
  type DrawView,
  type Guessed,
  type Op,
  type Phase,
  type RelayedOp,
  type SeatMap,
  type TurnResult,
  type WordEntry,
  type WordOption,
} from '../shared/types';
import { TEMPLATES, planDrawing } from './templates';

export const DRAW_AND_GUESS_GAME_ID = 'draw-and-guess';
const PHASE_TIMER = 'phase';
const HINT_TIMERS = ['hint1', 'hint2'] as const;

/** Spec §12 / Appendix A. */
export const DEFAULT_TIMING: DrawTiming = { chooseMs: 10_000, drawMs: 60_000, revealMs: 5000 };
/** Guesser points by order (spec §12), then the drawer's points per correct guesser. */
export const GUESSER_POINTS = [100, 80, 65, 55, 50] as const;
export const DRAWER_POINTS_PER_GUESS = 20;
/**
 * Guesses have their own rate limit (instead of room chat's 5 + 1/s and 30 s
 * cooldown): a quick burst, then one guess per second, never a cooldown.
 */
export const GUESS_LIMIT: ChatInputLimit = { burst: 8, perSecond: 1 };

export interface DrawOptions {
  /** Multiplies every duration (dev/e2e speed-ups; production uses 1). */
  timeScale?: number;
  timing?: Partial<DrawTiming>;
  /** The word pack (default: English). */
  pack?: readonly WordEntry[];
  guesserPoints?: readonly number[];
  drawerPointsPerGuess?: number;
  /** Bot delays (ms, scaled by timeScale). */
  botChooseMs?: [number, number];
  botGuessMs?: [number, number];
  /** How long a bot takes to draw a template (ms, scaled). */
  botDrawMs?: [number, number];
  /** Consecutive empty drawing turns before the seat is handed to a bot. */
  idleAfterEmptyTurns?: number;
  /** Rate limit for guesses (see GUESS_LIMIT). */
  guessLimit?: ChatInputLimit;
}

type T = Transition<DrawState, DrawEvent>;
type Ev = Scoped<DrawEvent>;

const chunkSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('stroke'),
    id: z.number().int().min(0).max(65_535),
    tool: z.enum(['pen', 'eraser']),
    colour: z.number().int().min(0).max(11),
    size: z.number().int().min(0).max(3),
    points: z
      .array(
        z
          .number()
          .int()
          .min(0)
          .max(CANVAS_WIDTH - 1),
      )
      .min(2)
      .max(MAX_POINTS_PER_CHUNK * 2),
  }),
  z.strictObject({ op: z.literal('undo') }),
  z.strictObject({ op: z.literal('clear') }),
]);

/** Standard competition ranking: equal scores share a place. */
function rank(seats: number[], scores: SeatMap<number>) {
  return seats.map((seat) => ({
    seat,
    place: 1 + seats.filter((o) => (scores[o] ?? 0) > (scores[seat] ?? 0)).length,
  }));
}

export function createDrawAndGuessGame(
  options: DrawOptions = {},
): GameModule<DrawState, DrawAction, DrawView, DrawEvent, DrawSettings> {
  const scale = options.timeScale ?? 1;
  const ms = (k: keyof DrawTiming) =>
    Math.round((options.timing?.[k] ?? DEFAULT_TIMING[k]) * scale);
  const timing: DrawTiming = {
    chooseMs: ms('chooseMs'),
    drawMs: ms('drawMs'),
    revealMs: ms('revealMs'),
  };
  const range = (r: [number, number] | undefined, fallback: [number, number]) =>
    (r ?? fallback).map((v) => Math.max(0, Math.round(v * scale))) as [number, number];
  const [chooseMin, chooseMax] = range(options.botChooseMs, [1000, 3000]);
  const [guessMin, guessMax] = range(options.botGuessMs, [6000, 12_000]);
  const [drawMin, drawMax] = range(options.botDrawMs, [20_000, 40_000]);
  const pack = options.pack ?? WORD_PACK;
  const guesserPoints = options.guesserPoints ?? GUESSER_POINTS;
  const drawerPer = options.drawerPointsPerGuess ?? DRAWER_POINTS_PER_GUESS;
  const idleAfter = options.idleAfterEmptyTurns ?? 2;
  const drawable = (i: number) => (pack[i] as WordEntry).word in TEMPLATES;

  const enter = (s: DrawState, phase: Phase, phaseMs: number, ctx: StepCtx): DrawState => ({
    ...s,
    phase,
    phaseMs,
    phaseEndsAt: ctx.now + phaseMs,
  });
  const wordOf = (s: DrawState) => (s.wordIndex === null ? null : (pack[s.wordIndex] as WordEntry));
  const guessers = (s: DrawState) => s.seats.filter((seat) => seat !== s.drawer);

  /**
   * Three unused cards — one per difficulty where possible — always including at
   * least one a bot can draw, so a bot drawer only ever draws template words.
   * A (small, custom) pack that runs out starts over.
   */
  function dealOptions(s: DrawState, rng: SeededRng): number[] {
    const all = pack.map((_, i) => i);
    const fresh = all.filter((i) => !s.used.includes(i));
    const unused = fresh.length >= 3 ? fresh : all;
    const picks: number[] = [];
    for (const d of ['easy', 'medium', 'hard'] as const) {
      const pool = unused.filter(
        (i) => (pack[i] as WordEntry).difficulty === d && !picks.includes(i),
      );
      if (pool.length > 0) picks.push(rng.pick(pool));
    }
    while (picks.length < 3) {
      const pool = unused.filter((i) => !picks.includes(i));
      if (pool.length === 0) break;
      picks.push(rng.pick(pool));
    }
    if (!picks.some(drawable)) {
      const pool = unused.filter((i) => drawable(i) && !picks.includes(i));
      if (pool.length > 0) picks[0] = rng.pick(pool);
    }
    return picks;
  }

  const startChoosing = (s: DrawState, ctx: StepCtx, events: Ev[] = []): T => {
    const drawer = s.seats[s.turnIndex] as number;
    const turn = s.turn + 1;
    const base: DrawState = {
      ...s,
      turn,
      drawer,
      wordIndex: null,
      revealed: [],
      hintsGiven: 0,
      guessed: [],
      wrong: [],
      ops: [],
      strokeIds: [],
      pointCount: 0,
    };
    const optionsIdx = dealOptions(base, ctx.rng);
    const state = enter({ ...base, options: optionsIdx }, 'CHOOSING', s.timing.chooseMs, ctx);
    return {
      state,
      events: [
        ...events,
        toAll({
          type: 'CHOOSING_STARTED',
          round: s.round,
          turn,
          drawer,
          deadline: state.phaseEndsAt,
        }),
        toSeats([drawer], { type: 'WORD_OPTIONS', options: optionsIdx.map(optionOf) } as DrawEvent),
      ],
      timers: [
        { set: PHASE_TIMER, ms: s.timing.chooseMs },
        ...HINT_TIMERS.map((id) => ({ clear: id })),
      ],
    };
  };

  const optionOf = (i: number): WordOption => {
    const entry = pack[i] as WordEntry;
    return { word: entry.word, difficulty: entry.difficulty, drawable: drawable(i) };
  };

  const startDrawing = (s: DrawState, option: number, ctx: StepCtx): T => {
    const wordIndex = s.options[option] ?? (s.options[0] as number);
    const word = (pack[wordIndex] as WordEntry).word;
    const state = enter(
      { ...s, wordIndex, options: [], used: [...s.used, wordIndex] },
      'DRAWING',
      s.timing.drawMs,
      ctx,
    );
    const cap = hintCap(word);
    const hintTimers = HINT_TIMERS.slice(0, cap).map((id, i) => ({
      set: id,
      ms: Math.round(s.timing.drawMs * (i === 0 ? 0.5 : 0.75)),
    }));
    return {
      state,
      events: [
        toAll({
          type: 'DRAWING_STARTED',
          turn: s.turn,
          drawer: s.drawer,
          pattern: patternOf(word, []),
          deadline: state.phaseEndsAt,
        }),
        toSeats([s.drawer], { type: 'YOUR_WORD', word } as DrawEvent),
      ],
      timers: [{ set: PHASE_TIMER, ms: s.timing.drawMs }, ...hintTimers],
    };
  };

  /** Ends the drawing turn: scores, idle check, the reveal. */
  const endTurn = (s: DrawState, ctx: StepCtx, events: Ev[] = []): T => {
    const word = wordOf(s)?.word ?? '';
    const deltas: SeatMap<number> = {};
    for (const g of s.guessed) deltas[g.seat] = g.points;
    deltas[s.drawer] = s.guessed.length * drawerPer;
    const scores: SeatMap<number> = { ...s.scores };
    for (const seat of s.seats) scores[seat] = (scores[seat] ?? 0) + (deltas[seat] ?? 0);
    const empty = s.strokeIds.length === 0 ? (s.emptyTurns[s.drawer] ?? 0) + 1 : 0;
    const requests: RuntimeRequest[] =
      empty === idleAfter ? [{ type: 'MARK_IDLE', seat: s.drawer }] : [];
    const result: TurnResult = { turn: s.turn, drawer: s.drawer, word, deltas, guessed: s.guessed };
    const state = enter(
      { ...s, scores, emptyTurns: { ...s.emptyTurns, [s.drawer]: empty }, lastTurn: result },
      'REVEAL',
      s.timing.revealMs,
      ctx,
    );
    return {
      state,
      events: [...events, toAll({ type: 'REVEAL', result, scores })],
      timers: [
        { set: PHASE_TIMER, ms: s.timing.revealMs },
        ...HINT_TIMERS.map((id) => ({ clear: id })),
      ],
      requests,
    };
  };

  const nextTurn = (s: DrawState, ctx: StepCtx): T => {
    let turnIndex = s.turnIndex + 1;
    let round = s.round;
    if (turnIndex >= s.seats.length) {
      turnIndex = 0;
      round += 1;
    }
    if (round > s.rounds) {
      return {
        state: { ...s, phase: 'OVER', phaseMs: 0, phaseEndsAt: ctx.now },
        events: [toAll({ type: 'MATCH_OVER', scores: { ...s.scores } })],
        timers: [{ clear: PHASE_TIMER }],
      };
    }
    return startChoosing({ ...s, turnIndex, round }, ctx);
  };

  const nothing = (s: DrawState): T => ({ state: s, events: [] });

  const viewOf = (s: DrawState, viewer: SeatIndex): DrawView => {
    const entry = wordOf(s);
    const solved = s.guessed.some((g) => g.seat === viewer);
    const showWord =
      entry !== null &&
      (viewer === s.drawer || solved || s.phase === 'REVEAL' || s.phase === 'OVER');
    return {
      phase: s.phase,
      round: s.round,
      rounds: s.rounds,
      turn: s.turn,
      drawer: s.drawer,
      phaseEndsAt: s.phaseEndsAt,
      phaseMs: s.phaseMs,
      options: s.phase === 'CHOOSING' && viewer === s.drawer ? s.options.map(optionOf) : [],
      word: showWord && entry ? entry.word : null,
      pattern: entry ? patternOf(entry.word, s.revealed) : '',
      guessed: s.guessed,
      wrong: s.wrong,
      strokes: s.strokeIds.length,
      scores: s.scores,
      lastTurn: s.lastTurn,
    };
  };

  return {
    manifest: {
      id: DRAW_AND_GUESS_GAME_ID,
      version: 1,
      players: { min: MIN_PLAYERS, max: MAX_PLAYERS },
      sync: 'STREAMED',
      bots: { supported: true, canTakeOverSeat: true },
      publicMatch: { targetPlayers: 5, minHumans: 2 },
      reclaim: 'NEXT_PHASE_BOUNDARY',
      layout: { orientation: 'any' },
    },

    settingsSchema: z.strictObject({ rounds: z.number().int().min(1).max(3) }),
    defaultSettings: { rounds: 2 },

    actionSchema: z.strictObject({
      type: z.literal('CHOOSE'),
      option: z.number().int().min(0).max(2),
    }),

    setup(seats, settings, ctx) {
      if (seats.length < MIN_PLAYERS || seats.length > MAX_PLAYERS) {
        throw new Error('Draw & Guess needs 3–6 players');
      }
      const zero = Object.fromEntries(seats.map((seat) => [seat, 0])) as SeatMap<number>;
      const initial: DrawState = {
        phase: 'CHOOSING',
        seats: [...seats],
        rounds: settings.rounds,
        round: 1,
        turnIndex: 0,
        turn: 0,
        drawer: seats[0] as number,
        options: [],
        wordIndex: null,
        used: [],
        revealed: [],
        hintsGiven: 0,
        guessed: [],
        wrong: [],
        ops: [],
        strokeIds: [],
        pointCount: 0,
        scores: zero,
        emptyTurns: { ...zero },
        lastTurn: null,
        phaseEndsAt: ctx.now,
        phaseMs: 0,
        timing,
      };
      return startChoosing(initial, ctx);
    },

    validateAction(s, seat, a) {
      if (s.phase !== 'CHOOSING') return { ok: false, code: 'INVALID_PHASE' };
      if (seat !== s.drawer) return { ok: false, code: 'NOT_YOUR_TURN' };
      if (a.option >= s.options.length) return { ok: false, code: 'ILLEGAL_ACTION' };
      return { ok: true };
    },

    applyAction(s, _seat, a, ctx) {
      return startDrawing(s, a.option, ctx);
    },

    onTimer(s, timer, ctx) {
      if (HINT_TIMERS.includes(timer as (typeof HINT_TIMERS)[number])) {
        const entry = wordOf(s);
        if (s.phase !== 'DRAWING' || !entry) return nothing(s);
        const hidden = letterPositions(entry.word).filter((i) => !s.revealed.includes(i));
        if (hidden.length <= 1 || s.hintsGiven >= hintCap(entry.word)) return nothing(s);
        const index = ctx.rng.pick(hidden);
        return {
          state: { ...s, revealed: [...s.revealed, index], hintsGiven: s.hintsGiven + 1 },
          events: [toAll({ type: 'HINT', index, letter: entry.word[index] as string })],
        };
      }
      if (timer !== PHASE_TIMER) return nothing(s);
      switch (s.phase) {
        case 'CHOOSING':
          // Time's up: a random card (spec §12).
          return startDrawing(s, ctx.rng.int(0, Math.max(0, s.options.length - 1)), ctx);
        case 'DRAWING':
          return endTurn(s, ctx);
        case 'REVEAL':
          return nextTurn(s, ctx);
        case 'OVER':
          return nothing(s);
      }
    },

    onSeatChange(s, seat, change, ctx) {
      if (change === 'BOT_TOOK_OVER' || change === 'RECLAIMED') {
        const next = { ...s, emptyTurns: { ...s.emptyTurns, [seat]: 0 } };
        // The drawer's grace expired (or they left): the turn ends now (spec §12).
        if (change === 'BOT_TOOK_OVER' && seat === s.drawer && s.phase === 'DRAWING') {
          return endTurn(next, ctx);
        }
        return { state: next, events: [] };
      }
      if (change === 'LEFT' && seat === s.drawer && s.phase === 'DRAWING') return endTurn(s, ctx);
      return nothing(s);
    },

    /** NEXT_PHASE_BOUNDARY: the drawer gets their seat back after their turn. */
    canReclaimSeat: (s, seat) =>
      !(seat === s.drawer && (s.phase === 'CHOOSING' || s.phase === 'DRAWING')),

    getPlayerView: viewOf,
    isOver: (s) => s.phase === 'OVER',

    getResults(s) {
      return {
        placements: rank(s.seats, s.scores),
        stats: Object.fromEntries(s.seats.map((seat) => [seat, { score: s.scores[seat] ?? 0 }])),
      };
    },

    stream: {
      chunkSchema,
      limits: {
        maxChunkBytes: 1024,
        maxChunksPerSec: 20,
        maxPointsPerTurn: MAX_POINTS_PER_TURN,
        maxStrokesPerTurn: MAX_STROKES_PER_TURN,
      },
      accept(s, seat, raw) {
        const op = raw as Op;
        if (s.phase !== 'DRAWING') return { ok: false, code: 'INVALID_PHASE' };
        if (seat !== s.drawer) return { ok: false, code: 'NOT_YOUR_TURN' };
        let next = s;
        if (op.op === 'stroke') {
          const pts = op.points;
          if (pts.length % 2 !== 0) return { ok: false, code: 'ILLEGAL_ACTION' };
          for (let i = 1; i < pts.length; i += 2) {
            if ((pts[i] as number) > CANVAS_HEIGHT - 1)
              return { ok: false, code: 'ILLEGAL_ACTION' };
          }
          const isNew = !s.strokeIds.includes(op.id);
          const pointCount = s.pointCount + pts.length / 2;
          if (isNew && s.strokeIds.length >= MAX_STROKES_PER_TURN)
            return { ok: false, code: 'ILLEGAL_ACTION' };
          if (pointCount > MAX_POINTS_PER_TURN) return { ok: false, code: 'ILLEGAL_ACTION' };
          next = { ...s, pointCount, strokeIds: isNew ? [...s.strokeIds, op.id] : s.strokeIds };
        }
        const relay: RelayedOp = { ...op, turn: s.turn };
        return {
          state: { ...next, ops: [...next.ops, op] },
          relay,
          audience: { to: 'ALL_EXCEPT', seats: [s.drawer] },
        };
      },
      /** The current turn's drawing (kept through the reveal). */
      replay: (s) =>
        s.phase === 'DRAWING' || s.phase === 'REVEAL'
          ? s.ops.map((op): RelayedOp => ({ ...op, turn: s.turn }))
          : [],
    },

    chat: {
      /** Guessers' messages while drawing are guesses (solved players chat normally). */
      input: {
        limit: options.guessLimit ?? GUESS_LIMIT,
        applies: (s, seat) =>
          s.phase === 'DRAWING' &&
          seat !== s.drawer &&
          s.seats.includes(seat) &&
          !s.guessed.some((g) => g.seat === seat),
      },
      intercept(s, seat, normalized, ctx) {
        const entry = wordOf(s);
        if (s.phase !== 'DRAWING' || !entry) return { kind: 'PASS' };
        if (seat === s.drawer) return { kind: 'BLOCK', code: 'CHAT_BLOCKED' };
        if (s.guessed.some((g) => g.seat === seat)) {
          return {
            kind: 'RESTRICT',
            audience: { to: 'SEATS', seats: [s.drawer, ...s.guessed.map((g) => g.seat)] },
            channel: 'SOLVED',
          };
        }
        if (isCorrectGuess(normalized, entry)) {
          const order = s.guessed.length + 1;
          const points = guesserPoints[Math.min(order, guesserPoints.length) - 1] ?? 0;
          const guessed: Guessed[] = [...s.guessed, { seat, order, points }];
          const events: Ev[] = [
            toAll({ type: 'GUESSED', seat, order }),
            toSeats([seat], { type: 'YOU_GUESSED', word: entry.word, points } as DrawEvent),
          ];
          const next = { ...s, guessed };
          const everyone = guessers(s).every((g) => guessed.some((x) => x.seat === g));
          return {
            kind: 'CONSUME',
            transition: everyone ? endTurn(next, ctx, events) : { state: next, events },
          };
        }
        if (isCloseGuess(normalized, entry)) {
          return {
            kind: 'CONSUME',
            transition: {
              state: s,
              events: [
                toSeats([seat], { type: 'CLOSE', guess: normalizeGuess(normalized) } as DrawEvent),
              ],
            },
          };
        }
        // A wrong guess is shown normally and remembered (public) for bots and the board.
        const guess = normalizeGuess(normalized);
        const wrong = guess && !s.wrong.includes(guess) ? [...s.wrong, guess].slice(-40) : s.wrong;
        return { kind: 'PASS', transition: { state: { ...s, wrong }, events: [] } };
      },
    },

    bot: {
      createMemory: () => null,
      observe: (memory) => memory,
      decide(view, _memory, ctx) {
        if (view.phase === 'CHOOSING' && view.drawer === ctx.seat && view.options.length > 0) {
          const drawableOptions = view.options.flatMap((o, i) => (o.drawable ? [i] : []));
          const option = drawableOptions.length > 0 ? ctx.rng.pick(drawableOptions) : 0;
          return {
            kind: 'ACTION',
            action: { type: 'CHOOSE', option },
            thinkMs: ctx.rng.int(chooseMin, chooseMax),
          };
        }
        if (view.phase !== 'DRAWING') return null;
        if (view.drawer === ctx.seat) {
          const template = view.word ? TEMPLATES[view.word] : undefined;
          if (!template || view.strokes > 0) return null;
          return {
            kind: 'STREAM',
            thinkMs: ctx.rng.int(400, 1200),
            steps: planDrawing(template, ctx.rng, ctx.rng.int(drawMin, drawMax)),
          };
        }
        if (view.guessed.some((g) => g.seat === ctx.seat)) return null;
        // Only public information: the pattern, revealed letters and earlier wrong guesses.
        const candidates = pack.filter(
          (e) => fitsPattern(e.word, view.pattern) && !view.wrong.includes(normalizeGuess(e.word)),
        );
        if (candidates.length === 0) return null;
        return {
          kind: 'CHAT',
          text: ctx.rng.pick(candidates).word,
          thinkMs: ctx.rng.int(guessMin, guessMax),
        };
      },
    },
  };
}

export const drawAndGuessGame = createDrawAndGuessGame();

/**
 * Leak-checker helper: replaces the word with another of the same shape. A
 * guesser who has not guessed it must see exactly the same view.
 */
export function perturbDrawHidden(s: DrawState, viewer: SeatIndex, rng: SeededRng): DrawState {
  if (s.wordIndex === null || s.phase === 'REVEAL' || s.phase === 'OVER') return s;
  if (viewer === s.drawer || s.guessed.some((g) => g.seat === viewer)) return s;
  const current = WORD_PACK[s.wordIndex] as WordEntry;
  const pattern = patternOf(current.word, s.revealed);
  const others = WORD_PACK.map((e, i) => ({ e, i })).filter(
    ({ e, i }) =>
      i !== s.wordIndex &&
      fitsPattern(e.word, pattern) &&
      patternOf(e.word, s.revealed) === pattern,
  );
  if (others.length === 0) return s;
  return { ...s, wordIndex: rng.pick(others).i };
}
