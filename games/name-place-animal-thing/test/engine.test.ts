import { createRng, type SeededRng, type StepCtx, type Transition } from '@cg/game-sdk';
import { deepFreeze, simulateMatch } from '@cg/game-sdk/testing';
import { createModerator } from '@cg/moderation';
import { describe, expect, it } from 'vitest';
import { BANK } from '../content/en';
import { createNpatGame, perturbNpatHidden, playableLetters } from '../src/server';
import {
  CATEGORIES,
  LETTERS,
  answerKey,
  type Answers,
  type DraftChunk,
  type NpatAction,
  type NpatEvent,
  type NpatState,
  type NpatView,
} from '../src/shared';

type T = Transition<NpatState, NpatEvent>;
const moderator = createModerator();
const game = createNpatGame({ moderate: (t) => moderator.moderate(t) });
const stream = game.stream as NonNullable<typeof game.stream>;

let clock = 1_000_000;
const ctx = (seed = 7): StepCtx => ({ now: clock, rng: createRng(seed) });
const types = (t: T) => t.events.map((e) => e.event.type);

/** A new match, already in WRITING with letter `letter`. */
function writing(seats = [0, 1, 2], bots: number[] = [], letter = 'D', rounds = 3): NpatState {
  clock = 1_000_000;
  const t = game.setup(seats, { rounds: rounds as 3, answerSeconds: 90 }, ctx(), { bots });
  const s = game.onTimer(t.state, 'phase', ctx()).state;
  expect(s.phase).toBe('WRITING');
  return deepFreeze({ ...s, letter, usedLetters: [letter] });
}
const timer = (s: NpatState, id = 'phase', seed = 7): T => {
  const t = game.onTimer(s, id, ctx(seed));
  return { ...t, state: deepFreeze(t.state) };
};
const draft = (s: NpatState, seat: number, answers: Answers) => {
  const out = stream.accept(s, seat, {
    round: s.round,
    seq: (s.draftSeq[seat] ?? 0) + 1,
    answers,
  } satisfies DraftChunk);
  if (!('state' in out)) throw new Error(`draft rejected: ${JSON.stringify(out)}`);
  return deepFreeze(out.state);
};
const act = (s: NpatState, seat: number, a: NpatAction): T => {
  const parsed = game.actionSchema.parse(a);
  const verdict = game.validateAction(s, seat, parsed);
  if (!verdict.ok) throw new Error(`rejected: ${verdict.code}`);
  const t = game.applyAction(s, seat, parsed, ctx());
  return { ...t, state: deepFreeze(t.state) };
};
const verdict = (s: NpatState, seat: number, a: unknown) => {
  const parsed = game.actionSchema.safeParse(a);
  if (!parsed.success) return 'INVALID_PAYLOAD';
  const v = game.validateAction(s, seat, parsed.data);
  return v.ok ? 'OK' : v.code;
};
const full = (letter: string, offset = 0): Answers =>
  Object.fromEntries(
    CATEGORIES.map((c) => [c, BANK[c][letter]?.[offset % 5] as string]),
  ) as Answers;
/** WRITING → LOCKING (time up) → REVIEW. */
const toReview = (s: NpatState) => timer(timer(s).state).state;
const view = (s: NpatState, seat: number): NpatView => game.getPlayerView(s, seat);
const group = (s: NpatState, category: string, text: string) => `${category}:${answerKey(text)}`;

