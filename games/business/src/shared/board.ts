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
  | { kind: 'transport'; id: TransportId; price: number }
  | { kind: 'event'; deck: Deck };

const city = (id: string, group: Group, price: number): Space => ({
  kind: 'city',
  id,
  group,
  price,
});
const transport = (id: TransportId, price: number): Space => ({ kind: 'transport', id, price });

/**
 * The India Classic board (fixed for every match): 36 spaces numbered in the order the
 * pawn moves, ANTI-CLOCKWISE from START at the bottom-right: up the right side, left
 * across the top, down the left side, right along the bottom. Corners: 0 START, 9 CLUB,
 * 18 RESORT, 27 JAIL. The four city groups are deliberately mixed round all four sides
 * (a group's colour belongs to its cities, not to a side); prices rise round the board.
 * Sides 1 and 3: 5 cities + 2 transports + 1 event; sides 2 and 4: 6 cities + 1 transport
 * + 1 event. Events alternate Chance, Community Chest, Chance, Community Chest.
 */
export const BOARD: readonly Space[] = [
  { kind: 'corner', corner: 'start' },
  // right side, going up
  city('patna', 'C', 1500),
  city('dehradun', 'A', 1700),
  transport('roadways', 3000),
  city('kochi', 'B', 1900),
  { kind: 'event', deck: 'chance' },
  city('ranchi', 'C', 2200),
  transport('railways', 4500),
  city('surat', 'D', 2500),
  { kind: 'corner', corner: 'club' },
  // top, going left
  city('guwahati', 'C', 2800),
  city('jammu', 'A', 3100),
  city('thiruvananthapuram', 'B', 3400),
  { kind: 'event', deck: 'chest' },
  city('goa', 'D', 3800),
  transport('waterways', 6000),
  city('bhubaneswar', 'C', 4200),
  city('visakhapatnam', 'B', 4600),
  { kind: 'corner', corner: 'resort' },
  // left side, going down
  city('lucknow', 'A', 5000),
  city('ahmedabad', 'D', 5400),
  transport('petroleum', 7500),
  city('kolkata', 'C', 5800),
  { kind: 'event', deck: 'chance' },
  city('chandigarh', 'A', 6200),
  transport('satellite', 9000),
  city('chennai', 'B', 6700),
  { kind: 'corner', corner: 'jail' },
  // bottom, going right
  city('pune', 'D', 7200),
  city('hyderabad', 'B', 7700),
  city('jaipur', 'A', 8200),
  { kind: 'event', deck: 'chest' },
  city('bengaluru', 'B', 8700),
  city('mumbai', 'D', 9300),
  transport('airways', 10_500),
  city('delhi', 'A', 9900),
];
export const BOARD_SIZE = BOARD.length;
export const SIDE = 9;
export const CORNER_SPACE: Record<CornerId, number> = { start: 0, club: 9, resort: 18, jail: 27 };

/** Building levels: 0 none, 1-3 houses, 4 hotel (cities only; transports never build). */
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
  /** Rent multiplier by level: empty, 1-3 houses, hotel. */
  levelMultipliers: readonly [number, number, number, number, number];
  /** Rent multiplier when the owner holds at least `groupThreshold` cities of the group. */
  groupMultiplier: number;
  groupThreshold: number;
  /** A house costs this share of the city price; the hotel `hotelShare`. */
  houseShare: number;
  hotelShare: number;
  /** Each transport's own fixed rent (never depends on how many transports the owner has). */
  transportRent: Readonly<Record<TransportId, number>>;
  /** Event money amounts are the deck tables' base amounts times this. */
  eventScale: number;
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

/**
 * Tuned by the economy simulation (BUSINESS_REDESIGN.md section 23); still play-test values.
 * Frozen by the owner: Rs 65,000 start, START Rs 1,500, CLUB / RESORT Rs 200, JAIL Rs 500,
 * Airways Rs 10,500.
 */
export const DEFAULT_ECONOMY: Economy = {
  startCash: 65_000,
  salary: 1500,
  clubCollect: 200,
  resortPay: 200,
  jailFee: 500,
  rentShare: 0.5,
  levelMultipliers: [1, 3, 6, 10, 15],
  groupMultiplier: 2,
  groupThreshold: 3,
  houseShare: 0.3,
  hotelShare: 0.6,
  transportRent: {
    roadways: 1000,
    railways: 1500,
    waterways: 2100,
    petroleum: 2600,
    satellite: 3100,
    airways: 3700,
  },
  eventScale: 5,
  loanStep: 5000,
  loanFee: 0.1,
  loanBase: 20_000,
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

export const priceOf = (i: number, _e: Economy = DEFAULT_ECONOMY): number => {
  const s = BOARD[i];
  return isCity(s) || isTransport(s) ? s.price : 0;
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
/** A transport's own fixed rent. */
export const transportRent = (i: number, e: Economy = DEFAULT_ECONOMY) => {
  const s = BOARD[i];
  return isTransport(s) ? e.transportRent[s.id] : 0;
};

/**
 * Grid cell of a space on a 10 x 10 board (row 0 = top, col 0 = left). START (0) is the
 * bottom-right corner; numbering runs anti-clockwise: up the right side (to 9 CLUB,
 * top-right), left across the top (to 18 RESORT, top-left), down the left side (to 27 JAIL,
 * bottom-left), right along the bottom (to 35, directly left of START).
 */
export function cellOf(i: number): { row: number; col: number } {
  if (i <= 9) return { row: 9 - i, col: 9 };
  if (i <= 18) return { row: 0, col: 18 - i };
  if (i <= 27) return { row: i - 18, col: 0 };
  return { row: 9, col: i - 27 };
}
/** 0 right side (1-8), 1 top (10-17), 2 left side (19-26), 3 bottom (28-35). */
export const sideOf = (i: number): 0 | 1 | 2 | 3 =>
  Math.min(3, Math.floor(i / SIDE)) as 0 | 1 | 2 | 3;
/** Which edge of the board a space sits on. */
export type Edge = 'right' | 'top' | 'left' | 'bottom' | 'corner';
export const edgeOf = (i: number): Edge =>
  i % SIDE === 0 ? 'corner' : (['right', 'top', 'left', 'bottom'] as const)[sideOf(i)];

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

/** Base amounts (the owner's list); play uses them x `Economy.eventScale`. */
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
/** The effect with its money amounts scaled to the economy (base amounts x `eventScale`). */
export function scaleEffect(effect: EventEffect, e: Economy = DEFAULT_ECONOMY): EventEffect {
  const k = (n: number) => round10(n * e.eventScale);
  switch (effect.kind) {
    case 'gain':
    case 'pay':
    case 'collectEach':
    case 'payEach':
      return { ...effect, amount: k(effect.amount) };
    case 'freeBuilding':
      return { ...effect, fallback: k(effect.fallback) };
    case 'repairs':
      return {
        ...effect,
        perHouse: k(effect.perHouse),
        perHotel: k(effect.perHotel),
        max: k(effect.max),
      };
    default:
      return effect;
  }
}

/** The one deterministic outcome for a deck and a dice sum (amounts scaled to the economy). */
export const eventOutcome = (
  deck: Deck,
  sum: number,
  e: Economy = DEFAULT_ECONOMY,
): EventOutcome => ({
  deck,
  sum,
  good: isGood(deck, sum),
  effect: scaleEffect((deck === 'chance' ? CHANCE : CHEST)[sum] as EventEffect, e),
});
