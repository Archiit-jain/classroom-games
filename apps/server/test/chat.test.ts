import { afterEach, describe, expect, it } from 'vitest';
import type { AnyGameModule } from '@cg/game-sdk';
import { REMOVED_MARKER } from '@cg/moderation';
import { InMemoryFlagStore } from '../src/reports/ReportService';
import { autoPlay, setupRoom, sleep, startServer, testFixture, type TestServer } from './helpers';

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

describe('quick reactions', () => {
  async function inMatch() {
    // Long turns, so the match is still running when the reaction cooldown ends.
    t = await startServer({}, { games: [testFixture({ turnMs: 20_000 })] });
    const a = await t.player('Archit');
    const b = await t.player('Priya');
    await setupRoom(a, b);
    expect((await a.emit('room:start', {})).ok).toBe(true);
    const room = await a.waitForRoom((r) => r?.phase === 'IN_GAME');
    const seatOf = (id: string) => room?.match?.seats.find((s) => s.memberId === id)?.seat;
    return { a, b, seatOf };
  }

  it('shows a reaction over the sender’s seat for everyone in the match', async () => {
    const { a, b, seatOf } = await inMatch();
    expect(await a.emit('chat:react', { reactionId: 'FIRE' })).toEqual({ ok: true });
    for (const client of [a, b]) {
      expect(await client.waitFor('chat:reaction')).toMatchObject({
        fromId: a.playerId,
        seat: seatOf(a.playerId as string),
        reactionId: 'FIRE',
      });
    }
  });

  it('allows one reaction per 1.5 s', async () => {
    const { a } = await inMatch();
    expect((await a.emit('chat:react', { reactionId: 'LOL' })).ok).toBe(true);
    const again = await a.emit('chat:react', { reactionId: 'LOL' });
    expect(again).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
    expect(again.ok === false && again.retryAfterMs).toBeGreaterThan(1000);
    await sleep(1550);
    expect(await a.emit('chat:react', { reactionId: 'CLAP' })).toEqual({ ok: true });
  });

  it('only accepts the fixed emotes, only from seated players in a running match', async () => {
    t = await startServer();
    const outside = await t.player('Archit');
    expect(await outside.emit('chat:react', { reactionId: 'LOL' })).toEqual({
      ok: false,
      code: 'NOT_IN_ROOM',
    });
    const host = await t.player('Priya');
    await setupRoom(host);
    expect(await host.emit('chat:react', { reactionId: 'LOL' })).toEqual({
      ok: false,
      code: 'INVALID_PHASE',
    });
    const other = await t.player('Kabir');
    expect(await other.emit('chat:react', { reactionId: '💩' } as never)).toEqual({
      ok: false,
      code: 'INVALID_PAYLOAD',
    });
  });

  it('never comes from a bot', async () => {
    t = await startServer();
    const host = await t.player('Archit');
    await setupRoom(host);
    await host.emit('room:addBot', {});
    autoPlay(host);
    expect((await host.emit('room:start', {})).ok).toBe(true);
    await host.waitFor('match:end', () => true, 10_000);
    expect(host.all('chat:reaction')).toEqual([]);
  });
});
