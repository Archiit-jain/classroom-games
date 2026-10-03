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
  BOARD,
  BOARD_SIZE,
  CARDS,
  DEFAULT_ECONOMY,
  INDUSTRY_SPACES,
  MAX_LEVEL,
  MAX_PLAYERS,
  MIN_PLAYERS,
  OWNABLE_SPACES,
  ROUND_OPTIONS,
  WHEEL,
  cardById,
  cityFee,
  developCost,
  isCity,
  isIndustry,
  priceOf,
  regionOf,
  regionSpaces,
  round5,
  type Card,
  type Deck,
  type Economy,
} from '../shared/board';
import type {
  BusinessAction,
  BusinessEvent,
  BusinessSettings,
  BusinessState,
  BusinessTiming,
  BusinessView,
  Choice,
  Decision,
  LogEntry,
  PayReason,
  SeatMap,
  Sold,
} from '../shared/types';

export const BUSINESS_GAME_ID = 'business';
const PHASE_TIMER = 'phase';
const LOG_SIZE = 30;

/** Play-test values (design §2). */
export const DEFAULT_TIMING: BusinessTiming = {
  rollMs: 10_000,
  decideMs: 15_000,
  hopMs: 160,
  landingMs: 1200,
};

export interface BusinessOptions {
  /** Multiplies every duration (dev/e2e speed-ups; production uses 1). */
  timeScale?: number;
  timing?: Partial<BusinessTiming>;
  economy?: Partial<Economy>;
  /** Bot delays (ms, scaled). */
  botRollMs?: [number, number];
  botThinkMs?: [number, number];
  /** Share of close buy/develop calls a bot gets "wrong" (human-like). */
  botMistakeRate?: number;
  /** Consecutive automatic actions before a connected player is handed to a bot. */
  idleAfterAutoActs?: number;
  /** The card set (the economy simulation swaps in no-op cards to measure their effect). */
  cards?: readonly Card[];
  /** Tests only: script the dice (default: fair six-sided dice from the match RNG). */
  dice?: (rng: SeededRng, count: number) => number[];
}

type T = Transition<BusinessState, BusinessEvent>;

const turnField = z.number().int().min(0).max(100_000);
const spaceField = z
  .number()
  .int()
  .min(0)
  .max(BOARD_SIZE - 1);
const actionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ROLL'), turn: turnField }),
  z.strictObject({ type: z.literal('BUY'), turn: turnField, space: spaceField }),
  z.strictObject({ type: z.literal('DEVELOP'), turn: turnField, space: spaceField }),
  z.strictObject({ type: z.literal('SKIP'), turn: turnField }),
]);

// ───────────────────────────── pure helpers ─────────────────────────────

/** Coins + price of everything owned + development spent (design §8). */
export function wealthOf(
  s: Pick<BusinessState, 'coins' | 'owner' | 'level' | 'economy'>,
  seat: number,
) {
  let total = s.coins[seat] ?? 0;
  for (const i of OWNABLE_SPACES) {
    if (s.owner[i] !== seat) continue;
    total += priceOf(i, s.economy);
    if (isCity(BOARD[i])) total += Math.max(0, (s.level[i] ?? 1) - 1) * developCost(i, s.economy);
  }
  return total;
}

export const ownsRegion = (s: Pick<BusinessState, 'owner'>, space: number, seat: number) => {
  const region = regionOf(space);
  return region !== null && regionSpaces(region).every((i) => s.owner[i] === seat);
};

/** The visitor fee a player pays on landing on someone else's place (0 if none). */
export function feeAt(
  s: Pick<BusinessState, 'owner' | 'level' | 'economy'>,
  space: number,
): number {
  const owner = s.owner[space];
  if (owner === null || owner === undefined) return 0;
  if (isIndustry(BOARD[space])) {
    return s.economy.factoryVisit * INDUSTRY_SPACES.filter((i) => s.owner[i] === owner).length;
  }
  return cityFee(space, s.level[space] ?? 1, ownsRegion(s, space, owner), s.economy);
}

const rank = (seats: number[], value: (seat: number) => number) =>
  seats.map((seat) => ({
    seat,
    place: 1 + seats.filter((o) => value(o) > value(seat)).length,
  }));

/** A mutable working copy for one transition (the input state is never touched). */
interface Work {
  s: BusinessState;
  /** Passed or landed on Start during this transition. */
  passed?: boolean;
  events: Scoped<BusinessEvent>[];
  requests: RuntimeRequest[];
}

