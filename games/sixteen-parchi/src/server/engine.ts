import {
  toAll,
  toSeats,
  type GameModule,
  type RuntimeRequest,
  type Scoped,
  type SeatIndex,
  type SeededRng,
  type StepCtx,
  type Transition,
} from '@cg/game-sdk';
import { z } from 'zod';
import { CATEGORIES, CATEGORY_IDS, categoryById } from '../shared/categories';
import {
  CHITS_PER_PLAYER,
  COPIES_PER_ITEM,
  PLAYERS,
  TOTAL_CHITS,
  countItems,
  isFullSet,
  largestGroup,
  nextActive,
  type Chit,
  type Finish,
  type FinishReason,
  type ParchiAction,
  type ParchiEvent,
  type ParchiSettings,
  type ParchiState,
  type ParchiTiming,
  type ParchiView,
  type PassMove,
  type Phase,
  type SeatMap,
} from '../shared/types';

export const SIXTEEN_PARCHI_GAME_ID = 'sixteen-parchi';
const PHASE_TIMER = 'phase';

/** Spec §11 / Appendix A timings (claim hold: spec §15 animation hold). */
export const DEFAULT_TIMING: ParchiTiming = {
  dealMs: 2000,
  selectMs: 10_000,
  settleMs: 300,
  passMs: 1200,
  claimMs: 6000,
  claimHoldMs: 1500,
};

export const DEFAULT_CYCLE_CAP = 100;

export interface ParchiOptions {
  /** Multiplies every duration (dev/e2e speed-ups; production uses 1). */
  timeScale?: number;
  /** Per-phase overrides (tests). */
  timing?: Partial<ParchiTiming>;
  /** Bot delay before choosing a slip, in ms (scaled by timeScale). */
  botThinkMs?: [min: number, max: number];
  /** Bot delay before claiming, in ms (scaled) — lets humans win claim races. */
  botClaimMs?: [min: number, max: number];
  /** Consecutive auto-picks before the seat is handed to a bot. */
  idleAfterAutoPicks?: number;
  /** Passing cycles before the safety cap ends the match. */
  cycleCap?: number;
  /**
   * Test-only: the 16 items in dealing order (seat order, four each) instead
   * of a seeded shuffle. Used to rig lucky hands and claim races.
   */
  deck?: (items: readonly string[]) => string[];
}

type T = Transition<ParchiState, ParchiEvent>;
type Ev = Scoped<ParchiEvent>;

const HANDLE_CHARS = 'abcdefghijkmnpqrstuvwxyz23456789';

/** A fresh random handle, unique among `taken` (which it is added to). */
function newHandle(rng: SeededRng, taken: Set<string>): string {
  for (;;) {
    let handle = 'p';
    for (let i = 0; i < 7; i++) handle += HANDLE_CHARS[rng.int(0, HANDLE_CHARS.length - 1)];
    if (!taken.has(handle)) {
      taken.add(handle);
      return handle;
    }
  }
}

function allHandles(hands: SeatMap<Chit[]>): Set<string> {
  return new Set(Object.values(hands).flatMap((hand) => hand.map((c) => c.handle)));
}

/**
 * The safe auto-pick (spec §11), also the bot's strategy: keep the item you
 * hold most of, pass one you hold fewest of; ties broken by the RNG.
 */
export function safePick(hand: readonly Chit[], rng: SeededRng): Chit {
  if (hand.length === 0) throw new Error('Cannot pick from an empty hand');
  const counts = countItems(hand);
  const fewest = Math.min(...counts.values());
  const candidates = [...counts.entries()].filter(([, n]) => n === fewest).map(([item]) => item);
  const item = rng.pick(candidates.sort());
  return rng.pick(hand.filter((c) => c.item === item));
}

