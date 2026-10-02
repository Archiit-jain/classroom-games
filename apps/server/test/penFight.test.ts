import { createPenFightGame, type FightOptions } from '@cg/game-pen-fight/server';
import type { FightEvent, FightView } from '@cg/game-pen-fight/shared';
import type { MatchUpdate } from '@cg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { setupGameRoom, sleep, startServer, type TestClient, type TestServer } from './helpers';

type Update = MatchUpdate<FightView, FightEvent>;
type ShotPlayed = Extract<FightEvent, { type: 'SHOT_PLAYED' }>;

const FAST: FightOptions = {
  timing: { aimMs: 1500, afterReplayMs: 30, shrinkMs: 30 },
  timeScale: 0.2,
  bot: { thinkMs: [100, 200] },
};

let t: TestServer;
afterEach(async () => {
  await t?.close();
});

const updates = (c: TestClient) => c.all('match:update') as Update[];
const shotsSeenBy = (c: TestClient) =>
  updates(c).flatMap((u) => u.events.filter((e): e is ShotPlayed => e.type === 'SHOT_PLAYED'));

/** Flicks toward the centre whenever it is this client's turn. */
function autoFlick(client: TestClient): void {
  client.socket.on('match:update', (update) => {
    const u = update as Update;
    if (u.view.phase === 'AIMING' && u.view.active === u.you) {
      const me = u.view.pens.find((p) => p.seat === u.you);
      if (!me) return;
      const angle = Math.atan2(-me.y, -me.x);
      void client.act(u, { type: 'FLICK', anchor: 0.2, angle, power: 0.6 }).catch(() => undefined);
    }
  });
}

async function room(players: string[], bots: number, options: FightOptions = FAST, overrides = {}) {
  t = await startServer(overrides, { games: [createPenFightGame(options)] });
  const clients = await Promise.all(players.map((n) => t.player(n)));
  const [host, ...guests] = clients as [TestClient, ...TestClient[]];
  await setupGameRoom('pen-fight', host, ...guests);
  for (let i = 0; i < bots; i++) await host.emit('room:addBot', {});
  return clients;
}

