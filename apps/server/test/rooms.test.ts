import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eventually, setupRoom, startServer, type TestServer } from './helpers';

let t: TestServer;
beforeEach(async () => {
  t = await startServer();
});
afterEach(async () => {
  await t.close();
});

describe('creating and joining private rooms', () => {
  it('requires a nickname', async () => {
    const c = await t.connect();
    expect(await c.emit('room:create', { gameId: 'fixture' })).toEqual({
      ok: false,
      code: 'NICKNAME_REQUIRED',
    });
  });

  it('creates a room with a 6-character code and the creator as host', async () => {
    const host = await t.player('Archit');
    const res = await host.emit('room:create', { gameId: 'fixture' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.room.code).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    expect(res.room).toMatchObject({
      kind: 'PRIVATE',
      phase: 'LOBBY',
      hostId: host.playerId,
      capacity: 4,
      minPlayers: 2,
    });
    expect(await host.emit('room:create', { gameId: 'fixture' })).toEqual({
      ok: false,
      code: 'ALREADY_IN_ROOM',
    });
  });

  it('rejects unknown games and unknown codes', async () => {
    const c = await t.player('Archit');
    expect(await c.emit('room:create', { gameId: 'uno' })).toEqual({
      ok: false,
      code: 'GAME_NOT_FOUND',
    });
    expect(await c.emit('room:join', { code: 'ABCDEF' })).toEqual({
      ok: false,
      code: 'ROOM_NOT_FOUND',
    });
    expect(await c.emit('room:join', { code: '!!' })).toEqual({
      ok: false,
      code: 'ROOM_NOT_FOUND',
    });
  });

  it('accepts codes typed in lower case or with spaces', async () => {
    const host = await t.player('Archit');
    const guest = await t.player('Priya');
    const code = await setupRoom(host);
    const res = await guest.emit('room:join', {
      code: ` ${code.slice(0, 3).toLowerCase()} ${code.slice(3)} `,
    });
    expect(res.ok).toBe(true);
  });

  it('broadcasts membership to everyone in the room', async () => {
    const host = await t.player('Archit');
    const guest = await t.player('Priya');
    await setupRoom(host, guest);
    const room = await host.waitForRoom((r) => r?.members.length === 2);
    expect(room?.members.map((m) => (m.kind === 'HUMAN' ? m.nickname : m.name))).toEqual([
      'Archit',
      'Priya',
    ]);
  });

  it('refuses look-alike duplicate nicknames', async () => {
    const host = await t.player('Archit');
    const dupe = await t.player('ARCH1T');
    const code = await setupRoom(host);
    expect(await dupe.emit('room:join', { code })).toEqual({ ok: false, code: 'NICKNAME_TAKEN' });
  });

  it('enforces the game capacity', async () => {
    const host = await t.player('Host');
    const guests = await Promise.all(['Ana', 'Ben', 'Cy'].map((n) => t.player(n)));
    const code = await setupRoom(host, ...guests);
    const late = await t.player('Dee');
    expect(await late.emit('room:join', { code })).toEqual({ ok: false, code: 'ROOM_FULL' });
    expect(await host.emit('room:addBot', {})).toEqual({ ok: false, code: 'ROOM_FULL' });
  });

  it('closes joining once the game has started', async () => {
    const host = await t.player('Archit');
    const code = await setupRoom(host);
    await host.emit('room:addBot', {});
    expect((await host.emit('room:start', {})).ok).toBe(true);
    const late = await t.player('Priya');
    expect(await late.emit('room:join', { code })).toEqual({ ok: false, code: 'ROOM_IN_PROGRESS' });
  });
});

describe('host powers', () => {
  it('only the host can manage the room', async () => {
    const host = await t.player('Archit');
    const guest = await t.player('Priya');
    await setupRoom(host, guest);
    for (const res of [
      await guest.emit('room:start', {}),
      await guest.emit('room:addBot', {}),
      await guest.emit('room:kick', { playerId: host.playerId }),
      await guest.emit('room:updateSettings', { settings: { target: 20, turnSeconds: 10 } }),
    ]) {
      expect(res).toEqual({ ok: false, code: 'NOT_HOST' });
    }
  });

  it('validates settings against the game schema', async () => {
    const host = await t.player('Archit');
    await setupRoom(host);
    expect(
      await host.emit('room:updateSettings', { settings: { target: 99, turnSeconds: 10 } }),
    ).toEqual({
      ok: false,
      code: 'INVALID_SETTINGS',
    });
    expect(
      (await host.emit('room:updateSettings', { settings: { target: 20, turnSeconds: 10 } })).ok,
    ).toBe(true);
    const room = await host.waitForRoom(
      (r) => (r?.settings as { target: number } | undefined)?.target === 20,
    );
    expect(room?.settings).toEqual({ target: 20, turnSeconds: 10 });
  });

  it('adds and removes bots in the lobby', async () => {
    const host = await t.player('Archit');
    await setupRoom(host);
    await host.emit('room:addBot', {});
    const room = await host.waitForRoom((r) => r?.members.length === 2);
    const bot = room?.members[1];
    expect(bot).toMatchObject({ kind: 'BOT', name: 'Bot Tiku' });
    expect(await host.emit('room:removeBot', { botId: 'b_missing' })).toEqual({
      ok: false,
      code: 'BOT_NOT_FOUND',
    });
    expect((await host.emit('room:removeBot', { botId: bot?.id as string })).ok).toBe(true);
    await host.waitForRoom((r) => r?.members.length === 1);
  });

  it('removing a player bars them from rejoining', async () => {
    const host = await t.player('Archit');
    const guest = await t.player('Priya');
    const code = await setupRoom(host, guest);
    expect(await host.emit('room:kick', { playerId: host.playerId })).toEqual({
      ok: false,
      code: 'CANNOT_TARGET_SELF',
    });
    expect((await host.emit('room:kick', { playerId: guest.playerId })).ok).toBe(true);
    await guest.waitFor('room:event', (e) => e.type === 'KICKED');
    await guest.waitForRoom((r) => r === null);
    expect(await guest.emit('room:join', { code })).toEqual({
      ok: false,
      code: 'REMOVED_FROM_ROOM',
    });
  });

  it('needs enough players to start', async () => {
    const host = await t.player('Archit');
    await setupRoom(host);
    expect(await host.emit('room:start', {})).toEqual({ ok: false, code: 'NOT_ENOUGH_PLAYERS' });
  });
});

describe('leaving, host transfer and cleanup', () => {
  it('passes host to the next player when the host leaves, and closes the empty room', async () => {
    const host = await t.player('Archit');
    const guest = await t.player('Priya');
    await setupRoom(host, guest);
    expect((await host.emit('room:leave', {})).ok).toBe(true);
    await guest.waitFor(
      'room:event',
      (e) => e.type === 'HOST_CHANGED' && e.hostId === guest.playerId,
    );
    expect(t.server.services.rooms.roomCount).toBe(1);
    await guest.emit('room:leave', {});
    expect(t.server.services.rooms.roomCount).toBe(0);
  });

  it('transfers host after the host’s reconnect grace period expires', async () => {
    const host = await t.player('Archit');
    const guest = await t.player('Priya');
    await setupRoom(host, guest);
    host.close();
    await guest.waitForRoom(
      (r) => r?.members.some((m) => m.kind === 'HUMAN' && m.status === 'AWAY') ?? false,
    );
    await guest.waitFor('room:event', (e) => e.type === 'HOST_CHANGED', 2000);
    const room = await guest.waitForRoom((r) => r?.members.length === 1);
    expect(room?.hostId).toBe(guest.playerId);
  });

  it('keeps the seat when the player returns within the grace period', async () => {
    const host = await t.player('Archit');
    const guest = await t.player('Priya');
    await setupRoom(host, guest);
    guest.close();
    await host.waitForRoom(
      (r) => r?.members.some((m) => m.kind === 'HUMAN' && m.status === 'AWAY') ?? false,
    );
    const back = await t.connect({ token: guest.ready.token as string });
    const room = await back.waitForRoom(
      (r) => r?.members.every((m) => m.kind !== 'HUMAN' || m.status === 'CONNECTED') ?? false,
    );
    expect(room?.members).toHaveLength(2);
    expect(back.all('chat:history')).toHaveLength(1);
  });

  it('tells a player who returns after their grace period that they are no longer in the room', async () => {
    const host = await t.player('Archit');
    const guest = await t.player('Priya');
    await setupRoom(host, guest);
    await host.waitForRoom((r) => r?.members.length === 2);
    host.clear('room:snapshot');
    guest.close();
    await host.waitForRoom((r) => r?.members.length === 1, 2000);
    const back = await t.connect({ token: guest.ready.token as string });
    expect(back.playerId).toBe(guest.playerId);
    expect(await back.waitForRoom(() => true)).toBeNull();
  });

  it('closes a room when its last human is gone for good', async () => {
    const host = await t.player('Archit');
    await setupRoom(host);
    await host.emit('room:addBot', {});
    host.close();
    await eventually(() => t.server.services.rooms.roomCount === 0);
  });
});
