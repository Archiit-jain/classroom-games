import { afterEach, describe, expect, it } from 'vitest';
import type { FixtureEvent, FixtureView } from '@cg/game-sdk/fixture';
import type { MatchUpdate } from '@cg/protocol';
import {
  autoPlay,
  eventually,
  newActionId,
  setupRoom,
  startServer,
  testFixture,
  type TestClient,
  type TestServer,
} from './helpers';

let t: TestServer;
afterEach(async () => {
  await t?.close();
});

type Update = MatchUpdate<FixtureView, FixtureEvent>;
const updates = (c: TestClient) => c.all('match:update') as Update[];

async function startMatch(host: TestClient, ...others: TestClient[]): Promise<Update> {
  expect((await host.emit('room:start', {})).ok).toBe(true);
  await host.waitForRoom((r) => r?.phase === 'STARTING');
  const first = (await host.waitFor('match:update')) as Update;
  for (const o of others) await o.waitFor('match:update');
  return first;
}

describe('a complete private match', () => {
  it('runs LOBBY → STARTING → IN_GAME → RESULTS with humans and a bot', async () => {
    t = await startServer();
    const host = await t.player('Archit');
    const guest = await t.player('Priya');
    await setupRoom(host, guest);
    await host.emit('room:addBot', {});
    autoPlay(host);
    autoPlay(guest);
    await startMatch(host, guest);

    const inGame = await host.waitForRoom((r) => r?.phase === 'IN_GAME');
    expect(inGame?.match?.seats.map((s) => [s.displayName, s.controller])).toEqual([
      ['Archit', 'HUMAN'],
      ['Priya', 'HUMAN'],
      ['Bot Tiku', 'BOT'],
    ]);

    const end = await host.waitFor('match:end', () => true, 10_000);
    expect(end.results.placements.filter((p) => p.place === 1)).toHaveLength(1);
    const results = await guest.waitForRoom((r) => r?.phase === 'RESULTS');
    expect(results?.match?.results).toEqual(end.results);

    // Host decides what happens next.
    expect(await guest.emit('room:playAgain', {})).toEqual({ ok: false, code: 'NOT_HOST' });
    guest.clear('room:snapshot');
    expect((await host.emit('room:backToLobby', {})).ok).toBe(true);
    const lobby = await guest.waitForRoom((r) => r?.phase === 'LOBBY');
    expect(lobby?.match).toBeNull();
    expect(lobby?.members).toHaveLength(3); // the host-added bot stays
  });

  it('play again restarts straight away with the same players', async () => {
    t = await startServer();
    const host = await t.player('Archit');
    const guest = await t.player('Priya');
    await setupRoom(host, guest);
    autoPlay(host);
    autoPlay(guest);
    await startMatch(host, guest);
    const firstEnd = await host.waitFor('match:end', () => true, 10_000);
    expect((await host.emit('room:playAgain', {})).ok).toBe(true);
    const next = await host.waitFor('match:update', (u) => u.matchId !== firstEnd.matchId);
    expect(next.matchId).not.toBe(firstEnd.matchId);
  });
});

