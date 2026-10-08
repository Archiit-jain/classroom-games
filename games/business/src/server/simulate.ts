import { createRng, type SeededRng, type TimerCommand } from '@cg/game-sdk';
import {
  ASSET_SPACES,
  BOARD,
  CITY_SPACES,
  GROUPS,
  HOTEL,
  TRANSPORT_SPACES,
  groupOf,
  type Economy,
  type Group,
} from '../shared/board';
import type { BusinessAction, BusinessEvent, BusinessState, LogEntry } from '../shared/types';
import { createBusinessGame, wealthOf, type BusinessOptions } from './engine';

/**
 * The economy simulation (BUSINESS_REDESIGN.md §20): complete matches through the
 * real engine, bots and timers, measured. `casual` seats imitate relaxed human play
 * (random buying, fewer buildings, occasional auctions) so guardrails and auctions are
 * measured too; bot-only numbers are a sanity check, not the target.
 */
export interface SimulationConfig {
  games: number;
  seed: number;
  players?: number[];
  rounds?: number[];
  economy?: Partial<Economy>;
  eventsOff?: boolean;
  /** Share of seats played "casually" (0–1). */
  casual?: number;
}

export interface EconomyReport {
  games: number;
  meanWealth: number;
  /** Mean coefficient of variation of final wealth. */
  meanSpread: number;
  earlyLeaderWinRate: number;
  /** Winner over 2× the runner-up, having led after the first third. */
  runawayRate: number;
  insolventRate: number;
  loansPerGame: number;
  meanDebtBeforeSettle: number;
  tradesPerGame: number;
  auctionsPerGame: number;
  auctionSoldRate: number;
  /** Share of final wealth that came from trades/auctions between players. */
  transferShare: number;
  ownedAtEnd: number;
  transportOwnedAtEnd: number;
  housesPerGame: number;
  hotelsPerGame: number;
  /** Mean coins moved by events per game (absolute). */
  eventMoneyPerGame: number;
  jailPayRate: number;
  meanTurns: number;
  /** At ≈ 11 s a turn (human pace with animations). */
  estimatedMinutes: number;
  /** Purchase rate per group (owned at the end). */
  groupOwned: Record<Group, number>;
  /** Mean final level of owned cities per group. */
  groupLevel: Record<Group, number>;
  /** Share of cities owned at the end, by price tier. */
  tierOwned: Record<Tier, number>;
  /** Share of cities bought from the bank at least once in a game, by price tier. */
  tierBought: Record<Tier, number>;
  /** Mean round in which a city of the tier was first bought (when bought). */
  tierFirstRound: Record<Tier, number>;
  /** Share of games each transport was owned at the end. */
  transportOwned: Record<string, number>;
}

/** City price tiers for the report. */
export type Tier = 'cheap' | 'lowMid' | 'mid' | 'high' | 'premium';
export const TIERS: readonly Tier[] = ['cheap', 'lowMid', 'mid', 'high', 'premium'];
export const tierOf = (price: number): Tier =>
  price <= 2500
    ? 'cheap'
    : price <= 3800
      ? 'lowMid'
      : price <= 5400
        ? 'mid'
        : price <= 7200
          ? 'high'
          : 'premium';

/** Human pace including dice, the space-by-space walk and decisions. */
const HUMAN_SECONDS_PER_TURN = 12;

