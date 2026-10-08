import type { Deck, Economy } from './board';

export type SeatMap<T> = Record<number, T>;

export interface BusinessSettings {
  /** Custom number of rounds (MIN_ROUNDS–MAX_ROUNDS). */
  rounds: number;
  /** Only India Classic exists in v1; the field keeps room for future boards. */
  board: 'india-classic';
  /** Only Normal in v1 (the four physical event spaces). */
  eventFrequency: 'normal';
}

/** Durations in ms (play-test values; scaled in development and e2e). */
export interface BusinessTiming {
  /** Every decision a player makes on their turn (frozen: 30 s). */
  turnMs: number;
  /** The dice tumble before the pawn starts moving. */
  diceMs: number;
  /** Token travel per space, held by the server so the board catches up. */
  hopMs: number;
  /** Reading time after landing (payments, building) before the next step. */
  landingMs: number;
  /** Event card reveal. */
  eventMs: number;
  auctionMs: number;
  /** A late bid resets the auction clock to this. */
  auctionExtendMs: number;
  auctionMaxMs: number;
  tradeMs: number;
  /** A skipped turn ("lose your next roll") is shown this long. */
  skipMs: number;
}

export type Phase = 'ROLL' | 'EVENT' | 'DECIDE' | 'RAISE' | 'AUCTION' | 'TRADE' | 'HOLD' | 'OVER';

export interface Spending {
  /** Cumulative money spent on cities (bank purchases, winning bids, trade cash). */
  property: number;
  /** Cumulative money spent on houses and hotels. */
  development: number;
  /** Cumulative money spent on transport. */
  transport: number;
}

export interface PlayerState {
  cash: number;
  debt: number;
  position: number;
  spend: Spending;
  /** Lose the next roll (Jail wait, events). */
  skipNext: boolean;
  /** "Cannot buy on your next turn" (set) and "this turn" (active). */
  noBuyNext: boolean;
  noBuyActive: boolean;
  /** The next rent this player owes is waived. */
  rentHoliday: boolean;
  /** Went insolvent (cleared at their next START salary). */
  insolvent: boolean;
  /** Consecutive automatic actions (idle detection). */
  autoActs: number;
}

export interface Decision {
  kind: 'BUY' | 'BUILD' | 'JAIL' | 'FREE_BUILD';
  /** The space the player stands on. */
  space: number;
  /** BUY: the price; BUILD: the next level's cost; JAIL: the fee; FREE_BUILD: 0. */
  cost: number;
  /** FREE_BUILD: the player's cities that can take one more level. */
  options?: number[];
}

export type PayReason = 'rent' | 'transport' | 'event' | 'club' | 'resort' | 'jail' | 'debt';

export interface Payment {
  to: number | null;
  amount: number;
  reason: PayReason;
  space?: number;
}

export interface Offer {
  cash: number;
  assets: number[];
}

export interface Auction {
  seller: number;
  space: number;
  /** The lowest acceptable first bid. */
  open: number;
  high: { seat: number; amount: number } | null;
  startedAt: number;
  endsAt: number;
  /** Where the seller's turn continues afterwards. */
  returnTo: 'ROLL' | 'RAISE';
}

export interface Trade {
  from: number;
  to: number;
  give: Offer;
  get: Offer;
  endsAt: number;
}

export interface FinalWealth {
  cash: number;
  property: number;
  development: number;
  transport: number;
  total: number;
}

/** A public line of the game log (what Reduced motion and the event feed show). */
export type LogEntry =
  | { type: 'ROLLED'; seat: number; dice: number[]; to: number }
  | { type: 'SALARY'; seat: number; amount: number }
  | { type: 'BOUGHT'; seat: number; space: number; price: number }
  | { type: 'BUILT'; seat: number; space: number; level: number; cost: number }
  | {
      type: 'PAID';
      from: number;
      to: number | null;
      amount: number;
      reason: PayReason;
      space?: number;
      writtenOff: number;
    }
  | { type: 'GAINED'; seat: number; amount: number; reason: 'event' | 'club' }
  | { type: 'EVENT'; seat: number; deck: Deck; sum: number; good: boolean }
  | { type: 'RENT_WAIVED'; seat: number; space: number; amount: number }
  | { type: 'NO_BUY'; seat: number; space: number }
  | { type: 'MOVED'; seat: number; to: number }
  | { type: 'JAIL'; seat: number; paid: boolean }
  | { type: 'TURN_SKIPPED'; seat: number }
  | { type: 'DECLINED'; seat: number; space: number }
  | { type: 'LOAN'; seat: number; amount: number; debt: number }
  | { type: 'REPAID'; seat: number; amount: number; debt: number }
  | { type: 'SOLD'; seat: number; space: number; what: 'building' | 'asset'; value: number }
  | { type: 'AUCTION'; seller: number; space: number; open: number }
  | { type: 'BID'; seat: number; amount: number }
  | { type: 'AUCTION_WON'; seller: number; space: number; seat: number; amount: number }
  | { type: 'AUCTION_UNSOLD'; seller: number; space: number }
  | { type: 'TRADE_OFFER'; from: number; to: number }
  | { type: 'TRADE_DONE'; from: number; to: number; give: Offer; get: Offer }
  | { type: 'TRADE_DECLINED'; from: number; to: number }
  | { type: 'INSOLVENT'; seat: number; writtenOff: number }
  | { type: 'SETTLED'; seat: number; repaid: number };