describe('server authority and hidden information', () => {
  it('never shows a player anyone else’s secret before the end', async () => {
    t = await startServer({}, { games: [testFixture({ turnMs: 60_000 })] });
    const players = [await t.player('Ana'), await t.player('Ben'), await t.player('Cy')];
    await setupRoom(players[0] as TestClient, players[1] as TestClient, players[2] as TestClient);
    await startMatch(players[0] as TestClient, players[1] as TestClient, players[2] as TestClient);

    const secrets = players.map((p) => {
      const dealt = updates(p)
        .flatMap((u) => u.events)
        .filter((e) => e.type === 'LUCKY_DEALT');
      expect(dealt).toHaveLength(1);
      return (dealt[0] as { lucky: number }).lucky;
    });
    for (const [i, p] of players.entries()) {
      for (const u of updates(p)) {
        expect(u.view.yourLucky).toBe(secrets[i]);
        expect(u.view.revealedLucky).toBeNull();
      }
    }
  });

  it('rejects out-of-turn, malformed and unknown-match actions', async () => {
    t = await startServer({}, { games: [testFixture({ turnMs: 60_000 })] });
    const host = await t.player('Archit');
    const guest = await t.player('Priya');
    await setupRoom(host, guest);
    const first = await startMatch(host, guest);
    const { matchId, version } = first;
    const notTurn = first.view.turn === 0 ? guest : host;
    const onTurn = first.view.turn === 0 ? host : guest;

    const add = (amount: number) => ({ type: 'ADD', amount });
    expect(await notTurn.act({ matchId, version }, add(1))).toEqual({
      ok: false,
      code: 'NOT_YOUR_TURN',
    });
    expect(await onTurn.act({ matchId, version }, add(7))).toEqual({
      ok: false,
      code: 'INVALID_PAYLOAD',
    });
    expect(await onTurn.act({ matchId: 'm_other', version }, add(1))).toEqual({
      ok: false,
      code: 'MATCH_NOT_FOUND',
    });
    expect(await onTurn.act({ matchId, version: version + 50 }, add(1))).toEqual({
      ok: false,
      code: 'STALE_VERSION',
    });
    // Missing or malformed action ids never reach the game.
    expect(
      await onTurn.emitRaw('match:action', { matchId, version, action: add(1) }),
    ).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' });
    expect(
      await onTurn.emitRaw('match:action', { matchId, version, actionId: 'short', action: add(1) }),
    ).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' });
    expect(await onTurn.act({ matchId, version }, add(2))).toEqual({
      ok: true,
      version: version + 1,
    });
    // A double-tap sent as a new intent is still rejected by the rules (the turn has passed).
    expect(await onTurn.act({ matchId, version }, add(2))).toEqual({
      ok: false,
      code: 'NOT_YOUR_TURN',
    });
  });

  it('never executes the same action id twice (double tap, replay)', async () => {
    t = await startServer({}, { games: [testFixture({ turnMs: 60_000 })] });
    const host = await t.player('Archit');
    const guest = await t.player('Priya');
    await setupRoom(host, guest);
    const first = await startMatch(host, guest);
    const [onTurn, other] = first.view.turn === 0 ? [host, guest] : [guest, host];
    const add = (amount: number) => ({ type: 'ADD', amount });

    // Double tap: the identical message arrives twice.
    const tapId = newActionId();
    const [a, b] = await Promise.all([
      onTurn.act(first, add(1), tapId),
      onTurn.act(first, add(1), tapId),
    ]);
    expect([a, b]).toContainEqual({ ok: true, version: first.version + 1 });
    expect([a, b]).toContainEqual({ ok: false, code: 'DUPLICATE_ACTION' });

    // The other player moves; now it is legal for the first player to act again…
    const afterTap = (await other.waitFor(
      'match:update',
      (u) => u.version === first.version + 1,
    )) as Update;
    expect((await other.act(afterTap, add(1))).ok).toBe(true);
    const backToFirst = (await onTurn.waitFor(
      'match:update',
      (u) => u.version === first.version + 2,
    )) as Update;
    expect(backToFirst.view.turn).toBe(backToFirst.you);
    // …but replaying the old message is refused, while a new intent is accepted.
    expect(await onTurn.act(backToFirst, add(1), tapId)).toEqual({
      ok: false,
      code: 'DUPLICATE_ACTION',
    });
    expect(await onTurn.act(backToFirst, add(1))).toEqual({
      ok: true,
      version: backToFirst.version + 1,
    });
    const counters = (onTurn.last('match:update') as Update).view.counter;
    expect(counters).toBe(3); // 1 + 1 + 1: each intent counted exactly once
  });

  it('resync returns the player’s current view', async () => {
    t = await startServer({}, { games: [testFixture({ turnMs: 60_000 })] });
    const host = await t.player('Archit');
    const guest = await t.player('Priya');
    await setupRoom(host, guest);
    const first = await startMatch(host, guest);
    const res = await guest.emit('match:resync', { matchId: first.matchId });
    expect(res.ok && res.update.you).toBe(1);
  });
});

