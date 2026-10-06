import { afterEach, describe, expect, it } from 'vitest';
import {
  TestClient,
  eventually,
  expectConnectError,
  setupRoom,
  startServer,
  type TestServer,
} from '../helpers';
import { DEFAULT_CONFIG } from '../../src/config';
import { captureLog, expectHealthy, forgedTokens, reconnectStorm } from './harness';

/** Phase 10 §3: session abuse. */
let ts: TestServer;
afterEach(async () => {
  await ts?.close();
});

describe('session abuse', () => {
  it('a forged, malformed or oversized token never resumes someone else', async () => {
    const log = captureLog();
    ts = await startServer({}, { log });
    const victim = await ts.player('Victim');
    const token = victim.ready.token as string;
    for (const forged of forgedTokens(token)) {
      const socket = await (async () => {
        try {
          return await TestClient.connect(ts.url, { token: forged as string });
        } catch {
          return null; // refused outright (e.g. an oversized handshake) is fine too
        }
      })();
      if (socket) {
        expect(socket.playerId, `token ${JSON.stringify(forged)?.slice(0, 40)}`).not.toBe(
          victim.playerId,
        );
        // A brand-new session gets its own token; the victim's is never echoed.
        expect(socket.ready.token).not.toBe(token);
        socket.close();
      }
    }
    // The victim is undisturbed (not displaced).
    expect(victim.all('session:displaced')).toHaveLength(0);
    expect(log.errors).toEqual([]);
    await expectHealthy(ts.url);
  });

  it('session:ready carries nothing secret about the server or the session', async () => {
    ts = await startServer();
    const fresh = await ts.connect();
    const resumed = await TestClient.connect(ts.url, { token: fresh.ready.token as string });
    for (const ready of [fresh.ready, resumed.ready]) {
      const raw = JSON.stringify(ready);
      expect(raw).not.toMatch(/tokenHash|127\.0\.0\.1|instanceId|socketId|stack/u);
    }
    // The token is only ever sent to the session that just got it.
    expect(resumed.ready.token).toBeUndefined();
  });

  it('rapid session creation from one address is capped (shared host-side count)', async () => {
    ts = await startServer({ limits: { newSessionsPerIpPerMinute: 5 } });
    const made: TestClient[] = [];
    for (let i = 0; i < 5; i++) made.push(await ts.connect());
    const refused = await expectConnectError(ts.url);
    expect(refused.message).toBe('RATE_LIMITED');
    // Existing sessions still reconnect fine (resuming is not creating).
    const back = await TestClient.connect(ts.url, { token: made[0]?.ready.token as string });
    expect(back.playerId).toBe(made[0]?.playerId);
  });

  it('simultaneous sockets with one token: exactly one stays active, the room seat is kept', async () => {
    ts = await startServer();
    const host = await ts.player('Host');
    const token = host.ready.token as string;
    const created = await host.emit('room:create', { gameId: 'fixture' });
    expect(created.ok).toBe(true);
    const tabs = await Promise.all(
      Array.from({ length: 6 }, () => TestClient.connect(ts.url, { token })),
    );
    await eventually(
      () => tabs.filter((t) => t.socket.connected).length + (host.socket.connected ? 1 : 0) === 1,
    );
    const active = [host, ...tabs].find((t) => t.socket.connected) as TestClient;
    const room = await active.waitForRoom((r) => r !== null);
    // Still exactly one member: duplicate sockets never duplicate the player.
    expect(room?.members.filter((m) => m.id === host.playerId)).toHaveLength(1);
  });

  it('a reconnect storm keeps one seat and one membership', async () => {
    ts = await startServer();
    const host = await ts.player('Host');
    const guest = await ts.player('Guest');
    const created = await host.emit('room:create', { gameId: 'fixture' });
    const code = created.ok ? (created.room.code as string) : '';
    await guest.emit('room:join', { code });
    const { last } = await reconnectStorm(ts.url, guest.ready.token as string, 15);
    const room = await last.waitForRoom((r) => r !== null);
    expect(room?.members.map((m) => m.id).filter((id) => id === guest.playerId)).toHaveLength(1);
    expect(room?.members).toHaveLength(2);
    await expectHealthy(ts.url);
  });

  it('a full session table evicts the oldest idle sessions instead of locking new players out', async () => {
    ts = await startServer({ limits: { maxSessions: 4 } });
    // Someone fills the table with named sessions and walks away…
    const flood: TestClient[] = [];
    for (let i = 0; i < 3; i++) flood.push(await ts.player(`Flood${i}`));
    // …while one real player sits in a room.
    const real = await ts.player('Real');
    await setupRoom(real);
    for (const f of flood) f.close();
    await eventually(() => ts.server.services.sessions.size === 4);
    // A newcomer still gets in (the oldest idle session makes room)…
    const newcomer = await ts.player('Newcomer');
    expect(newcomer.playerId).toBeTruthy();
    // …and the player in a room keeps their session and seat.
    const back = await TestClient.connect(ts.url, { token: real.ready.token as string });
    expect(back.playerId).toBe(real.playerId);
    expect(ts.server.services.sessions.size).toBeLessThanOrEqual(4);
  });

  it('a whole class behind one address can arrive at once', async () => {
    // The production default (the test helper otherwise lifts this limit).
    const perIp = DEFAULT_CONFIG.limits.newSessionsPerIpPerMinute;
    ts = await startServer({ limits: { newSessionsPerIpPerMinute: perIp } });
    const clients = await Promise.all(Array.from({ length: 45 }, () => ts.connect()));
    expect(new Set(clients.map((c) => c.playerId)).size).toBe(45);
  });

  it('one session holds at most one room', async () => {
    ts = await startServer();
    const c = await ts.player('Hoarder');
    expect((await c.emit('room:create', { gameId: 'fixture' })).ok).toBe(true);
    for (let i = 0; i < 3; i++) {
      expect(await c.emit('room:create', { gameId: 'fixture' })).toEqual(
        expect.objectContaining({ ok: false }),
      );
    }
    expect(await c.emit('public:play', { gameId: null })).toEqual(
      expect.objectContaining({ ok: false, code: 'ALREADY_IN_ROOM' }),
    );
  });
});