export interface BusinessState {
  phase: Phase;
  board: 'india-classic';
  eventFrequency: 'normal';
  seats: number[];
  /** Turn order, starting with the seeded first player. */
  order: number[];
  rounds: number;
  round: number;
  /** Turns started so far; every action carries it (stale-intent guard). */
  turn: number;
  current: number;
  players: SeatMap<PlayerState>;
  /** Per board space: owning seat or null. */
  owner: (number | null)[];
  /** Per board space: 0 none, 1–3 houses, 4 hotel. */
  level: number[];
  /** Per board space: the round until which the asset can't be auctioned or traded again. */
  lockedUntil: number[];
  decision: Decision | null;
  /** The current player's unpaid dues while raising money. */
  raise: { payments: Payment[]; total: number } | null;
  auction: Auction | null;
  trade: Trade | null;
  auctionsThisTurn: number;
  tradesThisTurn: number;
  /** The last dice (movement or event) — the board shows them. */
  lastRoll: { seat: number; dice: number[]; kind: 'move' | 'event'; turn: number } | null;
  lastEvent: {
    seat: number;
    deck: 'chance' | 'chest';
    sum: number;
    good: boolean;
    turn: number;
  } | null;
  log: LogEntry[];
  economy: Economy;
  timing: BusinessTiming;
  phaseEndsAt: number;
  phaseMs: number;
  /** Net money the bank paid out (salary, loans, gains, sales) minus what it took in. */
  bankNet: number;
  /** Amounts owed but never paid (insolvency). */
  writtenOff: number;
  final: SeatMap<FinalWealth> | null;
}

export type BusinessAction =
  | { type: 'ROLL'; turn: number }
  | { type: 'EVENT_ROLL'; turn: number }
  | { type: 'BUY'; turn: number; space: number }
  | { type: 'BUILD'; turn: number; space: number }
  | { type: 'FREE_BUILD'; turn: number; space: number }
  | { type: 'SKIP'; turn: number }
  | { type: 'JAIL_PAY'; turn: number }
  | { type: 'JAIL_WAIT'; turn: number }
  | { type: 'LOAN'; turn: number; amount: number }
  | { type: 'REPAY'; turn: number; amount: number }
  | { type: 'SELL_BUILDING'; turn: number; space: number }
  | { type: 'SELL_ASSET'; turn: number; space: number }
  | { type: 'BANK_HANDLES_IT'; turn: number }
  | { type: 'AUCTION_START'; turn: number; space: number }
  | { type: 'BID'; turn: number; amount: number }
  | { type: 'TRADE_PROPOSE'; turn: number; to: number; give: Offer; get: Offer }
  | { type: 'TRADE_ANSWER'; turn: number; accept: boolean };

export type BusinessEvent =
  | { type: 'TURN'; seat: number; round: number; turn: number; skipped: boolean }
  | {
      type: 'ROLLED';
      seat: number;
      dice: number[];
      kind: 'move' | 'event';
      from: number;
      to: number;
      path: number[];
    }
  | { type: 'LOG'; entry: LogEntry }
  | { type: 'MATCH_OVER'; final: SeatMap<FinalWealth> };

/** Everything in Business is public (dice are rolled on the server; there is no deck). */
export interface BusinessView extends BusinessState {
  /** Live score by the final-wealth formula. */
  wealth: SeatMap<number>;
  /** How much each player may still borrow right now. */
  canBorrow: SeatMap<number>;
}