describe('Pen Fight over real sockets', () => {
  it('plays a full match with two humans and two bots; everyone sees the same server replay', async () => {
    const [host, guest] = (await room(['Archit', 'Priya'], 2)) as [TestClient, TestClient];
    autoFlick(host);
    autoFlick(guest);
    expect((await host.emit('room:start', {})).ok).toBe(true);
    const end = await host.waitFor('match:end', () => true, 60_000);
    expect(end.results.placements.map((p) => p.place).sort()[0]).toBe(1);
    expect(end.results.placements).toHaveLength(4);

    await sleep(50);
    const hostShots = shotsSeenBy(host);
    expect(hostShots.length).toBeGreaterThan(0);
    // Identical replay data for every player — it is the server's simulation, not theirs.
    expect(shotsSeenBy(guest)).toEqual(hostShots);
    for (const shot of hostShots) {
      expect(JSON.stringify(shot).length).toBeLessThan(16 * 1024);
      expect(shot.durationMs).toBe(Math.round((shot.steps / 60) * 1000));
    }
    // After each shot, the view holds the replay's final positions.
    for (const u of updates(host)) {
      const shot = u.events.find((e): e is ShotPlayed => e.type === 'SHOT_PLAYED');
      if (!shot) continue;
      for (const pen of u.view.pens.filter((p) => p.alive)) {
        const moved = shot.frames
          .flat()
          .filter((f) => f[0] === pen.seat)
          .at(-1);
        if (moved) expect([moved[1], moved[2], moved[3]]).toEqual([pen.x, pen.y, pen.a]);
      }
    }
  });

  it('validates every flick on the server: turn, phase, shape and duplicates', async () => {
    const [a, b] = (await room(['Archit', 'Priya'], 0)) as [TestClient, TestClient];
    expect((await a.emit('room:start', {})).ok).toBe(true);
    const first = (await a.waitFor('match:update')) as Update;
    const [active, other] = first.view.active === first.you ? [a, b] : [b, a];
    const view = (await active.waitFor('match:update')) as Update;
    const waiting = (await other.waitFor('match:update')) as Update;

    expect(await other.act(waiting, { type: 'FLICK', anchor: 0, angle: 0, power: 1 })).toEqual({
      ok: false,
      code: 'NOT_YOUR_TURN',
    });
    expect(await active.act(view, { type: 'FLICK', anchor: 0, angle: 'left', power: 1 })).toEqual({
      ok: false,
      code: 'INVALID_PAYLOAD',
    });
    const id = 'flick_once_1';
    const ok = await active.act(view, { type: 'FLICK', anchor: 0, angle: 0, power: 0.3 }, id);
    expect(ok.ok).toBe(true);
    // The same intent again is a duplicate; a new one during the replay is the wrong phase.
    expect(await active.act(view, { type: 'FLICK', anchor: 0, angle: 0, power: 0.3 }, id)).toEqual({
      ok: false,
      code: 'DUPLICATE_ACTION',
    });
    expect(await active.act(view, { type: 'FLICK', anchor: 0, angle: 0, power: 0.3 })).toEqual({
      ok: false,
      code: 'INVALID_PHASE',
    });
    // Others only ever learn that someone is aiming — the flick itself arrives as the replay.
    await other.waitFor('match:update', (u) =>
      (u as Update).events.some((e) => e.type === 'SHOT_PLAYED'),
    );
    expect(other.all('match:stream')).toEqual([]);
  });

  it('skips a turn at the timeout and hands an idle player to a bot after 3 skips; they can reclaim mid-match', async () => {
    const [host, idler] = (await room(['Archit', 'Priya'], 0, {
      ...FAST,
      timing: { aimMs: 300, afterReplayMs: 20, shrinkMs: 20 },
      timeScale: 1,
    })) as [TestClient, TestClient];
    autoFlick(host);
    expect((await host.emit('room:start', {})).ok).toBe(true);
    await idler.waitFor('match:update', (u) =>
      (u as Update).events.some((e) => e.type === 'TURN_SKIPPED'),
    );
    await idler.waitFor(
      'room:event',
      (e) => e.type === 'SEAT_TAKEN_OVER' && e.reason === 'IDLE',
      8000,
    );
    // The bot now flicks for them…
    await host.waitFor(
      'match:update',
      (u) =>
        (u as Update).events.some((e) => e.type === 'SHOT_PLAYED' && e.seat !== (u as Update).you),
      8000,
    );
    // …until they take the seat back (reclaim is immediate in Pen Fight).
    expect((await idler.emit('room:reclaimSeat', {})).ok).toBe(true);
    await idler.waitFor('room:event', (e) => e.type === 'SEAT_RECLAIMED');
  });

  it('a player who reconnects during a replay gets the final positions at once', async () => {
    const [a, b] = (await room(['Archit', 'Priya'], 0, {
      ...FAST,
      timing: { aimMs: 5000, afterReplayMs: 3000, shrinkMs: 30 },
      timeScale: 1,
    })) as [TestClient, TestClient];
    expect((await a.emit('room:start', {})).ok).toBe(true);
    const first = (await a.waitFor('match:update')) as Update;
    const shooter = first.view.active === first.you ? a : b;
    const watcher = shooter === a ? b : a;
    const view = (await shooter.waitFor('match:update')) as Update;
    await shooter.act(view, { type: 'FLICK', anchor: 0, angle: 0.3, power: 0.7 });
    const played = (await watcher.waitFor('match:update', (u) =>
      (u as Update).events.some((e) => e.type === 'SHOT_PLAYED'),
    )) as Update;

    const token = watcher.ready.token as string;
    watcher.close();
    const back = await t.connect({ token });
    const resumed = (await back.waitFor('match:update')) as Update;
    expect(resumed.events).toEqual([]); // no replay, just the result
    expect(resumed.view.phase).toBe('PLAYBACK');
    expect(resumed.view.pens).toEqual(played.view.pens);
    expect(resumed.view.lastShot?.seat).toBe(view.view.active);
  });
});
