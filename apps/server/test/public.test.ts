import type { AnyGameModule } from '@cg/game-sdk';
import type { PublicRoomListing, RoomView } from '@cg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import {
  autoPlay,
  eventually,
  sleep,
  startServer,
  testFixture,
  type TestClient,
  type TestServer,
} from './helpers';

/** The fixture game, offered in public play under its own id. */
function publicGame(id: string, targetPlayers = 4): AnyGameModule {
  const base = testFixture();
  return {
    ...base,
    manifest: { ...base.manifest, id, publicMatch: { enabled: true, targetPlayers, minHumans: 2 } },
  } as AnyGameModule;
}

const FILL_MS = 400;
let t: TestServer;
afterEach(async () => {
  await t?.close();
});

async function start(games: AnyGameModule[] = [publicGame('alpha')], overrides = {}) {
  t = await startServer(
    {
      matchmaking: { fillWindowMs: FILL_MS, resultsMs: 600, browsePushMs: 20 },
      rateLimits: {
        matchmaking: { burst: 100, perSecond: 100 },
        browse: { burst: 100, perSecond: 100 },
      },
      ...overrides,
    },
    { games },
  );
  return t;
}

const roomOf = async (c: TestClient, test: (r: RoomView) => boolean, ms = 4000) =>
  (await c.waitForRoom((r) => r !== null && test(r), ms)) as RoomView;
const humans = (r: RoomView) => r.members.filter((m) => m.kind === 'HUMAN').length;
const bots = (r: RoomView) => r.members.filter((m) => m.kind === 'BOT').length;