export function createSixteenParchiGame(
  options: ParchiOptions = {},
): GameModule<ParchiState, ParchiAction, ParchiView, ParchiEvent, ParchiSettings> {
  const scale = options.timeScale ?? 1;
  const ms = (key: keyof ParchiTiming) =>
    Math.round((options.timing?.[key] ?? DEFAULT_TIMING[key]) * scale);
  const timing: ParchiTiming = {
    dealMs: ms('dealMs'),
    selectMs: ms('selectMs'),
    settleMs: ms('settleMs'),
    passMs: ms('passMs'),
    claimMs: ms('claimMs'),
    claimHoldMs: ms('claimHoldMs'),
  };
  const range = (r: [number, number] | undefined, fallback: [number, number]) =>
    (r ?? fallback).map((v) => Math.max(0, Math.round(v * scale))) as [number, number];
  const [thinkMin, thinkMax] = range(options.botThinkMs, [800, 2500]);
  const [claimMin, claimMax] = range(options.botClaimMs, [800, 2500]);
  const idleAfter = options.idleAfterAutoPicks ?? 3;
  const cycleCap = options.cycleCap ?? DEFAULT_CYCLE_CAP;

  const enter = (s: ParchiState, phase: Phase, phaseMs: number, ctx: StepCtx): ParchiState => ({
    ...s,
    phase,
    phaseMs,
    phaseEndsAt: ctx.now + phaseMs,
  });

  const startSelecting = (s: ParchiState, ctx: StepCtx, events: Ev[] = []): T => ({
    state: enter({ ...s, selections: {}, eligible: [] }, 'SELECTING', s.timing.selectMs, ctx),
    events,
    timers: [{ set: PHASE_TIMER, ms: s.timing.selectMs }],
  });

  const finishMatch = (s: ParchiState, events: Ev[], endedByCap: boolean, ctx: StepCtx): T => {
    const state: ParchiState = {
      ...s,
      phase: 'OVER',
      phaseMs: 0,
      phaseEndsAt: ctx.now,
      selections: {},
      eligible: [],
      endedByCap,
    };
    return {
      state,
      events: [
        ...events,
        toAll({
          type: 'MATCH_OVER',
          placements: state.finishes.map(({ seat, place }) => ({ seat, place })),
          endedByCap,
        }),
      ],
      timers: [{ clear: PHASE_TIMER }],
    };
  };

  /** Removes `seat` from the circle with the next placement. */
  const finishSeat = (
    s: ParchiState,
    seat: number,
    reason: FinishReason,
  ): { state: ParchiState; events: Ev[] } => {
    const finish: Finish = {
      seat,
      place: s.finishes.length + 1,
      items: (s.hands[seat] ?? []).map((c) => c.item),
      reason,
      cycle: s.cycle,
    };
    const hands = { ...s.hands };
    delete hands[seat];
    const selections = { ...s.selections };
    delete selections[seat];
    const active = s.active.filter((a) => a !== seat);
    return {
      state: {
        ...s,
        hands,
        selections,
        active,
        eligible: s.eligible.filter((e) => e !== seat),
        finishes: [...s.finishes, finish],
      },
      events: [
        toAll({
          type: 'CLAIM_ACCEPTED',
          seat,
          place: finish.place,
          items: finish.items,
          reason,
        }),
        toAll({ type: 'CIRCLE_CHANGED', active }),
      ],
    };
  };

  /**
   * A claim (manual or automatic). When one player is left they take the last
   * place and the match is over.
   */
  const claim = (
    s: ParchiState,
    seat: number,
    reason: FinishReason,
  ): { state: ParchiState; events: Ev[]; over: boolean } => {
    const first = finishSeat(s, seat, reason);
    if (first.state.active.length > 1) return { ...first, over: false };
    const last = first.state.active[0];
    if (last === undefined) return { ...first, over: true };
    const final = finishSeat(first.state, last, 'LAST');
    return { state: final.state, events: [...first.events, ...final.events], over: true };
  };

  /** Ends the match by the safety cap: largest same-item group first, seeded tie-break. */
  const endByCap = (s: ParchiState, ctx: StepCtx): T => {
    const ranked = ctx.rng
      .shuffle(s.active)
      .map((seat, order) => ({ seat, order, best: largestGroup(s.hands[seat] ?? []) }))
      .sort((a, b) => b.best - a.best || a.order - b.order);
    let state = s;
    const events: Ev[] = [];
    for (const { seat } of ranked) {
      const done = finishSeat(state, seat, 'CAP');
      state = done.state;
      events.push(...done.events);
    }
    return finishMatch(state, events, true, ctx);
  };

  /** After dealing or a pass: open a claim window, end by the cap, or select again. */
  const check = (s: ParchiState, ctx: StepCtx): T => {
    const eligible = s.active.filter((seat) => isFullSet(s.hands[seat]));
    if (eligible.length > 0) {
      const state = enter(
        { ...s, eligible, selections: {} },
        'CLAIM_WINDOW',
        s.timing.claimMs,
        ctx,
      );
      return {
        state,
        events: [
          toAll({ type: 'CLAIM_WINDOW_OPENED', deadline: state.phaseEndsAt }),
          toSeats(eligible, { type: 'YOU_CAN_CLAIM' } as ParchiEvent),
        ],
        timers: [{ set: PHASE_TIMER, ms: s.timing.claimMs }],
      };
    }
    if (s.cycle >= s.cycleCap) return endByCap(s, ctx);
    return startSelecting(s, ctx);
  };

  /** After claims: hold for the animation unless the match is over. */
  const afterClaims = (
    result: { state: ParchiState; events: Ev[]; over: boolean },
    ctx: StepCtx,
  ): T => {
    if (result.over) return finishMatch(result.state, result.events, false, ctx);
    if (result.state.eligible.length > 0) return { state: result.state, events: result.events };
    return {
      state: enter(result.state, 'CLAIM_HOLD', result.state.timing.claimHoldMs, ctx),
      events: result.events,
      timers: [{ set: PHASE_TIMER, ms: result.state.timing.claimHoldMs }],
    };
  };

  /** Selection time is over: auto-pick for anyone missing, then pass everything at once. */
  const resolvePass = (s: ParchiState, ctx: StepCtx): T => {
    const events: Ev[] = [];
    const requests: RuntimeRequest[] = [];
    const selections = { ...s.selections };
    const autoPicks = { ...s.autoPicks };
    for (const seat of s.active) {
      if (selections[seat] !== undefined) continue;
      const pick = safePick(s.hands[seat] ?? [], ctx.rng);
      selections[seat] = pick.handle;
      const count = (autoPicks[seat] ?? 0) + 1;
      autoPicks[seat] = count;
      if (count === idleAfter) requests.push({ type: 'MARK_IDLE', seat });
      events.push(
        toAll({ type: 'SEAT_SELECTED', seat }),
        toSeats([seat], {
          type: 'MY_SELECTION',
          handle: pick.handle,
          item: pick.item,
          auto: true,
        } as ParchiEvent),
      );
    }

    const moves: PassMove[] = s.active.map((from) => ({ from, to: nextActive(s.active, from) }));
    const outgoing = new Map<number, Chit>();
    const hands: SeatMap<Chit[]> = {};
    for (const seat of s.active) {
      const hand = s.hands[seat] ?? [];
      const chosen = hand.find((c) => c.handle === selections[seat]);
      if (!chosen) throw new Error(`Seat ${seat} has no selected slip`);
      outgoing.set(seat, chosen);
      hands[seat] = hand.filter((c) => c !== chosen);
    }
    const taken = allHandles(s.hands);
    const cycle = s.cycle + 1;
    events.push(toAll({ type: 'PASS_RESOLVED', moves, cycle }));
    for (const { from, to } of moves) {
      const chit = outgoing.get(from) as Chit;
      const received: Chit = { handle: newHandle(ctx.rng, taken), item: chit.item };
      hands[to] = [...(hands[to] ?? []), received];
      events.push(
        toSeats([from], { type: 'CHIT_SENT', handle: chit.handle, to } as ParchiEvent),
        toSeats([to], {
          type: 'CHIT_RECEIVED',
          handle: received.handle,
          item: received.item,
          from,
        } as ParchiEvent),
      );
    }

    return {
      state: enter(
        { ...s, hands, selections: {}, autoPicks, cycle },
        'PASSING',
        s.timing.passMs,
        ctx,
      ),
      events,
      timers: [{ set: PHASE_TIMER, ms: s.timing.passMs }],
      requests,
    };
  };

  const nothing = (s: ParchiState): T => ({ state: s, events: [] });

  return {
    manifest: {
      id: SIXTEEN_PARCHI_GAME_ID,
      version: 1,
      players: { min: PLAYERS, max: PLAYERS },
      sync: 'TURN_PHASE',
      bots: { supported: true, canTakeOverSeat: true },
      publicMatch: { enabled: true, targetPlayers: PLAYERS, minHumans: 2 },
      reclaim: 'IMMEDIATE',
      layout: { orientation: 'any' },
    },

    settingsSchema: z.strictObject({
      category: z.enum(['RANDOM', ...CATEGORY_IDS] as [string, ...string[]]),
    }),
    defaultSettings: { category: 'RANDOM' },

    actionSchema: z.discriminatedUnion('type', [
      z.strictObject({ type: z.literal('SELECT'), handle: z.string().min(1).max(16) }),
      z.strictObject({ type: z.literal('CLAIM') }),
    ]),

    setup(seats, settings, ctx) {
      if (seats.length !== PLAYERS) throw new Error('16 Parchi needs exactly 4 seats');
      const category =
        settings.category === 'RANDOM'
          ? ctx.rng.pick(CATEGORIES)
          : (categoryById(settings.category) ?? ctx.rng.pick(CATEGORIES));
      const items = category.items.map((i) => i.id);
      const deck = options.deck
        ? options.deck(items)
        : ctx.rng.shuffle(items.flatMap((item) => Array<string>(COPIES_PER_ITEM).fill(item)));
      if (
        deck.length !== TOTAL_CHITS ||
        items.some((item) => deck.filter((d) => d === item).length !== COPIES_PER_ITEM)
      ) {
        throw new Error('A deck must hold exactly four copies of each of the four items');
      }

      const taken = new Set<string>();
      const hands: SeatMap<Chit[]> = {};
      seats.forEach((seat, i) => {
        hands[seat] = deck
          .slice(i * CHITS_PER_PLAYER, (i + 1) * CHITS_PER_PLAYER)
          .map((item) => ({ handle: newHandle(ctx.rng, taken), item }));
      });
      const zero = Object.fromEntries(seats.map((seat) => [seat, 0])) as SeatMap<number>;
      const initial: ParchiState = {
        phase: 'DEALING',
        seats: [...seats],
        categoryId: category.id,
        items,
        hands,
        selections: {},
        active: [...seats].sort((a, b) => a - b),
        eligible: [],
        finishes: [],
        cycle: 0,
        cycleCap,
        autoPicks: zero,
        phaseEndsAt: ctx.now,
        phaseMs: 0,
        timing,
        endedByCap: false,
      };
      return {
        state: enter(initial, 'DEALING', timing.dealMs, ctx),
        events: seats.map((seat) =>
          toSeats([seat], { type: 'DEALT', hand: hands[seat] as Chit[] } as ParchiEvent),
        ),
        timers: [{ set: PHASE_TIMER, ms: timing.dealMs }],
      };
    },

    validateAction(s, seat, a) {
      if (a.type === 'CLAIM') {
        // A false claim is never shown a button; the server refuses it anyway.
        return s.phase === 'CLAIM_WINDOW' && s.eligible.includes(seat)
          ? { ok: true }
          : { ok: false, code: 'NOT_ELIGIBLE' };
      }
      if (s.phase !== 'SELECTING') return { ok: false, code: 'INVALID_PHASE' };
      if (!s.active.includes(seat)) return { ok: false, code: 'NOT_ELIGIBLE' };
      if (!s.hands[seat]?.some((c) => c.handle === a.handle)) {
        return { ok: false, code: 'ILLEGAL_ACTION' };
      }
      return { ok: true };
    },

    applyAction(s, seat, a, ctx) {
      if (a.type === 'CLAIM') return afterClaims(claim(s, seat, 'CLAIM'), ctx);

      const first = s.selections[seat] === undefined;
      const chosen = (s.hands[seat] ?? []).find((c) => c.handle === a.handle) as Chit;
      const selections = { ...s.selections, [seat]: a.handle };
      const state = { ...s, selections, autoPicks: { ...s.autoPicks, [seat]: 0 } };
      const events: Ev[] = [
        toSeats([seat], {
          type: 'MY_SELECTION',
          handle: a.handle,
          item: chosen.item,
          auto: false,
        } as ParchiEvent),
      ];
      if (first) events.unshift(toAll({ type: 'SEAT_SELECTED', seat }));
      const everyone = s.active.every((x) => selections[x] !== undefined);
      // The last missing choice starts the short settle before the pass.
      const timers = first && everyone ? [{ set: PHASE_TIMER, ms: s.timing.settleMs }] : undefined;
      return timers ? { state, events, timers } : { state, events };
    },

    onTimer(s, timer, ctx) {
      if (timer !== PHASE_TIMER) return nothing(s);
      switch (s.phase) {
        case 'DEALING':
        case 'PASSING':
        case 'CLAIM_HOLD':
          return check(s, ctx);
        case 'SELECTING':
          return resolvePass(s, ctx);
        case 'CLAIM_WINDOW': {
          // Time's up: unclaimed full sets are claimed in a seeded random order.
          let result = { state: s, events: [] as Ev[], over: false };
          for (const seat of ctx.rng.shuffle(s.eligible)) {
            if (result.over) break;
            const next = claim(result.state, seat, 'AUTO_CLAIM');
            result = { ...next, events: [...result.events, ...next.events] };
          }
          return afterClaims(result, ctx);
        }
        case 'OVER':
          return nothing(s);
      }
    },

    onSeatChange(s, seat, change) {
      if (change === 'BOT_TOOK_OVER' || change === 'RECLAIMED') {
        return { state: { ...s, autoPicks: { ...s.autoPicks, [seat]: 0 } }, events: [] };
      }
      return nothing(s);
    },

    getPlayerView(s, viewer): ParchiView {
      return {
        phase: s.phase,
        categoryId: s.categoryId,
        items: s.items,
        cycle: s.cycle,
        cycleCap: s.cycleCap,
        phaseEndsAt: s.phaseEndsAt,
        phaseMs: s.phaseMs,
        active: s.active,
        hand: s.hands[viewer] ?? [],
        mySelection: s.selections[viewer] ?? null,
        selected: s.active.filter((seat) => s.selections[seat] !== undefined),
        canClaim: s.phase === 'CLAIM_WINDOW' && s.eligible.includes(viewer),
        finishes: s.finishes,
        endedByCap: s.endedByCap,
      };
    },

    isOver: (s) => s.phase === 'OVER',

    getResults(s) {
      return { placements: s.finishes.map(({ seat, place }) => ({ seat, place })) };
    },

    bot: {
      createMemory: () => null,
      observe: (memory) => memory,
      /** Uses only the bot's own hand: the same safe pick a timeout would make. */
      decide(view, _memory, ctx) {
        if (view.phase === 'CLAIM_WINDOW' && view.canClaim) {
          return {
            kind: 'ACTION',
            action: { type: 'CLAIM' },
            thinkMs: ctx.rng.int(claimMin, claimMax),
          };
        }
        if (
          view.phase === 'SELECTING' &&
          view.mySelection === null &&
          view.active.includes(ctx.seat) &&
          view.hand.length > 0
        ) {
          return {
            kind: 'ACTION',
            action: { type: 'SELECT', handle: safePick(view.hand, ctx.rng).handle },
            thinkMs: ctx.rng.int(thinkMin, thinkMax),
          };
        }
        return null;
      },
    },
  };
}

