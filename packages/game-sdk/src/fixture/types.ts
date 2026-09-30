/**
 * "Count Up" — the platform fixture game. NOT a product game: it exists to
 * exercise the runtime (hidden info, turns, timers, idle requests, bots,
 * results) and is never registered in production.
 *
 * Rules: players take turns adding 1–3 to a shared counter. Whoever brings
 * the counter to the target (or beyond) wins. Every player also holds a secret
 * "lucky number" that only they can see until the match ends.
 */

export interface FixtureSettings {
  target: number;
  turnSeconds: number;
}

export type FixtureAction = { type: 'ADD'; amount: 1 | 2 | 3 };

export type FixtureEvent =
  | { type: 'LUCKY_DEALT'; lucky: number }
  | { type: 'TURN_STARTED'; seat: number; deadline: number }
  | { type: 'ADDED'; seat: number; amount: number; counter: number; auto: boolean }
  | { type: 'MATCH_OVER'; winner: number; lucky: Record<number, number> };

export interface FixtureMove {
  seat: number;
  amount: number;
  auto: boolean;
}

export interface FixtureState {
  phase: 'PLAYING' | 'OVER';
  seats: number[];
  counter: number;
  target: number;
  turnMs: number;
  turn: number;
  turnDeadline: number;
  /** Hidden: each seat sees only its own entry until the match is over. */
  lucky: Record<number, number>;
  /** Consecutive turn timeouts per seat, for idle detection. */
  timeouts: Record<number, number>;
  lastMove: FixtureMove | null;
  winner: number | null;
}

export interface FixtureView {
  phase: 'PLAYING' | 'OVER';
  counter: number;
  target: number;
  turn: number;
  turnDeadline: number;
  yourLucky: number;
  lastMove: FixtureMove | null;
  winner: number | null;
  /** All lucky numbers, only once the match is over. */
  revealedLucky: Record<number, number> | null;
}

export interface FixtureBotMemory {
  movesSeen: number;
}
