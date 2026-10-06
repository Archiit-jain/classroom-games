import { afterEach, describe, expect, it } from 'vitest';
import { setupRoom, startServer, testFixture, type TestServer } from '../helpers';

/** Phase 10 §4–5: room codes, membership and public/private crossover. */
let ts: TestServer;
afterEach(async () => {
  await ts?.close();
});

const publicFixture = () => {
  const base = testFixture();
  return {
    ...base,
    manifest: { ...base.manifest, publicMatch: { enabled: true, targetPlayers: 4, minHumans: 2 } },
  } as typeof base;
};

/** Codes no room has (the alphabet has no 0/O/1/I/L, so these are valid but unused). */
const wrongCodes = (n: number) =>
  Array.from({ length: n }, (_, i) => `ZZ${String.fromCharCode(65 + (i % 20))}${'XYZ'[i % 3]}QQ`);

describe('room-code guessing', () => {
  it('wrong codes from one address are capped across sessions, and a real code then waits too', async () => {
    ts = await startServer({
      // Generous per-session limit so only the per-IP budget is being tested.
      rateLimits: {
        roomJoin: { burst: 1000, perSecond: 1000 },
        codeGuess: { burst: 8, perSecond: 0.1 },
      },
    });
    const owner = await ts.player('Owner');
    const created = await owner.emit('room:create', { gameId: 'fixture' });
    const code = created.ok ? (created.room.code as string) : '';
    // Several sessions from the same address (a guesser rotating identities).
    const guessers = await Promise.all(['Gus', 'Gabi', 'Gita'].map((n) => ts.player(n)));
    const codes: string[] = [];
    for (const [i, guess] of wrongCodes(12).entries()) {
      const res = await (guessers[i % 3] as (typeof guessers)[number]).emit('room:join', {
        code: guess,
      });
      codes.push(res.ok ? 'ok' : res.code);
    }
    expect(codes.slice(0, 8)).toEqual(Array(8).fill('ROOM_NOT_FOUND'));
    expect(codes.slice(8)).toEqual(Array(4).fill('RATE_LIMITED'));
    // While the address is locked out even the right code waits (fails closed, briefly).
    const right = await (guessers[0] as (typeof guessers)[number]).emit('room:join', { code });
    expect(right).toEqual(expect.objectContaining({ ok: false, code: 'RATE_LIMITED' }));
    expect((right as { retryAfterMs?: number }).retryAfterMs).toBeGreaterThan(0);
  });

  it('a correct code costs nothing from the guess budget', async () => {
    ts = await startServer({ rateLimits: { codeGuess: { burst: 2, perSecond: 0.01 } } });
    for (let i = 0; i < 4; i++) {
      const host = await ts.player(`Host${i}`);
      const guest = await ts.player(`Guest${i}`);
      await setupRoom(host, guest); // throws if any join failed
    }
  });

  it('errors reveal nothing beyond "not found" for codes that do not exist', async () => {
    ts = await startServer();
    const c = await ts.player('Prober');
    for (const code of ['ZZZZZZ', 'zz zz zz', 'AAAAAA', '', '!!!!!!', 'ABCDEFGHIJKLMNOP']) {
      expect(await c.emit('room:join', { code })).toEqual({ ok: false, code: 'ROOM_NOT_FOUND' });
    }
  });

  it('started, closed and public rooms cannot be joined by code', async () => {
    ts = await startServer({}, { games: [publicFixture()] });
    const a = await ts.player('Anu');
    const b = await ts.player('Bela');
    const late = await ts.player('Late');
    const created = await a.emit('room:create', { gameId: 'fixture' });
    const code = created.ok ? (created.room.code as string) : '';
    await b.emit('room:join', { code });
    expect((await a.emit('room:start', {})).ok).toBe(true);
    await a.waitForRoom((r) => r?.phase === 'IN_GAME');
    expect(await late.emit('room:join', { code })).toEqual({ ok: false, code: 'ROOM_IN_PROGRESS' });
    // Everyone leaves: the room closes and its code is dead.
    await a.emit('room:leave', {});
    await b.emit('room:leave', {});
    expect(await late.emit('room:join', { code })).toEqual({ ok: false, code: 'ROOM_NOT_FOUND' });
    // A public room has no code at all.
    const pub = await late.emit('public:play', { gameId: 'fixture' });
    expect(pub.ok && pub.room.code).toBeNull();
  });
});

describe('membership and powers', () => {
  it('a private room cannot be entered through the public API, even with its id', async () => {
    ts = await startServer({}, { games: [publicFixture()] });
    const owner = await ts.player('Owner');
    const created = await owner.emit('room:create', { gameId: 'fixture' });
    const roomId = created.ok ? created.room.id : '';
    const intruder = await ts.player('Intruder');
    const res = await intruder.emit('public:join', { roomId });
    expect(res.ok).toBe(false);
    expect(intruder.all('room:snapshot').filter((s) => s.room !== null)).toHaveLength(0);
  });

  it('non-hosts and non-members cannot use host powers or touch other rooms', async () => {
    ts = await startServer();
    const host = await ts.player('Host');
    const guest = await ts.player('Guest');
    const stranger = await ts.player('Stranger');
    await setupRoom(host, guest);
    for (const [event, payload] of [
      ['room:start', {}],
      ['room:addBot', {}],
      ['room:setGame', { gameId: 'fixture' }],
      ['room:updateSettings', { settings: { target: 5 } }],
      ['room:kick', { playerId: host.playerId }],
    ] as const) {
      expect(await guest.emitRaw(event, payload), `guest ${event}`).toEqual(
        expect.objectContaining({ ok: false, code: 'NOT_HOST' }),
      );
      expect(await stranger.emitRaw(event, payload), `stranger ${event}`).toEqual(
        expect.objectContaining({ ok: false, code: 'NOT_IN_ROOM' }),
      );
    }
    // Forged ids inside the host's own room do nothing.
    expect((await host.emit('room:kick', { playerId: stranger.playerId })).ok).toBe(false);
    expect((await host.emit('room:removeBot', { botId: guest.playerId })).ok).toBe(false);
    const room = await guest.waitForRoom((r) => r !== null);
    expect(room?.members).toHaveLength(2);
  });

  it('public rooms take no host commands and no forged seats', async () => {
    ts = await startServer({}, { games: [publicFixture()] });
    const a = await ts.player('Anu');
    const joined = await a.emit('public:play', { gameId: 'fixture' });
    expect(joined.ok).toBe(true);
    for (const event of ['room:start', 'room:addBot', 'room:backToLobby']) {
      expect(await a.emitRaw(event, {})).toEqual(expect.objectContaining({ ok: false }));
    }
    const room = joined.ok ? joined.room : null;
    expect(room?.members.filter((m) => m.kind === 'BOT')).toHaveLength(0);
  });
});