describe('rounds and letters', () => {
  it('needs 2–8 players; each round opens with a get-ready, then one shared random letter', () => {
    expect(() => game.setup([0], game.defaultSettings, ctx(), { bots: [] })).toThrow();
    expect(() =>
      game.setup([0, 1, 2, 3, 4, 5, 6, 7, 8], game.defaultSettings, ctx(), { bots: [] }),
    ).toThrow();
    const t = game.setup([0, 1], game.defaultSettings, ctx(), { bots: [1] });
    expect(t.state.phase).toBe('LETTER');
    expect(t.state.letter).toBeNull(); // nobody knows the letter during "get ready"
    expect(view(t.state, 0).letter).toBeNull();
    const w = timer(t.state);
    expect(types(w)).toEqual(['WRITING_STARTED']);
    expect(LETTERS).toContain(w.state.letter);
    expect(view(w.state, 0).letter).toBe(w.state.letter);
    expect(view(w.state, 1).letter).toBe(w.state.letter);
  });

  it('defaults to 5 rounds of 90 s with the six default categories, and offers only the listed settings', () => {
    expect(game.defaultSettings).toEqual({ rounds: 5, answerSeconds: 90 });
    expect(game.settingsSchema.safeParse({ rounds: 8, answerSeconds: 60 }).success).toBe(true);
    expect(game.settingsSchema.safeParse({ rounds: 4, answerSeconds: 90 }).success).toBe(false);
    expect(game.settingsSchema.safeParse({ rounds: 5, answerSeconds: 30 }).success).toBe(false);
    expect(game.settingsSchema.safeParse({ rounds: 5, answerSeconds: 90, x: 1 }).success).toBe(
      false,
    );
    const s = writing();
    expect(view(s, 0).categories).toEqual([
      'name',
      'place',
      'animal',
      'thing',
      'food',
      'profession',
    ]);
    expect(s.timing.answerMs).toBe(90_000);
  });

  it('never repeats a letter in a match and never draws Q, X or Z', () => {
    for (let seed = 1; seed <= 20; seed++) {
      let s = game.setup([0, 1], { rounds: 10, answerSeconds: 60 }, ctx(seed), {
        bots: [0, 1],
      }).state;
      const seen: string[] = [];
      while (s.phase !== 'OVER') {
        if (s.phase === 'WRITING') seen.push(s.letter as string);
        s = game.onTimer(s, 'phase', ctx(seed + seen.length)).state;
      }
      expect(seen).toHaveLength(10);
      expect(new Set(seen).size).toBe(10);
      for (const l of seen) expect(['Q', 'X', 'Z']).not.toContain(l);
    }
  });
});

describe('private autosave and the round end', () => {
  it('stores each autosave for its owner only and relays it to nobody', () => {
    let s = writing();
    const out = stream.accept(s, 0, {
      round: s.round,
      seq: 50,
      answers: { name: 'Divya', place: '' },
    });
    expect('state' in out && out.audience).toEqual({ to: 'SEATS', seats: [] });
    s = draft(s, 0, { name: 'Divya', place: '' });
    expect(view(s, 0).mine).toEqual({ name: 'Divya' });
    expect(view(s, 1).mine).toEqual({});
    expect(JSON.stringify(view(s, 1))).not.toContain('Divya');
    expect(JSON.stringify(view(s, 2))).not.toContain('Divya');
  });

  it('rejects autosaves for another round, after the lock, and malformed or oversized sheets', () => {
    const s = writing();
    expect(stream.accept(s, 0, { round: s.round + 1, seq: 50, answers: {} })).toEqual({
      ok: false,
      code: 'INVALID_PHASE',
    });
    expect(
      stream.chunkSchema.safeParse({ round: 1, seq: 1, answers: { colour: 'Dark' } }).success,
    ).toBe(false);
    expect(
      stream.chunkSchema.safeParse({ round: 1, seq: 1, answers: { name: 'D'.repeat(31) } }).success,
    ).toBe(false);
    expect(stream.chunkSchema.safeParse({ round: 1, seq: 1, answers: { name: 5 } }).success).toBe(
      false,
    );
    expect(stream.chunkSchema.safeParse({ round: 1, seq: 1, answers: {}, score: 10 }).success).toBe(
      false,
    );
    const review = toReview(s);
    expect(stream.accept(review, 0, { round: s.round, seq: 50, answers: { name: 'Dev' } })).toEqual(
      {
        ok: false,
        code: 'INVALID_PHASE',
      },
    );
  });

  it('ends writing when the timer expires; partial sheets keep what was saved', () => {
    let s = draft(writing(), 0, { name: 'Divya', animal: 'Dog' });
    const up = timer(s);
    expect(types(up)).toEqual(['TIME_UP']);
    expect(up.state.phase).toBe('LOCKING');
    // The last autosave of what was typed before "time up" still counts …
    s = draft(up.state, 1, { food: 'Dosa' });
    const locked = timer(s);
    expect(locked.state.phase).toBe('REVIEW');
    expect(types(locked)).toEqual(['REVEALED']);
    const review = view(locked.state, 2).review;
    expect(review?.answers.name.find((a) => a.seat === 0)?.text).toBe('Divya');
    expect(review?.answers.place.find((a) => a.seat === 0)?.status).toBe('BLANK');
    expect(review?.answers.food.find((a) => a.seat === 1)?.text).toBe('Dosa');
    // … but nothing after the lock.
    expect(
      'state' in stream.accept(locked.state, 1, { round: s.round, seq: 50, answers: {} }),
    ).toBe(false);
  });

  it('accepts flush autosaves only from players who were human when writing ended', () => {
    const s = writing([0, 1, 2], [2]);
    const locking = timer(s).state;
    expect(locking.flush).toEqual([0, 1]);
    expect(
      stream.accept(locking, 2, { round: s.round, seq: 50, answers: { name: 'Dev' } }),
    ).toEqual({
      ok: false,
      code: 'INVALID_PHASE',
    });
    expect(
      'state' in stream.accept(locking, 1, { round: s.round, seq: 50, answers: { name: 'Dev' } }),
    ).toBe(true);
  });
});

