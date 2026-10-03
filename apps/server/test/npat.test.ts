import { createModerator } from '@cg/moderation';
import { BANK } from '@cg/game-name-place-animal-thing/content';
import { createNpatGame, type NpatOptions } from '@cg/game-name-place-animal-thing/server';
import {
  CATEGORIES,
  type Answers,
  type NpatEvent,
  type NpatView,
} from '@cg/game-name-place-animal-thing/shared';
import type { MatchUpdate } from '@cg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { setupGameRoom, sleep, startServer, type TestClient, type TestServer } from './helpers';

type Update = MatchUpdate<NpatView, NpatEvent>;
const moderator = createModerator();
/** Short phases; writing is long (it ends by STOP in these tests). */
const TIMING: NpatOptions = {
  moderate: (t) => moderator.moderate(t),
  timing: {
    letterMs: 60,
    stopUnlockMs: 250,
    flushMs: 150,
    reviewMs: 2500,
    readOnlyReviewMs: 300,
    resultMs: 200,
  },
  botFirstMs: [100, 200],
  botNextMs: [30, 60],
};
/** Something no bank answer, no bot and no other test ever writes. */
const SECRET = 'Dzorbaqueen';

let t: TestServer;
afterEach(async () => {
  await t?.close();
});

const latest = (c: TestClient) => c.all('match:update').at(-1) as Update | undefined;
/** Every message a client received, as one string (for leak scans). */
const everything = (c: TestClient) => JSON.stringify([...c.received.entries()]);
const waitPhase = (c: TestClient, phase: NpatView['phase'], ms = 6000) =>
  c.waitFor('match:update', (u) => (u as Update).view.phase === phase, ms) as Promise<Update>;
const fullSheet = (letter: string): Answers =>
  Object.fromEntries(CATEGORIES.map((c) => [c, BANK[c][letter]?.[0]])) as Answers;

async function match(bots = 1, options: NpatOptions = TIMING) {
  t = await startServer({}, { games: [createNpatGame(options)] });
  const a = await t.player('Archit');
  const b = await t.player('Priya');
  await setupGameRoom('name-place-animal-thing', a, b);
  await a.emit('room:updateSettings', { settings: { rounds: 3, answerSeconds: 120 } });
  for (let i = 0; i < bots; i++) await a.emit('room:addBot', {});
  expect((await a.emit('room:start', {})).ok).toBe(true);
  const w = await waitPhase(a, 'WRITING');
  await waitPhase(b, 'WRITING');
  return { a, b, matchId: w.matchId, letter: w.view.letter as string };
}

const save = (c: TestClient, matchId: string, round: number, seq: number, answers: Answers) =>
  c.emit('match:stream', { matchId, chunk: { round, seq, answers } });

