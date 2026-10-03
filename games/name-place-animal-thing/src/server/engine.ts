import {
  toAll,
  type BotStreamStep,
  type GameModule,
  type RuntimeRequest,
  type SeatIndex,
  type SeededRng,
  type StepCtx,
  type Transition,
} from '@cg/game-sdk';
import { z } from 'zod';
import { ALIASES, BANK } from '../../content/en';
import {
  ANSWER_MS,
  CATEGORIES,
  LETTERS,
  MIN_BANK_ANSWERS,
  MAX_ANSWER_LENGTH,
  MAX_PLAYERS,
  MIN_VOTING_HUMANS,
  MIN_PLAYERS,
  POINTS,
  ROUND_OPTIONS,
  STOP_UNLOCK_MS,
  answerKey,
  cleanAnswer,
  formatProblem,
  groupId,
  isBlank,
  pluralFolding,
  votesNeeded,
  type AnswerGroup,
  type Answers,
  type Category,
  type CheckedAnswer,
  type DraftChunk,
  type GroupView,
  type NpatAction,
  type NpatEvent,
  type NpatSettings,
  type NpatState,
  type NpatTiming,
  type NpatView,
  type Phase,
  type RoundResult,
  type RoundReview,
  type SeatMap,
} from '../shared';

export const NPAT_GAME_ID = 'name-place-animal-thing';
const PHASE_TIMER = 'phase';
const STOP_TIMER = 'stop';

/**
 * Answer time and STOP unlock are frozen product decisions; the others are
 * play-test values (design §2).
 */
export const DEFAULT_TIMING: NpatTiming = {
  letterMs: 2500,
  answerMs: ANSWER_MS,
  stopUnlockMs: STOP_UNLOCK_MS,
  flushMs: 1000,
  reviewMs: 30_000,
  readOnlyReviewMs: 5000,
  resultMs: 6000,
};

/** The platform moderator's verdict (same shape as `@cg/moderation`'s result). */
export type ModerateFn = (text: string) => { display: string; flags: readonly unknown[] };

export interface NpatOptions {
  /** Multiplies every duration (dev/e2e speed-ups; production uses 1). */
  timeScale?: number;
  timing?: Partial<NpatTiming>;
  /** The platform moderator (the server always passes it; tests may omit it). */
  moderate?: ModerateFn;
  bank?: Record<Category, Record<string, readonly string[]>>;
  aliases?: Record<Category, readonly (readonly string[])[]>;
  /** Bot: delay before its first answer, then between answers (ms, scaled). */
  botFirstMs?: [number, number];
  botNextMs?: [number, number];
  /** Consecutive completely empty sheets before a connected player is handed to a bot. */
  idleAfterEmptyRounds?: number;
}

type T = Transition<NpatState, NpatEvent>;

const answerString = z.string().max(MAX_ANSWER_LENGTH);
const answersSchema = z.strictObject(
  Object.fromEntries(CATEGORIES.map((c) => [c, answerString.optional()])) as Record<
    Category,
    z.ZodOptional<z.ZodString>
  >,
);
const round = z.number().int().min(1).max(1000);

const chunkSchema = z.strictObject({
  round,
  seq: z.number().int().min(1).max(1_000_000),
  answers: answersSchema,
});

const actionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('STOP'), round, answers: answersSchema }),
  z.strictObject({
    type: z.literal('VOTE'),
    round,
    group: z
      .string()
      .max(80)
      .regex(/^[a-z]+:[a-z]+$/u),
    out: z.boolean(),
  }),
  z.strictObject({ type: z.literal('DONE'), round }),
]);

/** Standard competition ranking: equal scores share a place. */
function rank(seats: number[], scores: SeatMap<number>) {
  return seats.map((seat) => ({
    seat,
    place: 1 + seats.filter((o) => (scores[o] ?? 0) > (scores[seat] ?? 0)).length,
  }));
}

/** A sheet without empty entries (what is stored). */
function compact(answers: Answers): Answers {
  const out: Answers = {};
  for (const c of CATEGORIES) {
    const v = answers[c];
    if (v !== undefined && v.trim() !== '') out[c] = v;
  }
  return out;
}