describe('STOP', () => {
  const open = (s: NpatState) => {
    const t = timer(s, 'stop');
    expect(types(t)).toEqual(['STOP_OPEN']);
    return t.state;
  };

  it('opens 15 s after writing starts', () => {
    const t = game.setup([0, 1], game.defaultSettings, ctx(), { bots: [] });
    const w = game.onTimer(t.state, 'phase', ctx());
    expect(w.timers).toContainEqual({ set: 'stop', ms: 15_000 });
    expect(view(w.state, 0).stopOpen).toBe(false);
  });

  it('needs every category filled with an answer that passes the format check', () => {
    const s = open(writing());
    const stop = (answers: Answers) => verdict(s, 0, { type: 'STOP', round: s.round, answers });
    expect(stop(full('D'))).toBe('OK');
    expect(stop({ ...full('D'), food: '' })).toBe('NOT_ELIGIBLE');
    expect(stop({ ...full('D'), food: 'Apple' })).toBe('NOT_ELIGIBLE'); // wrong letter
    expect(stop({ ...full('D'), food: 'D' })).toBe('NOT_ELIGIBLE'); // too short
    expect(stop({ ...full('D'), food: 'Dosa 2' })).toBe('NOT_ELIGIBLE'); // digits
    expect(stop({ ...full('D'), food: 'Dickhead' })).toBe('NOT_ELIGIBLE'); // moderated
  });

  it('is refused before it opens, outside writing and for another round', () => {
    const s = writing();
    expect(verdict(s, 0, { type: 'STOP', round: s.round, answers: full('D') })).toBe(
      'NOT_ELIGIBLE',
    );
    const o = open(s);
    expect(verdict(o, 0, { type: 'STOP', round: s.round + 1, answers: full('D') })).toBe(
      'INVALID_PHASE',
    );
    expect(verdict(toReview(o), 0, { type: 'STOP', round: s.round, answers: full('D') })).toBe(
      'INVALID_PHASE',
    );
  });

  it('is never possible for a bot or a seat a bot is playing', () => {
    const s = open(writing([0, 1, 2], [2]));
    expect(verdict(s, 2, { type: 'STOP', round: s.round, answers: full('D') })).toBe(
      'NOT_ELIGIBLE',
    );
    const taken = game.onSeatChange(s, 1, 'BOT_TOOK_OVER', ctx()).state;
    expect(verdict(taken, 1, { type: 'STOP', round: s.round, answers: full('D') })).toBe(
      'NOT_ELIGIBLE',
    );
  });

  it('ends writing for everyone at once and uses the sheet sent with it', () => {
    const s = draft(open(writing()), 0, { name: 'Dev' });
    const t = act(s, 0, { type: 'STOP', round: s.round, answers: full('D') });
    expect(types(t)).toEqual(['STOPPED']);
    expect(t.state.phase).toBe('LOCKING');
    expect(t.state.stoppedBy).toBe(0);
    expect(t.timers).toContainEqual({ clear: 'stop' });
    expect(t.state.drafts[0]).toEqual(full('D'));
    expect(verdict(t.state, 1, { type: 'STOP', round: s.round, answers: full('D', 1) })).toBe(
      'INVALID_PHASE',
    );
  });
});