/** A relaxed "human" player: more random buying, fewer buildings, occasional auctions. */
function casualAction(
  s: BusinessState,
  seat: number,
  rng: SeededRng,
  bot: () => BusinessAction | null,
): BusinessAction | null {
  const me = s.players[seat];
  if (!me || s.current !== seat) return bot();
  if (s.phase === 'ROLL' && s.auctionsThisTurn === 0 && rng.int(1, 40) === 1) {
    const mine = ASSET_SPACES.filter(
      (i) => s.owner[i] === seat && (s.lockedUntil[i] ?? 0) <= s.round,
    );
    if (mine.length > 0) return { type: 'AUCTION_START', turn: s.turn, space: rng.pick(mine) };
  }
  if (
    s.phase === 'DECIDE' &&
    s.decision &&
    (s.decision.kind === 'BUY' || s.decision.kind === 'BUILD')
  ) {
    const d = s.decision;
    // One level per landing, on a 45 % whim.
    const wants = d.kind === 'BUY' ? rng.int(1, 100) <= 70 : rng.int(1, 100) <= 45;
    if (wants && me.cash >= d.cost) {
      return d.kind === 'BUY'
        ? { type: 'BUY', turn: s.turn, space: d.space }
        : { type: 'BUILD', turn: s.turn, space: d.space };
    }
    return { type: 'SKIP', turn: s.turn };
  }
  return bot();
}

