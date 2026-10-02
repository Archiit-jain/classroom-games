import { createDrawAndGuessGame, type DrawOptions } from '@cg/game-draw-and-guess/server';
import type { DrawEvent, DrawView, RelayedOp, WordEntry } from '@cg/game-draw-and-guess/shared';
import type { MatchStream, MatchUpdate } from '@cg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { setupGameRoom, sleep, startServer, type TestClient, type TestServer } from './helpers';

type Update = MatchUpdate<DrawView, DrawEvent>;

/** Three words of different lengths (so a pattern names exactly one), all with bot templates. */
const PACK: WordEntry[] = [
  { word: 'umbrella', aliases: [], difficulty: 'easy' },
  { word: 'kite', aliases: [], difficulty: 'medium' },
  { word: 'rainbow', aliases: [], difficulty: 'hard' },
];
const FAST: DrawOptions = {
  pack: PACK,
  timing: { chooseMs: 3000, drawMs: 4000, revealMs: 300 },
  botChooseMs: [20, 60],
  botGuessMs: [150, 300],
  botDrawMs: [400, 600],
};

let t: TestServer;
afterEach(async () => {
  await t?.close();
});

const updates = (c: TestClient) => c.all('match:update') as Update[];
const latest = (c: TestClient) => updates(c).at(-1) as Update;
const eventsOf = (c: TestClient) => updates(c).flatMap((u) => u.events);
const strokesOf = (c: TestClient) =>
  (c.all('match:stream') as MatchStream[]).flatMap((s) => s.chunks as RelayedOp[]);

async function threePlayers(options: DrawOptions = {}) {
  t = await startServer({}, { games: [createDrawAndGuessGame({ ...FAST, ...options })] });
  const players = await Promise.all(['Archit', 'Priya', 'Kabir'].map((n) => t.player(n)));
  const [host, ...guests] = players as [TestClient, TestClient, TestClient];
  await setupGameRoom('draw-and-guess', host, ...guests);
  expect((await host.emit('room:start', {})).ok).toBe(true);
  return players as [TestClient, TestClient, TestClient];
}