describe('automatic check, duplicates and scoring', () => {
  it('marks blank, invalid (with the reason), recognised and unverified answers', () => {
    let s = writing([0, 1]);
    s = draft(s, 0, {
      name: 'Divya',
      place: 'Dholavira', // real, but not in our list
      animal: 'Apple', // wrong letter
      thing: 'D', // too short
      food: 'Dickhead', // moderated
    });
    const r = view(toReview(s), 1).review;
    const row = (c: (typeof CATEGORIES)[number]) => r?.answers[c].find((a) => a.seat === 0);
    expect(row('name')).toMatchObject({ status: 'RECOGNISED', reason: null });
    expect(row('place')).toMatchObject({ status: 'UNVERIFIED', reason: null });
    expect(row('animal')).toMatchObject({ status: 'INVALID', reason: 'LETTER', group: null });
    expect(row('thing')).toMatchObject({ status: 'INVALID', reason: 'SHORT' });
    expect(row('food')).toMatchObject({ status: 'INVALID', reason: 'NOT_ALLOWED' });
    expect(row('food')?.text).toBe('****head'); // only the censored form is revealed
    expect(row('profession')).toMatchObject({ status: 'BLANK', text: '' });
  });

  it('groups identical answers despite case, spacing, punctuation, accents, plurals and variants', () => {
    let s = writing([0, 1, 2, 3, 4], [], 'B');
    s = draft(s, 0, { place: 'Bengaluru', food: 'Banana', thing: 'Ball' });
    s = draft(s, 1, { place: ' bangalore.', food: 'bananas', thing: 'Balls' });
    s = draft(s, 2, { place: 'BENGALURU', food: 'Bánana', thing: 'Bat' });
    s = draft(s, 3, { place: 'Bhopal', food: 'Bread', thing: 'Bell' });
    s = draft(s, 4, { place: 'Bengal', food: 'Bun', thing: 'Bottle' });
    const r = view(toReview(s), 0).review;
    const authors = (id: string) => r?.groups.find((g) => g.id === id)?.authors;
    expect(authors('place:bengaluru')).toEqual([0, 1, 2]);
    expect(authors('food:banana')).toEqual([0, 1, 2]);
    expect(authors('thing:ball')).toEqual([0, 1]);
    expect(authors('place:bengal')).toEqual([4]);
  });

  it('scores 10 for a valid unique answer, 5 for a shared one, 0 for blank or invalid', () => {
    let s = writing([0, 1, 2], [], 'D');
    s = draft(s, 0, { name: 'Divya', place: 'Delhi', animal: 'Apple' });
    s = draft(s, 1, { name: 'Dev', place: 'delhi' });
    s = draft(s, 2, { name: 'Dina', place: 'Dubai', animal: 'Dog' });
    const scored = timer(toReview(s));
    expect(types(scored)).toEqual(['ROUND_SCORED']);
    const result = scored.state.last;
    expect(result?.points[0]).toMatchObject({ name: 10, place: 5, animal: 0, thing: 0 });
    expect(result?.points[1]).toMatchObject({ name: 10, place: 5, animal: 0 });
    expect(result?.points[2]).toMatchObject({ name: 10, place: 10, animal: 10 });
    expect(result?.deltas).toEqual({ 0: 15, 1: 15, 2: 30 });
    expect(scored.state.scores).toEqual({ 0: 15, 1: 15, 2: 30 });
    expect(scored.state.unique).toEqual({ 0: 1, 1: 1, 2: 3 });
  });

  it('ends after the last round, highest total first, equal totals sharing a place', () => {
    let s = writing([0, 1, 2], [], 'D', 3);
    s = { ...s, round: 3, scores: { 0: 40, 1: 40, 2: 10 } };
    const result = timer(timer(toReview(s)).state);
    expect(result.state.phase).toBe('OVER');
    expect(types(result)).toEqual(['MATCH_OVER']);
    expect(game.isOver(result.state)).toBe(true);
    expect(game.getResults(result.state).placements).toEqual([
      { seat: 0, place: 1 },
      { seat: 1, place: 1 },
      { seat: 2, place: 3 },
    ]);
  });
});

