/**
 * Business (working title) — the India Classic board, economy and events.
 * Rules: docs/GAME_RULES/BUSINESS.md. Design: docs/design/BUSINESS_REDESIGN.md.
 * Structure and mechanics are frozen by the owner; every amount is a play-test value
 * tuned by the economy simulation.
 */

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const MIN_ROUNDS = 5;
export const MAX_ROUNDS = 40;
export const DEFAULT_ROUNDS = 15;

export type Group = 'A' | 'B' | 'C' | 'D';
export const GROUPS: readonly Group[] = ['A', 'B', 'C', 'D'];
export type TransportId =
  'railways' | 'roadways' | 'waterways' | 'airways' | 'petroleum' | 'satellite';
export type Deck = 'chance' | 'chest';
export type CornerId = 'start' | 'jail' | 'club' | 'resort';

export type Space =
  | { kind: 'corner'; corner: CornerId }
  | { kind: 'city'; id: string; group: Group; price: number }
  | { kind: 'transport'; id: TransportId }
  | { kind: 'event'; deck: Deck };

const city = (id: string, group: Group, price: number): Space => ({
  kind: 'city',
  id,
  group,
  price,
});
const transport = (id: TransportId): Space => ({ kind: 'transport', id });

/**
 * The India Classic board: 36 spaces, played clockwise, corners at 0 / 9 / 18 / 27.
 * Sides 1 and 3: 5 cities + 2 transports + 1 event; sides 2 and 4: 6 cities + 1 transport
 * + 1 event. Events alternate Chance → Community Chest → Chance → Community Chest.
 */
export const BOARD: readonly Space[] = [
  { kind: 'corner', corner: 'start' },
  city('patna', 'C', 600),
  city('ranchi', 'C', 600),
  transport('railways'),
  city('bhubaneswar', 'C', 700),
  { kind: 'event', deck: 'chance' },
  city('guwahati', 'C', 700),
  transport('roadways'),
  city('kolkata', 'C', 900),
  { kind: 'corner', corner: 'jail' },
  city('kochi', 'B', 1000),
  city('thiruvananthapuram', 'B', 1000),
  city('visakhapatnam', 'B', 1100),
  { kind: 'event', deck: 'chest' },
  city('chennai', 'B', 1300),
  transport('waterways'),
  city('hyderabad', 'B', 1400),
  city('bengaluru', 'B', 1500),
  { kind: 'corner', corner: 'club' },
  city('goa', 'D', 1600),
  city('surat', 'D', 1600),
  transport('airways'),
  city('pune', 'D', 1800),
  { kind: 'event', deck: 'chance' },
  city('ahmedabad', 'D', 1900),
  transport('petroleum'),
  city('mumbai', 'D', 2400),
  { kind: 'corner', corner: 'resort' },
  city('jammu', 'A', 2000),
  city('dehradun', 'A', 2000),
  city('lucknow', 'A', 2100),
  { kind: 'event', deck: 'chest' },
  city('jaipur', 'A', 2200),
  transport('satellite'),
  city('chandigarh', 'A', 2300),
  city('delhi', 'A', 2800),
];
export const BOARD_SIZE = BOARD.length;
export const SIDE = 9;
export const CORNER_SPACE: Record<CornerId, number> = { start: 0, jail: 9, club: 18, resort: 27 };

/** Building levels: 0 none, 1–3 houses, 4 hotel. */
export const HOTEL = 4;

export interface Economy {
  startCash: number;
  /** Paid when passing or landing on START. */
  salary: number;
  clubCollect: number;
  resortPay: number;
  jailFee: number;
  /** Base rent as a share of the city price. */
  rentShare: number;
  /** Rent multiplier by level: empty, 1–3 houses, hotel. */
  levelMultipliers: readonly [number, number, number, number, number];
  /** Rent multiplier when the owner holds at least `groupThreshold` cities of the group. */
  groupMultiplier: number;
  groupThreshold: number;
  /** A house costs this share of the city price; the hotel `hotelShare`. */
  houseShare: number;
  hotelShare: number;
  transportPrice: number;
  /** Transport fee by number of transports the owner holds (index 0 = one). */
  transportRent: readonly number[];
  loanStep: number;
  loanFee: number;
  loanBase: number;
  /** Property-backed borrowing: share of the list value of what you own. */
  loanBacking: number;
  /** Sales back to the bank return this share of what was paid. */
  sellBack: number;
  auctionOpenShare: number;
  auctionLockRounds: number;
}

/** Tuned by the economy simulation (BUSINESS_REDESIGN.md §20); still play-test values. */
export const DEFAULT_ECONOMY: Economy = {
  startCash: 10_500,
  salary: 1500,
  clubCollect: 200,
  resortPay: 200,
  jailFee: 500,
  rentShare: 0.4,
  levelMultipliers: [1, 3, 6, 10, 15],
  groupMultiplier: 2,
  groupThreshold: 3,
  houseShare: 0.4,
  hotelShare: 0.8,
  transportPrice: 1500,
  transportRent: [300, 700, 1200, 1800, 2500, 3200],
  loanStep: 1000,
  loanFee: 0.1,
  loanBase: 3000,
  loanBacking: 0.5,
  sellBack: 0.5,
  auctionOpenShare: 0.5,
  auctionLockRounds: 3,
};

export const round10 = (n: number) => Math.round(n / 10) * 10;
export const isCity = (s: Space | undefined): s is Extract<Space, { kind: 'city' }> =>
  s?.kind === 'city';
