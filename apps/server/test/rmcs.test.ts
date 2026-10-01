import { createRmcsGame } from '@cg/game-rmcs/server';
import { ROUND_TOTAL, TOTAL_ROUNDS, type RmcsEvent, type RmcsView } from '@cg/game-rmcs/shared';
import type { MatchUpdate } from '@cg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { setupGameRoom, startServer, type TestClient, type TestServer } from './helpers';

type Update = MatchUpdate<RmcsView, RmcsEvent>;

const fastRmcs = () =>
  createRmcsGame({
    timing: { dealMs: 30, revealMs: 30, guessMs: 400, resultMs: 30 },
    botThinkMs: [10, 40],
  });

let t: TestServer;
afterEach(async () => {
  await t?.close();
});

/** Guesses the first candidate whenever this client is the Mantri. */
function autoGuess(client: TestClient): void {
  client.socket.on('match:update', (update) => {
    const u = update as Update;
    if (u.view.phase === 'GUESSING' && u.view.mantri === u.you) {
      void client.act(u, { type: 'GUESS', target: u.view.candidates[0] }).catch(() => undefined);
    }
  });
}

describe('Raja Mantri Chor Sipahi over real sockets', () => {
  it('needs exactly four players', async () => {
    t = await startServer({}, { games: [fastRmcs()] });
    const host = await t.player('Archit');
    await setupGameRoom('rmcs', host);
    await host.emit('room:addBot', {});
    await host.emit('room:addBot', {});
    expect(await host.emit('room:start', {})).toEqual({ ok: false, code: 'NOT_ENOUGH_PLAYERS' });
    await host.emit('room:addBot', {});
    expect(await host.emit('room:addBot', {})).toEqual({ ok: false, code: 'ROOM_FULL' });
    expect((await host.emit('room:start', {})).ok).toBe(true);
  });

  it('plays 10 rounds with two humans and two bots, never leaking a hidden role', async () => {
    t = await startServer({}, { games: [fastRmcs()] });
    const host = await t.player('Archit');
    const guest = await t.player('Priya');
    await setupGameRoom('rmcs', host, guest);
    await host.emit('room:addBot', {});
    await host.emit('room:addBot', {});
    autoGuess(host);
    autoGuess(guest);
    expect((await host.emit('room:start', {})).ok).toBe(true);

    const end = await host.waitFor('match:end', () => true, 20_000);
    const room = await guest.waitForRoom((r) => r?.phase === 'RESULTS', 5000);

    // Final scores: 10 rounds × 2300, reported as the "score" stat and ranked.
    const stats = end.results.stats as Record<number, { score: number }>;
    const total = Object.values(stats).reduce((sum, s) => sum + s.score, 0);
    expect(total).toBe(ROUND_TOTAL * TOTAL_ROUNDS);
    for (const p of end.results.placements) {
      const better = Object.values(stats).filter(
        (s) => s.score > (stats[p.seat]?.score ?? 0),
      ).length;
      expect(p.place).toBe(better + 1);
    }
    expect(room?.match?.results).toEqual(end.results);

    for (const client of [host, guest]) {
      const updates = client.all('match:update') as Update[];
      const me = updates[0]?.you as number;
      const dealt = updates.flatMap((u) => u.events).filter((e) => e.type === 'ROLE_DEALT');
      expect(dealt).toHaveLength(TOTAL_ROUNDS);
      for (const u of updates) {
        // Before a round is resolved, a player may only know their own role
        // plus the revealed Raja and Mantri.
        if (u.view.phase === 'ROUND_RESULT' || u.view.phase === 'OVER') continue;
        const allowed = new Set([me, u.view.raja, u.view.mantri].filter((s) => s !== null));
        for (const seat of Object.keys(u.view.known).map(Number)) {
          expect(allowed.has(seat)).toBe(true);
        }
        for (const e of u.events) {
          if (e.type === 'ROUND_RESOLVED')
            throw new Error('resolved roles sent before the result phase');
        }
      }
    }
  });

  it('guesses for a Mantri who lets the timer run out', async () => {
    t = await startServer({}, { games: [fastRmcs()] });
    // Four humans who never guess: whoever is dealt the Mantri in round 1 times
    // out, so the server must guess for them (deterministic for every deal).
    const players = await Promise.all(
      ['Archit', 'Priya', 'Kabir', 'Meera'].map((name) => t.player(name)),
    );
    const [host, ...guests] = players as [TestClient, ...TestClient[]];
    await setupGameRoom('rmcs', host, ...guests);
    expect((await host.emit('room:start', {})).ok).toBe(true);
    const resolved = (await host.waitFor(
      'match:update',
      (u) => (u as Update).view.history.length > 0,
      5000,
    )) as Update;
    const [round] = resolved.view.history;
    expect(round?.round).toBe(1);
    expect(round?.auto).toBe(true);
    // The server's guess is one of the two hidden seats (Chor or Sipahi).
    expect(['CHOR', 'SIPAHI']).toContain(round?.roles[round.target]);
  });
});