describe('voting', () => {
  /** Players 0–3 humans (unless bots given); seat 0 wrote an unverified place. */
  const reviewWith = (seats = [0, 1, 2, 3], bots: number[] = []) => {
    let s = writing(seats, bots, 'D');
    s = draft(s, 0, { place: 'Dholavira', name: 'Divya' });
    s = draft(s, 1, { name: 'divya' });
    return toReview(s);
  };
  const vote = (s: NpatState, seat: number, id: string, out = true) =>
    act(s, seat, { type: 'VOTE', round: s.round, group: id, out }).state;

  it('rejects an answer when more than half of the other human players vote it out', () => {
    let s = reviewWith();
    const id = group(s, 'place', 'Dholavira');
    s = vote(s, 1, id);
    expect(view(s, 0).review?.groups.find((g) => g.id === id)).toMatchObject({
      votes: 1,
      eligible: 3,
    });
    s = vote(s, 2, id);
    const result = timer(s).state.last;
    expect(result?.rejected).toEqual([id]);
    expect(result?.points[0]?.place).toBe(0);
  });

  it('lets a tie stand (exactly half)', () => {
    let s = reviewWith([0, 1, 2]);
    const id = group(s, 'place', 'Dholavira');
    s = vote(s, 1, id); // 1 of 2 eligible
    const result = timer(s).state.last;
    expect(result?.rejected).toEqual([]);
    expect(result?.points[0]?.place).toBe(10);
  });

  it('with two humans, the other player alone decides', () => {
    let s = reviewWith([0, 1]);
    const id = group(s, 'place', 'Dholavira');
    s = vote(s, 1, id);
    expect(timer(s).state.last?.points[0]?.place).toBe(0);
  });

  it('a rejected shared answer is rejected for all its authors', () => {
    let s = reviewWith();
    const id = group(s, 'name', 'Divya'); // seats 0 and 1
    expect(view(s, 2).review?.groups.find((g) => g.id === id)?.eligible).toBe(2);
    s = vote(s, 2, id);
    s = vote(s, 3, id);
    const result = timer(s).state.last;
    expect(result?.points[0]?.name).toBe(0);
    expect(result?.points[1]?.name).toBe(0);
  });

  it('forbids voting on your own answer, voting twice, and voting outside the review', () => {
    const s = reviewWith();
    const id = group(s, 'place', 'Dholavira');
    expect(verdict(s, 0, { type: 'VOTE', round: s.round, group: id, out: true })).toBe(
      'NOT_ELIGIBLE',
    );
    const voted = vote(s, 1, id);
    expect(verdict(voted, 1, { type: 'VOTE', round: s.round, group: id, out: true })).toBe(
      'ILLEGAL_ACTION',
    );
    expect(verdict(voted, 1, { type: 'VOTE', round: s.round, group: id, out: false })).toBe('OK');
    expect(verdict(s, 1, { type: 'VOTE', round: s.round, group: 'place:nowhere', out: true })).toBe(
      'ILLEGAL_ACTION',
    );
    expect(verdict(s, 1, { type: 'VOTE', round: s.round + 1, group: id, out: true })).toBe(
      'INVALID_PHASE',
    );
    expect(verdict(s, 1, { type: 'VOTE', round: s.round, group: 'Place:X!', out: true })).toBe(
      'INVALID_PAYLOAD',
    );
    const w = writing();
    expect(verdict(w, 1, { type: 'VOTE', round: w.round, group: id, out: true })).toBe(
      'INVALID_PHASE',
    );
  });

  it('can withdraw a vote', () => {
    let s = reviewWith([0, 1]);
    const id = group(s, 'place', 'Dholavira');
    s = vote(vote(s, 1, id), 1, id, false);
    expect(timer(s).state.last?.points[0]?.place).toBe(10);
  });

  it('bots never vote and never count; answers with no eligible voter stand on the automatic check', () => {
    let s = reviewWith([0, 1, 2], [1, 2]);
    expect(view(s, 0).canVote).toBe(false);
    expect(s.phaseMs).toBe(5000); // read-only reveal
    expect(verdict(s, 1, { type: 'DONE', round: s.round })).toBe('NOT_ELIGIBLE');
    // Bots' answers: one human voter decides.
    s = writing([0, 1], [1], 'D');
    s = draft(s, 1, { place: 'Dholavira' });
    s = toReview(s);
    expect(view(s, 0).canVote).toBe(true);
    s = vote(s, 0, group(s, 'place', 'Dholavira'));
    expect(timer(s).state.last?.points[1]?.place).toBe(0);
  });

  it('keeps votes anonymous: only counts and your own vote are visible', () => {
    let s = reviewWith();
    const id = group(s, 'place', 'Dholavira');
    s = vote(s, 1, id);
    const g = view(s, 2).review?.groups.find((x) => x.id === id);
    expect(g).toMatchObject({ votes: 1, mine: false });
    expect(view(s, 1).review?.groups.find((x) => x.id === id)?.mine).toBe(true);
    expect(JSON.stringify(view(s, 2))).not.toMatch(/"votes":\{/u);
  });

  it('drops the votes of a player a bot takes over; a disconnected player’s votes still count', () => {
    let s = reviewWith([0, 1, 2]);
    const id = group(s, 'place', 'Dholavira');
    s = vote(vote(s, 1, id), 2, id); // 2 of 2 → out
    const away = game.onSeatChange(s, 2, 'DISCONNECTED', ctx()).state;
    expect(timer(away).state.last?.rejected).toEqual([id]);
    const taken = game.onSeatChange(away, 2, 'BOT_TOOK_OVER', ctx()).state;
    expect(view(taken, 0).review?.groups.find((g) => g.id === id)).toMatchObject({
      votes: 1,
      eligible: 1,
    });
    expect(timer(taken).state.last?.rejected).toEqual([id]); // 1 of 1 → still out
  });

  it('ends early once every connected human player taps Done', () => {
    let s = reviewWith([0, 1, 2]);
    s = act(s, 0, { type: 'DONE', round: s.round }).state;
    expect(view(s, 0).waitingFor).toEqual([1, 2]);
    expect(verdict(s, 0, { type: 'DONE', round: s.round })).toBe('ILLEGAL_ACTION');
    s = game.onSeatChange(s, 2, 'DISCONNECTED', ctx()).state;
    expect(view(s, 0).waitingFor).toEqual([1]);
    const t = act(s, 1, { type: 'DONE', round: s.round });
    expect(types(t)).toEqual(['ROUND_SCORED']);
    expect(t.state.phase).toBe('ROUND_RESULT');
  });
});

describe('seats, idle and bots', () => {
  it('hands a connected player with two completely empty sheets in a row to a bot', () => {
    let s = writing([0, 1], [1]);
    let review = timer(timer(s).state);
    expect(review.requests ?? []).toEqual([]);
    s = timer(timer(review.state).state).state; // next round, writing
    s = timer(s).state; // LETTER → WRITING
    review = timer(timer(s).state);
    expect(review.requests).toEqual([{ type: 'MARK_IDLE', seat: 0 }]);
  });

  it('does not count a disconnected player’s empty sheet as idleness', () => {
    let s = game.onSeatChange(writing([0, 1], [1]), 0, 'DISCONNECTED', ctx()).state;
    s = timer(timer(s).state).state;
    expect(s.emptyRounds[0]).toBe(0);
  });

  it('a bot taking over mid-writing keeps the human’s saved answers and fills the blanks', () => {
    let s = draft(writing([0, 1]), 0, { name: 'Divya', place: 'Delhi' });
    s = game.onSeatChange(s, 0, 'BOT_TOOK_OVER', ctx()).state;
    const decision = game.bot.decide(view(s, 0), null, { seat: 0, now: clock, rng: createRng(3) });
    expect(decision?.kind).toBe('STREAM');
    if (decision?.kind !== 'STREAM') return;
    const last = decision.steps.at(-1)?.chunk as DraftChunk;
    expect(last.answers.name).toBe('Divya');
    expect(last.answers.place).toBe('Delhi');
    expect(decision.steps).toHaveLength(4);
    for (const c of CATEGORIES) expect(last.answers[c]?.[0]).toBe('D');
  });

  it('bots answer every category from the bank at a human pace, within the answer time', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const s = writing([0, 1]);
      const rng: SeededRng = createRng(seed);
      const d = game.bot.decide(view(s, 1), null, { seat: 1, now: clock, rng });
      if (d?.kind !== 'STREAM') throw new Error('expected a plan');
      const total = d.thinkMs + d.steps.reduce((sum, step) => sum + step.delayMs, 0);
      expect(d.thinkMs).toBeGreaterThanOrEqual(6000);
      expect(total).toBeLessThanOrEqual(0.8 * 90_000);
      expect(d.steps).toHaveLength(6);
      // Each step adds one answer; the sheet only ever grows.
      d.steps.forEach((step, i) => {
        expect(Object.keys((step.chunk as DraftChunk).answers)).toHaveLength(i + 1);
      });
      const sheet = (d.steps.at(-1)?.chunk as DraftChunk).answers;
      for (const c of CATEGORIES) expect(BANK[c].D).toContain(sheet[c]);
    }
  });

  it('bots squeeze their answers into a short answer time', () => {
    const quick = createNpatGame();
    const t = quick.setup([0, 1], { rounds: 3, answerSeconds: 60 }, ctx(), { bots: [1] });
    const s = quick.onTimer(t.state, 'phase', ctx()).state;
    const d = quick.bot.decide(quick.getPlayerView(s, 1), null, {
      seat: 1,
      now: s.phaseEndsAt - 10_000,
      rng: createRng(1),
    });
    if (d?.kind !== 'STREAM') throw new Error('expected a plan');
    expect(d.thinkMs + d.steps.reduce((sum, x) => sum + x.delayMs, 0)).toBeLessThanOrEqual(8000);
  });

  it('bots never STOP, vote or tap Done, and do nothing outside writing', () => {
    let s = draft(writing([0, 1], [1]), 1, full('D'));
    s = timer(s, 'stop').state;
    expect(
      game.bot.decide(view(s, 1), null, { seat: 1, now: clock, rng: createRng(1) }),
    ).toBeNull();
    const review = toReview(s);
    expect(
      game.bot.decide(view(review, 1), null, { seat: 1, now: clock, rng: createRng(1) }),
    ).toBeNull();
  });

  it('a bot’s view never contains another seat’s draft', () => {
    const s = draft(writing([0, 1], [1]), 0, { name: 'Dhruvika' });
    expect(JSON.stringify(view(s, 1))).not.toContain('Dhruvika');
  });

  it('plays seeded bot matches to the end with private drafts until the reveal', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const seats = 2 + (seed % 7);
      const r = simulateMatch<NpatState, NpatEvent>(createNpatGame(), {
        seats,
        seed,
        streams: true,
        settings: { rounds: 3, answerSeconds: 60 },
        perturbHidden: perturbNpatHidden,
        invariant: (s) => {
          for (const seat of s.seats) {
            expect(
              Object.keys(s.drafts[seat] ?? {}).every((c) => CATEGORIES.includes(c as never)),
            ).toBe(true);
          }
          const total = Object.values(s.scores).reduce((a, b) => a + b, 0);
          expect(total % 5).toBe(0);
        },
      });
      expect(r.state.phase).toBe('OVER');
      // Bots answered: every bot scored in every round.
      for (const seat of r.state.seats) expect(r.state.scores[seat]).toBeGreaterThan(0);
      expect(r.state.usedLetters).toHaveLength(3);
    }
  });
});

