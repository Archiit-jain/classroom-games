/**
 * 16 Parchi — shared types (engine, bot and board).
 * Rules: docs/GAME_RULES/16_PARCHI.md (spec §11).
 */

export const PLAYERS = 4;
export const CHITS_PER_PLAYER = 4;
export const COPIES_PER_ITEM = 4;
export const TOTAL_CHITS = PLAYERS * CHITS_PER_PLAYER; // 16

export type Phase =
  | 'DEALING'
  | 'SELECTING'
  | 'PASSING'
  | 'CLAIM_WINDOW'
  /** Short hold after a claim window so the claim animation can finish (spec §15). */
  | 'CLAIM_HOLD'
  | 'OVER';

export interface ParchiTiming {
  dealMs: number;
  selectMs: number;
  /** After every active player has selected, the pass waits this long. */
  settleMs: number;
  passMs: number;
  claimMs: number;
  claimHoldMs: number;
}

export type SeatMap<T> = Record<number, T>;

/**
 * A slip in someone's hand. `handle` is a fresh random id each time the slip
 * enters a hand (re-keyed per holder), so nobody can follow a slip around the
 * table and stale actions cannot select a different slip.
 */
export interface Chit {
  handle: string;
  item: string;
}

export type FinishReason =
  /** Claimed in the claim window. */
  | 'CLAIM'
  /** Was eligible but the claim window ran out. */
  | 'AUTO_CLAIM'
  /** The last player left in the circle. */
  | 'LAST'
  /** The 100-cycle safety cap ended the match. */
  | 'CAP';

/** A player who has left the circle. Public: the set is revealed at the claim. */
export interface Finish {
  seat: number;
  /** 1-based; every seat gets a distinct place. */
  place: number;
  /** The four items the player finished with (four of a kind unless `reason` is CAP). */
  items: string[];
  reason: FinishReason;
  /** Passing cycles completed when the player finished. */
  cycle: number;
}

export interface ParchiState {
  phase: Phase;
  seats: number[];
  categoryId: string;
  /** The category's four item ids, in pack order. */
  items: string[];
  /** Hands of active seats only. */
  hands: SeatMap<Chit[]>;
  /** Selected handle per active seat for the current cycle. */
  selections: SeatMap<string>;
  /** Seats still in the circle, in seat (clockwise) order. */
  active: number[];
  /** During CLAIM_WINDOW: seats holding four of a kind that have not claimed yet. */
  eligible: number[];
  finishes: Finish[];
  /** Passing cycles completed. */
  cycle: number;
  cycleCap: number;
  /** Consecutive auto-picks per seat (idle detection). */
  autoPicks: SeatMap<number>;
  phaseEndsAt: number;
  phaseMs: number;
  timing: ParchiTiming;
  endedByCap: boolean;
}

export type ParchiAction = { type: 'SELECT'; handle: string } | { type: 'CLAIM' };

export interface PassMove {
  from: number;
  to: number;
}

export type ParchiEvent =
  /** Private: your four slips. */
  | { type: 'DEALT'; hand: Chit[] }
  /** Public: a seat has chosen a slip (first choice of the cycle only — never which one). */
  | { type: 'SEAT_SELECTED'; seat: number }
  /** Private: the slip you (or the timeout, `auto`) chose — your own item, so it is safe to name. */
  | { type: 'MY_SELECTION'; handle: string; item: string; auto: boolean }
  /** Public: folded slips moved one seat clockwise. No items. */
  | { type: 'PASS_RESOLVED'; moves: PassMove[]; cycle: number }
  /** Private (sender): your selected slip left your hand. */
  | { type: 'CHIT_SENT'; handle: string; to: number }
  /** Private (receiver): the slip that arrived, under its new handle. */
  | { type: 'CHIT_RECEIVED'; handle: string; item: string; from: number }
  /** Public: someone holds a full set — nobody is told who. */
  | { type: 'CLAIM_WINDOW_OPENED'; deadline: number }
  /** Private: you may claim. */
  | { type: 'YOU_CAN_CLAIM' }
  /** Public: a player finished and their set is revealed. */
  | { type: 'CLAIM_ACCEPTED'; seat: number; place: number; items: string[]; reason: FinishReason }
  /** Public: the seats still passing. */
  | { type: 'CIRCLE_CHANGED'; active: number[] }
  | { type: 'MATCH_OVER'; placements: { seat: number; place: number }[]; endedByCap: boolean };

/** Everything one seat may know. */
export interface ParchiView {
  phase: Phase;
  categoryId: string;
  items: string[];
  cycle: number;
  cycleCap: number;
  phaseEndsAt: number;
  phaseMs: number;
  active: number[];
  /** Your slips (empty once you have finished). */
  hand: Chit[];
  mySelection: string | null;
  /** Active seats that have chosen a slip this cycle. */
  selected: number[];
  /** True only for you, and only while you hold an unclaimed full set in a claim window. */
  canClaim: boolean;
  finishes: Finish[];
  endedByCap: boolean;
}

export interface ParchiSettings {
  /** A category id, or 'RANDOM'. */
  category: string;
}

/** Next active seat clockwise (the seat you pass to). */
export function nextActive(active: readonly number[], seat: number): number {
  const sorted = [...active].sort((a, b) => a - b);
  return sorted.find((s) => s > seat) ?? (sorted[0] as number);
}

/** Previous active seat (the seat you receive from). */
export function previousActive(active: readonly number[], seat: number): number {
  const sorted = [...active].sort((a, b) => b - a);
  return sorted.find((s) => s < seat) ?? (sorted[0] as number);
}

/** How many of each item a hand holds. */
export function countItems(hand: readonly Chit[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const chit of hand) counts.set(chit.item, (counts.get(chit.item) ?? 0) + 1);
  return counts;
}

export function isFullSet(hand: readonly Chit[] | undefined): boolean {
  return !!hand && hand.length === CHITS_PER_PLAYER && hand.every((c) => c.item === hand[0]?.item);
}

/** Size of the largest same-item group. */
export function largestGroup(hand: readonly Chit[]): number {
  return Math.max(0, ...countItems(hand).values());
}
