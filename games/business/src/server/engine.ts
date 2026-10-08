import {
  toAll,
  type GameModule,
  type RuntimeRequest,
  type Scoped,
  type SeatIndex,
  type SeededRng,
  type StepCtx,
  type Transition,
} from '@cg/game-sdk';
import { z } from 'zod';
import {
  ASSET_SPACES,
  BOARD,
  BOARD_SIZE,
  CITY_SPACES,
  DEFAULT_ECONOMY,
  DEFAULT_ROUNDS,
  HOTEL,
  MAX_PLAYERS,
  MAX_ROUNDS,
  MIN_PLAYERS,
  MIN_ROUNDS,
  buildCost,
  buildingsValue,
  cityRent,
  eventOutcome,
  groupOf,
  groupSpaces,
  isCity,
  isTransport,
  priceOf,
  round10,
  transportRent,
  type Economy,
} from '../shared/board';
import type {
  BusinessAction,
  BusinessEvent,
  BusinessSettings,
  BusinessState,
  BusinessTiming,
  BusinessView,
  FinalWealth,
  LogEntry,
  Offer,
  Payment,
  PayReason,
  PlayerState,
  SeatMap,
} from '../shared/types';

export const BUSINESS_GAME_ID = 'business';
const PHASE_TIMER = 'phase';
const LOG_SIZE = 40;
const BID_STEP = 100;

/** Play-test values; the 30 s decision time is frozen. */
export const DEFAULT_TIMING: BusinessTiming = {
  turnMs: 30_000,
  diceMs: 900,
  hopMs: 190,
  landingMs: 700,
  eventMs: 1800,
  auctionMs: 15_000,
  auctionExtendMs: 5000,
  auctionMaxMs: 30_000,
  tradeMs: 20_000,
  skipMs: 1400,
};

export interface BusinessOptions {
  /** Multiplies every duration (dev/e2e speed-ups; production uses 1). */
  timeScale?: number;
  timing?: Partial<BusinessTiming>;
  economy?: Partial<Economy>;
  /** Bot delays (ms, scaled). */
  botRollMs?: [number, number];
  botThinkMs?: [number, number];
  /** Share of close buy/build calls a bot gets "wrong". */
  botMistakeRate?: number;
  /** Consecutive automatic actions before a connected player is handed to a bot. */
  idleAfterAutoActs?: number;
  /** Tests only: script the dice (default: fair six-sided dice from the match RNG). */
  dice?: (rng: SeededRng) => [number, number];
  /** Simulation only: events still show their roll but do nothing (measures their impact). */
  eventsOff?: boolean;
}

type T = Transition<BusinessState, BusinessEvent>;

// ───────────────────────────── schemas ─────────────────────────────

const turn = z.number().int().min(0).max(1_000_000);
const space = z
  .number()
  .int()
  .min(0)
  .max(BOARD_SIZE - 1);
const money = z.number().int().min(0).max(10_000_000);
const offer = z.strictObject({
  cash: money,
  assets: z.array(space).max(ASSET_SPACES.length),
});
const actionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ROLL'), turn }),
  z.strictObject({ type: z.literal('EVENT_ROLL'), turn }),
  z.strictObject({ type: z.literal('BUY'), turn, space }),
  z.strictObject({ type: z.literal('BUILD'), turn, space }),
  z.strictObject({ type: z.literal('FREE_BUILD'), turn, space }),
  z.strictObject({ type: z.literal('SKIP'), turn }),
  z.strictObject({ type: z.literal('JAIL_PAY'), turn }),
  z.strictObject({ type: z.literal('JAIL_WAIT'), turn }),
  z.strictObject({ type: z.literal('LOAN'), turn, amount: money }),
  z.strictObject({ type: z.literal('REPAY'), turn, amount: money }),
  z.strictObject({ type: z.literal('SELL_BUILDING'), turn, space }),
  z.strictObject({ type: z.literal('SELL_ASSET'), turn, space }),
  z.strictObject({ type: z.literal('BANK_HANDLES_IT'), turn }),
  z.strictObject({ type: z.literal('AUCTION_START'), turn, space }),
  z.strictObject({ type: z.literal('BID'), turn, amount: money }),
  z.strictObject({
    type: z.literal('TRADE_PROPOSE'),
    turn,
    to: z
      .number()
      .int()
      .min(0)
      .max(MAX_PLAYERS - 1),
    give: offer,
    get: offer,
  }),
  z.strictObject({ type: z.literal('TRADE_ANSWER'), turn, accept: z.boolean() }),
]);

// ───────────────────────────── pure helpers ─────────────────────────────

type Owned = Pick<BusinessState, 'owner' | 'level' | 'economy'>;

export const ownedBy = (s: Pick<BusinessState, 'owner'>, seat: number) =>
  ASSET_SPACES.filter((i) => s.owner[i] === seat);

/** Does `seat` hold enough cities of the group of `space` for the ×2 group rent? */
export function hasGroupBonus(s: Owned, space: number, seat: number): boolean {
  const g = groupOf(space);
  if (!g) return false;
  return groupSpaces(g).filter((i) => s.owner[i] === seat).length >= s.economy.groupThreshold;
}

/** The rent a visitor pays on landing on `space` (0 if unowned). */
export function rentAt(s: Owned, space: number): number {
  const owner = s.owner[space];
  if (owner === null || owner === undefined) return 0;
  // A transport's own fixed rent: never more for owning several, never built on.
  if (isTransport(BOARD[space])) return transportRent(space, s.economy);
  return cityRent(space, s.level[space] ?? 0, hasGroupBonus(s, space, owner), s.economy);
}

/** What building `levels` more levels on `space` costs right now. */
export function buildPrice(s: Owned, space: number, levels: number): number {
  let total = 0;
  for (let k = 0; k < levels; k++) total += buildCost(space, (s.level[space] ?? 0) + k, s.economy);
  return total;
}

/** List value of what a player owns (prices + buildings) — the base of property-backed loans. */
export const listValue = (s: Owned, seat: number) =>
  ownedBy(s, seat).reduce(
    (sum, i) => sum + priceOf(i, s.economy) + buildingsValue(i, s.level[i] ?? 0, s.economy),
    0,
  );

export const borrowLimit = (s: Owned, seat: number) =>
  s.economy.loanBase + round10(listValue(s, seat) * s.economy.loanBacking);

