import { createRng } from '@cg/game-sdk';
import {
  BOARD,
  CARDS,
  OWNABLE_SPACES,
  REGIONS,
  developCost,
  isCity,
  priceOf,
  regionOf,
  type Economy,
  type Region,
} from '../shared/board';
import type { BusinessEvent, BusinessState, LogEntry } from '../shared/types';
import { createBusinessGame, wealthOf, type BusinessOptions } from './engine';

/**
 * The economy simulation (design §10): complete bot-only matches through the real
 * engine and bot, measured. Pure and fast (no harness overhead); used by the
 * economy tests and `pnpm --filter @cg/game-business sim`.
 */
export interface SimulationConfig {
  games: number;
  seed: number;
  players?: number[];
  rounds?: (12 | 16 | 20)[];
  economy?: Partial<Economy>;
  /** Replace every card with a no-op (to measure what cards do). */
  noCards?: boolean;
}

export interface EconomyReport {
  games: number;
  meanWealth: number;
  /** Mean of each game's coefficient of variation of final wealth. */
  meanSpread: number;
  /** Winner's wealth / runner-up's, averaged. */
  meanWinMargin: number;
  /** Games where the leader after the first third won by more than 2× second place. */
  runawayRate: number;
  /** Games won by the leader after the first third. */
  earlyLeaderWinRate: number;
  /** Player-games ending with nothing (0 coins, no property). */
  brokeRate: number;
  /** Clearance sales per game. */
  clearancePerGame: number;
  /** Share of turns that began with the current player under 100 coins. */
  lowCashTurnRate: number;
  writtenOffPerGame: number;
  meanTurns: number;
  /** Estimated minutes at human pace (≈ 9 s per turn). */
  estimatedMinutes: number;
  /** Share of games each ownable space was owned at the end. */
  ownedAtEnd: Record<string, number>;
  /** Mean final development level of each city when owned. */
  meanLevel: Record<string, number>;
  /** Per region: fees collected / coins invested (price + development) by owners. */
  regionReturn: Record<Region, number>;
  industryReturn: number;
  /** Coins moved per card draw (mean absolute effect on the drawing player). */
  cardsDrawnPerGame: number;
}

const HUMAN_SECONDS_PER_TURN = 9;