describe('draft ordering (latest accepted draft wins)', () => {
  const send = (s: NpatState, seat: number, seq: number, answers: Answers) =>
    stream.accept(s, seat, { round: s.round, seq, answers });

  it('drops an older autosave that arrives after a newer one (reordering, delays, replays)', () => {
    let s = writing();
    const newer = send(s, 0, 7, { name: 'Divya', place: 'Delhi' });
    if (!('state' in newer)) throw new Error('rejected');
    s = newer.state;
    expect(send(s, 0, 6, { name: 'Div' })).toEqual({ ok: false, code: 'ILLEGAL_ACTION' });
    expect(send(s, 0, 7, { name: 'Div' })).toEqual({ ok: false, code: 'ILLEGAL_ACTION' });
    expect(view(s, 0).mine).toEqual({ name: 'Divya', place: 'Delhi' });
    expect(view(s, 0).mineSeq).toBe(7);
    // Gaps are fine (lost autosaves): a higher sequence always wins.
    const later = send(s, 0, 12, { name: 'Divya', place: 'Delhi', food: 'Dosa' });
    expect('state' in later && view(later.state, 0).mine.food).toBe('Dosa');
  });

  it('keeps sequences per seat, and starts each round afresh', () => {
    let s = writing();
    s = draft(draft(s, 0, { name: 'Dev' }), 0, { name: 'Devi' });
    expect('state' in send(s, 1, 1, { name: 'Dina' })).toBe(true); // seat 1 has its own counter
    const next = timer(timer(timer(timer(s).state).state).state).state; // → next LETTER
    expect(next.draftSeq).toEqual({});
    expect(view(next, 0).mineSeq).toBe(0);
  });

  it('survives a snapshot round-trip (host hand-over): the restored state still refuses older drafts', () => {
    let s = draft(draft(writing(), 0, { name: 'Dev' }), 0, { name: 'Devi' });
    s = JSON.parse(JSON.stringify(s)) as NpatState;
    expect(send(s, 0, 1, { name: 'Dev' })).toEqual({ ok: false, code: 'ILLEGAL_ACTION' });
    expect(view(s, 0).mine).toEqual({ name: 'Devi' });
  });

  it('a bot’s plan continues after the saved sequence (takeover after the human typed)', () => {
    let s = draft(draft(writing([0, 1]), 0, { name: 'Dev' }), 0, { name: 'Devi' });
    s = game.onSeatChange(s, 0, 'BOT_TOOK_OVER', ctx()).state;
    const d = game.bot.decide(view(s, 0), null, { seat: 0, now: clock, rng: createRng(2) });
    if (d?.kind !== 'STREAM') throw new Error('expected a plan');
    expect(d.steps.map((x) => (x.chunk as DraftChunk).seq)).toEqual([3, 4, 5, 6, 7]);
    for (const step of d.steps) {
      const out = stream.accept(s, 0, step.chunk);
      if (!('state' in out)) throw new Error('bot chunk rejected');
      s = out.state;
    }
    expect(view(s, 0).mine.name).toBe('Devi');
  });

  it('the player who pressed STOP cannot replace their stopped sheet during the flush', () => {
    let s = draft(writing(), 1, { name: 'Dev' });
    s = timer(s, 'stop').state;
    s = act(s, 0, { type: 'STOP', round: s.round, answers: full('D') }).state;
    expect(s.flush).toEqual([1, 2]);
    expect(send(s, 0, 99, { name: 'Dina' })).toEqual({ ok: false, code: 'INVALID_PHASE' });
    expect('state' in send(s, 1, 99, { name: 'Dev', place: 'Delhi' })).toBe(true);
  });
});

