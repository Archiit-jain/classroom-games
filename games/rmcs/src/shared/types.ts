/**
 * Raja Mantri Chor Sipahi — shared types (engine, bot and board).
 * Rules: docs/GAME_RULES/RAJA_MANTRI_CHOR_SIPAHI.md (spec §10).
 */

export type Role = 'RAJA' | 'MANTRI' | 'SIPAHI' | 'CHOR';

export const ROLES: readonly Role[] = ['RAJA', 'MANTRI', 'SIPAHI', 'CHOR'];

/** Points for a round. The Mantri and the Chor depend on the guess (see `scoreRound`). */
export const RAJA_POINTS = 1000;
export const MANTRI_POINTS = 800;
export const SIPAHI_POINTS = 500;
export const ROUND_TOTAL = RAJA_POINTS + MANTRI_POINTS + SIPAHI_POINTS; // 2300

export const TOTAL_ROUNDS = 10;

export type Phase =
  'DEALING' | 'REVEAL_RAJA' | 'REVEAL_MANTRI' | 'GUESSING' | 'ROUND_RESULT' | 'OVER';

export const PHASE_ORDER: readonly Phase[] = [
  'DEALING',
  'REVEAL_RAJA',
  'REVEAL_MANTRI',
  'GUESSING',
  'ROUND_RESULT',
  'OVER',
];

export interface RmcsTiming {
  dealMs: number;
  revealMs: number;
  guessMs: number;
  resultMs: number;
}

export type SeatMap<T> = Record<number, T>;

/** A resolved round. Public: every role is revealed once a round is resolved. */
export interface RoundRecord {
  round: number;
  roles: SeatMap<Role>;
  mantri: number;
  chor: number;
  target: number;
  correct: boolean;
  /** The Mantri ran out of time and the server guessed for them. */
  auto: boolean;
  deltas: SeatMap<number>;
}

export interface RmcsState {
  phase: Phase;
  seats: number[];
  round: number;
  roles: SeatMap<Role>;
  scores: SeatMap<number>;
  /** Server time the current phase ends, and its total length (for countdowns). */
  phaseEndsAt: number;
  phaseMs: number;
  timing: RmcsTiming;
  /** Consecutive guessing timeouts per seat (idle detection). */
  timeouts: SeatMap<number>;
  history: RoundRecord[];
}

export type RmcsAction = { type: 'GUESS'; target: number };

export type RmcsEvent =
  | { type: 'ROUND_STARTED'; round: number }
  /** Private: only to the seat that received the role. */
  | { type: 'ROLE_DEALT'; role: Role }
  | { type: 'RAJA_REVEALED'; seat: number }
  | { type: 'MANTRI_REVEALED'; seat: number }
  | { type: 'GUESSING_STARTED'; mantri: number; deadline: number }
  | { type: 'GUESS_MADE'; mantri: number; target: number; auto: boolean }
  | {
      type: 'ROUND_RESOLVED';
      round: number;
      roles: SeatMap<Role>;
      correct: boolean;
      deltas: SeatMap<number>;
      scores: SeatMap<number>;
    }
  | { type: 'MATCH_OVER'; scores: SeatMap<number> };

/** Everything one seat may know. */
export interface RmcsView {
  phase: Phase;
  round: number;
  totalRounds: number;
  phaseEndsAt: number;
  phaseMs: number;
  myRole: Role;
  /** Roles this seat may see: its own, revealed Raja/Mantri, everything after the result. */
  known: SeatMap<Role>;
  raja: number | null;
  mantri: number | null;
  /** The two seats the Mantri chooses between (once the Mantri is revealed). */
  candidates: number[];
  scores: SeatMap<number>;
  /** Resolved rounds, newest last (public). */
  history: RoundRecord[];
}

export type RmcsSettings = Record<string, never>;