/** How much more a player may borrow, in whole loan steps. */
export function canBorrow(s: BusinessState, seat: number): number {
  if (s.round >= s.rounds) return 0; // no new loans in the final round
  const room = borrowLimit(s, seat) - (s.players[seat]?.debt ?? 0);
  const step = s.economy.loanStep;
  // A loan adds its amount plus the fee to the debt.
  return Math.max(0, Math.floor(room / (step * (1 + s.economy.loanFee)) + 1e-9) * step);
}

/** Final wealth (frozen formula): cash + cumulative spending on properties, buildings, transport. */
export function wealthOf(s: Pick<BusinessState, 'players'>, seat: number): FinalWealth {
  const p = s.players[seat];
  const cash = p?.cash ?? 0;
  const property = p?.spend.property ?? 0;
  const development = p?.spend.development ?? 0;
  const transport = p?.spend.transport ?? 0;
  return {
    cash,
    property,
    development,
    transport,
    total: cash + property + development + transport,
  };
}

const rank = (seats: number[], value: (seat: number) => number) =>
  seats.map((seat) => ({
    seat,
    place: 1 + seats.filter((o) => value(o) > value(seat)).length,
  }));

const newPlayer = (cash: number): PlayerState => ({
  cash,
  debt: 0,
  position: 0,
  spend: { property: 0, development: 0, transport: 0 },
  skipNext: false,
  noBuyNext: false,
  noBuyActive: false,
  rentHoliday: false,
  insolvent: false,
  autoActs: 0,
});

/** A mutable working copy for one transition (the input state is never touched). */
interface Work {
  s: BusinessState;
  events: Scoped<BusinessEvent>[];
  requests: RuntimeRequest[];
  ctx: StepCtx;
  /** Extra animation time this transition needs before the next step. */
  hold: number;
}