export function simulateEconomy(config: SimulationConfig): EconomyReport {
  const rng = createRng(config.seed);
  const options: BusinessOptions = {
    ...(config.economy ? { economy: config.economy } : {}),
    ...(config.eventsOff ? { eventsOff: true } : {}),
  };
  const game = createBusinessGame(options);
  const players = config.players ?? [2, 3, 4, 5, 6];
  const roundsChoice = config.rounds ?? [15];
  const totals = {
    wealth: 0,
    wealthN: 0,
    spread: 0,
    early: 0,
    runaway: 0,
    insolvent: 0,
    playerGames: 0,
    loans: 0,
    debt: 0,
    trades: 0,
    auctions: 0,
    sold: 0,
    transfers: 0,
    finalSum: 0,
    owned: 0,
    transports: 0,
    houses: 0,
    hotels: 0,
    eventMoney: 0,
    jailPay: 0,
    jailTotal: 0,
    turns: 0,
  };
  const groupOwned: Record<string, number> = {};
  const tierOwned: Record<string, number> = {};
  const tierBought: Record<string, number> = {};
  const tierFirstSum: Record<string, number> = {};
  const tierFirstN: Record<string, number> = {};
  const transportOwned: Record<string, number> = {};
  const groupLevelSum: Record<string, number> = {};
  const groupLevelN: Record<string, number> = {};

  for (let g = 0; g < config.games; g++) {
    const seats = Array.from({ length: rng.pick(players) }, (_, i) => i);
    const rounds = rng.pick(roundsChoice);
    const casual = new Set(seats.filter(() => rng.int(1, 1000) <= (config.casual ?? 0) * 1000));
    const gameRng = createRng(rng.int(1, 2 ** 30));
    let now = 0;
    const timers = new Map<string, number>();
    const track = (cmds: readonly TimerCommand[] | undefined) => {
      for (const c of cmds ?? []) {
        if ('set' in c) timers.set(c.set, now + c.ms);
        else timers.delete(c.clear);
      }
    };
    let t = game.setup(
      seats,
      { rounds, board: 'india-classic', eventFrequency: 'normal' },
      { now, rng: gameRng },
      { bots: seats },
    );
    let s: BusinessState = t.state;
    track(t.timers);
    const third = Math.ceil(rounds / 3);
    let early = -1;
    let debtPeak = 0;
    const boughtHere = new Set<number>();
    const observe = (events: readonly { event: BusinessEvent }[]) => {
      for (const { event } of events) {
        if (event.type === 'TURN') totals.turns++;
        if (event.type !== 'LOG') continue;
        const e: LogEntry = event.entry;
        if (e.type === 'LOAN') totals.loans++;
        if (e.type === 'BOUGHT' && !boughtHere.has(e.space)) {
          boughtHere.add(e.space);
          const b = BOARD[e.space];
          if (b?.kind === 'city') {
            const tier = tierOf(b.price);
            tierBought[tier] = (tierBought[tier] ?? 0) + 1;
            tierFirstSum[tier] = (tierFirstSum[tier] ?? 0) + s.round;
            tierFirstN[tier] = (tierFirstN[tier] ?? 0) + 1;
          }
        }
        if (e.type === 'TRADE_DONE') {
          totals.trades++;
          totals.transfers += e.give.cash + e.get.cash;
        }
        if (e.type === 'AUCTION') totals.auctions++;
        if (e.type === 'AUCTION_WON') {
          totals.sold++;
          totals.transfers += e.amount;
        }
        if (e.type === 'JAIL') {
          totals.jailTotal++;
          if (e.paid) totals.jailPay++;
        }
        if (e.type === 'GAINED' && e.reason === 'event') totals.eventMoney += e.amount;
        if (e.type === 'PAID' && e.reason === 'event') totals.eventMoney += e.amount;
      }
    };
    observe(t.events);
    let guard = 0;
    while (s.phase !== 'OVER') {
      if (++guard > 50_000) throw new Error('simulation did not finish');
      if (s.round === third + 1 && early < 0) {
        early = [...seats].sort((a, b) => wealthOf(s, b).total - wealthOf(s, a).total)[0] as number;
      }
      // The earliest bot action (by think time) or the next timer.
      let best: { seat: number; action: BusinessAction; at: number } | null = null;
      for (const seat of seats) {
        const view = game.getPlayerView(s, seat);
        const viaBot = () => {
          const d = game.bot.decide(view, null, { seat, now, rng: gameRng });
          return d && d.kind === 'ACTION' ? d.action : null;
        };
        const action = casual.has(seat) ? casualAction(s, seat, gameRng, viaBot) : viaBot();
        if (!action) continue;
        const at = now + gameRng.int(300, 2000);
        if (!best || at < best.at) best = { seat, action, at };
      }
      const next = [...timers.entries()].sort((a, b) => a[1] - b[1])[0];
      if (best && (!next || best.at < next[1])) {
        now = best.at;
        const v = game.validateAction(s, best.seat, best.action);
        if (!v.ok) {
          // A stale casual intent (e.g. an auction that just became impossible): skip it.
          if (casual.has(best.seat)) continue;
          throw new Error(`bot action rejected: ${v.code} ${JSON.stringify(best.action)}`);
        }
        t = game.applyAction(s, best.seat, best.action, { now, rng: gameRng });
      } else if (next) {
        now = Math.max(now, next[1]);
        timers.delete(next[0]);
        t = game.onTimer(s, next[0], { now, rng: gameRng });
      } else {
        throw new Error('simulation stalled');
      }
      s = t.state;
      track(t.timers);
      observe(t.events);
      if (s.phase !== 'OVER') {
        for (const x of seats) debtPeak = Math.max(debtPeak, s.players[x]?.debt ?? 0);
      }
    }

    const final = seats.map((x) => s.final?.[x]?.total ?? 0);
    const mean = final.reduce((a, b) => a + b, 0) / final.length;
    const sd = Math.sqrt(final.reduce((a, b) => a + (b - mean) ** 2, 0) / final.length);
    totals.wealth += final.reduce((a, b) => a + b, 0);
    totals.finalSum += final.reduce((a, b) => a + b, 0);
    totals.wealthN += final.length;
    totals.spread += mean > 0 ? sd / mean : 0;
    totals.debt += debtPeak;
    const sorted = [...final].sort((a, b) => b - a);
    const winner = seats[final.indexOf(sorted[0] as number)] as number;
    if (early === winner) {
      totals.early++;
      if ((sorted[0] ?? 0) > 2 * (sorted[1] ?? 0)) totals.runaway++;
    }
    for (const x of seats) {
      totals.playerGames++;
      if (s.log.some((e) => e.type === 'INSOLVENT' && e.seat === x) || s.players[x]?.insolvent) {
        totals.insolvent++;
      }
    }
    totals.owned += ASSET_SPACES.filter((i) => s.owner[i] !== null).length / ASSET_SPACES.length;
    totals.transports +=
      TRANSPORT_SPACES.filter((i) => s.owner[i] !== null).length / TRANSPORT_SPACES.length;
    for (const i of TRANSPORT_SPACES) {
      const b = BOARD[i];
      if (b?.kind === 'transport' && s.owner[i] !== null)
        transportOwned[b.id] = (transportOwned[b.id] ?? 0) + 1;
    }
    for (const i of CITY_SPACES) {
      const lv = s.level[i] ?? 0;
      if (lv === HOTEL) totals.hotels++;
      else totals.houses += lv;
      const group = groupOf(i) as Group;
      const b = BOARD[i];
      const tier = tierOf(b?.kind === 'city' ? b.price : 0);
      if (s.owner[i] !== null) tierOwned[tier] = (tierOwned[tier] ?? 0) + 1;
      if (s.owner[i] !== null) {
        groupOwned[group] = (groupOwned[group] ?? 0) + 1;
        groupLevelSum[group] = (groupLevelSum[group] ?? 0) + lv;
        groupLevelN[group] = (groupLevelN[group] ?? 0) + 1;
      }
    }
  }

  const n = config.games;
  const groupSize = (gr: Group) => CITY_SPACES.filter((i) => groupOf(i) === gr).length;
  const tierSize = (t: Tier) =>
    CITY_SPACES.filter((i) => {
      const b = BOARD[i];
      return b?.kind === 'city' && tierOf(b.price) === t;
    }).length;
  const r3 = (x: number) => +x.toFixed(3);
  return {
    games: n,
    meanWealth: Math.round(totals.wealth / totals.wealthN),
    meanSpread: r3(totals.spread / n),
    earlyLeaderWinRate: r3(totals.early / n),
    runawayRate: r3(totals.runaway / n),
    insolventRate: r3(totals.insolvent / totals.playerGames),
    loansPerGame: +(totals.loans / n).toFixed(2),
    meanDebtBeforeSettle: Math.round(totals.debt / n),
    tradesPerGame: +(totals.trades / n).toFixed(2),
    auctionsPerGame: +(totals.auctions / n).toFixed(2),
    auctionSoldRate: r3(totals.sold / Math.max(1, totals.auctions)),
    transferShare: r3(totals.transfers / Math.max(1, totals.finalSum)),
    ownedAtEnd: r3(totals.owned / n),
    transportOwnedAtEnd: r3(totals.transports / n),
    housesPerGame: +(totals.houses / n).toFixed(1),
    hotelsPerGame: +(totals.hotels / n).toFixed(1),
    eventMoneyPerGame: Math.round(totals.eventMoney / n),
    jailPayRate: r3(totals.jailPay / Math.max(1, totals.jailTotal)),
    meanTurns: Math.round(totals.turns / n),
    estimatedMinutes: +(((totals.turns / n) * HUMAN_SECONDS_PER_TURN) / 60).toFixed(1),
    groupOwned: Object.fromEntries(
      GROUPS.map((gr) => [gr, r3((groupOwned[gr] ?? 0) / (n * groupSize(gr)))]),
    ) as Record<Group, number>,
    tierOwned: Object.fromEntries(
      TIERS.map((t) => [t, r3((tierOwned[t] ?? 0) / (n * tierSize(t)))]),
    ) as Record<Tier, number>,
    tierBought: Object.fromEntries(
      TIERS.map((t) => [t, r3((tierBought[t] ?? 0) / (n * tierSize(t)))]),
    ) as Record<Tier, number>,
    tierFirstRound: Object.fromEntries(
      TIERS.map((t) => [t, +((tierFirstSum[t] ?? 0) / Math.max(1, tierFirstN[t] ?? 0)).toFixed(1)]),
    ) as Record<Tier, number>,
    transportOwned: Object.fromEntries(
      Object.entries(transportOwned).map(([k, v]) => [k, r3(v / n)]),
    ),
    groupLevel: Object.fromEntries(
      GROUPS.map((gr) => [
        gr,
        +((groupLevelSum[gr] ?? 0) / Math.max(1, groupLevelN[gr] ?? 0)).toFixed(2),
      ]),
    ) as Record<Group, number>,
  };
}

export const BOARD_FOR_REPORTS = BOARD;
