/**
 * Draw & Guess (working name) — shared types (engine, bots and board).
 * Rules: docs/GAME_RULES/DRAW_AND_GUESS.md (spec §12).
 */

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 6;

/** Fixed 4:3 logical canvas; all coordinates are integers inside it (spec §12). */
export const CANVAS_WIDTH = 4096;
export const CANVAS_HEIGHT = 3072;

/** The 12-colour palette (index = colour id). */
export const PALETTE = [
  '#1f1647', // ink
  '#ffffff', // white
  '#8a8fa8', // grey
  '#ff4d6a', // red
  '#ff8a3d', // orange
  '#ffd23f', // yellow
  '#3ec46d', // green
  '#2de2e6', // cyan
  '#4c8dff', // blue
  '#9b7bff', // violet
  '#ff7eb6', // pink
  '#a0622d', // brown
] as const;

/** The 4 brush sizes, in canvas units. */
export const BRUSH_SIZES = [14, 30, 60, 120] as const;

/** Per-chunk and per-turn limits the server enforces (spec §12). */
export const MAX_POINTS_PER_CHUNK = 64;
export const MAX_POINTS_PER_TURN = 20_000;
export const MAX_STROKES_PER_TURN = 1000;

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface WordEntry {
  word: string;
  aliases: string[];
  difficulty: Difficulty;
}

export type Phase = 'CHOOSING' | 'DRAWING' | 'REVEAL' | 'OVER';

export interface DrawTiming {
  chooseMs: number;
  drawMs: number;
  revealMs: number;
}

export type SeatMap<T> = Record<number, T>;

/** A piece of the drawing, as the drawer sends it. */
export type Op =
  | {
      op: 'stroke';
      /** Stroke id within the turn; a stroke continues across chunks with the same id. */
      id: number;
      tool: 'pen' | 'eraser';
      colour: number;
      size: number;
      /** Flat [x, y, x, y, …] in canvas units. */
      points: number[];
    }
  | { op: 'undo' }
  | { op: 'clear' };

/** What everyone else receives: the op tagged with the turn it belongs to. */
export type RelayedOp = Op & { turn: number };

export interface Guessed {
  seat: number;
  /** 1 for the first correct guesser, 2 for the second, … */
  order: number;
  points: number;
}

export interface TurnResult {
  turn: number;
  drawer: number;
  word: string;
  deltas: SeatMap<number>;
  guessed: Guessed[];
}

export interface DrawState {
  phase: Phase;
  seats: number[];
  rounds: number;
  round: number;
  /** Index into `seats` of the current drawer within the round. */
  turnIndex: number;
  /** Global turn counter (1-based); tags streamed ops. */
  turn: number;
  drawer: number;
  /** Indexes into the word pack offered to the drawer while CHOOSING. */
  options: number[];
  wordIndex: number | null;
  used: number[];
  /** Positions in the word revealed as hints. */
  revealed: number[];
  hintsGiven: number;
  guessed: Guessed[];
  /** Normalised wrong guesses this turn (public: they were shown in chat). */
  wrong: string[];
  /** The drawing of the current turn, in order (for replay). */
  ops: Op[];
  strokeIds: number[];
  pointCount: number;
  scores: SeatMap<number>;
  /** Consecutive own drawing turns without a single stroke (idle detection). */
  emptyTurns: SeatMap<number>;
  lastTurn: TurnResult | null;
  phaseEndsAt: number;
  phaseMs: number;
  timing: DrawTiming;
}

export type DrawAction = { type: 'CHOOSE'; option: number };

export interface WordOption {
  word: string;
  difficulty: Difficulty;
  /** A bot can draw this one (it has a stroke template). */
  drawable: boolean;
}

export type DrawEvent =
  | { type: 'CHOOSING_STARTED'; round: number; turn: number; drawer: number; deadline: number }
  /** Private: the drawer's three cards. */
  | { type: 'WORD_OPTIONS'; options: WordOption[] }
  | { type: 'DRAWING_STARTED'; turn: number; drawer: number; pattern: string; deadline: number }
  /** Private: the drawer's word. */
  | { type: 'YOUR_WORD'; word: string }
  /** Public: a letter of the word (at 50 % and 75 % of the timer). */
  | { type: 'HINT'; index: number; letter: string }
  /** Public: someone guessed it — never the word itself. */
  | { type: 'GUESSED'; seat: number; order: number }
  /** Private: you guessed it. */
  | { type: 'YOU_GUESSED'; word: string; points: number }
  /** Private: your guess was one letter away. */
  | { type: 'CLOSE'; guess: string }
  | { type: 'REVEAL'; result: TurnResult; scores: SeatMap<number> }
  | { type: 'MATCH_OVER'; scores: SeatMap<number> };

/** Everything one seat may know. */
export interface DrawView {
  phase: Phase;
  round: number;
  rounds: number;
  turn: number;
  drawer: number;
  phaseEndsAt: number;
  phaseMs: number;
  /** Your word cards (drawer, while choosing). */
  options: WordOption[];
  /** The word: for the drawer, for players who guessed it, and for everyone at the reveal. */
  word: string | null;
  /** Blanks with spaces/hyphens and revealed letters, e.g. "_ a _" → "_a_". */
  pattern: string;
  /** Seats that guessed it this turn, in order. */
  guessed: Guessed[];
  /** Wrong guesses this turn (they were shown in chat). */
  wrong: string[];
  /** Strokes drawn this turn (public). */
  strokes: number;
  scores: SeatMap<number>;
  lastTurn: TurnResult | null;
}

export interface DrawSettings {
  rounds: number;
}
