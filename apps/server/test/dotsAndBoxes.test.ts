import { createDotsAndBoxesGame, type DotsOptions } from '@cg/game-dots-and-boxes/server';
import {
  allEdges,
  edgeId,
  isDrawn,
  type DotsEvent,
  type DotsView,
  type Edge,
} from '@cg/game-dots-and-boxes/shared';
import type { MatchUpdate } from '@cg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import {
  newActionId,
  setupGameRoom,
  sleep,
  startServer,
  type TestClient,
  type TestServer,
} from './helpers';

type Update = MatchUpdate<DotsView, DotsEvent>;
const FAST: DotsOptions = { botThinkMs: [10, 30], botChainMs: [5, 15] };

let t: TestServer;
afterEach(async () => {
  await t?.close();
});

const latest = (c: TestClient) => c.all('match:update').at(-1) as Update | undefined;
const free = (v: DotsView): Edge[] =>
  allEdges(v.n).filter((e) => !isDrawn({ n: v.n, h: v.h, v: v.v }, e));
const id = (e: Edge) => edgeId(e.o, e.r, e.c);

/** Draws the first free line whenever it is this client's move. */
function autoDraw(client: TestClient): void {
  client.socket.on('match:update', (update) => {
    const u = update as Update;
    if (u.view.phase === 'PLAYING' && u.view.turn === u.you) {
      const e = free(u.view)[0];
      if (e) void client.act(u, { type: 'DRAW', edge: id(e) }).catch(() => undefined);
    }
  });
}

async function twoPlayers(options: DotsOptions = FAST, grid = 4) {
  t = await startServer({}, { games: [createDotsAndBoxesGame(options)] });
  const a = await t.player('Archit');
  const b = await t.player('Priya');
  await setupGameRoom('dots-and-boxes', a, b);
  await a.emit('room:updateSettings', { settings: { grid } });
  return [a, b] as const;
}

describe('Dots & Boxes over real sockets', () => {
  it('plays a full 4×4 match with two humans and a bot, everyone seeing the same board', async () => {
    const [a, b] = await twoPlayers();
    await a.emit('room:addBot', {});
    autoDraw(a);
    autoDraw(b);
    expect((await a.emit('room:start', {})).ok).toBe(true);
    const end = await a.waitFor('match:end', () => true, 20_000);
    const scores = end.results.stats as Record<number, { boxes: number }>;
    expect(Object.values(scores).reduce((s, x) => s + x.boxes, 0)).toBe(16);
    await sleep(50);
    expect(latest(b)?.view.boxes).toEqual(latest(a)?.view.boxes);
    expect(free(latest(a)?.view as DotsView)).toEqual([]);
  });

  it('rejects wrong-player, taken, duplicate, stale, forged and post-game moves', async () => {
    const [a, b] = await twoPlayers({ ...FAST, afkMs: 60_000 });
    expect((await a.emit('room:start', {})).ok).toBe(true);
    const first = (await a.waitFor('match:update')) as Update;
    await b.waitFor('match:update');
    const [mover, other] = first.view.turn === first.you ? [a, b] : [b, a];
    const view = latest(mover) as Update;
    const waiting = latest(other) as Update;

    expect(await other.act(waiting, { type: 'DRAW', edge: 'h:0:0' })).toEqual({
      ok: false,
      code: 'NOT_YOUR_TURN',
    });
    // Forged extras (claimed boxes, score, extra turn) and nonsense are rejected outright.
    for (const forged of [
      { type: 'DRAW', edge: 'h:0:0', boxes: [0] },
      { type: 'DRAW', edge: 'h:0:0', score: 16 },
      { type: 'CLAIM', box: 0 },
      { type: 'DRAW', edge: 'h:99:99' },
    ]) {
      const res = await mover.act(view, forged);
      expect(res.ok, JSON.stringify(forged)).toBe(false);
    }
    const actionId = newActionId();
    expect((await mover.act(view, { type: 'DRAW', edge: 'h:0:0' }, actionId)).ok).toBe(true);
    expect(await mover.act(view, { type: 'DRAW', edge: 'h:0:1' }, actionId)).toEqual({
      ok: false,
      code: 'DUPLICATE_ACTION',
    });
    const next = (await other.waitFor(
      'match:update',
      (u) => (u as Update).view.turn === u.you,
    )) as Update;
    expect(await other.act(next, { type: 'DRAW', edge: 'h:0:0' })).toEqual({
      ok: false,
      code: 'ILLEGAL_ACTION',
    });
    expect(
      await other.act({ matchId: next.matchId, version: 999 }, { type: 'DRAW', edge: 'h:0:1' }),
    ).toEqual({ ok: false, code: 'STALE_VERSION' });
    expect(
      await other.emit('match:action', {
        matchId: next.matchId,
        version: next.version,
        actionId: newActionId(),
        action: 'h:0:1',
      }),
    ).toMatchObject({ ok: false });
  });

  it('refuses moves after the end of the match', async () => {
    const [a, b] = await twoPlayers();
    autoDraw(a);
    autoDraw(b);
    expect((await a.emit('room:start', {})).ok).toBe(true);
    await a.waitFor('match:end', () => true, 20_000);
    await sleep(1500); // the quick auto-play used the action rate bucket: let it refill
    const last = latest(a) as Update;
    const res = await a.act(last, { type: 'DRAW', edge: 'h:0:0' });
    expect(res.ok).toBe(false);
    expect(['INVALID_PHASE', 'MATCH_NOT_FOUND']).toContain((res as { code: string }).code);
  });

  it('a player who reconnects mid-match gets the board and their seat back', async () => {
    const [a, b] = await twoPlayers({ ...FAST, afkMs: 60_000 });
    expect((await a.emit('room:start', {})).ok).toBe(true);
    await a.waitFor('match:update');
    const before = (await b.waitFor('match:update')) as Update;
    const token = b.ready.token as string;
    b.close();
    const back = await t.connect({ token });
    const resumed = (await back.waitFor('match:update')) as Update;
    expect(resumed.matchId).toBe(before.matchId);
    expect(resumed.view.h).toEqual(before.view.h);
    const room = await back.waitForRoom((r) => r?.phase === 'IN_GAME');
    expect(room?.match?.seats.find((s) => s.memberId === back.ready.playerId)?.controller).toBe(
      'HUMAN',
    );
  });

  it('hands an inactive player to a bot (no turn timer), and they can take the seat back', async () => {
    const [a, b] = await twoPlayers({ ...FAST, afkMs: 300 });
    expect((await a.emit('room:start', {})).ok).toBe(true);
    const first = (await a.waitFor('match:update')) as Update;
    const idler = first.view.turn === first.you ? a : b;
    await idler.waitFor(
      'room:event',
      (e) => e.type === 'SEAT_TAKEN_OVER' && e.reason === 'IDLE',
      4000,
    );
    // The bot moves for them through the normal validation path.
    await idler.waitFor('match:update', (u) => (u as Update).view.moves > 0, 4000);
    expect((await idler.emit('room:reclaimSeat', {})).ok).toBe(true);
    await idler.waitFor('room:event', (e) => e.type === 'SEAT_RECLAIMED');
  });
});
