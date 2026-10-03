/**
 * Name Place Animal Thing — shared types (engine, bot and board).
 * Rules: docs/GAME_RULES/NAME_PLACE_ANIMAL_THING.md.
 * Design: docs/design/NAME_PLACE_ANIMAL_THING_DESIGN.md.
 */

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

/** The four categories, in sheet order (product decision, Phase 7). */
export const CATEGORIES = ['name', 'place', 'animal', 'thing'] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * Candidate round letters: A–Z without Q, X and Z (play-test value). A letter is
 * only ever drawn if the answer bank covers it in every category (at least
 * `MIN_BANK_ANSWERS` each) — see `playableLetters` — so bots can always answer.
 */
export const LETTERS = 'ABCDEFGHIJKLMNOPRSTUVWY'.split('');
export const MIN_BANK_ANSWERS = 5;

export const ROUND_OPTIONS = [3, 5, 8, 10] as const;
export type RoundCount = (typeof ROUND_OPTIONS)[number];
/** Frozen (product decision, Phase 7): 90 s to write, STOP allowed after 15 s. */
export const ANSWER_MS = 90_000;
export const STOP_UNLOCK_MS = 15_000;
/** Voting needs at least this many human players; with fewer it is skipped. */
export const MIN_VOTING_HUMANS = 3;

/** Votes needed to reject an answer: a strict majority of the human players (3→2 … 8→5). */
export const votesNeeded = (humans: number) => Math.floor(humans / 2) + 1;

export const MIN_ANSWER_LETTERS = 2;
export const MAX_ANSWER_LENGTH = 30;

/** Points: valid and unique · valid but also given by someone else · blank/invalid/rejected. */
export const POINTS = { unique: 10, shared: 5, none: 0 } as const;

export type SeatMap<T> = Record<number, T>;

/** One player's sheet: only the categories they have written something in. */
export type Answers = Partial<Record<Category, string>>;

export interface NpatSettings {
  rounds: RoundCount;
}

/** Durations in ms (all play-test values; scaled in development and e2e). */
export interface NpatTiming {
  /** "Get ready" before the letter is revealed. */
  letterMs: number;
  answerMs: number;
  /** STOP is allowed this long after writing opens. */
  stopUnlockMs: number;
  /** After writing ends: the last autosaves of what was typed before then. */
  flushMs: number;
  reviewMs: number;
  /** Review length when nobody can vote on anything (a read-only reveal). */
  readOnlyReviewMs: number;
  resultMs: number;
}

export type Phase = 'LETTER' | 'WRITING' | 'LOCKING' | 'REVIEW' | 'ROUND_RESULT' | 'OVER';

/** The automatic check's verdict on one answer. */
export type AnswerStatus = 'BLANK' | 'INVALID' | 'RECOGNISED' | 'UNVERIFIED';
export type InvalidReason = 'LETTER' | 'SHORT' | 'CHARACTERS' | 'NOT_ALLOWED';

export interface CheckedAnswer {
  seat: number;
  /** What everyone sees: trimmed, moderated ('' when blank). */
  text: string;
  status: AnswerStatus;
  reason: InvalidReason | null;
  /** The answer group (identical answers) for valid answers. */
  group: string | null;
}

/** Identical valid answers in one category; voting targets the whole group. */
export interface AnswerGroup {
  id: string;
  category: Category;
  authors: number[];
  recognised: boolean;
}

export interface RoundReview {
  round: number;
  letter: string;
  answers: Record<Category, CheckedAnswer[]>;
  groups: AnswerGroup[];
}

export interface RoundResult {
  round: number;
  letter: string;
  /** Points per seat per category. */
  points: SeatMap<Record<Category, number>>;
  /** Groups rejected by the vote. */
  rejected: string[];
  deltas: SeatMap<number>;
  stoppedBy: number | null;
}

export interface NpatState {
  phase: Phase;
  seats: number[];
  /** Seats played by bots from the start. */
  bots: number[];
  /** Human seats a bot is standing in for right now. */
  controlled: number[];
  /** Human seats whose player is disconnected (in their reconnect grace). */
  away: number[];
  rounds: number;
  round: number;
  /** The round letter; null until writing opens. */
  letter: string | null;
  usedLetters: string[];
  timing: NpatTiming;
  phaseEndsAt: number;
  phaseMs: number;
  stopOpen: boolean;
  /** Private sheets (autosaved drafts, then the locked sheets). Never in another seat's view. */
  drafts: SeatMap<Answers>;
  /** Highest accepted autosave sequence per seat this round. */
  draftSeq: SeatMap<number>;
  /** Seats whose last autosave is still accepted while LOCKING. */
  flush: number[];
  stoppedBy: number | null;
  review: RoundReview | null;
  /** Group id → seats voting it out. */
  votes: Record<string, number[]>;
  done: number[];
  scores: SeatMap<number>;
  /** Unique (10-point) answers per seat, for the results screen. */
  unique: SeatMap<number>;
  emptyRounds: SeatMap<number>;
  last: RoundResult | null;
}

export type NpatAction =
  | { type: 'STOP'; round: number; answers: Answers }
  | { type: 'VOTE'; round: number; group: string; out: boolean }
  | { type: 'DONE'; round: number };

/** Autosave chunk (`match:stream`): the whole sheet so far. */
export interface DraftChunk {
  round: number;
  /**
   * Per seat and round, strictly increasing. The server keeps the sheet with the
   * highest sequence it has accepted, so a late or reordered autosave can never
   * overwrite a newer one.
   */
  seq: number;
  answers: Answers;
}

export type NpatEvent =
  | { type: 'GET_READY'; round: number }
  | { type: 'WRITING_STARTED'; round: number; letter: string; deadline: number }
  | { type: 'STOP_OPEN' }
  | { type: 'STOPPED'; seat: number }
  | { type: 'TIME_UP' }
  | { type: 'REVEALED'; round: number }
  | { type: 'VOTES_CHANGED' }
  | { type: 'ROUND_SCORED'; result: RoundResult; scores: SeatMap<number> }
  | { type: 'MATCH_OVER'; scores: SeatMap<number> };

export interface GroupView extends AnswerGroup {
  /** Votes to reject from players who may vote on it (anonymous). */
  votes: number;
  /** How many players may vote on it (the human players who did not write it). */
  eligible: number;
  /** Votes needed to reject it (strict majority of all human players). */
  needed: number;
  /** I voted it out. */
  mine: boolean;
}

export interface ReviewView {
  round: number;
  letter: string;
  answers: Record<Category, CheckedAnswer[]>;
  groups: GroupView[];
}

export interface NpatView {
  phase: Phase;
  round: number;
  rounds: number;
  letter: string | null;
  categories: readonly Category[];
  phaseEndsAt: number;
  phaseMs: number;
  stopOpen: boolean;
  /** My own saved sheet (never anyone else's before the reveal). */
  mine: Answers;
  /** Sequence of my saved sheet (a reconnecting client continues after it). */
  mineSeq: number;
  stoppedBy: number | null;
  review: ReviewView | null;
  /** I may vote (and tap Done) in this review. */
  canVote: boolean;
  done: number[];
  /** Players whose Done is still needed to end the review early. */
  waitingFor: number[];
  scores: SeatMap<number>;
  unique: SeatMap<number>;
  last: RoundResult | null;
}