export function createBusinessGame(
  options: BusinessOptions = {},
): GameModule<BusinessState, BusinessAction, BusinessView, BusinessEvent, BusinessSettings> {
  const scale = options.timeScale ?? 1;
  const scaled = (v: number) => Math.max(0, Math.round(v * scale));
  const timing: BusinessTiming = {
    rollMs: scaled(options.timing?.rollMs ?? DEFAULT_TIMING.rollMs),
    decideMs: scaled(options.timing?.decideMs ?? DEFAULT_TIMING.decideMs),
    hopMs: scaled(options.timing?.hopMs ?? DEFAULT_TIMING.hopMs),
    landingMs: scaled(options.timing?.landingMs ?? DEFAULT_TIMING.landingMs),
  };
  const economy: Economy = { ...DEFAULT_ECONOMY, ...options.economy };
  const [rollMin, rollMax] = (options.botRollMs ?? [600, 1400]).map(scaled) as [number, number];
  const [thinkMin, thinkMax] = (options.botThinkMs ?? [800, 2000]).map(scaled) as [number, number];
  const mistakeRate = options.botMistakeRate ?? 0.1;
  const idleAfter = options.idleAfterAutoActs ?? 3;
  const cards = options.cards ?? CARDS;
  const rollDice =
    options.dice ??
    ((rng: SeededRng, count: number) => Array.from({ length: count }, () => rng.int(1, 6)));
  const cardOf = (id: string) => cards.find((c) => c.id === id) ?? cardById(id);

  // ── ledger ──
  const log = (w: Work, entry: LogEntry) => {
    w.s.log = [...w.s.log, entry].slice(-LOG_SIZE);
    w.events.push(toAll({ type: 'LOG', entry }));
  };
  const gain = (w: Work, seat: number, amount: number) => {
    w.s.coins[seat] = (w.s.coins[seat] ?? 0) + amount;
    w.s.bankNet += amount;
  };

  /** Sells assets back to the bank at the sell-back share until `seat` has `needed` coins. */
  function clearance(w: Work, seat: number, needed: number) {
    const s = w.s;
    const sold: Sold[] = [];
    let raised = 0;
    const owned = () => OWNABLE_SPACES.filter((i) => s.owner[i] === seat);
    const byPrice = (a: number, b: number) =>
      priceOf(a, s.economy) - priceOf(b, s.economy) || a - b;
    while ((s.coins[seat] ?? 0) < needed) {
      const developed = owned()
        .filter((i) => (s.level[i] ?? 0) > 1)
        .sort((a, b) => (s.level[b] ?? 0) - (s.level[a] ?? 0) || byPrice(a, b));
      const pick = developed[0];
      if (pick !== undefined) {
        const value = round5(developCost(pick, s.economy) * s.economy.sellBack);
        s.level[pick] = (s.level[pick] ?? 1) - 1;
        gain(w, seat, value);
        raised += value;
        sold.push({ space: pick, what: 'level', value });
        continue;
      }
      const place = owned().sort(byPrice)[0];
      if (place === undefined) break;
      const value = round5(priceOf(place, s.economy) * s.economy.sellBack);
      s.owner[place] = null;
      s.level[place] = 0;
      gain(w, seat, value);
      raised += value;
      sold.push({ space: place, what: 'place', value });
    }
    if (sold.length > 0) log(w, { type: 'CLEARANCE', seat, sold, raised });
  }

  /** Moves coins from a player to another player or the bank (null), selling up if needed. */
  function pay(
    w: Work,
    from: number,
    to: number | null,
    amount: number,
    reason: PayReason,
    space?: number,
  ) {
    if (amount <= 0) return;
    const s = w.s;
    if ((s.coins[from] ?? 0) < amount) clearance(w, from, amount);
    const paid = Math.min(amount, s.coins[from] ?? 0);
    s.coins[from] = (s.coins[from] ?? 0) - paid;
    if (to === null) s.bankNet -= paid;
    else s.coins[to] = (s.coins[to] ?? 0) + paid;
    const writtenOff = amount - paid;
    s.writtenOff += writtenOff;
    log(w, {
      type: 'PAID',
      from,
      to,
      amount: paid,
      reason,
      ...(space !== undefined ? { space } : {}),
      writtenOff,
    });
  }

  // ── movement and landing ──
  function passStart(w: Work, seat: number) {
    w.passed = true;
    gain(w, seat, w.s.economy.salary);
    log(w, { type: 'SALARY', seat, amount: w.s.economy.salary });
    const industries = INDUSTRY_SPACES.filter((i) => w.s.owner[i] === seat).length;
    if (industries > 0) {
      const amount =
        industries * w.s.economy.dividend +
        (industries === INDUSTRY_SPACES.length ? w.s.economy.dividendSetBonus : 0);
      gain(w, seat, amount);
      log(w, { type: 'DIVIDEND', seat, amount });
    }
  }

  /** Moves `steps` (negative = backwards; only forward moves pass Start). Returns the hops. */
  function move(w: Work, seat: number, steps: number): number[] {
    const from = w.s.positions[seat] ?? 0;
    const path: number[] = [];
    const dir = Math.sign(steps);
    let at = from;
    for (let k = 0; k < Math.abs(steps); k++) {
      at = (at + dir + BOARD_SIZE) % BOARD_SIZE;
      path.push(at);
      if (dir > 0 && at === 0) passStart(w, seat);
    }
    w.s.positions[seat] = at;
    return path;
  }

  function freeLevel(w: Work, seat: number, fallback: number, reason: 'card' | 'wheel') {
    const s = w.s;
    const pick = OWNABLE_SPACES.filter(
      (i) => s.owner[i] === seat && isCity(BOARD[i]) && (s.level[i] ?? 0) < MAX_LEVEL,
    ).sort(
      (a, b) =>
        (s.level[a] ?? 0) - (s.level[b] ?? 0) ||
        priceOf(a, s.economy) - priceOf(b, s.economy) ||
        a - b,
    )[0];
    if (pick === undefined) {
      gain(w, seat, fallback);
      log(w, { type: 'GAINED', seat, amount: fallback, reason });
      return;
    }
    s.level[pick] = (s.level[pick] ?? 1) + 1;
    log(w, { type: 'DEVELOPED', seat, space: pick, level: s.level[pick] as number, cost: 0 });
  }

  function draw(w: Work, deck: Deck, rng: SeededRng): string {
    const d = w.s.decks[deck];
    if (d.draw.length === 0) {
      d.draw = rng.shuffle(d.discard);
      d.discard = [];
    }
    const id = d.draw.shift() as string;
    d.discard.push(id);
    return id;
  }

  /** Applies a card; returns extra hops (movement cards) and any decision on the new space. */
  function applyCard(
    w: Work,
    seat: number,
    cardId: string,
    ctx: StepCtx,
  ): { hops: number; decision: Decision | null } {
    const s = w.s;
    const e = cardOf(cardId).effect;
    const others = s.seats.filter((x) => x !== seat);
    const owns = (spaces: number[]) => spaces.filter((i) => s.owner[i] === seat).length;
    const gainLog = (target: number, amount: number) => {
      gain(w, target, amount);
      log(w, { type: 'GAINED', seat: target, amount, reason: 'card' });
    };
    switch (e.kind) {
      case 'gain':
        gainLog(seat, e.amount);
        break;
      case 'pay':
        pay(w, seat, null, e.amount, 'card');
        break;
      case 'payPerLevel': {
        const levels = OWNABLE_SPACES.filter((i) => s.owner[i] === seat && isCity(BOARD[i])).reduce(
          (sum, i) => sum + (s.level[i] ?? 0),
          0,
        );
        pay(w, seat, null, Math.min(e.max, levels * e.amount), 'card');
        break;
      }
      case 'everyone':
        for (const x of s.seats) {
          if (e.amount >= 0) gainLog(x, e.amount);
          else pay(w, x, null, -e.amount, 'card');
        }
        break;
      case 'payEachOther':
        for (const x of others) pay(w, seat, x, e.amount, 'card');
        break;
      case 'collectEachOther':
        for (const x of others) pay(w, x, seat, e.amount, 'card');
        break;
      case 'industryOwner': {
        const space = BOARD.findIndex((b) => isIndustry(b) && b.id === e.industry);
        const owner = s.owner[space];
        if (owner !== null && owner !== undefined) gainLog(owner, e.amount);
        break;
      }
      case 'perIndustry':
        gainLog(seat, Math.max(e.min, owns(INDUSTRY_SPACES) * e.amount));
        break;
      case 'regionOwners':
        for (const x of s.seats) {
          const n = regionSpaces(e.region).filter((i) => s.owner[i] === x).length;
          if (n === 0) continue;
          if (e.amount >= 0) gainLog(x, n * e.amount);
          else pay(w, x, null, n * -e.amount, 'card');
        }
        break;
      case 'mallOwners':
        for (const x of s.seats) {
          const malls = OWNABLE_SPACES.filter(
            (i) => s.owner[i] === x && s.level[i] === MAX_LEVEL,
          ).length;
          if (malls > 0) gainLog(x, malls * e.amount);
        }
        break;
      case 'freeLevel':
        freeLevel(w, seat, e.fallback, 'card');
        break;
      case 'move':
      case 'toStart': {
        const from = s.positions[seat] ?? 0;
        const steps =
          e.kind === 'toStart' ? (BOARD_SIZE - from) % BOARD_SIZE || BOARD_SIZE : e.steps;
        const path = move(w, seat, steps);
        log(w, { type: 'MOVED', seat, from, to: s.positions[seat] ?? 0 });
        // The new space resolves once; it never draws another card.
        const decision = land(w, seat, ctx, false);
        return { hops: path.length, decision };
      }
    }
    return { hops: 0, decision: null };
  }

  /** Resolves the space `seat` stands on. Returns a decision for the player, if any. */
  function land(w: Work, seat: number, ctx: StepCtx, cards = true): Decision | null {
    const s = w.s;
    const space = s.positions[seat] ?? 0;
    const b = BOARD[space];
    if (!b) return null;
    if (b.kind === 'city' || b.kind === 'industry') {
      const owner = s.owner[space];
      if (owner === null || owner === undefined) {
        const cost = priceOf(space, s.economy);
        return (s.coins[seat] ?? 0) >= cost ? { kind: 'BUY', options: [{ space, cost }] } : null;
      }
      if (owner === seat) {
        if (b.kind !== 'city' || (s.level[space] ?? 0) >= MAX_LEVEL) return null;
        const cost = developCost(space, s.economy);
        return (s.coins[seat] ?? 0) >= cost
          ? { kind: 'DEVELOP', options: [{ space, cost }] }
          : null;
      }
      pay(w, seat, owner, feeAt(s, space), b.kind === 'city' ? 'fee' : 'factory', space);
      return null;
    }
    if (b.kind === 'card') {
      if (!cards) return null;
      const card = draw(w, b.deck, ctx.rng);
      log(w, { type: 'CARD', seat, deck: b.deck, card });
      const out = applyCard(w, seat, card, ctx);
      extraHops += out.hops;
      return out.decision;
    }
    switch (b.corner) {
      case 'lucky': {
        const slice = ctx.rng.int(0, WHEEL.length - 1);
        log(w, { type: 'WHEEL', seat, slice });
        const ws = WHEEL[slice];
        if (ws?.kind === 'gain') {
          gain(w, seat, ws.amount);
          log(w, { type: 'GAINED', seat, amount: ws.amount, reason: 'wheel' });
        } else if (ws) freeLevel(w, seat, ws.fallback, 'wheel');
        return null;
      }
      case 'jam':
        if (!s.slow.includes(seat)) s.slow = [...s.slow, seat];
        log(w, { type: 'JAM', seat });
        return null;
      default:
        return null; // Start (salary paid on arrival) and Chai Break
    }
  }
  let extraHops = 0;

  // ── turns ──
  const enter = (s: BusinessState, phase: BusinessState['phase'], ms: number, ctx: StepCtx) => {
    s.phase = phase;
    s.phaseMs = ms;
    s.phaseEndsAt = ctx.now + ms;
  };

  function startTurn(w: Work, seat: number, ctx: StepCtx): void {
    const s = w.s;
    s.current = seat;
    s.turn += 1;
    s.decision = null;
    enter(s, 'ROLL', s.timing.rollMs, ctx);
    w.events.push(toAll({ type: 'TURN', seat, round: s.round, turn: s.turn }));
  }

  function nextTurn(w: Work, ctx: StepCtx): void {
    const s = w.s;
    let index = s.order.indexOf(s.current) + 1;
    if (index >= s.order.length) {
      index = 0;
      s.round += 1;
    }
    if (s.round > s.rounds) {
      enter(s, 'OVER', 0, ctx);
      s.decision = null;
      const wealth = Object.fromEntries(s.seats.map((x) => [x, wealthOf(s, x)])) as SeatMap<number>;
      w.events.push(toAll({ type: 'MATCH_OVER', wealth }));
      return;
    }
    startTurn(w, s.order[index] as number, ctx);
  }

  const done = (w: Work): T => {
    const s = w.s;
    const timers: T['timers'] =
      s.phase === 'OVER' ? [{ clear: PHASE_TIMER }] : [{ set: PHASE_TIMER, ms: s.phaseMs }];
    return { state: s, events: w.events, timers, requests: w.requests };
  };

  /** Counts automatic actions; three in a row hands the seat to a bot (platform request). */
  function noteAuto(w: Work, seat: number, auto: boolean) {
    const n = auto ? (w.s.autoActs[seat] ?? 0) + 1 : 0;
    w.s.autoActs[seat] = n;
    if (auto && n === idleAfter) w.requests.push({ type: 'MARK_IDLE', seat });
  }

  function roll(s0: BusinessState, ctx: StepCtx, auto: boolean): T {
    const w: Work = { s: structuredClone(s0), events: [], requests: [] };
    const s = w.s;
    const seat = s.current;
    noteAuto(w, seat, auto);
    const slow = s.slow.includes(seat);
    if (slow) s.slow = s.slow.filter((x) => x !== seat);
    const dice = rollDice(ctx.rng, slow ? 1 : 2);
    const from = s.positions[seat] ?? 0;
    const steps = dice.reduce((a, b) => a + b, 0);
    // Announce the roll before anything it causes (salary on the way, the landing).
    w.events.push(
      toAll({
        type: 'ROLLED',
        seat,
        dice,
        from,
        to: (from + steps) % BOARD_SIZE,
        path: Array.from({ length: steps }, (_, k) => (from + k + 1) % BOARD_SIZE),
      }),
    );
    move(w, seat, steps);
    s.lastRoll = { seat, dice, from, to: s.positions[seat] ?? 0 };
    log(w, { type: 'ROLLED', seat, dice, to: s.positions[seat] ?? 0 });
    extraHops = 0;
    const landed = land(w, seat, ctx);
    const hold = (steps + extraHops) * s.timing.hopMs + s.timing.landingMs;
    s.expandDue = w.passed === true;
    const decision = landed ?? takeExpand(s, seat);
    s.decision = decision;
    if (decision) enter(s, 'DECIDE', hold + s.timing.decideMs, ctx);
    else enter(s, 'HOLD', hold, ctx);
    return done(w);
  }

  /** The Start expansion offer, if due and the player can afford any development. */
  function takeExpand(s: BusinessState, seat: number): Decision | null {
    if (!s.expandDue) return null;
    s.expandDue = false;
    const options = OWNABLE_SPACES.filter(
      (i) => s.owner[i] === seat && isCity(BOARD[i]) && (s.level[i] ?? 0) < MAX_LEVEL,
    )
      .map((space) => ({ space, cost: developCost(space, s.economy) }))
      .filter((o) => o.cost <= (s.coins[seat] ?? 0));
    return options.length > 0 ? { kind: 'EXPAND', options } : null;
  }

  function decide(
    s0: BusinessState,
    kind: 'BUY' | 'DEVELOP' | 'SKIP',
    space: number | null,
    ctx: StepCtx,
    auto: boolean,
  ): T {
    const w: Work = { s: structuredClone(s0), events: [], requests: [] };
    const s = w.s;
    const seat = s.current;
    const d = s.decision as Decision;
    noteAuto(w, seat, auto);
    const choice = d.options.find((o) => o.space === space) ?? (d.options[0] as Choice);
    if (kind === 'BUY') {
      s.coins[seat] = (s.coins[seat] ?? 0) - choice.cost;
      s.bankNet -= choice.cost;
      s.owner[choice.space] = seat;
      s.level[choice.space] = 1;
      log(w, { type: 'BOUGHT', seat, space: choice.space, price: choice.cost });
    } else if (kind === 'DEVELOP') {
      s.coins[seat] = (s.coins[seat] ?? 0) - choice.cost;
      s.bankNet -= choice.cost;
      s.level[choice.space] = (s.level[choice.space] ?? 1) + 1;
      log(w, {
        type: 'DEVELOPED',
        seat,
        space: choice.space,
        level: s.level[choice.space] as number,
        cost: choice.cost,
      });
    } else {
      log(w, { type: 'SKIPPED', seat, space: d.kind === 'EXPAND' ? -1 : choice.space });
    }
    // After the landing decision, the Start expansion offer (if due) comes next.
    const expand = d.kind === 'EXPAND' ? null : takeExpand(s, seat);
    if (expand) {
      s.decision = expand;
      enter(s, 'DECIDE', s.timing.decideMs, ctx);
      return done(w);
    }
    s.decision = null;
    nextTurn(w, ctx);
    return done(w);
  }

  const viewOf = (s: BusinessState): BusinessView => {
    const { decks, ...rest } = s;
    return {
      ...rest,
      decks: { news: { left: decks.news.draw.length }, mela: { left: decks.mela.draw.length } },
      wealth: Object.fromEntries(s.seats.map((x) => [x, wealthOf(s, x)])) as SeatMap<number>,
    };
  };

  return {
    manifest: {
      id: BUSINESS_GAME_ID,
      version: 1,
      players: { min: MIN_PLAYERS, max: MAX_PLAYERS },
      sync: 'TURN_PHASE',
      bots: { supported: true, canTakeOverSeat: true },
      publicMatch: { targetPlayers: 4, minHumans: 2 },
      reclaim: 'IMMEDIATE',
      layout: { orientation: 'any' },
    },

    settingsSchema: z.strictObject({ rounds: z.literal(ROUND_OPTIONS) }),
    defaultSettings: { rounds: 16 },
    actionSchema,

    setup(seats, settings, ctx) {
      if (seats.length < MIN_PLAYERS || seats.length > MAX_PLAYERS) {
        throw new Error('Business needs 2–6 players');
      }
      const first = ctx.rng.int(0, seats.length - 1);
      const order = [...seats.slice(first), ...seats.slice(0, first)];
      const per = (v: number) => Object.fromEntries(seats.map((x) => [x, v])) as SeatMap<number>;
      const deckOf = (deck: Deck) => ({
        draw: ctx.rng.shuffle(cards.filter((c) => c.deck === deck).map((c) => c.id)),
        discard: [],
      });
      const s: BusinessState = {
        phase: 'ROLL',
        seats: [...seats],
        order,
        rounds: settings.rounds,
        round: 1,
        turn: 0,
        current: order[0] as number,
        positions: per(0),
        coins: per(economy.startCoins),
        owner: BOARD.map(() => null),
        level: BOARD.map(() => 0),
        slow: [],
        decks: { news: deckOf('news'), mela: deckOf('mela') },
        decision: null,
        expandDue: false,
        lastRoll: null,
        autoActs: per(0),
        log: [],
        economy,
        timing,
        phaseEndsAt: ctx.now,
        phaseMs: 0,
        bankNet: 0,
        writtenOff: 0,
      };
      const w: Work = { s, events: [], requests: [] };
      startTurn(w, order[0] as number, ctx);
      return done(w);
    },

    validateAction(s, seat, a) {
      if (s.phase === 'OVER' || a.turn !== s.turn) return { ok: false, code: 'INVALID_PHASE' };
      if (seat !== s.current) return { ok: false, code: 'NOT_YOUR_TURN' };
      if (a.type === 'ROLL')
        return s.phase === 'ROLL' ? { ok: true } : { ok: false, code: 'INVALID_PHASE' };
      if (s.phase !== 'DECIDE' || !s.decision) return { ok: false, code: 'INVALID_PHASE' };
      if (a.type === 'SKIP') return { ok: true };
      const d = s.decision;
      const kindOk =
        a.type === 'BUY' ? d.kind === 'BUY' : d.kind === 'DEVELOP' || d.kind === 'EXPAND';
      const choice = d.options.find((o) => o.space === a.space);
      if (!kindOk || !choice) return { ok: false, code: 'ILLEGAL_ACTION' };
      if (d.kind !== 'EXPAND' && s.positions[seat] !== a.space) {
        return { ok: false, code: 'ILLEGAL_ACTION' };
      }
      if ((s.coins[seat] ?? 0) < choice.cost) return { ok: false, code: 'ILLEGAL_ACTION' };
      if (a.type === 'BUY' && s.owner[a.space] !== null)
        return { ok: false, code: 'ILLEGAL_ACTION' };
      if (
        a.type === 'DEVELOP' &&
        (s.owner[a.space] !== seat || (s.level[a.space] ?? 0) >= MAX_LEVEL)
      ) {
        return { ok: false, code: 'ILLEGAL_ACTION' };
      }
      return { ok: true };
    },

    applyAction(s, _seat, a, ctx) {
      if (a.type === 'ROLL') return roll(s, ctx, false);
      return decide(s, a.type, a.type === 'SKIP' ? null : a.space, ctx, false);
    },

    onTimer(s, timer, ctx) {
      if (timer !== PHASE_TIMER) return { state: s, events: [] };
      switch (s.phase) {
        case 'ROLL':
          return roll(s, ctx, true);
        case 'DECIDE':
          return decide(s, 'SKIP', null, ctx, true);
        case 'HOLD': {
          const w: Work = { s: structuredClone(s), events: [], requests: [] };
          nextTurn(w, ctx);
          return done(w);
        }
        case 'OVER':
          return { state: s, events: [] };
      }
    },

    onSeatChange(s, seat, change) {
      if (change === 'BOT_TOOK_OVER' || change === 'RECLAIMED') {
        return { state: { ...s, autoActs: { ...s.autoActs, [seat]: 0 } }, events: [] };
      }
      return { state: s, events: [] };
    },

    getPlayerView: (s) => viewOf(s),
    isOver: (s) => s.phase === 'OVER',

    getResults(s) {
      const wealth = (x: number) => wealthOf(s, x);
      return {
        placements: rank(s.seats, wealth),
        stats: Object.fromEntries(
          s.seats.map((x) => [
            x,
            {
              wealth: wealth(x),
              coins: s.coins[x] ?? 0,
              cities: OWNABLE_SPACES.filter((i) => s.owner[i] === x && isCity(BOARD[i])).length,
            },
          ]),
        ),
      };
    },

    bot: {
      createMemory: () => null,
      observe: (memory) => memory,
      decide(view, _memory, ctx) {
        if (view.phase === 'OVER' || view.current !== ctx.seat) return null;
        if (view.phase === 'ROLL') {
          return {
            kind: 'ACTION',
            action: { type: 'ROLL', turn: view.turn },
            thinkMs: ctx.rng.int(rollMin, rollMax),
          };
        }
        if (view.phase !== 'DECIDE' || !view.decision) return null;
        return {
          kind: 'ACTION',
          action: botChoice(view, ctx.seat, ctx.rng, mistakeRate),
          thinkMs: ctx.rng.int(thinkMin, thinkMax),
        };
      },
    },
  };
}