export function createBusinessGame(
  options: BusinessOptions = {},
): GameModule<BusinessState, BusinessAction, BusinessView, BusinessEvent, BusinessSettings> {
  const scale = options.timeScale ?? 1;
  const scaled = (v: number) => Math.max(0, Math.round(v * scale));
  const timing = Object.fromEntries(
    Object.entries({ ...DEFAULT_TIMING, ...options.timing }).map(([k, v]) => [k, scaled(v)]),
  ) as unknown as BusinessTiming;
  const economy: Economy = { ...DEFAULT_ECONOMY, ...options.economy };
  const [rollMin, rollMax] = (options.botRollMs ?? [600, 1400]).map(scaled) as [number, number];
  const [thinkMin, thinkMax] = (options.botThinkMs ?? [800, 2000]).map(scaled) as [number, number];
  const mistakeRate = options.botMistakeRate ?? 0.1;
  const idleAfter = options.idleAfterAutoActs ?? 3;
  const rollDice =
    options.dice ?? ((rng: SeededRng): [number, number] => [rng.int(1, 6), rng.int(1, 6)]);

  // ── ledger ──
  const P = (w: Work, seat: number) => w.s.players[seat] as PlayerState;
  const log = (w: Work, entry: LogEntry) => {
    w.s.log = [...w.s.log, entry].slice(-LOG_SIZE);
    w.events.push(toAll({ type: 'LOG', entry }));
  };
  const fromBank = (w: Work, seat: number, amount: number) => {
    P(w, seat).cash += amount;
    w.s.bankNet += amount;
  };
  const toBank = (w: Work, seat: number, amount: number) => {
    P(w, seat).cash -= amount;
    w.s.bankNet -= amount;
  };

  function takeLoan(w: Work, seat: number, amount: number) {
    const p = P(w, seat);
    p.debt += round10(amount * (1 + w.s.economy.loanFee));
    fromBank(w, seat, amount);
    log(w, { type: 'LOAN', seat, amount, debt: p.debt });
  }

  function sellTopBuilding(w: Work, seat: number, at: number) {
    const lv = w.s.level[at] ?? 0;
    const value = round10(buildCost(at, lv - 1, w.s.economy) * w.s.economy.sellBack);
    w.s.level[at] = lv - 1;
    fromBank(w, seat, value);
    log(w, { type: 'SOLD', seat, space: at, what: 'building', value });
  }

  function sellAsset(w: Work, seat: number, at: number) {
    const e = w.s.economy;
    const value = round10(
      (priceOf(at, e) + buildingsValue(at, w.s.level[at] ?? 0, e)) * e.sellBack,
    );
    w.s.owner[at] = null;
    w.s.level[at] = 0;
    fromBank(w, seat, value);
    log(w, { type: 'SOLD', seat, space: at, what: 'asset', value });
  }

  /** The bank raises money for `seat` (design §13 order) until they hold `needed`. */
  function bankHandles(w: Work, seat: number, needed: number) {
    const s = w.s;
    const p = P(w, seat);
    while (p.cash < needed && canBorrow(s, seat) >= s.economy.loanStep) {
      takeLoan(w, seat, s.economy.loanStep);
    }
    const byPrice = (a: number, b: number) =>
      priceOf(a, s.economy) - priceOf(b, s.economy) || a - b;
    while (p.cash < needed) {
      const built = ownedBy(s, seat)
        .filter((i) => (s.level[i] ?? 0) > 0)
        .sort((a, b) => (s.level[b] ?? 0) - (s.level[a] ?? 0) || byPrice(a, b))[0];
      if (built !== undefined) {
        sellTopBuilding(w, seat, built);
        continue;
      }
      const asset = ownedBy(s, seat).sort(byPrice)[0];
      if (asset === undefined) break;
      sellAsset(w, seat, asset);
    }
  }

  /** Pays out a list of dues from `seat`'s cash, writing off what can't be paid. */
  function payOut(w: Work, seat: number, payments: Payment[]) {
    const p = P(w, seat);
    let shortfall = 0;
    for (const pay of payments) {
      const paid = Math.min(pay.amount, p.cash);
      p.cash -= paid;
      if (pay.to === null) w.s.bankNet -= paid;
      else P(w, pay.to).cash += paid;
      const writtenOff = pay.amount - paid;
      shortfall += writtenOff;
      w.s.writtenOff += writtenOff;
      log(w, {
        type: 'PAID',
        from: seat,
        to: pay.to,
        amount: paid,
        reason: pay.reason,
        ...(pay.space !== undefined ? { space: pay.space } : {}),
        writtenOff,
      });
    }
    if (shortfall > 0) {
      // Insolvent: nothing left; the bank clears the loans; the player stays in the match.
      p.debt = 0;
      p.insolvent = true;
      log(w, { type: 'INSOLVENT', seat, writtenOff: shortfall });
    }
  }

  /**
   * Settles dues. The current player who can't pay gets the Raise-money panel
   * (returns 'RAISE'); anyone else (or `auto`) has the bank handle it at once.
   */
  function settle(
    w: Work,
    seat: number,
    payments: Payment[],
    interactive: boolean,
  ): 'PAID' | 'RAISE' {
    const due = payments.filter((x) => x.amount > 0);
    if (due.length === 0) return 'PAID';
    const total = due.reduce((a, b) => a + b.amount, 0);
    if (P(w, seat).cash >= total) {
      payOut(w, seat, due);
      return 'PAID';
    }
    if (interactive) {
      w.s.raise = { payments: due, total };
      return 'RAISE';
    }
    bankHandles(w, seat, total);
    payOut(w, seat, due);
    return 'PAID';
  }

  // ── turns ──
  const enter = (w: Work, phase: BusinessState['phase'], ms: number) => {
    w.s.phase = phase;
    w.s.phaseMs = ms;
    w.s.phaseEndsAt = w.ctx.now + ms;
  };

  function startTurn(w: Work, seat: number) {
    const s = w.s;
    const p = P(w, seat);
    s.current = seat;
    s.turn += 1;
    s.decision = null;
    s.raise = null;
    s.auctionsThisTurn = 0;
    s.tradesThisTurn = 0;
    p.noBuyActive = p.noBuyNext;
    p.noBuyNext = false;
    const skipped = p.skipNext;
    w.events.push(toAll({ type: 'TURN', seat, round: s.round, turn: s.turn, skipped }));
    if (skipped) {
      p.skipNext = false;
      log(w, { type: 'TURN_SKIPPED', seat });
      enter(w, 'HOLD', s.timing.skipMs);
      return;
    }
    enter(w, 'ROLL', s.timing.turnMs);
  }

  function finish(w: Work) {
    const s = w.s;
    // Debts are repaid from cash before wealth is counted; loans never create free wealth.
    for (const seat of s.seats) {
      const p = P(w, seat);
      if (p.debt <= 0) continue;
      const debt = p.debt;
      bankHandles(w, seat, debt);
      const repaid = Math.min(debt, p.cash);
      toBank(w, seat, repaid);
      p.debt = 0;
      if (repaid < debt) {
        s.writtenOff += debt - repaid;
        p.insolvent = true;
        log(w, { type: 'INSOLVENT', seat, writtenOff: debt - repaid });
      }
      log(w, { type: 'SETTLED', seat, repaid });
    }
    s.final = Object.fromEntries(s.seats.map((x) => [x, wealthOf(s, x)])) as SeatMap<FinalWealth>;
    s.decision = null;
    s.raise = null;
    enter(w, 'OVER', 0);
    w.events.push(toAll({ type: 'MATCH_OVER', final: s.final }));
  }

  function nextTurn(w: Work) {
    const s = w.s;
    P(w, s.current).noBuyActive = false;
    let index = s.order.indexOf(s.current) + 1;
    if (index >= s.order.length) {
      index = 0;
      s.round += 1;
    }
    if (s.round > s.rounds) return finish(w);
    startTurn(w, s.order[index] as number);
  }

  /** Ends the current player's resolution: hold for the animation, then the next turn. */
  const endResolution = (w: Work) => enter(w, 'HOLD', w.hold + w.s.timing.landingMs);

  function noteAuto(w: Work, seat: number, auto: boolean) {
    const p = P(w, seat);
    p.autoActs = auto ? p.autoActs + 1 : 0;
    if (auto && p.autoActs === idleAfter) w.requests.push({ type: 'MARK_IDLE', seat });
  }

  /** Moves forward (passing START pays the salary) and returns the path. */
  function move(w: Work, seat: number, steps: number): number[] {
    const p = P(w, seat);
    const path: number[] = [];
    let at = p.position;
    for (let k = 0; k < steps; k++) {
      at = (at + 1) % BOARD_SIZE;
      path.push(at);
      if (at === 0) {
        fromBank(w, seat, w.s.economy.salary);
        p.insolvent = false;
        log(w, { type: 'SALARY', seat, amount: w.s.economy.salary });
      }
    }
    p.position = at;
    w.hold += steps * w.s.timing.hopMs;
    return path;
  }

  /** The player's cities that can take one more level (never transports). */
  const freeBuildOptions = (s: BusinessState, seat: number) =>
    ownedBy(s, seat).filter((i) => isCity(BOARD[i]) && (s.level[i] ?? 0) < HOTEL);

  /**
   * FREE BUILDING: the player chooses one of their cities and gets its next level for Rs 0
   * (no spending recorded). No eligible city: the cash fallback instead.
   */
  function freeBuilding(w: Work, seat: number, fallback: number) {
    const s = w.s;
    const options = freeBuildOptions(s, seat);
    if (options.length === 0) {
      fromBank(w, seat, fallback);
      log(w, { type: 'GAINED', seat, amount: fallback, reason: 'event' });
      return endResolution(w);
    }
    s.decision = { kind: 'FREE_BUILD', space: P(w, seat).position, cost: 0, options };
    return enter(w, 'DECIDE', w.hold + s.timing.landingMs + s.timing.turnMs);
  }

  function grantFreeLevel(w: Work, seat: number, at: number) {
    const s = w.s;
    s.level[at] = (s.level[at] ?? 0) + 1;
    log(w, { type: 'BUILT', seat, space: at, level: s.level[at] as number, cost: 0 });
  }

  /** Resolves the space the current player stands on. */
  function land(w: Work, seat: number): void {
    const s = w.s;
    const p = P(w, seat);
    const at = p.position;
    const b = BOARD[at];
    if (!b) return endResolution(w);
    if (b.kind === 'city' || b.kind === 'transport') {
      const owner = s.owner[at];
      if (owner === null || owner === undefined) {
        if (p.noBuyActive) {
          log(w, { type: 'NO_BUY', seat, space: at });
          return endResolution(w);
        }
        s.decision = { kind: 'BUY', space: at, cost: priceOf(at, s.economy) };
        return enter(w, 'DECIDE', w.hold + s.timing.landingMs + s.timing.turnMs);
      }
      if (owner === seat) {
        if (b.kind === 'city' && (s.level[at] ?? 0) < HOTEL) {
          s.decision = {
            kind: 'BUILD',
            space: at,
            cost: buildCost(at, s.level[at] ?? 0, s.economy),
          };
          return enter(w, 'DECIDE', w.hold + s.timing.landingMs + s.timing.turnMs);
        }
        return endResolution(w);
      }
      const rent = rentAt(s, at);
      if (p.rentHoliday) {
        p.rentHoliday = false;
        log(w, { type: 'RENT_WAIVED', seat, space: at, amount: rent });
        return endResolution(w);
      }
      const reason: PayReason = b.kind === 'city' ? 'rent' : 'transport';
      return afterPayment(
        w,
        settle(w, seat, [{ to: owner, amount: rent, reason, space: at }], true),
      );
    }
    if (b.kind === 'event') {
      return enter(w, 'EVENT', w.hold + s.timing.landingMs + s.timing.turnMs);
    }
    switch (b.corner) {
      case 'jail':
        s.decision = { kind: 'JAIL', space: at, cost: s.economy.jailFee };
        return enter(w, 'DECIDE', w.hold + s.timing.landingMs + s.timing.turnMs);
      case 'club':
        for (const other of s.seats) {
          if (other === seat) continue;
          settle(w, other, [{ to: seat, amount: s.economy.clubCollect, reason: 'club' }], false);
        }
        return endResolution(w);
      case 'resort':
        return afterPayment(
          w,
          settle(
            w,
            seat,
            s.seats
              .filter((x) => x !== seat)
              .map((x) => ({ to: x, amount: s.economy.resortPay, reason: 'resort' as const })),
            true,
          ),
        );
      default:
        return endResolution(w); // START (salary already paid on arrival)
    }
  }

  function afterPayment(w: Work, result: 'PAID' | 'RAISE') {
    if (result === 'RAISE')
      return enter(w, 'RAISE', w.hold + w.s.timing.landingMs + w.s.timing.turnMs);
    return endResolution(w);
  }

  /** Applies a deterministic event outcome (design §8). */
  function applyEvent(w: Work, seat: number, deck: 'chance' | 'chest', sum: number) {
    const s = w.s;
    const p = P(w, seat);
    const outcome = eventOutcome(deck, sum, s.economy);
    s.lastEvent = { seat, deck, sum, good: outcome.good, turn: s.turn };
    log(w, { type: 'EVENT', seat, deck, sum, good: outcome.good });
    w.hold += s.timing.eventMs;
    if (options.eventsOff) return endResolution(w);
    const e = outcome.effect;
    const others = s.seats.filter((x) => x !== seat);
    switch (e.kind) {
      case 'gain':
        fromBank(w, seat, e.amount);
        log(w, { type: 'GAINED', seat, amount: e.amount, reason: 'event' });
        return endResolution(w);
      case 'pay':
        return afterPayment(
          w,
          settle(w, seat, [{ to: null, amount: e.amount, reason: 'event' }], true),
        );
      case 'payEach':
        return afterPayment(
          w,
          settle(
            w,
            seat,
            others.map((x) => ({ to: x, amount: e.amount, reason: 'event' as const })),
            true,
          ),
        );
      case 'collectEach':
        for (const x of others)
          settle(w, x, [{ to: seat, amount: e.amount, reason: 'event' }], false);
        return endResolution(w);
      case 'repairs': {
        const owned = ownedBy(s, seat).filter((i) => isCity(BOARD[i]));
        const hotels = owned.filter((i) => s.level[i] === HOTEL).length;
        const houses = owned.reduce(
          (n, i) => n + ((s.level[i] ?? 0) < HOTEL ? (s.level[i] ?? 0) : 0),
          0,
        );
        const amount = Math.min(e.max, houses * e.perHouse + hotels * e.perHotel);
        return afterPayment(w, settle(w, seat, [{ to: null, amount, reason: 'event' }], true));
      }
      case 'freeBuilding':
        return freeBuilding(w, seat, e.fallback);
      case 'skipNextRoll':
        p.skipNext = true;
        return endResolution(w);
      case 'noBuyNextTurn':
        p.noBuyNext = true;
        return endResolution(w);
      case 'rentHoliday':
        p.rentHoliday = true;
        return endResolution(w);
      case 'toStart': {
        const steps = (BOARD_SIZE - p.position) % BOARD_SIZE || BOARD_SIZE;
        const from = p.position;
        const path = move(w, seat, steps);
        w.events.push(toAll({ type: 'ROLLED', seat, dice: [], kind: 'move', from, to: 0, path }));
        log(w, { type: 'MOVED', seat, to: 0 });
        return endResolution(w);
      }
    }
  }

  const begin = (s0: BusinessState, ctx: StepCtx): Work => ({
    s: structuredClone(s0),
    events: [],
    requests: [],
    ctx,
    hold: 0,
  });
  const done = (w: Work): T => ({
    state: w.s,
    events: w.events,
    timers:
      w.s.phase === 'OVER'
        ? [{ clear: PHASE_TIMER }]
        : [{ set: PHASE_TIMER, ms: Math.max(0, w.s.phaseEndsAt - w.ctx.now) }],
    requests: w.requests,
  });

  // ── actions ──
  function roll(w: Work, auto: boolean) {
    const s = w.s;
    const seat = s.current;
    noteAuto(w, seat, auto);
    const dice = rollDice(w.ctx.rng);
    const from = P(w, seat).position;
    const steps = dice[0] + dice[1];
    s.lastRoll = { seat, dice, kind: 'move', turn: s.turn };
    // The dice tumble first; then the pawn walks every space (the board animates this path).
    w.hold += s.timing.diceMs;
    w.events.push(
      toAll({
        type: 'ROLLED',
        seat,
        dice,
        kind: 'move',
        from,
        to: (from + steps) % BOARD_SIZE,
        path: Array.from({ length: steps }, (_, k) => (from + k + 1) % BOARD_SIZE),
      }),
    );
    move(w, seat, steps);
    log(w, { type: 'ROLLED', seat, dice, to: P(w, seat).position });
    land(w, seat);
  }

  function eventRoll(w: Work, auto: boolean) {
    const s = w.s;
    const seat = s.current;
    noteAuto(w, seat, auto);
    const at = P(w, seat).position;
    const b = BOARD[at];
    const deck = b?.kind === 'event' ? b.deck : 'chance';
    const dice = rollDice(w.ctx.rng);
    s.lastRoll = { seat, dice, kind: 'event', turn: s.turn };
    w.events.push(toAll({ type: 'ROLLED', seat, dice, kind: 'event', from: at, to: at, path: [] }));
    applyEvent(w, seat, deck, dice[0] + dice[1]);
  }

  function decide(
    w: Work,
    kind: 'BUY' | 'BUILD' | 'SKIP' | 'JAIL_PAY' | 'JAIL_WAIT' | 'FREE_BUILD',
    auto: boolean,
    target?: number,
  ) {
    const s = w.s;
    const seat = s.current;
    const d = s.decision;
    noteAuto(w, seat, auto);
    if (!d) return endResolution(w);
    const p = P(w, seat);
    if (kind === 'BUILD') {
      // One level per landing (House 1 → 2 → 3 → Hotel over separate landings): the
      // offer closes after the build.
      const lv = s.level[d.space] ?? 0;
      const cost = buildCost(d.space, lv, s.economy);
      toBank(w, seat, cost);
      s.level[d.space] = lv + 1;
      p.spend.development += cost;
      log(w, { type: 'BUILT', seat, space: d.space, level: lv + 1, cost });
      s.decision = null;
      return endResolution(w);
    }
    s.decision = null;
    if (kind === 'BUY') {
      toBank(w, seat, d.cost);
      s.owner[d.space] = seat;
      s.level[d.space] = 0;
      if (isTransport(BOARD[d.space])) p.spend.transport += d.cost;
      else p.spend.property += d.cost;
      log(w, { type: 'BOUGHT', seat, space: d.space, price: d.cost });
    } else if (kind === 'FREE_BUILD') {
      const options = d.options ?? [];
      // Timeout: the least-developed eligible city (cheapest first) gets it.
      const pick =
        target ??
        [...options].sort(
          (a, b) =>
            (s.level[a] ?? 0) - (s.level[b] ?? 0) ||
            priceOf(a, s.economy) - priceOf(b, s.economy) ||
            a - b,
        )[0];
      if (pick !== undefined) grantFreeLevel(w, seat, pick);
    } else if (kind === 'JAIL_PAY') {
      toBank(w, seat, d.cost);
      log(w, { type: 'PAID', from: seat, to: null, amount: d.cost, reason: 'jail', writtenOff: 0 });
      log(w, { type: 'JAIL', seat, paid: true });
    } else if (kind === 'JAIL_WAIT') {
      p.skipNext = true;
      log(w, { type: 'JAIL', seat, paid: false });
    } else {
      log(w, { type: 'DECLINED', seat, space: d.space });
    }
    w.hold = 0;
    endResolution(w);
  }

  /** After a raise action: once the dues are covered they are paid and the turn moves on. */
  function maybeCovered(w: Work) {
    const s = w.s;
    const r = s.raise;
    if (!r || P(w, s.current).cash < r.total) return enter(w, 'RAISE', s.phaseEndsAt - w.ctx.now);
    s.raise = null;
    payOut(w, s.current, r.payments);
    endResolution(w);
  }

  function closeAuction(w: Work) {
    const s = w.s;
    const a = s.auction;
    if (!a) return;
    s.auction = null;
    if (a.high && (P(w, a.high.seat).cash ?? 0) >= a.high.amount && s.owner[a.space] === a.seller) {
      const buyer = P(w, a.high.seat);
      buyer.cash -= a.high.amount;
      P(w, a.seller).cash += a.high.amount;
      if (isTransport(BOARD[a.space])) buyer.spend.transport += a.high.amount;
      else buyer.spend.property += a.high.amount;
      s.owner[a.space] = a.high.seat;
      s.lockedUntil[a.space] = s.round + s.economy.auctionLockRounds;
      log(w, {
        type: 'AUCTION_WON',
        seller: a.seller,
        space: a.space,
        seat: a.high.seat,
        amount: a.high.amount,
      });
    } else {
      log(w, { type: 'AUCTION_UNSOLD', seller: a.seller, space: a.space });
    }
    if (a.returnTo === 'RAISE' && s.raise) return maybeCovered({ ...w, s });
    enter(w, 'ROLL', s.timing.turnMs);
  }

  /** Cash paid in a trade counts as spending on the assets received, split by list price. */
  function tradeSpending(w: Work, seat: number, cash: number, received: number[]) {
    if (cash <= 0 || received.length === 0) return;
    const s = w.s;
    const total = received.reduce((n, i) => n + priceOf(i, s.economy), 0);
    const toTransport = received
      .filter((i) => isTransport(BOARD[i]))
      .reduce((n, i) => n + priceOf(i, s.economy), 0);
    const transport = Math.round((cash * toTransport) / total);
    P(w, seat).spend.transport += transport;
    P(w, seat).spend.property += cash - transport;
  }

  function tradeValid(
    s: BusinessState,
    from: number,
    to: number,
    give: Offer,
    get: Offer,
  ): boolean {
    const assetsOk = (seat: number, assets: number[]) =>
      new Set(assets).size === assets.length &&
      assets.every((i) => s.owner[i] === seat && (s.lockedUntil[i] ?? 0) <= s.round);
    return (
      from !== to &&
      s.seats.includes(to) &&
      assetsOk(from, give.assets) &&
      assetsOk(to, get.assets) &&
      (s.players[from]?.cash ?? 0) >= give.cash &&
      (s.players[to]?.cash ?? 0) >= get.cash &&
      give.cash + give.assets.length + get.cash + get.assets.length > 0
    );
  }

  const viewOf = (s: BusinessState): BusinessView => ({
    ...s,
    wealth: Object.fromEntries(s.seats.map((x) => [x, wealthOf(s, x).total])) as SeatMap<number>,
    canBorrow: Object.fromEntries(s.seats.map((x) => [x, canBorrow(s, x)])) as SeatMap<number>,
  });

  return {
    manifest: {
      id: BUSINESS_GAME_ID,
      version: 3,
      players: { min: MIN_PLAYERS, max: MAX_PLAYERS },
      sync: 'TURN_PHASE',
      bots: { supported: true, canTakeOverSeat: true },
      publicMatch: { enabled: true, targetPlayers: 6, minHumans: 2 },
      reclaim: 'IMMEDIATE',
      layout: { orientation: 'any' },
    },

    settingsSchema: z.strictObject({
      rounds: z.number().int().min(MIN_ROUNDS).max(MAX_ROUNDS),
      board: z.literal('india-classic'),
      eventFrequency: z.literal('normal'),
    }),
    defaultSettings: { rounds: DEFAULT_ROUNDS, board: 'india-classic', eventFrequency: 'normal' },
    actionSchema,

    setup(seats, settings, ctx) {
      if (seats.length < MIN_PLAYERS || seats.length > MAX_PLAYERS) {
        throw new Error('Business needs 2–6 players');
      }
      const first = ctx.rng.int(0, seats.length - 1);
      const order = [...seats.slice(first), ...seats.slice(0, first)];
      const s: BusinessState = {
        phase: 'ROLL',
        board: 'india-classic',
        eventFrequency: 'normal',
        seats: [...seats],
        order,
        rounds: settings.rounds,
        round: 1,
        turn: 0,
        current: order[0] as number,
        players: Object.fromEntries(seats.map((x) => [x, newPlayer(economy.startCash)])),
        owner: BOARD.map(() => null),
        level: BOARD.map(() => 0),
        lockedUntil: BOARD.map(() => 0),
        decision: null,
        raise: null,
        auction: null,
        trade: null,
        auctionsThisTurn: 0,
        tradesThisTurn: 0,
        lastRoll: null,
        lastEvent: null,
        log: [],
        economy,
        timing,
        phaseEndsAt: ctx.now,
        phaseMs: 0,
        bankNet: 0,
        writtenOff: 0,
        final: null,
      };
      const w: Work = { s, events: [], requests: [], ctx, hold: 0 };
      startTurn(w, order[0] as number);
      return done(w);
    },

    validateAction(s, seat, a) {
      if (s.phase === 'OVER' || a.turn !== s.turn) return { ok: false, code: 'INVALID_PHASE' };
      const p = s.players[seat];
      if (!p) return { ok: false, code: 'NOT_ELIGIBLE' };
      const ok = { ok: true } as const;
      const no = (code: 'INVALID_PHASE' | 'ILLEGAL_ACTION' | 'NOT_YOUR_TURN' | 'NOT_ELIGIBLE') =>
        ({ ok: false, code }) as const;
      // Actions other players may take.
      if (a.type === 'BID') {
        const au = s.auction;
        if (s.phase !== 'AUCTION' || !au) return no('INVALID_PHASE');
        if (seat === au.seller) return no('NOT_ELIGIBLE');
        const min = au.high ? au.high.amount + BID_STEP : au.open;
        if (a.amount < min || a.amount % BID_STEP !== 0 || a.amount > p.cash)
          return no('ILLEGAL_ACTION');
        if (au.high?.seat === seat) return no('ILLEGAL_ACTION');
        return ok;
      }
      if (a.type === 'TRADE_ANSWER') {
        if (s.phase !== 'TRADE' || !s.trade) return no('INVALID_PHASE');
        return seat === s.trade.to ? ok : no('NOT_ELIGIBLE');
      }
      if (seat !== s.current) return no('NOT_YOUR_TURN');
      switch (a.type) {
        case 'ROLL':
          return s.phase === 'ROLL' ? ok : no('INVALID_PHASE');
        case 'EVENT_ROLL':
          return s.phase === 'EVENT' ? ok : no('INVALID_PHASE');
        case 'BUY':
        case 'BUILD': {
          const d = s.decision;
          if (s.phase !== 'DECIDE' || !d) return no('INVALID_PHASE');
          if (d.kind !== a.type || d.space !== a.space || p.position !== a.space)
            return no('ILLEGAL_ACTION');
          if (a.type === 'BUY') {
            return s.owner[a.space] === null && p.cash >= d.cost ? ok : no('ILLEGAL_ACTION');
          }
          const lv = s.level[a.space] ?? 0;
          // Cities only (transports are never developed), one level at a time, up to the hotel.
          if (s.owner[a.space] !== seat || !isCity(BOARD[a.space]) || lv >= HOTEL)
            return no('ILLEGAL_ACTION');
          return p.cash >= buildCost(a.space, lv, s.economy) ? ok : no('ILLEGAL_ACTION');
        }
        case 'FREE_BUILD': {
          const d = s.decision;
          if (s.phase !== 'DECIDE' || d?.kind !== 'FREE_BUILD') return no('INVALID_PHASE');
          return (d.options ?? []).includes(a.space) &&
            s.owner[a.space] === seat &&
            isCity(BOARD[a.space]) &&
            (s.level[a.space] ?? 0) < HOTEL
            ? ok
            : no('ILLEGAL_ACTION');
        }
        case 'SKIP':
          if (s.phase !== 'DECIDE' || !s.decision) return no('INVALID_PHASE');
          return s.decision.kind === 'JAIL' || s.decision.kind === 'FREE_BUILD'
            ? no('ILLEGAL_ACTION')
            : ok;
        case 'JAIL_PAY':
        case 'JAIL_WAIT':
          if (s.phase !== 'DECIDE' || s.decision?.kind !== 'JAIL') return no('INVALID_PHASE');
          return a.type === 'JAIL_PAY' && p.cash < s.decision.cost ? no('ILLEGAL_ACTION') : ok;
        case 'LOAN':
          if (!['ROLL', 'DECIDE', 'RAISE'].includes(s.phase)) return no('INVALID_PHASE');
          if (
            a.amount <= 0 ||
            a.amount % s.economy.loanStep !== 0 ||
            a.amount > canBorrow(s, seat)
          ) {
            return no('ILLEGAL_ACTION');
          }
          return ok;
        case 'REPAY':
          if (!['ROLL', 'DECIDE'].includes(s.phase)) return no('INVALID_PHASE');
          return a.amount > 0 && a.amount <= p.debt && a.amount <= p.cash
            ? ok
            : no('ILLEGAL_ACTION');
        case 'SELL_BUILDING':
          if (s.phase !== 'RAISE') return no('INVALID_PHASE');
          return s.owner[a.space] === seat && (s.level[a.space] ?? 0) > 0
            ? ok
            : no('ILLEGAL_ACTION');
        case 'SELL_ASSET':
          if (s.phase !== 'RAISE') return no('INVALID_PHASE');
          return s.owner[a.space] === seat ? ok : no('ILLEGAL_ACTION');
        case 'BANK_HANDLES_IT':
          return s.phase === 'RAISE' ? ok : no('INVALID_PHASE');
        case 'AUCTION_START':
          if (s.phase !== 'ROLL' && s.phase !== 'RAISE') return no('INVALID_PHASE');
          if (s.auctionsThisTurn >= 1) return no('ILLEGAL_ACTION');
          if (s.owner[a.space] !== seat || (s.lockedUntil[a.space] ?? 0) > s.round)
            return no('ILLEGAL_ACTION');
          return ok;
        case 'TRADE_PROPOSE':
          if (s.phase !== 'ROLL') return no('INVALID_PHASE');
          if (s.tradesThisTurn >= 1) return no('ILLEGAL_ACTION');
          return tradeValid(s, seat, a.to, a.give, a.get) ? ok : no('ILLEGAL_ACTION');
      }
    },

    applyAction(s0, seat, a, ctx) {
      const w = begin(s0, ctx);
      const s = w.s;
      switch (a.type) {
        case 'ROLL':
          roll(w, false);
          break;
        case 'EVENT_ROLL':
          eventRoll(w, false);
          break;
        case 'BUILD':
          decide(w, 'BUILD', false);
          break;
        case 'FREE_BUILD':
          decide(w, 'FREE_BUILD', false, a.space);
          break;
        case 'BUY':
        case 'SKIP':
        case 'JAIL_PAY':
        case 'JAIL_WAIT':
          decide(w, a.type, false);
          break;
        case 'LOAN':
          P(w, seat).autoActs = 0;
          takeLoan(w, seat, a.amount);
          if (s.phase === 'RAISE') maybeCovered(w);
          break;
        case 'REPAY': {
          const p = P(w, seat);
          toBank(w, seat, a.amount);
          p.debt -= a.amount;
          log(w, { type: 'REPAID', seat, amount: a.amount, debt: p.debt });
          break;
        }
        case 'SELL_BUILDING':
          sellTopBuilding(w, seat, a.space);
          maybeCovered(w);
          break;
        case 'SELL_ASSET':
          sellAsset(w, seat, a.space);
          maybeCovered(w);
          break;
        case 'BANK_HANDLES_IT': {
          const r = s.raise;
          s.raise = null;
          if (r) {
            bankHandles(w, seat, r.total);
            payOut(w, seat, r.payments);
          }
          endResolution(w);
          break;
        }
        case 'AUCTION_START': {
          const value =
            priceOf(a.space, s.economy) + buildingsValue(a.space, s.level[a.space] ?? 0, s.economy);
          const open = Math.max(
            BID_STEP,
            Math.round((value * s.economy.auctionOpenShare) / BID_STEP) * BID_STEP,
          );
          s.auctionsThisTurn += 1;
          s.auction = {
            seller: seat,
            space: a.space,
            open,
            high: null,
            startedAt: ctx.now,
            endsAt: ctx.now + s.timing.auctionMs,
            returnTo: s.phase === 'RAISE' ? 'RAISE' : 'ROLL',
          };
          log(w, { type: 'AUCTION', seller: seat, space: a.space, open });
          enter(w, 'AUCTION', s.timing.auctionMs);
          break;
        }
        case 'BID': {
          const au = s.auction;
          if (!au) break;
          au.high = { seat, amount: a.amount };
          log(w, { type: 'BID', seat, amount: a.amount });
          const left = au.endsAt - ctx.now;
          const cap = au.startedAt + s.timing.auctionMaxMs;
          au.endsAt = Math.min(
            cap,
            left < s.timing.auctionExtendMs ? ctx.now + s.timing.auctionExtendMs : au.endsAt,
          );
          enter(w, 'AUCTION', au.endsAt - ctx.now);
          break;
        }
        case 'TRADE_PROPOSE':
          s.tradesThisTurn += 1;
          s.trade = {
            from: seat,
            to: a.to,
            give: a.give,
            get: a.get,
            endsAt: ctx.now + s.timing.tradeMs,
          };
          log(w, { type: 'TRADE_OFFER', from: seat, to: a.to });
          enter(w, 'TRADE', s.timing.tradeMs);
          break;
        case 'TRADE_ANSWER': {
          const t = s.trade;
          s.trade = null;
          if (t && a.accept && tradeValid(s, t.from, t.to, t.give, t.get)) {
            P(w, t.from).cash += t.get.cash - t.give.cash;
            P(w, t.to).cash += t.give.cash - t.get.cash;
            for (const i of t.give.assets) s.owner[i] = t.to;
            for (const i of t.get.assets) s.owner[i] = t.from;
            for (const i of [...t.give.assets, ...t.get.assets]) {
              s.lockedUntil[i] = s.round + s.economy.auctionLockRounds;
            }
            tradeSpending(w, t.from, t.give.cash, t.get.assets);
            tradeSpending(w, t.to, t.get.cash, t.give.assets);
            log(w, { type: 'TRADE_DONE', from: t.from, to: t.to, give: t.give, get: t.get });
          } else if (t) {
            log(w, { type: 'TRADE_DECLINED', from: t.from, to: t.to });
          }
          enter(w, 'ROLL', s.timing.turnMs);
          break;
        }
      }
      return done(w);
    },

    onTimer(s0, timer, ctx) {
      if (timer !== PHASE_TIMER || s0.phase === 'OVER') return { state: s0, events: [] };
      const w = begin(s0, ctx);
      const s = w.s;
      switch (s.phase) {
        case 'ROLL':
          roll(w, true);
          break;
        case 'EVENT':
          eventRoll(w, true);
          break;
        case 'DECIDE': {
          const k = s.decision?.kind;
          decide(w, k === 'JAIL' ? 'JAIL_WAIT' : k === 'FREE_BUILD' ? 'FREE_BUILD' : 'SKIP', true);
          break;
        }
        case 'RAISE': {
          noteAuto(w, s.current, true);
          const r = s.raise;
          s.raise = null;
          if (r) {
            bankHandles(w, s.current, r.total);
            payOut(w, s.current, r.payments);
          }
          endResolution(w);
          break;
        }
        case 'AUCTION':
          closeAuction(w);
          break;
        case 'TRADE':
          if (s.trade) log(w, { type: 'TRADE_DECLINED', from: s.trade.from, to: s.trade.to });
          s.trade = null;
          enter(w, 'ROLL', s.timing.turnMs);
          break;
        case 'HOLD':
          nextTurn(w);
          break;
      }
      return done(w);
    },

    onSeatChange(s, seat, change) {
      const p = s.players[seat];
      if (p && (change === 'BOT_TOOK_OVER' || change === 'RECLAIMED')) {
        return {
          state: { ...s, players: { ...s.players, [seat]: { ...p, autoActs: 0 } } },
          events: [],
        };
      }
      return { state: s, events: [] };
    },

    getPlayerView: (s) => viewOf(s),
    isOver: (s) => s.phase === 'OVER',

    getResults(s) {
      const total = (x: number) => (s.final?.[x] ?? wealthOf(s, x)).total;
      return {
        placements: rank(s.seats, total),
        stats: Object.fromEntries(
          s.seats.map((x) => {
            const f = s.final?.[x] ?? wealthOf(s, x);
            return [
              x,
              {
                wealth: f.total,
                cash: f.cash,
                property: f.property,
                development: f.development,
                transport: f.transport,
              },
            ];
          }),
        ),
      };
    },

    bot: {
      createMemory: () => null,
      observe: (memory) => memory,
      decide(view, _memory, ctx) {
        const action = botAction(view, ctx.seat, ctx.rng, mistakeRate);
        if (!action) return null;
        const quick = action.type === 'ROLL' || action.type === 'EVENT_ROLL';
        return {
          kind: 'ACTION',
          action,
          thinkMs: quick ? ctx.rng.int(rollMin, rollMax) : ctx.rng.int(thinkMin, thinkMax),
        };
      },
    },
  };
}