export const isTransport = (s: Space | undefined): s is Extract<Space, { kind: 'transport' }> =>
  s?.kind === 'transport';
export const isAsset = (s: Space | undefined) => isCity(s) || isTransport(s);

export const ASSET_SPACES = BOARD.flatMap((s, i) => (isAsset(s) ? [i] : []));
export const CITY_SPACES = BOARD.flatMap((s, i) => (isCity(s) ? [i] : []));
export const TRANSPORT_SPACES = BOARD.flatMap((s, i) => (isTransport(s) ? [i] : []));
export const groupSpaces = (g: Group) =>
  BOARD.flatMap((s, i) => (isCity(s) && s.group === g ? [i] : []));
export const groupOf = (i: number): Group | null => {
  const s = BOARD[i];
  return isCity(s) ? s.group : null;
};

export const priceOf = (i: number, e: Economy = DEFAULT_ECONOMY): number => {
  const s = BOARD[i];
  if (isCity(s)) return s.price;
  if (isTransport(s)) return e.transportPrice;
  return 0;
};
/** Cost of building from `level` to `level + 1`. */
export const buildCost = (i: number, level: number, e: Economy = DEFAULT_ECONOMY): number =>
  round10(priceOf(i, e) * (level + 1 >= HOTEL ? e.hotelShare : e.houseShare));
/** What all the buildings on a city at `level` cost. */
export const buildingsValue = (i: number, level: number, e: Economy = DEFAULT_ECONOMY) => {
  let total = 0;
  for (let l = 0; l < level; l++) total += buildCost(i, l, e);
  return total;
};
export const baseRent = (i: number, e: Economy = DEFAULT_ECONOMY) =>
  round10(priceOf(i, e) * e.rentShare);
export const cityRent = (
  i: number,
  level: number,
  groupBonus: boolean,
  e: Economy = DEFAULT_ECONOMY,
) => baseRent(i, e) * (e.levelMultipliers[level] ?? 1) * (groupBonus ? e.groupMultiplier : 1);
export const transportRent = (owned: number, e: Economy = DEFAULT_ECONOMY) =>
  e.transportRent[Math.max(1, Math.min(owned, e.transportRent.length)) - 1] ?? 0;

/**
 * Grid cell of a space on a 10 × 10 board (row 0 = top). START is bottom-left; play runs
 * clockwise: up the left side, along the top, down the right side, back along the bottom.
 */
export function cellOf(i: number): { row: number; col: number } {
  if (i <= 9) return { row: 9 - i, col: 0 };
  if (i <= 18) return { row: 0, col: i - 9 };
  if (i <= 27) return { row: i - 18, col: 9 };
  return { row: 9, col: 36 - i };
}
export const sideOf = (i: number): 0 | 1 | 2 | 3 =>
  Math.min(3, Math.floor(i / SIDE)) as 0 | 1 | 2 | 3;

// ───────────────────────────── events ─────────────────────────────

export type EventEffect =
  | { kind: 'gain'; amount: number }
  | { kind: 'pay'; amount: number }
  | { kind: 'collectEach'; amount: number }
  | { kind: 'payEach'; amount: number }
  | { kind: 'freeBuilding'; fallback: number }
  | { kind: 'skipNextRoll' }
  | { kind: 'toStart' }
  | { kind: 'repairs'; perHouse: number; perHotel: number; max: number }
  | { kind: 'noBuyNextTurn' }
  | { kind: 'rentHoliday' };

export interface EventOutcome {
  deck: Deck;
  sum: number;
  good: boolean;
  effect: EventEffect;
}

/** Chance: even sum good, odd bad. Community Chest: odd good, even bad. */
export const isGood = (deck: Deck, sum: number) =>
  deck === 'chance' ? sum % 2 === 0 : sum % 2 === 1;

const CHANCE: Record<number, EventEffect> = {
  2: { kind: 'gain', amount: 1500 },
  3: { kind: 'pay', amount: 1000 },
  4: { kind: 'collectEach', amount: 200 },
  5: { kind: 'payEach', amount: 300 },
  6: { kind: 'gain', amount: 500 },
  7: { kind: 'pay', amount: 200 },
  8: { kind: 'freeBuilding', fallback: 600 },
  9: { kind: 'skipNextRoll' },
  10: { kind: 'toStart' },
  11: { kind: 'repairs', perHouse: 100, perHotel: 250, max: 1500 },
  12: { kind: 'gain', amount: 1000 },
};
const CHEST: Record<number, EventEffect> = {
  2: { kind: 'pay', amount: 1500 },
  3: { kind: 'gain', amount: 1000 },
  4: { kind: 'payEach', amount: 200 },
  5: { kind: 'collectEach', amount: 150 },
  6: { kind: 'pay', amount: 400 },
  7: { kind: 'gain', amount: 300 },
  8: { kind: 'noBuyNextTurn' },
  9: { kind: 'rentHoliday' },
  10: { kind: 'skipNextRoll' },
  11: { kind: 'freeBuilding', fallback: 600 },
  12: { kind: 'pay', amount: 800 },
};
export const EVENT_SUMS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
/** The one deterministic outcome for a deck and a dice sum. */
export const eventOutcome = (deck: Deck, sum: number): EventOutcome => ({
  deck,
  sum,
  good: isGood(deck, sum),
  effect: (deck === 'chance' ? CHANCE : CHEST)[sum] as EventEffect,
});
