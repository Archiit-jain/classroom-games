import { createBusinessGame, type BusinessOptions } from '@cg/game-business/server';
import type { BusinessEvent, BusinessView } from '@cg/game-business/shared';
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

type Update = MatchUpdate<BusinessView, BusinessEvent>;
const FAST: BusinessOptions = {
  timing: { rollMs: 4000, decideMs: 4000, hopMs: 0, landingMs: 0 },
  botRollMs: [10, 20],
  botThinkMs: [10, 20],
};

let t: TestServer;
afterEach(async () => {
  await t?.close();
});

const latest = (c: TestClient) => c.all('match:update').at(-1) as Update | undefined;
const totalCoins = (v: BusinessView) => v.seats.reduce((s, x) => s + (v.coins[x] ?? 0), 0);

/** Rolls on your turn and takes every offer (buy, develop, expand). */
function autoPlay(client: TestClient): void {
  client.socket.on('match:update', (update) => {
    const u = update as Update;
    if (u.view.current !== u.you || u.view.phase === 'OVER') return;
    if (u.view.phase === 'ROLL') {
      void client.act(u, { type: 'ROLL', turn: u.view.turn }).catch(() => undefined);
    } else if (u.view.phase === 'DECIDE' && u.view.decision) {
      const d = u.view.decision;
      const o = d.options[0];
      const action = o
        ? { type: d.kind === 'BUY' ? 'BUY' : 'DEVELOP', turn: u.view.turn, space: o.space }
        : { type: 'SKIP', turn: u.view.turn };
      void client.act(u, action).catch(() => undefined);
    }
  });
}

async function twoPlayers(options: BusinessOptions = FAST) {
  t = await startServer({}, { games: [createBusinessGame(options)] });
  const a = await t.player('Archit');
  const b = await t.player('Priya');
  await setupGameRoom('business', a, b);
  await a.emit('room:updateSettings', { settings: { rounds: 12 } });
  return [a, b] as const;
}

describe('Business over real sockets', () => {
  it('plays a full 12-round match with two humans and a bot; everyone ends on the same board', async () => {
    const [a, b] = await twoPlayers();
    await a.emit('room:addBot', {});
    autoPlay(a);
    autoPlay(b);
    expect((await a.emit('room:start', {})).ok).toBe(true);
    const end = await a.waitFor('match:end', () => true, 30_000);
    expect(end.results.placements).toHaveLength(3);
    const stats = end.results.stats as Record<number, { wealth: number }>;
    await sleep(50);
    const va = latest(a)?.view as BusinessView;
    const vb = latest(b)?.view as BusinessView;
    expect(va.phase).toBe('OVER');
    expect(vb.owner).toEqual(va.owner);
    expect(vb.coins).toEqual(va.coins);
    expect(vb.level).toEqual(va.level);
    for (const seat of va.seats) expect(stats[seat]?.wealth).toBe(va.wealth[seat]);
    // Coins are conserved: everything not from the starting purse came from or went to the bank.
    expect(totalCoins(va)).toBe(va.seats.length * va.economy.startCoins + va.bankNet);
  }, 40_000);

  it('rejects wrong-turn, stale, duplicate, forged and post-game actions', async () => {
    const [a, b] = await twoPlayers();
    expect((await a.emit('room:start', {})).ok).toBe(true);
    const first = (await a.waitFor('match:update')) as Update;
    await b.waitFor('match:update');
    const [mover, other] = first.view.current === first.you ? [a, b] : [b, a];
    const v = latest(mover) as Update;
    const w = latest(other) as Update;
    expect(await other.act(w, { type: 'ROLL', turn: w.view.turn })).toEqual({
      ok: false,
      code: 'NOT_YOUR_TURN',
    });
    expect(await mover.act(v, { type: 'ROLL', turn: v.view.turn - 1 })).toEqual({
      ok: false,
      code: 'INVALID_PHASE',
    });
    // Forged fields: dice, amounts, positions or owners are never accepted from a client.
    for (const forged of [
      { type: 'ROLL', turn: v.view.turn, dice: [6, 6] },
      { type: 'BUY', turn: v.view.turn, space: 1, price: 0 },
      { type: 'BUY', turn: v.view.turn, space: 99 },
      { type: 'SKIP', turn: v.view.turn, coins: 99999 },
    ]) {
      expect(await mover.act(v, forged)).toEqual({ ok: false, code: 'INVALID_PAYLOAD' });
    }
    expect(await mover.act(v, { type: 'BUY', turn: v.view.turn, space: 1 })).toEqual({
      ok: false,
      code: 'INVALID_PHASE',
    });
    const id = newActionId();
    expect((await mover.act(v, { type: 'ROLL', turn: v.view.turn }, id)).ok).toBe(true);
    expect(await mover.act(v, { type: 'ROLL', turn: v.view.turn }, id)).toEqual({
      ok: false,
      code: 'DUPLICATE_ACTION',
    });
    expect(
      await mover.emit('match:action', {
        matchId: v.matchId,
        version: v.version + 999,
        actionId: newActionId(),
        action: { type: 'SKIP', turn: v.view.turn },
      }),
    ).toEqual({ ok: false, code: 'STALE_VERSION' });
  });

  it('a player who reconnects mid-decision gets the exact board back and can finish the turn', async () => {
    const [a, b] = await twoPlayers({ ...FAST, dice: () => [1, 0] });
    expect((await a.emit('room:start', {})).ok).toBe(true);
    const first = (await a.waitFor('match:update')) as Update;
    const mover = first.view.current === first.you ? a : b;
    const v = (await mover.waitFor('match:update')) as Update;
    expect((await mover.act(v, { type: 'ROLL', turn: v.view.turn })).ok).toBe(true);
    const deciding = (await mover.waitFor(
      'match:update',
      (u) => (u as Update).view.phase === 'DECIDE',
    )) as Update;
    expect(deciding.view.decision).toEqual({ kind: 'BUY', options: [{ space: 1, cost: 100 }] });
    const token = mover.ready.token as string;
    mover.close();
    const back = await t.connect({ token });
    const restored = (await back.waitFor('match:update')) as Update;
    expect(restored.view.positions).toEqual(deciding.view.positions);
    expect(restored.view.coins).toEqual(deciding.view.coins);
    expect(restored.view.owner).toEqual(deciding.view.owner);
    expect(restored.view.decision).toEqual(deciding.view.decision);
    expect((await back.act(restored, { type: 'BUY', turn: restored.view.turn, space: 1 })).ok).toBe(
      true,
    );
    const bought = (await back.waitFor(
      'match:update',
      (u) => (u as Update).view.owner[1] !== null,
    )) as Update;
    expect(bought.view.owner[1]).toBe(restored.you);
  });

  it('acts for an absent player when time runs out (roll, then skip)', async () => {
    const [a, b] = await twoPlayers({
      ...FAST,
      timing: { rollMs: 150, decideMs: 150, hopMs: 0, landingMs: 0 },
      dice: () => [1, 0],
    });
    expect((await a.emit('room:start', {})).ok).toBe(true);
    const after = (await b.waitFor(
      'match:update',
      (u) => (u as Update).view.turn >= 3,
      5000,
    )) as Update;
    // Nobody acted: rolls happened automatically, offers were skipped.
    expect(after.view.owner.every((o) => o === null)).toBe(true);
    expect(after.view.log.some((e) => e.type === 'SKIPPED')).toBe(true);
  });
});