describe('disconnects, bot takeover and reclaiming', () => {
  it('a bot takes over after the grace period and the player reclaims on return', async () => {
    t = await startServer(
      { timing: { reconnectGraceMs: 300 } },
      { games: [testFixture({ turnMs: 300 })] },
    );
    const host = await t.player('Archit');
    const guest = await t.player('Priya');
    await setupRoom(host, guest);
    autoPlay(host, 1);
    await host.emit('room:updateSettings', { settings: { target: 30, turnSeconds: 10 } });
    await startMatch(host, guest);

    guest.close();
    const takenOver = await host.waitForRoom(
      (r) => r?.match?.seats[1]?.takeover?.reason === 'DISCONNECTED',
      3000,
    );
    expect(takenOver?.match?.seats[1]).toMatchObject({
      controller: 'BOT',
      takeover: { botName: 'Bot Tiku' },
    });

    const back = await t.connect({ token: guest.ready.token as string });
    await back.waitFor('room:event', (e) => e.type === 'SEAT_RECLAIMED');
    const reclaimed = await host.waitForRoom((r) => r?.match?.seats[1]?.controller === 'HUMAN');
    expect(reclaimed?.match?.seats[1]?.takeover).toBeNull();
    const view = (await back.waitFor('match:update')) as Update;
    expect(view.you).toBe(1);
  });

  it('marks a connected but idle player, then lets them take their seat back', async () => {
    t = await startServer({}, { games: [testFixture({ turnMs: 150, idleAfterTimeouts: 2 })] });
    const host = await t.player('Archit');
    const idler = await t.player('Priya');
    await setupRoom(host, idler);
    await host.emit('room:updateSettings', { settings: { target: 30, turnSeconds: 10 } });
    autoPlay(host, 1);
    await startMatch(host, idler);

    await idler.waitFor(
      'room:event',
      (e) => e.type === 'SEAT_TAKEN_OVER' && e.reason === 'IDLE',
      4000,
    );
    const current = idler.last('match:update') as Update;
    expect(await idler.act(current, { type: 'ADD', amount: 1 })).toEqual({
      ok: false,
      code: 'SEAT_CONTROLLED_BY_BOT',
    });
    expect((await idler.emit('room:reclaimSeat', {})).ok).toBe(true);
    await idler.waitFor('room:event', (e) => e.type === 'SEAT_RECLAIMED');
    await host.waitForRoom((r) => r?.match?.seats[1]?.controller === 'HUMAN');
  });

  it('a player who leaves mid-match is replaced for good and cannot rejoin that match', async () => {
    t = await startServer({}, { games: [testFixture({ turnMs: 200 })] });
    const host = await t.player('Archit');
    const guest = await t.player('Priya');
    const code = await setupRoom(host, guest);
    autoPlay(host, 1);
    await host.emit('room:updateSettings', { settings: { target: 30, turnSeconds: 10 } });
    await startMatch(host, guest);

    expect((await guest.emit('room:leave', {})).ok).toBe(true);
    await guest.waitForRoom((r) => r === null);
    const room = await host.waitForRoom((r) => r?.match?.seats[1]?.takeover?.reason === 'LEFT');
    expect(room?.members).toHaveLength(1);
    expect(await guest.emit('room:join', { code })).toEqual({
      ok: false,
      code: 'ROOM_IN_PROGRESS',
    });
    expect(await guest.emit('room:reclaimSeat', {})).toEqual({ ok: false, code: 'NOT_IN_ROOM' });
    await host.waitFor('match:end', () => true, 15_000);
  });

  it('closes the room when only bots would be left playing', async () => {
    t = await startServer(
      { timing: { reconnectGraceMs: 200 } },
      { games: [testFixture({ turnMs: 60_000 })] },
    );
    const host = await t.player('Archit');
    await setupRoom(host);
    await host.emit('room:addBot', {});
    await startMatch(host);
    host.close();
    await eventually(() => t.server.services.rooms.roomCount === 0, 3000);
    expect(t.server.services.timers.size).toBe(0);
  });
});
