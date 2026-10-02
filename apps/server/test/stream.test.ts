import type { MatchStream, MatchUpdate } from '@cg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { setupGameRoom, sleep, startServer, type TestClient, type TestServer } from './helpers';
import { createSketchGame, type SketchView } from './streamGame';

type Update = MatchUpdate<SketchView>;

let t: TestServer;
afterEach(async () => {
  await t?.close();
});

async function sketchRoom(options: Parameters<typeof createSketchGame>[0] = {}, overrides = {}) {
  t = await startServer(overrides, { games: [createSketchGame(options)] });
  const artist = await t.player('Archit');
  const guest = await t.player('Priya');
  await setupGameRoom('sketch', artist, guest);
  expect((await artist.emit('room:start', {})).ok).toBe(true);
  const first = (await artist.waitFor('match:update')) as Update;
  await guest.waitFor('match:update');
  return { artist, guest, matchId: first.matchId };
}

const streams = (c: TestClient) => c.all('match:stream') as MatchStream[];

describe('streamed games (match:stream)', () => {
  it('relays accepted chunks to everyone but the sender, in order, without new versions', async () => {
    const { artist, guest, matchId } = await sketchRoom();
    const before = artist.all('match:update').length;
    for (const n of [5, 6]) {
      expect(await artist.emit('match:stream', { matchId, chunk: { n } })).toEqual({ ok: true });
    }
    await guest.waitFor('match:stream', (s) =>
      (s as MatchStream).chunks.some((c) => (c as { n: number }).n === 6),
    );
    expect(streams(guest).map((s) => s.chunks)).toEqual([[{ n: 5 }], [{ n: 6 }]]);
    expect(streams(guest).every((s) => s.reset === false && s.matchId === matchId)).toBe(true);
    await sleep(50);
    expect(streams(artist)).toEqual([]); // the sender draws locally
    expect(artist.all('match:update').length).toBe(before); // no match:update per chunk
  });

  it('rejects chunks from the wrong seat, of the wrong shape, over the limit or for another match', async () => {
    const { artist, guest, matchId } = await sketchRoom({ maxChunks: 1 });
    expect(await guest.emit('match:stream', { matchId, chunk: { n: 1 } })).toEqual({
      ok: false,
      code: 'NOT_YOUR_TURN',
    });
    expect(await artist.emit('match:stream', { matchId, chunk: { n: 'x' } })).toEqual({
      ok: false,
      code: 'INVALID_PAYLOAD',
    });
    expect((await artist.emit('match:stream', { matchId, chunk: { n: 1 } })).ok).toBe(true);
    expect(await artist.emit('match:stream', { matchId, chunk: { n: 2 } })).toEqual({
      ok: false,
      code: 'ILLEGAL_ACTION',
    });
    expect(await artist.emit('match:stream', { matchId: 'nope', chunk: { n: 1 } })).toEqual({
      ok: false,
      code: 'MATCH_NOT_FOUND',
    });
  });

  it('replays the whole picture after a reconnect and on resync', async () => {
    const { artist, guest, matchId } = await sketchRoom();
    for (const n of [1, 2]) await artist.emit('match:stream', { matchId, chunk: { n } });
    await guest.waitFor(
      'match:stream',
      (s) =>
        (s as MatchStream).chunks.length > 0 &&
        (s as MatchStream).chunks[0] !== undefined &&
        ((s as MatchStream).chunks[0] as { n: number }).n === 2,
    );

    const token = guest.ready.token as string;
    guest.close();
    const back = await t.connect({ token });
    const replay = (await back.waitFor('match:stream')) as MatchStream;
    expect(replay).toEqual({ matchId, reset: true, chunks: [{ n: 1 }, { n: 2 }] });

    back.clear('match:stream');
    expect((await back.emit('match:resync', { matchId })).ok).toBe(true);
    expect(await back.waitFor('match:stream')).toEqual({
      matchId,
      reset: true,
      chunks: [{ n: 1 }, { n: 2 }],
    });
  });

  it('rate-limits chunks per player', async () => {
    const { artist, matchId } = await sketchRoom(
      { maxChunks: 50 },
      { rateLimits: { stream: { burst: 2, perSecond: 1 } } },
    );
    const acks = [];
    for (let n = 0; n < 4; n++)
      acks.push(await artist.emit('match:stream', { matchId, chunk: { n } }));
    expect(acks.filter((a) => a.ok)).toHaveLength(2);
    expect(acks.at(-1)).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
  });

  it('plays a bot drawing plan through the same path', async () => {
    t = await startServer({}, { games: [createSketchGame({ artist: 2 })] });
    const host = await t.player('Archit');
    const guest = await t.player('Priya');
    await setupGameRoom('sketch', host, guest);
    await host.emit('room:addBot', {});
    expect((await host.emit('room:start', {})).ok).toBe(true);
    const third = (s: unknown) => ((s as MatchStream).chunks[0] as { n: number }).n === 3;
    await host.waitFor('match:stream', third, 5000);
    await guest.waitFor('match:stream', third, 5000);
    expect(streams(host).flatMap((s) => s.chunks)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    expect(streams(guest).flatMap((s) => s.chunks)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });
});

describe('game chat hooks', () => {
  it('consume, block, restrict and record-and-pass human messages', async () => {
    t = await startServer({}, { games: [createSketchGame()] });
    const artist = await t.player('Archit');
    const g1 = await t.player('Priya');
    const g2 = await t.player('Kabir');
    await setupGameRoom('sketch', artist, g1, g2);
    expect((await artist.emit('room:start', {})).ok).toBe(true);
    await g2.waitFor('match:update');

    // The artist may not chat while drawing.
    expect(await artist.emit('chat:send', { text: 'hi' })).toEqual({
      ok: false,
      code: 'CHAT_BLOCKED',
    });

    // A consumed message is never broadcast; the game publishes its own event.
    expect((await g1.emit('chat:send', { text: 'Secret' })).ok).toBe(true);
    const got = (await g2.waitFor(
      'match:update',
      (u) => (u as Update).events.length > 0,
    )) as Update;
    expect(got.events).toEqual([{ type: 'GOT_IT', seat: 1 }]);

    // Restricted messages reach only the audience (plus the sender), on their channel.
    expect((await g2.emit('chat:send', { text: 'shh, it was easy' })).ok).toBe(true);
    const restricted = await artist.waitFor('chat:message', (m) => m.channel === 'SOLVED');
    expect(restricted.text).toBe('shh, it was easy');

    // Everything else is shown normally and the game may record it as public state.
    expect((await g2.emit('chat:send', { text: 'a dog?' })).ok).toBe(true);
    await artist.waitFor('chat:message', (m) => m.text === 'a dog?');
    const recorded = (await artist.waitFor('match:update', (u) =>
      (u as Update).view.wrong.includes('a dog?'),
    )) as Update;
    expect(recorded.view.wrong).toEqual(['a dog?']);

    await sleep(80);
    for (const c of [artist, g1, g2]) {
      expect(c.all('chat:message').some((m) => /secret/i.test(m.text))).toBe(false);
    }
    expect(g1.all('chat:message').some((m) => m.channel === 'SOLVED')).toBe(false);
  });

  it('sends bot chat through the same hook and moderation, marked as a bot', async () => {
    t = await startServer({}, { games: [createSketchGame({ artist: 0 })] });
    const host = await t.player('Archit');
    const guest = await t.player('Priya');
    await setupGameRoom('sketch', host, guest);
    await host.emit('room:addBot', {});
    expect((await host.emit('room:start', {})).ok).toBe(true);
    const msg = await guest.waitFor('chat:message', (m) => m.isBot, 5000);
    expect(msg).toMatchObject({
      isBot: true,
      fromName: 'Bot Tiku',
      text: 'hello',
      channel: 'ROOM',
    });
    const recorded = (await guest.waitFor('match:update', (u) =>
      (u as Update).view.wrong.includes('hello'),
    )) as Update;
    expect(recorded.view.wrong).toEqual(['hello']);
  });
});