export function simulateEconomy(config: SimulationConfig): EconomyReport {
  const rng = createRng(config.seed);
  const noOps = CARDS.map((c) => ({ ...c, effect: { kind: 'gain' as const, amount: 0 } }));
  const options: BusinessOptions = {
    ...(config.economy ? { economy: config.economy } : {}),
    ...(config.noCards ? { cards: noOps } : {}),
  };
  const game = createBusinessGame(options);
  const playersChoice = config.players ?? [2, 3, 4, 5, 6];
  const roundsChoice = config.rounds ?? [16];

  let wealthSum = 0;
  let wealthN = 0;
  let spreadSum = 0;
  let marginSum = 0;
  let runaway = 0;
  let earlyWins = 0;
  let broke = 0;
  let playerGames = 0;
  let clearances = 0;
  let turns = 0;
  let lowCash = 0;
  let writtenOff = 0;
  let cardsDrawn = 0;
  const owned: Record<string, number> = {};
  const levelSum: Record<string, number> = {};
  const levelN: Record<string, number> = {};
  const feesByRegion: Record<string, number> = {};
  const investByRegion: Record<string, number> = {};

  for (let g = 0; g < config.games; g++) {
    const seats = Array.from({ length: rng.pick(playersChoice) }, (_, i) => i);
    const rounds = rng.pick(roundsChoice);
    const gameRng = createRng(rng.int(1, 2 ** 30));
    let now = 0;
    const ctx = () => ({ now, rng: gameRng });
    let t = game.setup(seats, { rounds }, ctx(), { bots: seats });
    let s: BusinessState = t.state;
    const third = Math.ceil(rounds / 3);
    let earlyLeader = -1;
    const seen = (events: readonly { event: BusinessEvent }[]) => {
      for (const { event } of events) {
        if (event.type !== 'LOG') continue;
        const e: LogEntry = event.entry;
        if (e.type === 'CLEARANCE') clearances++;
        if (e.type === 'CARD') cardsDrawn++;
        if (e.type === 'PAID' && e.reason === 'fee' && e.space !== undefined) {
          const region = regionOf(e.space) as Region;
          feesByRegion[region] = (feesByRegion[region] ?? 0) + e.amount;
        }
        if (e.type === 'PAID' && e.reason === 'factory') {
          feesByRegion.industry = (feesByRegion.industry ?? 0) + e.amount;
        }
        if (e.type === 'DIVIDEND') feesByRegion.industry = (feesByRegion.industry ?? 0) + e.amount;
        if (e.type === 'BOUGHT' || (e.type === 'DEVELOPED' && e.cost > 0)) {
          const key = regionOf(e.space) ?? 'industry';
          investByRegion[key] =
            (investByRegion[key] ?? 0) + (e.type === 'BOUGHT' ? e.price : e.cost);
        }
      }
    };
    seen(t.events);
    let guard = 0;
    while (s.phase !== 'OVER') {
      if (++guard > 10_000) throw new Error('simulation did not finish');
      now += 1000;
      if (s.phase === 'ROLL') {
        turns++;
        if ((s.coins[s.current] ?? 0) < 100) lowCash++;
        if (s.round === third + 1 && earlyLeader < 0) {
          earlyLeader = [...seats].sort((a, b) => wealthOf(s, b) - wealthOf(s, a))[0] as number;
        }
      }
      if (s.phase === 'HOLD') {
        t = game.onTimer(s, 'phase', ctx());
      } else {
        const d = game.bot.decide(game.getPlayerView(s, s.current), null, {
          seat: s.current,
          now,
          rng: gameRng,
        });
        if (!d || d.kind !== 'ACTION') throw new Error('bot did not act');
        const verdict = game.validateAction(s, s.current, d.action);
        if (!verdict.ok) throw new Error(`bot action rejected: ${verdict.code}`);
        t = game.applyAction(s, s.current, d.action, ctx());
      }
      s = t.state;
      seen(t.events);
    }

    const wealth = seats.map((x) => wealthOf(s, x));
    const mean = wealth.reduce((a, b) => a + b, 0) / wealth.length;
    const sd = Math.sqrt(wealth.reduce((a, b) => a + (b - mean) ** 2, 0) / wealth.length);
    wealthSum += wealth.reduce((a, b) => a + b, 0);
    wealthN += wealth.length;
    spreadSum += mean > 0 ? sd / mean : 0;
    const sorted = [...wealth].sort((a, b) => b - a);
    marginSum += (sorted[0] ?? 0) / Math.max(1, sorted[1] ?? 1);
    const winner = seats[wealth.indexOf(sorted[0] as number)] as number;
    if (earlyLeader === winner) {
      earlyWins++;
      if ((sorted[0] ?? 0) > 2 * (sorted[1] ?? 0)) runaway++;
    }
    for (const x of seats) {
      playerGames++;
      if ((s.coins[x] ?? 0) === 0 && OWNABLE_SPACES.every((i) => s.owner[i] !== x)) broke++;
    }
    writtenOff += s.writtenOff;
    for (const i of OWNABLE_SPACES) {
      const key = String(i);
      if (s.owner[i] !== null) {
        owned[key] = (owned[key] ?? 0) + 1;
        if (isCity(BOARD[i])) {
          levelSum[key] = (levelSum[key] ?? 0) + (s.level[i] ?? 0);
          levelN[key] = (levelN[key] ?? 0) + 1;
        }
      }
    }
  }

  const name = (i: number) => {
    const b = BOARD[i];
    return b?.kind === 'city' || b?.kind === 'industry' ? b.id : String(i);
  };
  const n = config.games;
  return {
    games: n,
    meanWealth: Math.round(wealthSum / wealthN),
    meanSpread: +(spreadSum / n).toFixed(3),
    meanWinMargin: +(marginSum / n).toFixed(2),
    runawayRate: +(runaway / n).toFixed(3),
    earlyLeaderWinRate: +(earlyWins / n).toFixed(3),
    brokeRate: +(broke / playerGames).toFixed(4),
    clearancePerGame: +(clearances / n).toFixed(2),
    lowCashTurnRate: +(lowCash / turns).toFixed(4),
    writtenOffPerGame: Math.round(writtenOff / n),
    meanTurns: Math.round(turns / n),
    estimatedMinutes: +(((turns / n) * HUMAN_SECONDS_PER_TURN) / 60).toFixed(1),
    ownedAtEnd: Object.fromEntries(
      OWNABLE_SPACES.map((i) => [name(i), +((owned[String(i)] ?? 0) / n).toFixed(2)]),
    ),
    meanLevel: Object.fromEntries(
      OWNABLE_SPACES.filter((i) => isCity(BOARD[i])).map((i) => [
        name(i),
        +((levelSum[String(i)] ?? 0) / Math.max(1, levelN[String(i)] ?? 0)).toFixed(2),
      ]),
    ),
    regionReturn: Object.fromEntries(
      REGIONS.map((r) => [
        r,
        +((feesByRegion[r] ?? 0) / Math.max(1, investByRegion[r] ?? 1)).toFixed(2),
      ]),
    ) as Record<Region, number>,
    industryReturn: +(
      (feesByRegion.industry ?? 0) / Math.max(1, investByRegion.industry ?? 1)
    ).toFixed(2),
    cardsDrawnPerGame: +(cardsDrawn / n).toFixed(1),
  };
}

/** Investment needed to fully develop a city (for reports). */
export const fullCost = (i: number, e?: Economy) => priceOf(i, e) + 3 * developCost(i, e);