describe('Name Place Animal Thing over real sockets', () => {
  it('never sends a player’s draft to anyone else — live, on resync or on reconnect', async () => {
    const { a, b, matchId, letter } = await match();
    // Each autosave is accepted and creates no new version (no broadcast).
    const before = latest(b)?.version;
    for (let seq = 1; seq <= 3; seq++) {
      expect((await save(a, matchId, 1, seq, { name: SECRET.slice(0, 6 + seq) })).ok).toBe(true);
    }
    await sleep(100);
    expect(latest(b)?.version).toBe(before);

    // A full view: the owner sees their own sheet; the other player does not.
    const mine = await a.emit('match:resync', { matchId });
    const theirs = await b.emit('match:resync', { matchId });
    expect(mine.ok && (mine.update.view as NpatView).mine.name).toBe(SECRET.slice(0, 9));
    expect(theirs.ok && (theirs.update.view as NpatView).mine).toEqual({});
    expect(JSON.stringify(theirs)).not.toContain('Dzorba');

    // Reconnects: the other player's fresh session payloads carry nothing of it…
    const bToken = b.ready.token as string;
    b.close();
    const b2 = await t.connect({ token: bToken });
    await b2.waitFor('match:update');
    // …and the drafting player gets their own sheet (and its sequence) back.
    const aToken = a.ready.token as string;
    a.close();
    const a2 = await t.connect({ token: aToken });
    const back = (await a2.waitFor('match:update')) as Update;
    expect(back.view.mine.name).toBe(SECRET.slice(0, 9));
    expect(back.view.mineSeq).toBe(3);

    for (const c of [b, b2]) expect(everything(c)).not.toContain('Dzorba');
    // The reveal is the first time anyone else sees it.
    expect((await save(a2, matchId, 1, 4, { name: SECRET })).ok).toBe(true);
    await b2.waitFor('match:update', (u) => (u as Update).view.stopOpen, 3000);
    expect(everything(b2)).not.toContain('Dzorba');
    const stop = { type: 'STOP', round: 1, answers: fullSheet(letter) };
    expect((await b2.act(latest(b2) as Update, stop)).ok).toBe(true);
    const revealed = await b2.waitFor(
      'match:update',
      (u) => (u as Update).view.phase === 'REVIEW',
      10_000,
    );
    expect(everything(b2)).toContain(SECRET);
    expect(
      (revealed as Update).view.review?.answers.name.find((x) => x.text === SECRET),
    ).toBeTruthy();
  }, 20_000);

  it('keeps the latest draft when autosaves arrive out of order', async () => {
    const { a, matchId } = await match(0);
    expect((await save(a, matchId, 1, 5, { name: 'Divya', place: 'Delhi' })).ok).toBe(true);
    expect(await save(a, matchId, 1, 3, { name: 'Div' })).toEqual({
      ok: false,
      code: 'ILLEGAL_ACTION',
    });
    expect(await save(a, matchId, 2, 9, { name: 'Dev' })).toEqual({
      ok: false,
      code: 'INVALID_PHASE',
    });
    const r = await a.emit('match:resync', { matchId });
    expect(r.ok && (r.update.view as NpatView).mine).toEqual({ name: 'Divya', place: 'Delhi' });
  });

  it('STOP ends writing for everyone, only with a complete sheet and only once it opens', async () => {
    const { a, b, matchId, letter } = await match();
    const early = await a.act(latest(a) as Update, {
      type: 'STOP',
      round: 1,
      answers: fullSheet(letter),
    });
    expect(early).toEqual({ ok: false, code: 'NOT_ELIGIBLE' });
    await a.waitFor('match:update', (u) => (u as Update).view.stopOpen, 3000);
    const partial = await a.act(latest(a) as Update, {
      type: 'STOP',
      round: 1,
      answers: { ...fullSheet(letter), food: '' },
    });
    expect(partial).toEqual({ ok: false, code: 'NOT_ELIGIBLE' });
    const forged = await a.act(latest(a) as Update, {
      type: 'STOP',
      round: 1,
      answers: fullSheet(letter),
      score: 60,
    });
    expect(forged).toEqual({ ok: false, code: 'INVALID_PAYLOAD' });
    expect(
      (await a.act(latest(a) as Update, { type: 'STOP', round: 1, answers: fullSheet(letter) })).ok,
    ).toBe(true);
    const stopped = await b.waitFor('match:update', (u) =>
      (u as Update).events.some((e) => e.type === 'STOPPED'),
    );
    expect((stopped as Update).view.phase).toBe('LOCKING');
    expect((stopped as Update).view.stoppedBy).toBe((latest(a) as Update).you);
    // After the lock: no more autosaves, no second STOP.
    await waitPhase(b, 'REVIEW');
    expect((await save(b, matchId, 1, 1, { name: 'Dev' })).ok).toBe(false);
  });

  it('votes: humans only, not on their own answers, once each, only during the review', async () => {
    const { a, b, matchId, letter } = await match(1);
    const aSeat = (latest(a) as Update).you;
    const bSeat = (latest(b) as Update).you;
    const own = `${letter}zorbaville`;
    expect((await save(a, matchId, 1, 1, { place: own })).ok).toBe(true);
    await a.waitFor('match:update', (u) => (u as Update).view.stopOpen, 3000);
    await b.act(latest(b) as Update, { type: 'STOP', round: 1, answers: fullSheet(letter) });
    const review = await waitPhase(a, 'REVIEW');
    const group = review.view.review?.answers.place.find((x) => x.seat === aSeat)?.group as string;
    expect(review.view.review?.answers.place.find((x) => x.seat === aSeat)?.status).toBe(
      'UNVERIFIED',
    );
    // The bot seat is not a voter: only the two humans are waited for.
    expect([...review.view.waitingFor].sort()).toEqual([aSeat, bSeat].sort());

    const vote = (c: TestClient, out = true) =>
      c.act(latest(c) as Update, { type: 'VOTE', round: 1, group, out });
    expect(await vote(a)).toEqual({ ok: false, code: 'NOT_ELIGIBLE' }); // own answer
    expect((await vote(b)).ok).toBe(true);
    expect(await vote(b)).toEqual({ ok: false, code: 'ILLEGAL_ACTION' }); // twice
    const counted = await a.waitFor('match:update', (u) =>
      Boolean((u as Update).view.review?.groups.find((g) => g.id === group && g.votes === 1)),
    );
    // Anonymous: the author sees the count, not who voted.
    expect(JSON.stringify((counted as Update).view.review)).not.toContain(b.playerId);

    expect((await a.act(latest(a) as Update, { type: 'DONE', round: 1 })).ok).toBe(true);
    expect((await b.act(latest(b) as Update, { type: 'DONE', round: 1 })).ok).toBe(true);
    const scored = (await a.waitFor('match:update', (u) =>
      (u as Update).events.some((e) => e.type === 'ROUND_SCORED'),
    )) as Update;
    // Two humans: the other player's vote alone rejects it (more than half of 1).
    expect(scored.view.last?.rejected).toEqual([group]);
    expect(scored.view.last?.points[aSeat]?.place).toBe(0);
    // B's STOP sheet came from the bank: recognised, scored, never voted on by the bot.
    expect(scored.view.last?.deltas[bSeat]).toBeGreaterThan(0);
    // Too late now.
    expect(await vote(b, false)).toEqual({ ok: false, code: 'INVALID_PHASE' });
  }, 20_000);

  it('bots fill their whole sheet through the same autosave path within the answer time', async () => {
    const { a, letter } = await match(2);
    await a.waitFor('match:update', (u) => (u as Update).view.stopOpen, 3000);
    await sleep(800); // bots finish within ~0.5 s with these timings
    await a.act(latest(a) as Update, { type: 'STOP', round: 1, answers: fullSheet(letter) });
    const review = await waitPhase(a, 'REVIEW');
    const botSeats = [2, 3];
    for (const c of CATEGORIES) {
      for (const seat of botSeats) {
        const row = review.view.review?.answers[c].find((x) => x.seat === seat);
        expect(row?.status, `${c} seat ${seat}`).toBe('RECOGNISED');
      }
    }
  });
});