export const sixteenParchiGame = createSixteenParchiGame();

/**
 * Leak-checker helper: changes everything hidden from `viewer` — the items in
 * every other active hand (shuffled among them) and which slip each other
 * seat selected. `viewer`'s view must not change.
 */
export function perturbParchiHidden(
  s: ParchiState,
  viewer: SeatIndex,
  rng: SeededRng,
): ParchiState {
  const others = s.active.filter((seat) => seat !== viewer);
  const slots = others.flatMap((seat) => (s.hands[seat] ?? []).map((_, i) => ({ seat, i })));
  const items = rng.shuffle(
    slots.map(({ seat, i }) => (s.hands[seat] as Chit[])[i]?.item as string),
  );
  const hands: SeatMap<Chit[]> = { ...s.hands };
  for (const seat of others) hands[seat] = [...(s.hands[seat] ?? [])];
  slots.forEach(({ seat, i }, k) => {
    const hand = hands[seat] as Chit[];
    hand[i] = { handle: (hand[i] as Chit).handle, item: items[k] as string };
  });
  const selections = { ...s.selections };
  for (const seat of others) {
    if (selections[seat] !== undefined) selections[seat] = rng.pick(hands[seat] as Chit[]).handle;
  }
  return { ...s, hands, selections };
}

/** Rules that must hold after every transition (tests and fuzzing). */
export function checkParchiInvariant(s: ParchiState): void {
  const fail = (msg: string) => {
    throw new Error(`16 Parchi invariant: ${msg}`);
  };
  const finished = s.finishes.map((f) => f.seat);
  if (new Set([...finished, ...s.active]).size !== s.seats.length)
    fail('every seat is active or finished, never both');
  if (s.active.some((seat) => finished.includes(seat))) fail('a finished seat is still active');
  for (const seat of s.active) {
    if ((s.hands[seat]?.length ?? 0) !== CHITS_PER_PLAYER) fail(`seat ${seat} must hold 4 slips`);
  }
  if (Object.keys(s.hands).length !== s.active.length) fail('only active seats hold slips');
  const all = [
    ...s.active.flatMap((seat) => (s.hands[seat] ?? []).map((c) => c.item)),
    ...s.finishes.flatMap((f) => f.items),
  ];
  if (all.length !== TOTAL_CHITS) fail(`there must be 16 slips, found ${all.length}`);
  for (const item of s.items) {
    if (all.filter((i) => i === item).length !== COPIES_PER_ITEM)
      fail(`${item} must appear 4 times`);
  }
  const handles = s.active.flatMap((seat) => (s.hands[seat] ?? []).map((c) => c.handle));
  if (new Set(handles).size !== handles.length) fail('handles must be unique');
  s.finishes.forEach((f, i) => {
    if (f.place !== i + 1) fail('places are 1, 2, 3, 4 in finishing order');
    if (f.reason !== 'CAP' && !f.items.every((item) => item === f.items[0]))
      fail('a claimed set is four of a kind');
  });
  if (s.phase === 'OVER' && s.active.length !== 0) fail('nobody is active once the match is over');
  if (s.phase !== 'OVER' && s.active.length < 2)
    fail('a running match has at least two active seats');
  for (const seat of Object.keys(s.selections).map(Number)) {
    if (!s.hands[seat]?.some((c) => c.handle === s.selections[seat]))
      fail('a selection names a slip in that hand');
  }
  if (s.eligible.some((seat) => !isFullSet(s.hands[seat]))) fail('only full sets are eligible');
}
