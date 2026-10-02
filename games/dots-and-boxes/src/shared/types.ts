/**
 * Dots & Boxes — shared types (engine, bot and board).
 * Rules: docs/GAME_RULES/DOTS_AND_BOXES.md. Design: docs/design/DOTS_AND_BOXES_DESIGN.md.
 */

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

/** Grid sizes in boxes per side; 5×5 is the default. */
export const GRID_SIZES = [4, 5, 7] as const;
export type GridSize = (typeof GRID_SIZES)[number];
export const DEFAULT_GRID: GridSize = 5;

export type SeatMap<T> = Record<number, T>;

/**
 * A line between two neighbouring dots: `h:r:c` joins dots (r, c)–(r, c+1),
 * `v:r:c` joins (r, c)–(r+1, c). Dots are (row, column), 0…n each way.
 */
export type EdgeId = `h:${number}:${number}` | `v:${number}:${number}`;

export interface DotsSettings {
  grid: GridSize;
}

export interface LastMove {
  edge: EdgeId;
  seat: number;
  /** Boxes (indices) this move closed. */
  boxes: number[];
}

export interface DotsState {
  phase: 'PLAYING' | 'OVER';
  /** Boxes per side. */
  n: number;
  seats: number[];
  /** Whose move it is. */
  turn: number;
  /** Horizontal lines, index r·n + c (r 0…n, c 0…n−1): who drew it, or null. */
  h: (number | null)[];
  /** Vertical lines, index r·(n+1) + c (r 0…n−1, c 0…n): who drew it, or null. */
  v: (number | null)[];
  /** Boxes, index r·n + c: owner, or null. */
  boxes: (number | null)[];
  scores: SeatMap<number>;
  /** Boxes closed in the current player's uninterrupted streak (0 = a fresh turn). */
  chain: number;
  moves: number;
  lastMove: LastMove | null;
  /** When the current player's turn began (server ms) — for the inactivity nudge. */
  turnStartedAt: number;
  /** Inactivity before the seat is handed to a bot (ms). */
  afkMs: number;
}

export type DotsAction = { type: 'DRAW'; edge: EdgeId };

export type DotsEvent =
  | { type: 'EDGE_DRAWN'; edge: EdgeId; seat: number }
  | { type: 'BOXES_CLAIMED'; seat: number; boxes: number[]; chain: number }
  | { type: 'TURN'; seat: number; again: boolean }
  | { type: 'MATCH_OVER'; scores: SeatMap<number> };

/** Everything is public in Dots & Boxes: the view is the whole board. */
export type DotsView = DotsState;