describe('Draw & Guess over real sockets', () => {
  it('relays strokes, consumes guesses and never shows the answer to anyone still guessing', async () => {
    const [drawer, g1, g2] = await threePlayers();

    // The drawer (seat 0) gets three private cards and picks one.
    const choosing = (await drawer.waitFor('match:update', (u) =>
      (u as Update).events.some((e) => e.type === 'WORD_OPTIONS'),
    )) as Update;
    expect(choosing.view.options).toHaveLength(3);
    expect((await drawer.act(choosing, { type: 'CHOOSE', option: 1 })).ok).toBe(true);
    const drawing = (await drawer.waitFor('match:update', (u) =>
      (u as Update).events.some((e) => e.type === 'YOUR_WORD'),
    )) as Update;
    const word = drawing.view.word as string;
    expect(word).toBe(choosing.view.options[1]?.word);
    await g1.waitFor('match:update', (u) => (u as Update).view.phase === 'DRAWING');
    await g2.waitFor('match:update', (u) => (u as Update).view.phase === 'DRAWING');
    expect(latest(g1).view.word).toBeNull();
    expect(latest(g1).view.pattern).toBe('_'.repeat(word.length));

    // Strokes go to the guessers (tagged with the turn), not back to the drawer.
    const stroke = {
      op: 'stroke',
      id: 0,
      tool: 'pen',
      colour: 3,
      size: 1,
      points: [10, 20, 30, 40],
    };
    expect(await drawer.emit('match:stream', { matchId: drawing.matchId, chunk: stroke })).toEqual({
      ok: true,
    });
    expect(
      await g1.emit('match:stream', { matchId: drawing.matchId, chunk: stroke }),
    ).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });
    for (const c of [g1, g2]) {
      await c.waitFor('match:stream', (s) => (s as MatchStream).chunks.length > 0);
      expect(strokesOf(c)).toEqual([{ ...stroke, turn: drawing.view.turn }]);
    }

    // The drawer cannot chat; a wrong guess is shown and recorded; a near miss is private.
    expect(await drawer.emit('chat:send', { text: 'hello' })).toEqual({
      ok: false,
      code: 'CHAT_BLOCKED',
    });
    expect((await g1.emit('chat:send', { text: 'zebra' })).ok).toBe(true);
    await g2.waitFor('chat:message', (m) => m.text === 'zebra');
    await g2.waitFor('match:update', (u) => (u as Update).view.wrong.includes('zebra'));
    const nearMiss = `${word.slice(0, -1)}${word.endsWith('z') ? 'y' : 'z'}`;
    expect((await g1.emit('chat:send', { text: nearMiss })).ok).toBe(true);
    await g1.waitFor('match:update', (u) => (u as Update).events.some((e) => e.type === 'CLOSE'));

    // A correct guess is consumed: private Correct!, public "guessed it".
    expect((await g2.emit('chat:send', { text: word.toUpperCase() })).ok).toBe(true);
    const mine = (await g2.waitFor('match:update', (u) =>
      (u as Update).events.some((e) => e.type === 'YOU_GUESSED'),
    )) as Update;
    expect(mine.events).toContainEqual({ type: 'YOU_GUESSED', word, points: 100 });
    expect(mine.view.word).toBe(word);
    await g1.waitFor('match:update', (u) =>
      (u as Update).events.some((e) => e.type === 'GUESSED' && e.seat === 2),
    );
    expect(latest(g1).view.word).toBeNull();

    // Solved players chat in the SOLVED lane: the drawer sees it, g1 does not.
    expect((await g2.emit('chat:send', { text: 'nice drawing' })).ok).toBe(true);
    await drawer.waitFor('chat:message', (m) => m.channel === 'SOLVED');

    // Last guesser → the turn ends at once with the reveal.
    expect((await g1.emit('chat:send', { text: `is it ${word}` })).ok).toBe(true);
    const reveal = (await g1.waitFor('match:update', (u) =>
      (u as Update).events.some((e) => e.type === 'REVEAL'),
    )) as Update;
    expect(reveal.view.lastTurn).toMatchObject({
      word,
      deltas: { 0: 40, 1: 80, 2: 100 },
    });

    // Before that reveal, nothing g1 received — views, events, chat — contained the word.
    await sleep(50);
    const revealAt = updates(g1).indexOf(reveal);
    const beforeReveal = JSON.stringify([
      updates(g1).slice(0, revealAt),
      g1.all('chat:message'),
      g1.all('match:stream'),
    ]);
    expect(beforeReveal.toLowerCase()).not.toContain(`"${word}"`);
    expect(beforeReveal.toLowerCase()).not.toContain(`is it ${word}`);
    for (const c of [drawer, g1, g2]) {
      expect(c.all('chat:message').some((m) => m.text.toLowerCase().includes(word))).toBe(false);
    }
    expect(g1.all('chat:message').some((m) => m.channel === 'SOLVED')).toBe(false);
  });

  it('gives guesses their own rate limit: a burst of guesses never triggers the chat cooldown', async () => {
    const [drawer, g1, g2] = await threePlayers();
    const choosing = (await drawer.waitFor('match:update', (u) =>
      (u as Update).events.some((e) => e.type === 'WORD_OPTIONS'),
    )) as Update;
    await drawer.act(choosing, { type: 'CHOOSE', option: 0 });
    const word = (
      (await drawer.waitFor(
        'match:update',
        (u) => (u as Update).view.phase === 'DRAWING',
      )) as Update
    ).view.word as string;
    await g1.waitFor('match:update', (u) => (u as Update).view.phase === 'DRAWING');

    // Eight quick wrong guesses (room chat alone allows 5, then a 30 s cooldown): all accepted,
    // shown to the others and still moderated.
    const guesses = [
      'zebra',
      'yak',
      'what the fuck',
      'quilt',
      'xylophone',
      'violin',
      'tulip',
      'swan',
    ];
    for (const text of guesses) {
      expect(await g1.emit('chat:send', { text })).toEqual({ ok: true });
    }
    await g2.waitFor('chat:message', (m) => m.text === 'swan');
    expect(g2.all('chat:message').map((m) => m.text)).toContain('what the ****');

    // A ninth at once: a short "slow down" from the guess limit — not the chat cooldown.
    const limited = await g1.emit('chat:send', { text: 'rose' });
    expect(limited).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
    const retry = (limited as { retryAfterMs: number }).retryAfterMs;
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(1000);

    // After that wait the correct guess goes through, is consumed and stays hidden.
    await sleep(retry + 50);
    expect(await g1.emit('chat:send', { text: word })).toEqual({ ok: true });
    await g1.waitFor('match:update', (u) =>
      (u as Update).events.some((e) => e.type === 'YOU_GUESSED'),
    );
    await sleep(50);
    expect(g2.all('chat:message').some((m) => m.text.toLowerCase().includes(word))).toBe(false);

    // Now solved, g1 chats in the SOLVED lane under the unchanged room-chat limit:
    // the guess burst used none of it (5 accepted), and a 6th starts the usual cooldown.
    for (let i = 0; i < 5; i++) {
      expect(await g1.emit('chat:send', { text: `gg ${i}` })).toEqual({ ok: true });
    }
    expect(await g1.emit('chat:send', { text: 'gg 5' })).toMatchObject({
      ok: false,
      code: 'CHAT_COOLDOWN',
    });
  });

  it('keeps the room-chat limit and cooldown for the drawer and outside drawing', async () => {
    const [drawer, g1] = await threePlayers();
    await g1.waitFor('match:update', (u) => (u as Update).view.phase === 'CHOOSING');
    // While the drawer is choosing, messages are ordinary chat.
    for (let i = 0; i < 5; i++) {
      expect(await g1.emit('chat:send', { text: `hi ${i}` })).toEqual({ ok: true });
    }
    expect(await g1.emit('chat:send', { text: 'hi 5' })).toMatchObject({
      ok: false,
      code: 'CHAT_COOLDOWN',
    });
    expect(drawer.all('chat:message').filter((m) => m.text.startsWith('hi '))).toHaveLength(5);
  });

  it('replays the current drawing to a guesser who reconnects', async () => {
    const [drawer, guest] = await threePlayers();
    const choosing = (await drawer.waitFor('match:update', (u) =>
      (u as Update).events.some((e) => e.type === 'WORD_OPTIONS'),
    )) as Update;
    await drawer.act(choosing, { type: 'CHOOSE', option: 0 });
    const drawing = (await drawer.waitFor(
      'match:update',
      (u) => (u as Update).view.phase === 'DRAWING',
    )) as Update;
    const ops = [
      { op: 'stroke', id: 0, tool: 'pen', colour: 0, size: 0, points: [1, 2, 3, 4] },
      { op: 'stroke', id: 0, tool: 'pen', colour: 0, size: 0, points: [5, 6] },
      { op: 'undo' },
      { op: 'stroke', id: 1, tool: 'eraser', colour: 0, size: 3, points: [7, 8] },
    ];
    for (const chunk of ops) {
      expect((await drawer.emit('match:stream', { matchId: drawing.matchId, chunk })).ok).toBe(
        true,
      );
    }
    await guest.waitFor('match:stream', (s) =>
      (s as MatchStream).chunks.some(
        (c) => (c as RelayedOp).op === 'stroke' && (c as { id: number }).id === 1,
      ),
    );
    const token = guest.ready.token as string;
    guest.close();
    const back = await t.connect({ token });
    const replay = (await back.waitFor('match:stream')) as MatchStream;
    expect(replay.reset).toBe(true);
    expect(replay.chunks).toEqual(ops.map((op) => ({ ...op, turn: drawing.view.turn })));
  });

  it('bots guess through the chat and draw their word through the stream', async () => {
    t = await startServer({}, { games: [createDrawAndGuessGame(FAST)] });
    const host = await t.player('Archit');
    await setupGameRoom('draw-and-guess', host);
    await host.emit('room:addBot', {});
    await host.emit('room:addBot', {});
    await host.emit('room:updateSettings', { settings: { rounds: 1 } });
    expect((await host.emit('room:start', {})).ok).toBe(true);

    // Turn 1: the human draws; the bots read only the pattern and guess in the chat.
    const choosing = (await host.waitFor('match:update', (u) =>
      (u as Update).events.some((e) => e.type === 'WORD_OPTIONS'),
    )) as Update;
    await host.act(choosing, { type: 'CHOOSE', option: 0 });
    // With three words of different lengths the pattern gives it away: both bots guess
    // right (consumed, never shown in the chat) and the turn ends early.
    const reveal = (await host.waitFor(
      'match:update',
      (u) => (u as Update).events.some((e) => e.type === 'REVEAL'),
      6000,
    )) as Update;
    expect(reveal.view.lastTurn?.guessed.map((g) => g.seat).sort()).toEqual([1, 2]);
    expect(eventsOf(host).filter((e) => e.type === 'GUESSED')).toHaveLength(2);
    const word = choosing.view.options[0]?.word as string;
    expect(host.all('chat:message').some((m) => m.text.includes(word))).toBe(false);

    // Turn 2: a bot draws a template word; the human receives the strokes live.
    await host.waitFor(
      'match:stream',
      (s) =>
        (s as MatchStream).chunks.some(
          (c) => (c as RelayedOp).op === 'stroke' && (c as RelayedOp).turn === 2,
        ),
      6000,
    );
    const turn2 = strokesOf(host).filter((op) => op.turn === 2);
    expect(turn2.length).toBeGreaterThan(0);
    expect(turn2.every((op) => op.op === 'stroke')).toBe(true);

    // The human guesses the bot's word (the pattern names it) and scores.
    const drawingView = (await host.waitFor(
      'match:update',
      (u) => (u as Update).view.phase === 'DRAWING' && (u as Update).view.turn === 2,
    )) as Update;
    const answer = PACK.find((e) => e.word.length === drawingView.view.pattern.length)?.word;
    expect((await host.emit('chat:send', { text: answer as string })).ok).toBe(true);
    await host.waitFor('match:update', (u) =>
      (u as Update).events.some((e) => e.type === 'YOU_GUESSED'),
    );
  });
});
