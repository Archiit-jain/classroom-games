/**
 * Business (working title) — the board, the economy and the cards.
 * Rules: docs/GAME_RULES/BUSINESS.md. Design: docs/design/BUSINESS_DESIGN.md.
 * Every number here is a play-test value tuned by the economy simulation.
 */

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const ROUND_OPTIONS = [12, 16, 20] as const;
export type RoundCount = (typeof ROUND_OPTIONS)[number];

export type Region = 'central' | 'east' | 'north' | 'south' | 'west';
export const REGIONS: readonly Region[] = ['central', 'east', 'north', 'south', 'west'];
export type IndustryId = 'tea' | 'textile' | 'film';
export type Deck = 'news' | 'mela';
export type CornerId = 'start' | 'chai' | 'jam' | 'lucky';

export type Space =
  | { kind: 'corner'; corner: CornerId }
  | { kind: 'city'; id: string; region: Region; price: number }
  | { kind: 'industry'; id: IndustryId }
  | { kind: 'card'; deck: Deck };

/**
 * The 28-space "ring road", clockwise from the top-left corner of a 6 × 10 board:
 * top 0–5, right 5–14, bottom 14–19, left 19–27.
 */
export const BOARD: readonly Space[] = [
  { kind: 'corner', corner: 'start' },
  { kind: 'city', id: 'indore', region: 'central', price: 100 },
  { kind: 'card', deck: 'news' },
  { kind: 'city', id: 'bhopal', region: 'central', price: 110 },
  { kind: 'city', id: 'nagpur', region: 'central', price: 120 },
  { kind: 'corner', corner: 'chai' },
  { kind: 'city', id: 'bhubaneswar', region: 'east', price: 140 },
  { kind: 'card', deck: 'mela' },
  { kind: 'city', id: 'guwahati', region: 'east', price: 150 },
  { kind: 'industry', id: 'tea' },
  { kind: 'city', id: 'kolkata', region: 'east', price: 170 },
  { kind: 'card', deck: 'news' },
  { kind: 'city', id: 'lucknow', region: 'north', price: 190 },
  { kind: 'city', id: 'chandigarh', region: 'north', price: 200 },
  { kind: 'corner', corner: 'jam' },
  { kind: 'city', id: 'delhi', region: 'north', price: 230 },
  { kind: 'industry', id: 'textile' },
  { kind: 'card', deck: 'mela' },
  { kind: 'city', id: 'kochi', region: 'south', price: 240 },
  { kind: 'corner', corner: 'lucky' },
  { kind: 'city', id: 'chennai', region: 'south', price: 250 },
  { kind: 'card', deck: 'news' },
  { kind: 'city', id: 'bengaluru', region: 'south', price: 270 },
  { kind: 'industry', id: 'film' },
  { kind: 'city', id: 'jaipur', region: 'west', price: 290 },
  { kind: 'card', deck: 'mela' },
  { kind: 'city', id: 'ahmedabad', region: 'west', price: 300 },
  { kind: 'city', id: 'mumbai', region: 'west', price: 340 },
];
export const BOARD_SIZE = BOARD.length;
/** Board geometry: tiles across the short side and along the long side. */
export const BOARD_COLS = 6;
export const BOARD_ROWS = 10;

/** Development levels; 0 = owned by nobody. */
export const LEVELS = ['stall', 'shop', 'showroom', 'mall'] as const;
export type LevelName = (typeof LEVELS)[number];
export const MAX_LEVEL = 4;

export interface Economy {
  startCoins: number;
  salary: number;
  /** Visitor fee at Stall level, as a share of the city's price. */
  feeShare: number;
  /** Fee multiplier per level (index 0 = Stall). */
  levelMultipliers: readonly [number, number, number, number];
  /** Cost of each development level, as a share of the city's price. */
  developShare: number;
  /** Fee multiplier when the owner holds the whole region. */
  regionBonus: number;
  industryPrice: number;
  /** Paid to the owner per industry when passing or landing on Start. */
  dividend: number;
  /** Extra dividend for owning all three industries. */
  dividendSetBonus: number;
  /** Fee per industry the owner has, paid by a visitor. */
  factoryVisit: number;
  /** Clearance sales return this share of what was paid. */
  sellBack: number;
}

/** Tuned by the economy simulation (design §10); still play-test values. */
export const DEFAULT_ECONOMY: Economy = {
  startCoins: 1200,
  salary: 150,
  feeShare: 0.25,
  levelMultipliers: [1, 3, 5, 8],
  developShare: 0.5,
  regionBonus: 1.5,
  industryPrice: 200,
  dividend: 25,
  dividendSetBonus: 40,
  factoryVisit: 20,
  sellBack: 0.5,
};

/** Rounds to the nearest 5 coins (amounts stay simple). */
export const round5 = (n: number) => Math.round(n / 5) * 5;

export const isCity = (s: Space | undefined): s is Extract<Space, { kind: 'city' }> =>
  s?.kind === 'city';
export const isIndustry = (s: Space | undefined): s is Extract<Space, { kind: 'industry' }> =>
  s?.kind === 'industry';
export const isOwnable = (s: Space | undefined) => isCity(s) || isIndustry(s);

export const priceOf = (index: number, e: Economy = DEFAULT_ECONOMY): number => {
  const s = BOARD[index];
  if (isCity(s)) return s.price;
  if (isIndustry(s)) return e.industryPrice;
  return 0;
};
export const developCost = (index: number, e: Economy = DEFAULT_ECONOMY): number =>
  isCity(BOARD[index]) ? round5(priceOf(index, e) * e.developShare) : 0;

