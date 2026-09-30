import { afterEach, describe, expect, it } from 'vitest';
import type { AnyGameModule } from '@cg/game-sdk';
import { REMOVED_MARKER } from '@cg/moderation';
import { InMemoryFlagStore } from '../src/reports/ReportService';
import { setupRoom, sleep, startServer, testFixture, type TestServer } from './helpers';

let t: TestServer;
afterEach(async () => {
  await t?.close();
});

describe('room chat', () => {
  it('censors profanity and removes contact details before anyone sees it', async () => {
    t = await startServer();
    const a = await t.player('Archit');
    const b = await t.player('Priya');
    await setupRoom(a, b);

    expect((await a.emit('chat:send', { text: '  you are   stupid  ' })).ok).toBe(true);
    const msg = await b.waitFor('chat:message');
    expect(msg).toMatchObject({
      fromId: a.playerId,
      fromName: 'Archit',
      isBot: false,
      text: 'you are ******',
      channel: 'ROOM',
    });

    await a.emit('chat:send', { text: 'add me insta: rahul_07' });
    const contact = await b.waitFor('chat:message', (m) => m.text.includes(REMOVED_MARKER));
    expect(contact.text).toBe(`add me insta: ${REMOVED_MARKER}`);
  });

  it('never punishes profanity — only flooding earns a cooldown', async () => {
    t = await startServer({ chat: { burst: 3, perSecond: 2, cooldownMs: 1000 } });
    const a = await t.player('Archit');
    await setupRoom(a);
    for (let i = 0; i < 3; i++) expect((await a.emit('chat:send', { text: 'fuck' })).ok).toBe(true);
    const flooded = await a.emit('chat:send', { text: 'hello' });
    expect(flooded).toEqual({ ok: false, code: 'CHAT_COOLDOWN', retryAfterMs: 1000 });
    expect(a.all('room:snapshot').at(-1)?.room?.members).toHaveLength(1); // still in the room
    await sleep(1100);
    expect((await a.emit('chat:send', { text: 'hello again' })).ok).toBe(true);
  });

  it('rejects empty messages and chat outside a room', async () => {
    t = await startServer();
    const a = await t.player('Archit');
    expect(await a.emit('chat:send', { text: 'hi' })).toEqual({ ok: false, code: 'NOT_IN_ROOM' });
    await setupRoom(a);
    expect(await a.emit('chat:send', { text: '   ' })).toEqual({ ok: false, code: 'CHAT_EMPTY' });
    expect(await a.emit('chat:send', { text: 'x'.repeat(201) })).toEqual({
      ok: false,
      code: 'INVALID_PAYLOAD',
    });
  });

  it('sends recent (censored) history to players who join later', async () => {
    t = await startServer();
    const a = await t.player('Archit');
    const code = await setupRoom(a);
    await a.emit('chat:send', { text: 'first' });
    await a.emit('chat:send', { text: 'second idiot' });
    const late = await t.player('Priya');
    await late.emit('room:join', { code });
    const history = await late.waitFor('chat:history');
    expect(history.messages.map((m) => m.text)).toEqual(['first', 'second *****']);
  });
});

describe('reports', () => {
  it('records an in-memory flag and never removes the reported player', async () => {
    const sink = new InMemoryFlagStore(100, 60_000);
    t = await startServer({}, { reportSink: sink });
    const a = await t.player('Archit');
    const b = await t.player('Priya');
    await setupRoom(a, b);
    expect(await b.emit('report:submit', { playerId: b.playerId, reason: 'CHAT' })).toEqual({
      ok: false,
      code: 'CANNOT_TARGET_SELF',
    });
    expect(await b.emit('report:submit', { playerId: 'p_nobody', reason: 'CHAT' })).toEqual({
      ok: false,
      code: 'PLAYER_NOT_FOUND',
    });
    expect((await b.emit('report:submit', { playerId: a.playerId, reason: 'NAME' })).ok).toBe(true);
    expect(sink.list()).toEqual([
      expect.objectContaining({ reportedId: a.playerId, reporterId: b.playerId, reason: 'NAME' }),
    ]);
    const room = t.server.services.rooms.getRoom(
      t.server.services.sessions.get(a.playerId)?.roomId as string,
    );
    expect(room?.members).toHaveLength(2);
  });
});

describe('game chat interception', () => {
  const base = testFixture({ turnMs: 60_000 });
  const chatGame: AnyGameModule = {
    ...base,
    chat: {
      intercept: (s, _seat, text) => {
        if (text === 'secret') return { kind: 'CONSUME', transition: { state: s, events: [] } };
        if (text === 'blocked') return { kind: 'BLOCK', code: 'CHAT_BLOCKED' };
        if (text === 'whisper')
          return { kind: 'RESTRICT', audience: { to: 'SEATS', seats: [0] }, channel: 'TEAM' };
        return { kind: 'PASS' };
      },
    },
  };

  it('lets the running game consume, block or restrict messages', async () => {
    t = await startServer({}, { games: [chatGame] });
    const [a, b, c] = [await t.player('Ana'), await t.player('Ben'), await t.player('Cy')];
    await setupRoom(a, b, c);
    await a.emit('room:start', {});
    await a.waitForRoom((r) => r?.phase === 'IN_GAME');

    expect(await b.emit('chat:send', { text: 'blocked' })).toEqual({
      ok: false,
      code: 'CHAT_BLOCKED',
    });
    expect((await b.emit('chat:send', { text: 'Secret' })).ok).toBe(true);
    expect((await b.emit('chat:send', { text: 'whisper' })).ok).toBe(true);
    expect((await b.emit('chat:send', { text: 'hello all' })).ok).toBe(true);

    await c.waitFor('chat:message', (m) => m.text === 'hello all');
    const whisper = await a.waitFor('chat:message', (m) => m.channel === 'TEAM');
    expect(whisper.text).toBe('whisper');
    expect(c.all('chat:message').map((m) => m.text)).toEqual(['hello all']);
    expect(a.all('chat:message').map((m) => m.text)).toEqual(['whisper', 'hello all']);
  });
});
