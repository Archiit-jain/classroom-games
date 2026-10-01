import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestClient, expectConnectError, sleep, startServer, type TestServer } from './helpers';

let t: TestServer;
beforeEach(async () => {
  t = await startServer();
});
afterEach(async () => {
  await t.close();
});

describe('sessions', () => {
  it('creates an anonymous session with a secret token and lists available games', async () => {
    const c = await t.connect();
    expect(c.ready.playerId).toMatch(/^p_/);
    expect(c.ready.token).toMatch(/^[\w-]{40,}$/);
    expect(c.ready.nickname).toBeNull();
    expect(c.ready.games).toEqual([
      expect.objectContaining({ id: 'fixture', minPlayers: 2, maxPlayers: 4, supportsBots: true }),
    ]);
  });

  it('resumes the same identity with the token and never re-sends it', async () => {
    const first = await t.connect();
    await first.emit('session:setNickname', { nickname: 'Archit' });
    first.close();
    const again = await t.connect({ token: first.ready.token as string });
    expect(again.playerId).toBe(first.playerId);
    expect(again.ready.token).toBeUndefined();
    expect(again.ready.nickname).toBe('Archit');
  });

  it('treats an unknown token as a brand-new session', async () => {
    const c = await t.connect({ token: 'x'.repeat(43) });
    expect(c.ready.token).toBeDefined();
  });

  it('lets a newer tab displace an older one without starting a grace period', async () => {
    const first = await t.connect();
    const second = await t.connect({ token: first.ready.token as string });
    await first.waitFor('session:displaced');
    await sleep(50);
    expect(first.socket.connected).toBe(false);
    expect(second.socket.connected).toBe(true);
    expect(t.server.services.sessions.get(first.playerId)?.socketId).toBe(second.socket.id);
  });
});

describe('nicknames', () => {
  it('validates length/characters and moderates content', async () => {
    const c = await t.connect();
    expect(await c.emit('session:setNickname', { nickname: 'a' })).toEqual({
      ok: false,
      code: 'NICKNAME_INVALID',
    });
    expect(await c.emit('session:setNickname', { nickname: 'Bot Tiku' })).toEqual({
      ok: false,
      code: 'NICKNAME_REJECTED',
    });
    expect(await c.emit('session:setNickname', { nickname: 'stupid' })).toEqual({
      ok: false,
      code: 'NICKNAME_REJECTED',
    });
    expect(await c.emit('session:setNickname', { nickname: '  Priya   S ' })).toEqual({
      ok: true,
      nickname: 'Priya S',
    });
  });

  it('cannot be changed while in a room', async () => {
    const c = await t.player('Archit');
    await c.emit('room:create', { gameId: 'fixture' });
    expect(await c.emit('session:setNickname', { nickname: 'Other' })).toEqual({
      ok: false,
      code: 'NICKNAME_LOCKED_IN_ROOM',
    });
  });
});

describe('transport hardening', () => {
  it('rejects malformed payloads before any handler runs', async () => {
    const c = await t.player('Archit');
    const invalid = { ok: false, code: 'INVALID_PAYLOAD' };
    expect(await c.emitRaw('room:create', {})).toEqual(invalid);
    expect(await c.emitRaw('room:create', { gameId: 5 })).toEqual(invalid);
    expect(await c.emitRaw('room:create', { gameId: 'fixture', extra: true })).toEqual(invalid);
    expect(await c.emitRaw('room:join', 'ABCDEF')).toEqual(invalid);
    expect(await c.emitRaw('room:kick', null)).toEqual(invalid);
    expect(
      await c.emitRaw('match:action', {
        matchId: 'm_1',
        version: -1,
        actionId: 'abcdefgh',
        action: {},
      }),
    ).toEqual(invalid);
    expect(await c.emitRaw('chat:send', { text: 42 })).toEqual(invalid);
    expect(await c.emitRaw('report:submit', { playerId: 'p_x', reason: 'SPAM' })).toEqual(invalid);
    // Rate limiting happens before validation, so floods of junk stay cheap.
    expect(await c.emitRaw('room:create', {})).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
  });

  it('ignores events without an acknowledgement and unknown events', async () => {
    const c = await t.player('Archit');
    c.emitNoAck('room:create', { gameId: 'fixture' });
    c.emitNoAck('definitely:not-an-event');
    await sleep(50);
    expect(t.server.services.rooms.roomCount).toBe(0);
    const pong = await c.emit('time:ping', { clientTs: 123 });
    expect(pong).toMatchObject({ ok: true, clientTs: 123 });
  });

  it('drops the connection on oversized messages', async () => {
    const c = await t.player('Archit');
    const disconnected = new Promise<string>((resolve) => c.socket.on('disconnect', resolve));
    c.emitNoAck('chat:send', { text: 'x'.repeat(40_000) });
    expect(await disconnected).toBeTruthy();
  });

  it('refuses browsers from unknown origins and accepts configured ones', async () => {
    await expectConnectError(t.url, { origin: 'https://evil.example' });
    const ok = await TestClient.connect(t.url, { origin: 'http://localhost:5173' });
    expect(ok.playerId).toMatch(/^p_/);
    ok.close();
  });

  it('rate-limits repeated join attempts (room-code guessing)', async () => {
    const c = await t.player('Archit');
    const codes: string[] = [];
    for (let i = 0; i < 15; i++) {
      const res = await c.emit('room:join', { code: 'ZZZZZZ' });
      if (!res.ok) codes.push(res.code);
    }
    expect(codes).toContain('ROOM_NOT_FOUND');
    expect(codes).toContain('RATE_LIMITED');
  });

  it('serves a health check and nothing else over HTTP', async () => {
    const health = await fetch(`${t.url}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok' });
    expect((await fetch(`${t.url}/anything`)).status).toBe(404);
  });
});

describe('connection limits', () => {
  it('caps concurrent sockets per IP', async () => {
    const limited = await startServer({ limits: { maxConnectionsPerIp: 2 } });
    try {
      await limited.connect();
      await limited.connect();
      const err = await expectConnectError(limited.url);
      expect(err.message).toBe('RATE_LIMITED');
    } finally {
      await limited.close();
    }
  });
});