export const regionOf = (index: number): Region | null => {
  const s = BOARD[index];
  return isCity(s) ? s.region : null;
};
export const regionSpaces = (region: Region): number[] =>
  BOARD.flatMap((s, i) => (isCity(s) && s.region === region ? [i] : []));
export const INDUSTRY_SPACES = BOARD.flatMap((s, i) => (isIndustry(s) ? [i] : []));
export const OWNABLE_SPACES = BOARD.flatMap((s, i) => (isOwnable(s) ? [i] : []));
export const CORNER_SPACE: Record<CornerId, number> = {
  start: 0,
  chai: 5,
  jam: 14,
  lucky: 19,
};

/** Visitor fee for a city at `level` (1–4), with or without the region bonus. */
export function cityFee(
  index: number,
  level: number,
  wholeRegion: boolean,
  e: Economy = DEFAULT_ECONOMY,
): number {
  const base = priceOf(index, e) * e.feeShare * (e.levelMultipliers[level - 1] ?? 1);
  return round5(wholeRegion ? base * e.regionBonus : base);
}

/**
 * The (row, col) of a space on the 6 × 10 portrait board: row 0 is the top edge.
 * The client turns it for landscape.
 */
export function tilePosition(index: number): { row: number; col: number } {
  const lastCol = BOARD_COLS - 1;
  const lastRow = BOARD_ROWS - 1;
  if (index <= lastCol) return { row: 0, col: index }; // top, left → right
  if (index <= lastCol + lastRow) return { row: index - lastCol, col: lastCol }; // right, down
  if (index <= 2 * lastCol + lastRow)
    return { row: lastRow, col: lastCol - (index - lastCol - lastRow) }; // bottom, right → left
  return { row: lastRow - (index - 2 * lastCol - lastRow), col: 0 }; // left, up
}

// ───────────────────────────── cards ─────────────────────────────

/** What a card does. Texts live in the client's messages (`card.N1` …). */
export type CardEffect =
  | { kind: 'gain'; amount: number }
  | { kind: 'pay'; amount: number }
  | { kind: 'payPerLevel'; amount: number; max: number }
  | { kind: 'everyone'; amount: number }
  | { kind: 'payEachOther'; amount: number }
  | { kind: 'collectEachOther'; amount: number }
  | { kind: 'industryOwner'; industry: IndustryId; amount: number }
  | { kind: 'perIndustry'; amount: number; min: number }
  | { kind: 'regionOwners'; region: Region; amount: number }
  | { kind: 'mallOwners'; amount: number }
  | { kind: 'move'; steps: number }
  | { kind: 'toStart' }
  | { kind: 'freeLevel'; fallback: number };

export interface Card {
  id: string;
  deck: Deck;
  effect: CardEffect;
}

export const CARDS: readonly Card[] = [
  { id: 'N1', deck: 'news', effect: { kind: 'industryOwner', industry: 'tea', amount: 100 } },
  { id: 'N2', deck: 'news', effect: { kind: 'gain', amount: 80 } },
  { id: 'N3', deck: 'news', effect: { kind: 'pay', amount: 40 } },
  { id: 'N4', deck: 'news', effect: { kind: 'payPerLevel', amount: 15, max: 120 } },
  { id: 'N5', deck: 'news', effect: { kind: 'mallOwners', amount: 50 } },
  { id: 'N6', deck: 'news', effect: { kind: 'perIndustry', amount: 40, min: 40 } },
  { id: 'N7', deck: 'news', effect: { kind: 'regionOwners', region: 'south', amount: 30 } },
  { id: 'N8', deck: 'news', effect: { kind: 'regionOwners', region: 'west', amount: -20 } },
  { id: 'N9', deck: 'news', effect: { kind: 'everyone', amount: -25 } },
  { id: 'N10', deck: 'news', effect: { kind: 'move', steps: 4 } },
  { id: 'N11', deck: 'news', effect: { kind: 'industryOwner', industry: 'film', amount: 100 } },
  { id: 'N12', deck: 'news', effect: { kind: 'industryOwner', industry: 'textile', amount: 100 } },
  { id: 'M1', deck: 'mela', effect: { kind: 'gain', amount: 50 } },
  { id: 'M2', deck: 'mela', effect: { kind: 'payEachOther', amount: 10 } },
  { id: 'M3', deck: 'mela', effect: { kind: 'gain', amount: 70 } },
  { id: 'M4', deck: 'mela', effect: { kind: 'collectEachOther', amount: 15 } },
  { id: 'M5', deck: 'mela', effect: { kind: 'move', steps: -3 } },
  { id: 'M6', deck: 'mela', effect: { kind: 'pay', amount: 30 } },
  { id: 'M7', deck: 'mela', effect: { kind: 'freeLevel', fallback: 60 } },
  { id: 'M8', deck: 'mela', effect: { kind: 'gain', amount: 60 } },
  { id: 'M9', deck: 'mela', effect: { kind: 'pay', amount: 20 } },
  { id: 'M10', deck: 'mela', effect: { kind: 'everyone', amount: 30 } },
  { id: 'M11', deck: 'mela', effect: { kind: 'pay', amount: 40 } },
  { id: 'M12', deck: 'mela', effect: { kind: 'toStart' } },
];
export const cardById = (id: string) => CARDS.find((c) => c.id === id) as Card;

/** The Lucky Mela wheel: six equal slices. */
export type WheelSlice = { kind: 'gain'; amount: number } | { kind: 'freeLevel'; fallback: number };
export const WHEEL: readonly WheelSlice[] = [
  { kind: 'gain', amount: 50 },
  { kind: 'gain', amount: 75 },
  { kind: 'gain', amount: 100 },
  { kind: 'gain', amount: 100 },
  { kind: 'gain', amount: 150 },
  { kind: 'freeLevel', fallback: 75 },
];
