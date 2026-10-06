import { afterEach, describe, expect, it } from 'vitest';
import { TestClient, setupRoom, sleep, startServer, type TestServer } from '../helpers';
import { burst } from './harness';

/** Phase 10 §6–8: chat spam, repeats and quick reactions over real sockets. */
let ts: TestServer;
afterEach(async () => {
  await ts?.close();
});

async function inMatch(ts: TestServer) {
  const host = await ts.player('Host');
  const guest = await ts.player('Guest');
  await setupRoom(host, guest);
  expect((await host.emit('room:start', {})).ok).toBe(true);
  await host.waitFor('match:update');
  await guest.waitFor('match:update');
  return { host, guest };
}

describe('chat spam', () => {
  it('the same message twice in a row is refused (not sent), a different one is fine', async () => {
    // A big flood budget: refused repeats still spend it (spam attempts aren't free).
    ts = await startServer({ chat: { repeatWindowMs: 300, burst: 20 } });
    const host = await ts.player('Host');
    const guest = await ts.player('Guest');
    await setupRoom(host, guest);
    expect(await host.emit('chat:send', { text: 'hello' })).toEqual({ ok: true });
    for (const again of ['hello', 'HELLO', '  hello  ']) {
      expect(await host.emit('chat:send', { text: again })).toEqual({
        ok: false,
        code: 'CHAT_REPEATED',
      });
    }
    expect(await host.emit('chat:send', { text: 'hello!' })).toEqual({ ok: true });
    await sleep(350); // after the window the same words are conversation again
    expect(await host.emit('chat:send', { text: 'hello!' })).toEqual({ ok: true });
    await guest.waitFor('chat:message', (m) => m.text === 'hello!');
    const texts = guest.all('chat:message').map((m) => m.text);
    expect(texts.filter((t) => t === 'hello')).toHaveLength(1);
  });

  it('a flood earns the cooldown; alternating texts do not dodge it', async () => {
    ts = await startServer();
    const host = await ts.player('Host');
    await setupRoom(host);
    const tally = await burst(12, (i) => host.emit('chat:send', { text: `msg ${i % 2}` }));
    expect(tally.ok).toBeLessThanOrEqual(5);
    expect((tally.CHAT_COOLDOWN ?? 0) + (tally.CHAT_REPEATED ?? 0)).toBeGreaterThanOrEqual(7);
    // Still cooling down for a new, different message.
    expect(await host.emit('chat:send', { text: 'something new' })).toEqual(
      expect.objectContaining({ ok: false, code: 'CHAT_COOLDOWN' }),
    );
  });

  it('a new socket for the same session keeps the cooldown', async () => {
    ts = await startServer();
    const host = await ts.player('Host');
    await setupRoom(host);
    await burst(10, (i) => host.emit('chat:send', { text: `spam ${i}` }));
    const again = await TestClient.connect(ts.url, { token: host.ready.token as string });
    expect(await again.emit('chat:send', { text: 'fresh start?' })).toEqual(
      expect.objectContaining({ ok: false, code: 'CHAT_COOLDOWN' }),
    );
  });

  it('over-long messages are refused, not truncated into the room', async () => {
    ts = await startServer();
    const host = await ts.player('Host');
    await setupRoom(host);
    expect(await host.emitRaw('chat:send', { text: 'a'.repeat(201) })).toEqual({
      ok: false,
      code: 'INVALID_PAYLOAD',
    });
    expect(await host.emitRaw('chat:send', { text: 'a'.repeat(5_000) })).toEqual({
      ok: false,
      code: 'INVALID_PAYLOAD',
    });
    expect(await host.emit('chat:send', { text: '   ' })).toEqual({
      ok: false,
      code: 'CHAT_EMPTY',
    });
  });
});

describe('quick reactions', () => {
  // Validation tests lift the 1-per-1.5 s limit (it is checked first and would answer instead).
  const manyReactions = { rateLimits: { reaction: { burst: 100, perSecond: 100 } } };

  it('only fixed emotes, only seated players, only during a match', async () => {
    ts = await startServer(manyReactions);
    const host = await ts.player('Host');
    const guest = await ts.player('Guest');
    const outsider = await ts.player('Outsider');
    await setupRoom(host, guest);
    // In the lobby: no seat yet.
    expect(await host.emit('chat:react', { reactionId: 'LOL' })).toEqual(
      expect.objectContaining({ ok: false }),
    );
    expect(await outsider.emit('chat:react', { reactionId: 'LOL' })).toEqual(
      expect.objectContaining({ ok: false, code: 'NOT_IN_ROOM' }),
    );
    for (const forged of ['HACK', '', '<script>', 0, null]) {
      expect(await host.emitRaw('chat:react', { reactionId: forged })).toEqual({
        ok: false,
        code: 'INVALID_PAYLOAD',
      });
    }
  });

  it('reaction spam is limited, and reactions and chat keep separate budgets', async () => {
    ts = await startServer();
    const { host, guest } = await inMatch(ts);
    const tally = await burst(8, () => host.emit('chat:react', { reactionId: 'LOL' }));
    expect(tally.ok).toBe(1);
    expect(tally.RATE_LIMITED).toBe(7);
    // Chat is untouched by the reaction limit…
    expect(await host.emit('chat:send', { text: 'nice' })).toEqual({ ok: true });
    // …and the outsider room never hears any of it.
    await guest.waitFor('chat:reaction');
    expect(guest.all('chat:reaction')).toHaveLength(1);
    expect(guest.all('chat:reaction')[0]?.fromId).toBe(host.playerId);
  });

  it('a reaction cannot be attributed to another player', async () => {
    ts = await startServer(manyReactions);
    const { host, guest } = await inMatch(ts);
    expect(
      await host.emitRaw('chat:react', { reactionId: 'LOL', fromId: guest.playerId, seat: 1 }),
    ).toEqual({ ok: false, code: 'INVALID_PAYLOAD' });
    expect(await host.emit('chat:react', { reactionId: 'CLAP' })).toEqual({ ok: true });
    const r = await guest.waitFor('chat:reaction');
    expect(r.fromId).toBe(host.playerId);
  });
});