/** Human seats a human is playing right now (bots and bot-controlled seats never vote). */
export const humansOf = (s: NpatState) =>
  s.seats.filter((seat) => !s.bots.includes(seat) && !s.controlled.includes(seat));

/** Players who may vote on a group: the humans who did not write it. */
export const eligibleFor = (s: NpatState, g: AnswerGroup) =>
  humansOf(s).filter((seat) => !g.authors.includes(seat));

const votesFor = (s: NpatState, g: AnswerGroup) => {
  const eligible = eligibleFor(s, g);
  return (s.votes[g.id] ?? []).filter((v) => eligible.includes(v));
};

/**
 * Frozen voting rule (Phase 7): with H human players (H ≥ 3) an answer is rejected
 * when at least ⌊H/2⌋ + 1 of the humans who did not write it vote it out. With 2 or
 * fewer human players there is no voting at all — one player can never reject the
 * other's answer alone. Bots never vote and never count.
 */
export function isRejected(s: NpatState, g: AnswerGroup): boolean {
  const humans = humansOf(s).length;
  return humans >= MIN_VOTING_HUMANS && votesFor(s, g).length >= votesNeeded(humans);
}

/** Is there a vote this review? Only with at least 3 human players. */
const votable = (s: NpatState) => s.review !== null && humansOf(s).length >= MIN_VOTING_HUMANS;

/** Connected human players whose Done is still needed to end the review early. */
const waitingFor = (s: NpatState) =>
  s.phase === 'REVIEW' && votable(s)
    ? humansOf(s).filter((seat) => !s.away.includes(seat) && !s.done.includes(seat))
    : [];

/** Letters the bank covers in every category with at least MIN_BANK_ANSWERS answers. */
export function playableLetters(
  bank: Record<Category, Record<string, readonly string[]>>,
): string[] {
  return LETTERS.filter((l) =>
    CATEGORIES.every((c) => new Set((bank[c][l] ?? []).map(answerKey)).size >= MIN_BANK_ANSWERS),
  );
}