/** The bot's reserve: cash it tries to keep after spending (scales with the economy). */
export const botReserve = (view: Pick<BusinessView, 'seats' | 'economy'>) =>
  round10(
    view.economy.startCash *
      (BOT_RESERVE_BASE + BOT_RESERVE_PER_OPPONENT * (view.seats.length - 1)),
  );
export const BOT_RESERVE_BASE = 0.14;
export const BOT_RESERVE_PER_OPPONENT = 0.024;

/** A stable pseudo-random factor in [lo, hi] for a bot and a situation (no memory needed). */
const factor = (key: number, lo: number, hi: number) =>
  lo + ((((key * 2654435761) >>> 0) % 1000) / 1000) * (hi - lo);

/** One simple, imperfect bot (design §16). Public view only; the same actions as people. */
export function botAction(
  view: BusinessView,
  seat: number,
  rng: SeededRng,
  mistakeRate: number,
): BusinessAction | null {
  const turn = view.turn;
  const me = view.players[seat];
  if (!me || view.phase === 'OVER') return null;
  const reserve = botReserve(view);

  // Other players' auctions and trade offers.
  if (view.phase === 'AUCTION' && view.auction && view.auction.seller !== seat) {
    const a = view.auction;
    if (a.high?.seat === seat) return null;
    const value =
      priceOf(a.space, view.economy) +
      buildingsValue(a.space, view.level[a.space] ?? 0, view.economy);
    const limit = value * factor(a.space * 31 + seat * 7 + turn, 0.8, 1.1);
    const next = a.high ? a.high.amount + BID_STEP : a.open;
    return next <= limit && me.cash - next >= reserve / 2
      ? { type: 'BID', turn, amount: next }
      : null;
  }
  if (view.phase === 'TRADE' && view.trade?.to === seat) {
    const t = view.trade;
    const worth = (o: Offer) =>
      o.cash +
      o.assets.reduce(
        (n, i) =>
          n + priceOf(i, view.economy) + buildingsValue(i, view.level[i] ?? 0, view.economy),
        0,
      );
    let accept = worth(t.give) >= 1.1 * worth(t.get) && me.cash >= t.get.cash;
    if (rng.int(1, 10) === 1) accept = !accept && me.cash >= t.get.cash;
    return { type: 'TRADE_ANSWER', turn, accept };
  }
  if (view.current !== seat) return null;

  const completes = (space: number) => {
    const g = groupOf(space);
    return (
      g !== null &&
      groupSpaces(g).filter((i) => view.owner[i] === seat).length + 1 >= view.economy.groupThreshold
    );
  };
  const close = (after: number) =>
    Math.abs(after - reserve) < 0.2 * reserve && rng.int(1, 1000) <= mistakeRate * 1000;

  switch (view.phase) {
    case 'ROLL': {
      // Now and then, offer cash for the city that completes a group.
      if (view.tradesThisTurn === 0 && view.round % 5 === seat % 5) {
        for (const i of CITY_SPACES) {
          const owner = view.owner[i];
          if (owner === null || owner === undefined || owner === seat) continue;
          if ((view.lockedUntil[i] ?? 0) > view.round || !completes(i)) continue;
          const cash = Math.round((priceOf(i, view.economy) * 1.3) / 100) * 100;
          if (me.cash - cash < reserve) continue;
          return {
            type: 'TRADE_PROPOSE',
            turn,
            to: owner,
            give: { cash, assets: [] },
            get: { cash: 0, assets: [i] },
          };
        }
      }
      return { type: 'ROLL', turn };
    }
    case 'EVENT':
      return { type: 'EVENT_ROLL', turn };
    case 'RAISE':
      return { type: 'BANK_HANDLES_IT', turn };
    case 'DECIDE': {
      const d = view.decision;
      if (!d) return null;
      if (d.kind === 'JAIL') {
        return me.cash >= 3 * d.cost ? { type: 'JAIL_PAY', turn } : { type: 'JAIL_WAIT', turn };
      }
      if (d.kind === 'FREE_BUILD') {
        // The free level goes where it adds most rent: the dearest eligible city.
        const pick = [...(d.options ?? [])].sort(
          (a, b) => priceOf(b, view.economy) - priceOf(a, view.economy) || a - b,
        )[0];
        return pick === undefined ? null : { type: 'FREE_BUILD', turn, space: pick };
      }
      if (d.kind === 'BUILD') {
        // One level per action, again and again while the reserve allows.
        const after = me.cash - d.cost;
        let wants = after >= reserve;
        if (close(after)) wants = !wants;
        return wants && after >= 0
          ? { type: 'BUILD', turn, space: d.space }
          : { type: 'SKIP', turn };
      }
      const after = me.cash - d.cost;
      let wants = after >= reserve || (completes(d.space) && after >= reserve / 3);
      if (close(after)) wants = !wants;
      if (!wants || after < 0) return { type: 'SKIP', turn };
      return { type: 'BUY', turn, space: d.space };
    }
    default:
      return null;
  }
}

export const businessGame = createBusinessGame();

/** Business has no hidden information (dice are rolled on the server; no deck). */
export const perturbBusinessHidden = (s: BusinessState, _viewer: SeatIndex, _rng: SeededRng) => s;

export { round10 };