/** The bot's buy/develop call (design §11). Public view only. */
export function botChoice(
  view: BusinessView,
  seat: number,
  rng: SeededRng,
  mistakeRate: number,
): BusinessAction {
  const d = view.decision as Decision;
  const coins = view.coins[seat] ?? 0;
  const reserve = 150 + 25 * (view.seats.length - 1);
  const completes = (space: number) => {
    const region = regionOf(space);
    return (
      region !== null && regionSpaces(region).every((i) => i === space || view.owner[i] === seat)
    );
  };
  // EXPAND: the best city to develop — a complete region first, then the dearest.
  const ranked = [...d.options].sort(
    (a, b) =>
      Number(completes(b.space)) - Number(completes(a.space)) ||
      priceOf(b.space, view.economy) - priceOf(a.space, view.economy),
  );
  const pick = (d.kind === 'EXPAND' ? ranked[0] : d.options[0]) as Choice;
  const after = coins - pick.cost;
  let wants = after >= reserve || (d.kind === 'BUY' && completes(pick.space) && after >= 50);
  // Human-like: close calls sometimes go the other way.
  if (Math.abs(after - reserve) < 0.2 * reserve && rng.int(1, 1000) <= mistakeRate * 1000) {
    wants = !wants;
  }
  if (!wants || after < 0) return { type: 'SKIP', turn: view.turn };
  return { type: d.kind === 'BUY' ? 'BUY' : 'DEVELOP', turn: view.turn, space: pick.space };
}

export const businessGame = createBusinessGame();

/** Leak-checker helper: reshuffles the hidden deck order; views must not change. */
export function perturbBusinessHidden(
  s: BusinessState,
  _viewer: SeatIndex,
  rng: SeededRng,
): BusinessState {
  return {
    ...s,
    decks: {
      news: { ...s.decks.news, draw: rng.shuffle(s.decks.news.draw) },
      mela: { ...s.decks.mela, draw: rng.shuffle(s.decks.mela.draw) },
    },
  };
}