export function createNpatGame(
  options: NpatOptions = {},
): GameModule<NpatState, NpatAction, NpatView, NpatEvent, NpatSettings> {
  const scale = options.timeScale ?? 1;
  const scaled = (v: number) => Math.max(0, Math.round(v * scale));
  const base = { ...DEFAULT_TIMING, ...options.timing };
  const bank = options.bank ?? BANK;
  const aliases = options.aliases ?? ALIASES;
  const moderate = options.moderate;
  const idleAfter = options.idleAfterEmptyRounds ?? 2;
  const [firstMin, firstMax] = (options.botFirstMs ?? [6000, 14_000]).map(scaled) as [
    number,
    number,
  ];
  const [nextMin, nextMax] = (options.botNextMs ?? [4000, 11_000]).map(scaled) as [number, number];

  /** Per category: known key → canonical key (bank entries and their variants). */
  const letters = playableLetters(bank);
  if (letters.length === 0) throw new Error('The answer bank covers no round letter');

  const dictionary = Object.fromEntries(
    CATEGORIES.map((c) => {
      const map = new Map<string, string>();
      for (const list of Object.values(bank[c]))
        for (const w of list) map.set(answerKey(w), answerKey(w));
      for (const variants of aliases[c]) {
        const canonical = answerKey(variants[0] as string);
        for (const v of variants) map.set(answerKey(v), canonical);
      }
      return [c, map];
    }),
  ) as Record<Category, Map<string, string>>;

  /** Moderation verdict: the text to show and whether anything was censored. */
  const moderated = (text: string) => {
    if (!moderate) return { display: text, flagged: false };
    const r = moderate(text);
    return { display: r.display, flagged: r.flags.length > 0 || r.display !== text };
  };

  const enter = (s: NpatState, phase: Phase, phaseMs: number, ctx: StepCtx): NpatState => ({
    ...s,
    phase,
    phaseMs,
    phaseEndsAt: ctx.now + phaseMs,
  });
  const nothing = (s: NpatState): T => ({ state: s, events: [] });

  const startRound = (s: NpatState, ctx: StepCtx): T => {
    const next = enter(
      {
        ...s,
        round: s.round + 1,
        letter: null,
        stopOpen: false,
        drafts: {},
        draftSeq: {},
        flush: [],
        stoppedBy: null,
        review: null,
        votes: {},
        done: [],
      },
      'LETTER',
      s.timing.letterMs,
      ctx,
    );
    return {
      state: next,
      events: [toAll({ type: 'GET_READY', round: next.round })],
      timers: [{ set: PHASE_TIMER, ms: s.timing.letterMs }],
    };
  };

  const startWriting = (s: NpatState, ctx: StepCtx): T => {
    const fresh = letters.filter((l) => !s.usedLetters.includes(l));
    const letter = ctx.rng.pick(fresh.length > 0 ? fresh : letters);
    const next = enter(
      { ...s, letter, usedLetters: [...s.usedLetters, letter] },
      'WRITING',
      s.timing.answerMs,
      ctx,
    );
    return {
      state: next,
      events: [
        toAll({ type: 'WRITING_STARTED', round: s.round, letter, deadline: next.phaseEndsAt }),
      ],
      timers: [
        { set: PHASE_TIMER, ms: s.timing.answerMs },
        { set: STOP_TIMER, ms: Math.min(s.timing.stopUnlockMs, s.timing.answerMs) },
      ],
    };
  };

  /** STOP or time-up: inputs freeze; the last autosaves may still arrive (LOCKING). */
  const endWriting = (s: NpatState, stoppedBy: number | null, ctx: StepCtx): T => {
    const next = enter(
      {
        ...s,
        stoppedBy,
        stopOpen: false,
        // The player who stopped sent their exact sheet with STOP; nothing may replace it.
        flush: humansOf(s).filter((seat) => seat !== stoppedBy),
      },
      'LOCKING',
      s.timing.flushMs,
      ctx,
    );
    return {
      state: next,
      events: [
        toAll(stoppedBy === null ? { type: 'TIME_UP' } : { type: 'STOPPED', seat: stoppedBy }),
      ],
      timers: [{ set: PHASE_TIMER, ms: s.timing.flushMs }, { clear: STOP_TIMER }],
    };
  };

  /** The automatic check of one answer (design §3). */
  const check = (seat: number, raw: string, letter: string, category: Category) => {
    if (isBlank(raw)) return { row: blankRow(seat), key: null };
    const text = cleanAnswer(raw);
    const mod = moderated(text);
    if (mod.flagged) {
      return {
        row: { seat, text: mod.display, status: 'INVALID', reason: 'NOT_ALLOWED', group: null },
        key: null,
      } satisfies { row: CheckedAnswer; key: null };
    }
    const problem = formatProblem(text, letter);
    if (problem) {
      return {
        row: { seat, text, status: 'INVALID', reason: problem, group: null },
        key: null,
      } satisfies { row: CheckedAnswer; key: null };
    }
    const own = answerKey(text);
    const key = dictionary[category].get(own) ?? own;
    return {
      row: {
        seat,
        text,
        status: dictionary[category].has(own) ? 'RECOGNISED' : 'UNVERIFIED',
        reason: null,
        group: null,
      } satisfies CheckedAnswer,
      key,
    };
  };
  const blankRow = (seat: number): CheckedAnswer => ({
    seat,
    text: '',
    status: 'BLANK',
    reason: null,
    group: null,
  });

  const buildReview = (s: NpatState): RoundReview => {
    const letter = s.letter as string;
    const answers = {} as Record<Category, CheckedAnswer[]>;
    const groups: AnswerGroup[] = [];
    for (const category of CATEGORIES) {
      const checked = s.seats.map((seat) =>
        check(seat, s.drafts[seat]?.[category] ?? '', letter, category),
      );
      const folding = pluralFolding(checked.flatMap((c) => (c.key ? [c.key] : [])));
      const byKey = new Map<string, AnswerGroup>();
      answers[category] = checked.map(({ row, key }) => {
        if (!key) return row;
        const final = folding.get(key) ?? key;
        const id = groupId(category, final);
        const group = byKey.get(id) ?? { id, category, authors: [], recognised: false };
        group.authors.push(row.seat);
        group.recognised ||= row.status === 'RECOGNISED' || dictionary[category].has(final);
        byKey.set(id, group);
        return { ...row, group: id };
      });
      groups.push(...byKey.values());
    }
    return { round: s.round, letter, answers, groups };
  };

  /** Locks every sheet, runs the automatic check and opens the review. */
  const lock = (s: NpatState, ctx: StepCtx): T => {
    const review = buildReview(s);
    const humans = humansOf(s);
    const emptyRounds: SeatMap<number> = { ...s.emptyRounds };
    const requests: RuntimeRequest[] = [];
    for (const seat of s.seats) {
      const blank = CATEGORIES.every((c) => isBlank(s.drafts[seat]?.[c] ?? ''));
      const counts = humans.includes(seat) && !s.away.includes(seat);
      emptyRounds[seat] = counts && blank ? (emptyRounds[seat] ?? 0) + 1 : 0;
      if (counts && emptyRounds[seat] === idleAfter) requests.push({ type: 'MARK_IDLE', seat });
    }
    const opened: NpatState = { ...s, review, votes: {}, done: [], flush: [], emptyRounds };
    const ms = votable(opened) ? s.timing.reviewMs : s.timing.readOnlyReviewMs;
    return {
      state: enter(opened, 'REVIEW', ms, ctx),
      events: [toAll({ type: 'REVEALED', round: s.round })],
      timers: [{ set: PHASE_TIMER, ms }],
      requests,
    };
  };

  const scoreRound = (s: NpatState, ctx: StepCtx): T => {
    const review = s.review as RoundReview;
    const rejected = review.groups.filter((g) => isRejected(s, g)).map((g) => g.id);
    const byId = new Map(review.groups.map((g) => [g.id, g]));
    const points: RoundResult['points'] = {};
    const deltas: SeatMap<number> = {};
    const scores: SeatMap<number> = { ...s.scores };
    const unique: SeatMap<number> = { ...s.unique };
    for (const seat of s.seats) {
      const row = {} as Record<Category, number>;
      for (const c of CATEGORIES) {
        const answer = review.answers[c].find((a) => a.seat === seat);
        const group = answer?.group ? byId.get(answer.group) : undefined;
        row[c] =
          !group || rejected.includes(group.id)
            ? POINTS.none
            : group.authors.length === 1
              ? POINTS.unique
              : POINTS.shared;
        if (row[c] === POINTS.unique) unique[seat] = (unique[seat] ?? 0) + 1;
      }
      points[seat] = row;
      deltas[seat] = CATEGORIES.reduce((sum, c) => sum + row[c], 0);
      scores[seat] = (scores[seat] ?? 0) + (deltas[seat] ?? 0);
    }
    const result: RoundResult = {
      round: s.round,
      letter: review.letter,
      points,
      rejected,
      deltas,
      stoppedBy: s.stoppedBy,
    };
    return {
      state: enter({ ...s, scores, unique, last: result }, 'ROUND_RESULT', s.timing.resultMs, ctx),
      events: [toAll({ type: 'ROUND_SCORED', result, scores })],
      timers: [{ set: PHASE_TIMER, ms: s.timing.resultMs }],
    };
  };

  /** Ends the review as soon as every connected human player has tapped Done. */
  const maybeEndReview = (t: T, ctx: StepCtx): T => {
    const s = t.state;
    if (s.phase !== 'REVIEW' || !votable(s) || s.done.length === 0 || waitingFor(s).length > 0) {
      return t;
    }
    const scored = scoreRound(s, ctx);
    return { ...scored, events: [...t.events, ...scored.events] };
  };

  const groupView = (s: NpatState, g: AnswerGroup, viewer: SeatIndex): GroupView => ({
    ...g,
    votes: votesFor(s, g).length,
    eligible: eligibleFor(s, g).length,
    needed: votesNeeded(humansOf(s).length),
    mine: (s.votes[g.id] ?? []).includes(viewer),
  });

  const viewOf = (s: NpatState, viewer: SeatIndex): NpatView => {
    const showReview =
      s.review !== null &&
      (s.phase === 'REVIEW' || s.phase === 'ROUND_RESULT' || s.phase === 'OVER');
    const review = showReview ? (s.review as RoundReview) : null;
    return {
      phase: s.phase,
      round: s.round,
      rounds: s.rounds,
      letter: s.letter,
      categories: CATEGORIES,
      phaseEndsAt: s.phaseEndsAt,
      phaseMs: s.phaseMs,
      stopOpen: s.stopOpen,
      mine: s.drafts[viewer] ?? {},
      mineSeq: s.draftSeq[viewer] ?? 0,
      stoppedBy: s.stoppedBy,
      review: review && {
        round: review.round,
        letter: review.letter,
        answers: review.answers,
        groups: review.groups.map((g) => groupView(s, g, viewer)),
      },
      canVote: s.phase === 'REVIEW' && votable(s) && humansOf(s).includes(viewer),
      done: s.done,
      waitingFor: waitingFor(s),
      scores: s.scores,
      unique: s.unique,
      last: s.last,
    };
  };

  /** A bot's sheet: one bank answer per missing category, typed in at a human pace. */
  function botPlan(view: NpatView, now: number, rng: SeededRng) {
    const letter = view.letter;
    if (view.phase !== 'WRITING' || !letter) return null;
    const missing = CATEGORIES.filter(
      (c) => isBlank(view.mine[c] ?? '') && (bank[c][letter]?.length ?? 0) > 0,
    );
    if (missing.length === 0) return null;
    const order = rng.shuffle([...missing]);
    const delays = order.map((_, i) =>
      i === 0 ? rng.int(firstMin, firstMax) : rng.int(nextMin, nextMax),
    );
    // Finish by ~80 % of the time left, whatever the answer time.
    const budget = Math.max(0, (view.phaseEndsAt - now) * 0.8);
    const total = delays.reduce((a, b) => a + b, 0);
    const factor = total > budget ? budget / total : 1;
    const sheet: Answers = { ...view.mine };
    const steps: BotStreamStep[] = order.map((c, i) => {
      sheet[c] = rng.pick(bank[c][letter] as readonly string[]);
      const chunk: DraftChunk = {
        round: view.round,
        seq: view.mineSeq + i + 1,
        answers: { ...sheet },
      };
      return { delayMs: i === 0 ? 0 : Math.round((delays[i] as number) * factor), chunk };
    });
    return { thinkMs: Math.round((delays[0] as number) * factor), steps };
  }

  return {
    manifest: {
      id: NPAT_GAME_ID,
      version: 1,
      players: { min: MIN_PLAYERS, max: MAX_PLAYERS },
      sync: 'TURN_PHASE',
      bots: { supported: true, canTakeOverSeat: true },
      publicMatch: { targetPlayers: 6, minHumans: 2 },
      reclaim: 'IMMEDIATE',
      layout: { orientation: 'any' },
    },

    settingsSchema: z.strictObject({
      rounds: z.literal(ROUND_OPTIONS),
    }),
    defaultSettings: { rounds: 5 },
    actionSchema,

    setup(seats, settings, ctx, roster) {
      if (seats.length < MIN_PLAYERS || seats.length > MAX_PLAYERS) {
        throw new Error('Name Place Animal Thing needs 2–8 players');
      }
      const zero = Object.fromEntries(seats.map((seat) => [seat, 0])) as SeatMap<number>;
      const timing: NpatTiming = {
        letterMs: scaled(base.letterMs),
        answerMs: scaled(base.answerMs),
        stopUnlockMs: scaled(base.stopUnlockMs),
        flushMs: scaled(base.flushMs),
        reviewMs: scaled(base.reviewMs),
        readOnlyReviewMs: scaled(base.readOnlyReviewMs),
        resultMs: scaled(base.resultMs),
      };
      const initial: NpatState = {
        phase: 'LETTER',
        seats: [...seats],
        bots: (roster?.bots ?? []).filter((seat) => seats.includes(seat)),
        controlled: [],
        away: [],
        rounds: settings.rounds,
        round: 0,
        letter: null,
        usedLetters: [],
        timing,
        phaseEndsAt: ctx.now,
        phaseMs: 0,
        stopOpen: false,
        drafts: {},
        draftSeq: {},
        flush: [],
        stoppedBy: null,
        review: null,
        votes: {},
        done: [],
        scores: zero,
        unique: { ...zero },
        emptyRounds: { ...zero },
        last: null,
      };
      return startRound(initial, ctx);
    },

    validateAction(s, seat, a) {
      if (a.round !== s.round) return { ok: false, code: 'INVALID_PHASE' };
      const human = humansOf(s).includes(seat);
      switch (a.type) {
        case 'STOP': {
          if (s.phase !== 'WRITING') return { ok: false, code: 'INVALID_PHASE' };
          if (!s.stopOpen || !human) return { ok: false, code: 'NOT_ELIGIBLE' };
          const letter = s.letter as string;
          const complete = CATEGORIES.every((c) => {
            const raw = a.answers[c] ?? '';
            return (
              !isBlank(raw) &&
              formatProblem(raw, letter) === null &&
              !moderated(cleanAnswer(raw)).flagged
            );
          });
          return complete ? { ok: true } : { ok: false, code: 'NOT_ELIGIBLE' };
        }
        case 'VOTE': {
          if (s.phase !== 'REVIEW' || !s.review) return { ok: false, code: 'INVALID_PHASE' };
          const group = s.review.groups.find((g) => g.id === a.group);
          if (!group) return { ok: false, code: 'ILLEGAL_ACTION' };
          // No vote with fewer than 3 human players; never on your own answer; never a bot.
          if (!votable(s) || !eligibleFor(s, group).includes(seat)) {
            return { ok: false, code: 'NOT_ELIGIBLE' };
          }
          const voted = (s.votes[group.id] ?? []).includes(seat);
          return voted === a.out ? { ok: false, code: 'ILLEGAL_ACTION' } : { ok: true };
        }
        case 'DONE':
          if (s.phase !== 'REVIEW') return { ok: false, code: 'INVALID_PHASE' };
          if (!human || !votable(s)) return { ok: false, code: 'NOT_ELIGIBLE' };
          return s.done.includes(seat) ? { ok: false, code: 'ILLEGAL_ACTION' } : { ok: true };
      }
    },

    applyAction(s, seat, a, ctx) {
      switch (a.type) {
        case 'STOP':
          return endWriting(
            { ...s, drafts: { ...s.drafts, [seat]: compact(a.answers) } },
            seat,
            ctx,
          );
        case 'VOTE': {
          const voters = s.votes[a.group] ?? [];
          const next = a.out ? [...voters, seat] : voters.filter((v) => v !== seat);
          return {
            state: { ...s, votes: { ...s.votes, [a.group]: next } },
            events: [toAll({ type: 'VOTES_CHANGED' })],
          };
        }
        case 'DONE':
          return maybeEndReview({ state: { ...s, done: [...s.done, seat] }, events: [] }, ctx);
      }
    },

    onTimer(s, timer, ctx) {
      if (timer === STOP_TIMER) {
        return s.phase === 'WRITING' && !s.stopOpen
          ? { state: { ...s, stopOpen: true }, events: [toAll({ type: 'STOP_OPEN' })] }
          : nothing(s);
      }
      if (timer !== PHASE_TIMER) return nothing(s);
      switch (s.phase) {
        case 'LETTER':
          return startWriting(s, ctx);
        case 'WRITING':
          return endWriting(s, null, ctx);
        case 'LOCKING':
          return lock(s, ctx);
        case 'REVIEW':
          return scoreRound(s, ctx);
        case 'ROUND_RESULT':
          if (s.round >= s.rounds) {
            return {
              state: { ...s, phase: 'OVER', phaseMs: 0, phaseEndsAt: ctx.now },
              events: [toAll({ type: 'MATCH_OVER', scores: { ...s.scores } })],
            };
          }
          return startRound(s, ctx);
        case 'OVER':
          return nothing(s);
      }
    },

    onSeatChange(s, seat, change, ctx) {
      const without = (list: number[]) => list.filter((x) => x !== seat);
      const add = (list: number[]) => (list.includes(seat) ? list : [...list, seat]);
      let next = s;
      switch (change) {
        case 'DISCONNECTED':
          next = { ...s, away: add(s.away) };
          break;
        case 'RECONNECTED':
          next = { ...s, away: without(s.away) };
          break;
        case 'BOT_TOOK_OVER':
        case 'LEFT':
          next = {
            ...s,
            controlled: add(s.controlled),
            emptyRounds: { ...s.emptyRounds, [seat]: 0 },
          };
          break;
        case 'RECLAIMED':
          next = {
            ...s,
            controlled: without(s.controlled),
            away: without(s.away),
            emptyRounds: { ...s.emptyRounds, [seat]: 0 },
          };
          break;
      }
      return maybeEndReview({ state: next, events: [] }, ctx);
    },

    getPlayerView: viewOf,
    isOver: (s) => s.phase === 'OVER',

    getResults(s) {
      return {
        placements: rank(s.seats, s.scores),
        stats: Object.fromEntries(
          s.seats.map((seat) => [
            seat,
            { score: s.scores[seat] ?? 0, unique: s.unique[seat] ?? 0 },
          ]),
        ),
      };
    },

    stream: {
      chunkSchema,
      limits: {
        maxChunkBytes: 512,
        maxChunksPerSec: 20,
        maxPointsPerTurn: 0,
        maxStrokesPerTurn: 0,
      },
      /** A private autosave: stored for its owner, relayed to nobody. */
      accept(s, seat, raw) {
        const chunk = raw as DraftChunk;
        if (!s.seats.includes(seat)) return { ok: false, code: 'ILLEGAL_ACTION' };
        if (chunk.round !== s.round) return { ok: false, code: 'INVALID_PHASE' };
        const open = s.phase === 'WRITING' || (s.phase === 'LOCKING' && s.flush.includes(seat));
        if (!open) return { ok: false, code: 'INVALID_PHASE' };
        // Latest accepted draft wins: an older (reordered, delayed, replayed) one is dropped.
        if (chunk.seq <= (s.draftSeq[seat] ?? 0)) return { ok: false, code: 'ILLEGAL_ACTION' };
        return {
          state: {
            ...s,
            drafts: { ...s.drafts, [seat]: compact(chunk.answers) },
            draftSeq: { ...s.draftSeq, [seat]: chunk.seq },
          },
          relay: { round: s.round, seq: 0, answers: {} },
          audience: { to: 'SEATS', seats: [] },
        };
      },
      replay: () => [],
    },

    bot: {
      createMemory: () => null,
      observe: (memory) => memory,
      decide(view, _memory, ctx) {
        const plan = botPlan(view, ctx.now, ctx.rng);
        return plan && { kind: 'STREAM', thinkMs: plan.thinkMs, steps: plan.steps };
      },
    },
  };
}