describe('letters the answer bank can cover', () => {
  it('draws only letters with enough answers in every category', () => {
    const small = Object.fromEntries(
      CATEGORIES.map((c) => [c, { A: BANK[c].A, B: BANK[c].B, C: (BANK[c].C ?? []).slice(0, 4) }]),
    ) as unknown as typeof BANK;
    expect(playableLetters(small)).toEqual(['A', 'B']);
    const g = createNpatGame({ bank: small });
    for (let seed = 1; seed <= 30; seed++) {
      let s = g.setup([0, 1], { rounds: 3, answerSeconds: 60 }, ctx(seed), { bots: [] }).state;
      s = g.onTimer(s, 'phase', ctx(seed)).state;
      expect(['A', 'B']).toContain(s.letter);
    }
  });

  it('covers all 23 round letters with the English bank, and refuses a bank that covers none', () => {
    expect(playableLetters(BANK)).toEqual(LETTERS);
    expect(LETTERS).toHaveLength(23);
    const empty = Object.fromEntries(CATEGORIES.map((c) => [c, {}])) as typeof BANK;
    expect(() => createNpatGame({ bank: empty })).toThrow();
  });
});

describe('roster: who is a human player', () => {
  it('treats roster bots as bots from the start; without a roster every seat is human', () => {
    const t = game.setup([0, 1, 2], game.defaultSettings, ctx(), { bots: [2, 9] });
    expect(t.state.bots).toEqual([2]); // unknown seats ignored
    expect(game.setup([0, 1], game.defaultSettings, ctx()).state.bots).toEqual([]);
  });

  it('updates voting eligibility on takeover and reclaim', () => {
    let s = writing([0, 1, 2]);
    s = draft(s, 0, { place: 'Dholavira' });
    s = toReview(s);
    const id = group(s, 'place', 'Dholavira');
    const eligible = (x: NpatState) => view(x, 0).review?.groups.find((g) => g.id === id)?.eligible;
    expect(eligible(s)).toBe(2);
    s = game.onSeatChange(s, 1, 'BOT_TOOK_OVER', ctx()).state;
    expect(eligible(s)).toBe(1);
    expect(view(s, 1).canVote).toBe(false);
    expect(verdict(s, 1, { type: 'VOTE', round: s.round, group: id, out: true })).toBe(
      'NOT_ELIGIBLE',
    );
    s = game.onSeatChange(s, 1, 'RECLAIMED', ctx()).state;
    expect(eligible(s)).toBe(2);
    expect(view(s, 1).canVote).toBe(true);
  });

  it('does not reveal which seats are bots beyond what the room already shows', () => {
    const s = writing([0, 1, 2], [2]);
    const v = view(s, 0) as unknown as Record<string, unknown>;
    expect(v).not.toHaveProperty('bots');
    expect(v).not.toHaveProperty('controlled');
    expect(v).not.toHaveProperty('drafts');
    expect(v).not.toHaveProperty('draftSeq');
  });
});