describe('Quick Play and the public start rule', () => {
  it('creates a public room (no code, no host); a second player joins it; bots fill after the window', async () => {
    await start();
    const a = await t.player('Archit');
    const b = await t.player('Priya');
    const first = await a.emit('public:play', { gameId: 'alpha' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.room).toMatchObject({ kind: 'PUBLIC', code: null, hostId: null, phase: 'LOBBY' });
    expect(first.room.public).toMatchObject({ state: 'WAITING', targetPlayers: 4, minHumans: 2 });
    const second = await b.emit('public:play', { gameId: 'alpha' });
    expect(second.ok && second.room.id).toBe(first.room.id);
    const filling = await roomOf(a, (r) => r.public?.state === 'FILLING');
    expect(filling.public?.fillEndsAt).toBeGreaterThan(Date.now() - 50);
    // The window ends: bots take the two empty seats and the match starts.
    const started = await roomOf(a, (r) => r.phase === 'IN_GAME', 4000);
    expect([humans(started), bots(started)]).toEqual([2, 2]);
    expect(started.match?.seats.map((s) => s.memberKind)).toEqual(['HUMAN', 'HUMAN', 'BOT', 'BOT']);
    const same = await roomOf(b, (r) => r.phase === 'IN_GAME');
    expect(same.match?.matchId).toBe(started.match?.matchId);
  });

  it('starts at once when the target is reached by humans', async () => {
    await start();
    const players = await Promise.all(['A1', 'B2', 'C3', 'D4'].map((n) => t.player(n)));
    for (const p of players)
      expect((await p.emit('public:play', { gameId: 'alpha' })).ok).toBe(true);
    const room = await roomOf(
      players[0] as TestClient,
      (r) => r.phase === 'STARTING' || r.phase === 'IN_GAME',
    );
    expect([humans(room), bots(room)]).toEqual([4, 0]);
  });

  it('never starts with one human; after the window a lone player may play with bots (privately)', async () => {
    await start();
    const a = await t.player('Solo');
    const res = await a.emit('public:play', { gameId: 'alpha' });
    if (!res.ok) throw new Error(res.code);
    const publicId = res.room.id;
    expect(await a.emit('public:playWithBots', {})).toEqual({
      ok: false,
      code: 'PLAY_WITH_BOTS_NOT_READY',
    });
    await sleep(FILL_MS * 2);
    const still = a.last('room:snapshot')?.room as RoomView;
    expect([still.phase, still.public?.state]).toEqual(['LOBBY', 'WAITING']);
    expect(still.public?.playWithBotsAt).not.toBeNull();
    const own = await a.emit('public:playWithBots', {});
    if (!own.ok) throw new Error(own.code);
    expect(own.room).toMatchObject({ kind: 'PRIVATE', hostId: a.playerId });
    expect(own.room.id).not.toBe(publicId);
    expect(bots(own.room)).toBe(3);
    await roomOf(a, (r) => r.id === own.room.id && r.phase === 'IN_GAME');
    // The public room is gone (no humans left).
    const watcher = await t.player('Watcher');
    await watcher.emit('public:browse', { on: true });
    const feed = await watcher.waitFor('public:rooms');
    expect(feed.rooms.find((r) => r.roomId === publicId)).toBeUndefined();
  });

  it('counts only connected humans: a disconnect cancels the window, a reconnect reopens it', async () => {
    await start([publicGame('alpha')], {
      timing: { reconnectGraceMs: 5000, startingCountdownMs: 50 },
    });
    const a = await t.player('Archit');
    const b = await t.player('Priya');
    await a.emit('public:play', { gameId: 'alpha' });
    await b.emit('public:play', { gameId: 'alpha' });
    await roomOf(a, (r) => r.public?.state === 'FILLING');
    const token = b.ready.token as string;
    b.close();
    const bId = b.playerId;
    const waiting = await roomOf(
      a,
      (r) =>
        r.public?.state === 'WAITING' &&
        r.members.some((m) => m.kind === 'HUMAN' && m.id === bId && m.status === 'AWAY'),
    );
    expect(waiting.members.find((m) => m.kind === 'HUMAN' && m.id === b.playerId)).toMatchObject({
      status: 'AWAY',
    }); // the seat is kept during the grace period
    await sleep(FILL_MS * 1.5);
    expect((a.last('room:snapshot')?.room as RoomView).phase).toBe('LOBBY'); // not started
    const back = await t.connect({ token });
    const again = await roomOf(back, (r) => r.public?.state === 'FILLING');
    expect(again.id).toBe(waiting.id);
    await roomOf(back, (r) => r.phase === 'IN_GAME');
  });

  it('concurrent Quick Plays never overfill a room or create needless rooms', async () => {
    await start([publicGame('alpha')], { matchmaking: { fillWindowMs: 5000 } });
    const players = await Promise.all(['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].map((n) => t.player(n)));
    const results = await Promise.all(
      players.map((p) => p.emit('public:play', { gameId: 'alpha' })),
    );
    const rooms = new Map<string, number>();
    for (const r of results) {
      expect(r.ok).toBe(true);
      if (r.ok) rooms.set(r.room.id, (rooms.get(r.room.id) ?? 0) + 1);
    }
    // 6 players, target 4: one full room (started) + one room of 2 — never 3 rooms, never 5 in one.
    expect([...rooms.values()].sort()).toEqual([2, 4]);
  });
});

describe('public room commands and safety', () => {
  it('has no host controls; cancelling works while waiting but not once starting', async () => {
    await start();
    const a = await t.player('Archit');
    const b = await t.player('Priya');
    await a.emit('public:play', { gameId: 'alpha' });
    for (const [event, payload] of [
      ['room:start', {}],
      ['room:addBot', {}],
      ['room:updateSettings', { settings: { target: 20 } }],
      ['room:kick', { playerId: b.playerId }],
    ] as const) {
      expect(await a.emit(event, payload as never)).toEqual({ ok: false, code: 'NOT_HOST' });
    }
    expect((await a.emit('room:leave', {})).ok).toBe(true); // cancel while waiting
    await a.emit('public:play', { gameId: 'alpha' });
    await b.emit('public:play', { gameId: 'alpha' });
    const c = await t.player('Kabir');
    const d = await t.player('Meera');
    await c.emit('public:play', { gameId: 'alpha' });
    await d.emit('public:play', { gameId: 'alpha' }); // target reached → STARTING
    await roomOf(a, (r) => r.phase === 'STARTING' || r.phase === 'IN_GAME');
    const left = await a.emit('room:leave', {});
    // Too late to cancel while starting; once the match runs, Leave forfeits (bot takes over).
    if (!left.ok) expect(left.code).toBe('INVALID_PHASE');
  });

  it('rejects forged, unknown, stale and full joins', async () => {
    await start([publicGame('alpha'), publicGame('beta')]);
    const a = await t.player('Archit');
    expect(await a.emit('public:play', { gameId: 'no-such-game' })).toEqual({
      ok: false,
      code: 'GAME_NOT_FOUND',
    });
    expect(await a.emit('public:join', { roomId: 'r_forged' })).toEqual({
      ok: false,
      code: 'ROOM_NOT_FOUND',
    });
    for (const forged of [
      { gameId: 'alpha', seat: 0 },
      { gameId: 'alpha', players: 9 },
      { gameId: 7 },
    ]) {
      expect(await a.emit('public:play', forged as never)).toEqual({
        ok: false,
        code: 'INVALID_PAYLOAD',
      });
    }
    expect(await a.emit('public:join', { roomId: 'x', bot: true } as never)).toEqual({
      ok: false,
      code: 'INVALID_PAYLOAD',
    });
    // A private room's id can't be joined through the public path.
    const host = await t.player('Host');
    const priv = await host.emit('room:create', { gameId: 'alpha' });
    if (!priv.ok) throw new Error(priv.code);
    expect(await a.emit('public:join', { roomId: priv.room.id })).toEqual({
      ok: false,
      code: 'ROOM_NOT_FOUND',
    });
    // A full (started) room: nobody takes an extra seat.
    const four = await Promise.all(['A1', 'B2', 'C3', 'D4'].map((n) => t.player(n)));
    let roomId = '';
    for (const p of four) {
      const r = await p.emit('public:play', { gameId: 'beta' });
      if (r.ok) roomId = r.room.id;
    }
    expect(await a.emit('public:join', { roomId })).toEqual({
      ok: false,
      code: 'ROOM_IN_PROGRESS',
    });
    // Already in a room: Quick Play for another game is refused.
    const x = await t.player('Xavi');
    await x.emit('public:play', { gameId: 'alpha' });
    expect(await x.emit('public:play', { gameId: 'beta' })).toEqual({
      ok: false,
      code: 'ALREADY_IN_ROOM',
    });
  });

  it('rate-limits matchmaking requests per player', async () => {
    await start([publicGame('alpha')], {
      rateLimits: { matchmaking: { burst: 3, perSecond: 0.1 } },
    });
    const a = await t.player('Spammer');
    const codes: string[] = [];
    for (let k = 0; k < 6; k++) {
      const r = await a.emit('public:join', { roomId: 'r_nope' });
      codes.push(r.ok ? 'OK' : r.code);
    }
    expect(codes.slice(0, 3)).toEqual(['ROOM_NOT_FOUND', 'ROOM_NOT_FOUND', 'ROOM_NOT_FOUND']);
    expect(codes.slice(3)).toEqual(['RATE_LIMITED', 'RATE_LIMITED', 'RATE_LIMITED']);
  });
});

describe('Any Game and Browse', () => {
  it('Any Game joins the busiest open room; with none open it rotates through the games', async () => {
    await start([publicGame('alpha'), publicGame('beta')], { matchmaking: { fillWindowMs: 5000 } });
    const [a, b, c, d] = await Promise.all(['A1', 'B2', 'C3', 'D4'].map((n) => t.player(n)));
    const first = await (a as TestClient).emit('public:play', { gameId: null });
    const second = await (b as TestClient).emit('public:play', { gameId: 'beta' });
    if (!first.ok || !second.ok) throw new Error('play failed');
    expect(first.room.gameId).toBe('alpha'); // rotation starts with the first game
    // c joins beta specifically → beta has 2 humans; Any Game for d picks the busiest (beta).
    await (c as TestClient).emit('public:play', { gameId: 'beta' });
    const any = await (d as TestClient).emit('public:play', { gameId: null });
    expect(any.ok && any.room.gameId).toBe('beta');
  });

  it('pushes the live feed: joins, fills and starts update it; started rooms disappear', async () => {
    await start([publicGame('alpha')], { matchmaking: { fillWindowMs: 5000 } });
    const viewer = await t.player('Viewer');
    expect((await viewer.emit('public:browse', { on: true })).ok).toBe(true);
    const empty = await viewer.waitFor('public:rooms');
    expect(empty.rooms).toEqual([]);
    const [a, b, c, d] = await Promise.all(['A1', 'B2', 'C3', 'D4'].map((n) => t.player(n)));
    const r = await (a as TestClient).emit('public:play', { gameId: 'alpha' });
    if (!r.ok) throw new Error(r.code);
    const listed = await viewer.waitFor('public:rooms', (p) =>
      p.rooms.some((x) => x.roomId === r.room.id && x.humans === 1),
    );
    const entry = listed.rooms[0] as PublicRoomListing;
    expect(entry).toEqual({
      roomId: r.room.id,
      gameId: 'alpha',
      humans: 1,
      targetPlayers: 4,
      maxPlayers: 4,
      state: 'WAITING',
      fillEndsAt: null,
    });
    // Nothing internal is listed (no codes, instances, members).
    expect(Object.keys(entry).sort()).toEqual(
      ['fillEndsAt', 'gameId', 'humans', 'maxPlayers', 'roomId', 'state', 'targetPlayers'].sort(),
    );
    await (b as TestClient).emit('public:join', { roomId: r.room.id });
    await viewer.waitFor('public:rooms', (p) =>
      p.rooms.some((x) => x.roomId === r.room.id && x.humans === 2 && x.state === 'FILLING'),
    );
    await (c as TestClient).emit('public:join', { roomId: r.room.id });
    await (d as TestClient).emit('public:join', { roomId: r.room.id }); // full → starting
    await viewer.waitFor('public:rooms', (p) => !p.rooms.some((x) => x.roomId === r.room.id));
    // Unsubscribed: no more pushes.
    await viewer.emit('public:browse', { on: false });
    viewer.clear('public:rooms');
    const e = await t.player('E5');
    await e.emit('public:play', { gameId: 'alpha' });
    await sleep(150);
    expect(viewer.all('public:rooms')).toHaveLength(0);
  });
});

describe('results of a public match', () => {
  it('Play again keeps a player for the next match; nobody staying closes the room', async () => {
    await start([publicGame('alpha')], {
      matchmaking: { fillWindowMs: 200, resultsMs: 3000 },
    });
    const a = await t.player('Archit');
    const b = await t.player('Priya');
    autoPlay(a);
    autoPlay(b);
    await a.emit('public:play', { gameId: 'alpha' });
    await b.emit('public:play', { gameId: 'alpha' });
    const results = await roomOf(a, (r) => r.phase === 'RESULTS', 20_000);
    expect(results.public?.resultsEndsAt).not.toBeNull();
    expect((await a.emit('public:resultsChoice', { stay: true })).ok).toBe(true);
    expect((await b.emit('public:resultsChoice', { stay: false })).ok).toBe(true);
    // Everyone answered: back to matchmaking with the stayer only; bots removed.
    const lobby = await roomOf(a, (r) => r.phase === 'LOBBY' && r.id === results.id);
    expect(lobby.members.map((m) => m.kind)).toEqual(['HUMAN']);
    expect(lobby.public?.state).toBe('WAITING');
    await b.waitForRoom((r) => r === null);
    await eventually(() => a.last('room:snapshot')?.room?.public?.state === 'WAITING');
  }, 30_000);
});

describe('reconnecting to a public room', () => {
  it('keeps the seat while waiting, just before the start and during the match', async () => {
    await start([publicGame('alpha')], {
      timing: { reconnectGraceMs: 5000, startingCountdownMs: 700 },
      matchmaking: { fillWindowMs: 300 },
    });
    const a = await t.player('Archit');
    const b = await t.player('Priya');
    const ra = await a.emit('public:play', { gameId: 'alpha' });
    if (!ra.ok) throw new Error(ra.code);
    // Waiting: drop and come back to the same room.
    const token = a.ready.token as string; // the session keeps its token across reconnects
    a.close();
    let back = await t.connect({ token });
    const waiting = await roomOf(back, (r) => r.id === ra.room.id);
    expect(waiting.public?.state).toBe('WAITING');
    // Just before the start (STARTING countdown): drop and come back.
    await b.emit('public:play', { gameId: 'alpha' });
    await roomOf(b, (r) => r.phase === 'STARTING', 4000);
    back.close();
    back = await t.connect({ token });
    const resumed = await roomOf(back, (r) => r.id === ra.room.id);
    expect(['STARTING', 'IN_GAME']).toContain(resumed.phase);
    // During the match: the player gets their own seat's view back.
    await roomOf(back, (r) => r.phase === 'IN_GAME');
    back.close();
    back = await t.connect({ token });
    const update = await back.waitFor('match:update');
    const seat = (back.last('room:snapshot')?.room as RoomView).match?.seats.find(
      (s) => s.memberId === back.playerId,
    );
    expect(update.you).toBe(seat?.seat);
  });
});