export const npatGame = createNpatGame();

/**
 * Leak-checker helper: changes everything `viewer` must not know — every other
 * seat's private sheet before the reveal and who else voted (counts stay).
 */
export function perturbNpatHidden(s: NpatState, viewer: SeatIndex, rng: SeededRng): NpatState {
  const drafts: SeatMap<Answers> = { ...s.drafts };
  if (s.phase === 'LETTER' || s.phase === 'WRITING' || s.phase === 'LOCKING') {
    for (const seat of s.seats) {
      if (seat === viewer) continue;
      const sheet: Answers = {};
      for (const c of CATEGORIES) {
        if (rng.int(0, 2) > 0) sheet[c] = `${s.letter ?? 'A'}${'aeiou'[rng.int(0, 4)]}rk`;
      }
      drafts[seat] = sheet;
    }
  }
  // Who voted is hidden (only counts are shown): shuffle the voters among the eligible.
  const votes: Record<string, number[]> = {};
  for (const g of s.review?.groups ?? []) {
    const eligible = eligibleFor(s, g);
    const cast = (s.votes[g.id] ?? []).filter((v) => eligible.includes(v));
    const mine = cast.includes(viewer);
    const others = rng.shuffle(eligible.filter((v) => v !== viewer));
    votes[g.id] = [...(mine ? [viewer] : []), ...others.slice(0, cast.length - (mine ? 1 : 0))];
  }
  return { ...s, drafts, votes: s.review ? votes : s.votes };
}
