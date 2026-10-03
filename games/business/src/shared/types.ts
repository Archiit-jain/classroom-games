import type { Deck, Economy, RoundCount, WheelSlice } from './board';

export type SeatMap<T> = Record<number, T>;

export interface BusinessSettings {
  rounds: RoundCount;
}

/** Durations in ms (play-test values; scaled in development and e2e). */
export interface BusinessTiming {
  rollMs: number;
  decideMs: number;
  /** Animation time per hop of a token. */
  hopMs: number;
  /** Extra time to read a landing (card, payment) before the game moves on. */
  landingMs: number;
}

export type Phase = 'ROLL' | 'DECIDE' | 'HOLD' | 'OVER';

export interface Choice {
  space: number;
  cost: number;
}

/**
 * What the current player may do now. BUY / DEVELOP: the space they stand on.
 * EXPAND (after passing or landing on Start): develop any one of their cities.
 */
export interface Decision {
  kind: 'BUY' | 'DEVELOP' | 'EXPAND';
  options: Choice[];
}

export interface DeckState {
  /** Cards still to draw (top = first). Hidden from every view. */
  draw: string[];
  discard: string[];
}

/** A public line of the game log (also what Reduced motion relies on). */
export type LogEntry =
  | { type: 'ROLLED'; seat: number; dice: number[]; to: number }
  | { type: 'SALARY'; seat: number; amount: number }
  | { type: 'DIVIDEND'; seat: number; amount: number }
  | { type: 'BOUGHT'; seat: number; space: number; price: number }
  | { type: 'DEVELOPED'; seat: number; space: number; level: number; cost: number }
  | {
      type: 'PAID';
      from: number;
      to: number | null;
      amount: number;
      reason: PayReason;
      space?: number;
      writtenOff: number;
    }
  | { type: 'GAINED'; seat: number; amount: number; reason: 'card' | 'wheel' }
  | { type: 'CARD'; seat: number; deck: Deck; card: string }
  | { type: 'WHEEL'; seat: number; slice: number }
  | { type: 'MOVED'; seat: number; from: number; to: number }
  | { type: 'JAM'; seat: number }
  | { type: 'CLEARANCE'; seat: number; sold: Sold[]; raised: number }
  | { type: 'SKIPPED'; seat: number; space: number };

export type PayReason = 'fee' | 'factory' | 'card';

export interface Sold {
  space: number;
  /** A development level, or the whole place. */
  what: 'level' | 'place';
  value: number;
}

export interface BusinessState {
  phase: Phase;
  seats: number[];
  /** Turn order, starting with the seeded first player. */
  order: number[];
  rounds: number;
  round: number;
  /** Turns played so far (stale-intent guard: actions carry it). */
  turn: number;
  current: number;
  positions: SeatMap<number>;
  coins: SeatMap<number>;
  /** Per board space: owning seat or null (corners and card spaces stay null). */
  owner: (number | null)[];
  /** Per board space: development level 1–4 for owned cities, 0 otherwise. */
  level: number[];
  /** Seats whose next roll uses one die (Traffic Jam). */
  slow: number[];
  decks: Record<Deck, DeckState>;
  decision: Decision | null;
  /** The current player passed Start this turn and may still expand. */
  expandDue: boolean;
  lastRoll: { seat: number; dice: number[]; from: number; to: number } | null;
  /** Consecutive automatic actions per seat (idle detection). */
  autoActs: SeatMap<number>;
  log: LogEntry[];
  economy: Economy;
  timing: BusinessTiming;
  phaseEndsAt: number;
  phaseMs: number;
  /** Net coins the bank has paid out (salary, dividends, gains minus payments to it). */
  bankNet: number;
  /** Coins owed but written off (never paid by anyone). */
  writtenOff: number;
}

export type BusinessAction =
  | { type: 'ROLL'; turn: number }
  | { type: 'BUY'; turn: number; space: number }
  | { type: 'DEVELOP'; turn: number; space: number }
  | { type: 'SKIP'; turn: number };

export type BusinessEvent =
  | { type: 'TURN'; seat: number; round: number; turn: number }
  | { type: 'ROLLED'; seat: number; dice: number[]; from: number; to: number; path: number[] }
  | { type: 'LOG'; entry: LogEntry }
  | { type: 'MATCH_OVER'; wealth: SeatMap<number> };

/** Everything is public except the deck order (and the RNG). */
export interface BusinessView extends Omit<BusinessState, 'decks'> {
  decks: Record<Deck, { left: number }>;
  wealth: SeatMap<number>;
}

export type { WheelSlice };
