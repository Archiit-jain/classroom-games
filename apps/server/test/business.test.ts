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
const FAST_TIMING = {
  turnMs: 4000,
  hopMs: 0,
  landingMs: 0,
  eventMs: 0,
  skipMs: 0,
  auctionMs: 400,
  auctionExtendMs: 200,
  auctionMaxMs: 1000,
  tradeMs: 1000,
};
const FAST: BusinessOptions = { timing: FAST_TIMING, botRollMs: [10, 20], botThinkMs: [10, 20] };

let t: TestServer;
afterEach(async () => {
  await t?.close();
});

const latest = (c: TestClient) => c.all('match:update').at(-1) as Update | undefined;
const totalCash = (v: BusinessView) => v.seats.reduce((s, x) => s + (v.players[x]?.cash ?? 0), 0);
const waitView = (c: TestClient, test: (v: BusinessView, u: Update) => boolean, ms = 5000) =>
  c.waitFor('match:update', (u) => test((u as Update).view, u as Update), ms) as Promise<Update>;

/** Rolls, buys and builds whenever it can afford it; lets the bank settle debts. */
function autoPlay(client: TestClient): void {
  client.socket.on('match:update', (update) => {
    const u = update as Update;
    const v = u.view;
    const act = (a: Record<string, unknown>) =>
      void client.act(u, { ...a, turn: v.turn }).catch(() => undefined);
    if (v.phase === 'TRADE' && v.trade?.to === u.you)
      return act({ type: 'TRADE_ANSWER', accept: false });
    if (v.current !== u.you || v.phase === 'OVER') return;
    const cash = v.players[u.you]?.cash ?? 0;
    if (v.phase === 'ROLL') act({ type: 'ROLL' });
    else if (v.phase === 'EVENT') act({ type: 'EVENT_ROLL' });
    else if (v.phase === 'RAISE') act({ type: 'BANK_HANDLES_IT' });
    else if (v.phase === 'DECIDE' && v.decision) {
      const d = v.decision;
      if (d.kind === 'JAIL') act({ type: 'JAIL_WAIT' });
      else if (d.cost > cash) act({ type: 'SKIP' });
      else if (d.kind === 'BUY') act({ type: 'BUY', space: d.space });
      else act({ type: 'BUILD', space: d.space, levels: 1 });
    }
  });
}

async function twoPlayers(options: BusinessOptions = FAST, rounds = 8) {
  t = await startServer({}, { games: [createBusinessGame(options)] });
  const a = await t.player('Archit');
  const b = await t.player('Priya');
  await setupGameRoom('business', a, b);
  await a.emit('room:updateSettings', {
    settings: { rounds, board: 'india-classic', eventFrequency: 'normal' },
  });
  return [a, b] as const;
}

describe('Business over real sockets', () => {
  it('plays a full match with two humans and a bot; every screen agrees and money is conserved', async () => {
    const [a, b] = await twoPlayers();
    await a.emit('room:addBot', {});
    autoPlay(a);
    autoPlay(b);
    expect((await a.emit('room:start', {})).ok).toBe(true);
    const end = await a.waitFor('match:end', () => true, 40_000);
    expect(end.results.placements).toHaveLength(3);
    const stats = end.results.stats as Record<
      number,
      { wealth: number; cash: number; property: number; development: number; transport: number }
    >;
    await sleep(50);
    const va = latest(a)?.view as BusinessView;
    const vb = latest(b)?.view as BusinessView;
    expect(va.phase).toBe('OVER');
    expect(vb.owner).toEqual(va.owner);
    expect(vb.level).toEqual(va.level);
    expect(vb.players).toEqual(va.players);
    for (const seat of va.seats) {
      const s = stats[seat]!;
      // The frozen formula: cash + cumulative spending on properties, buildings and transport.
      expect(s.wealth).toBe(s.cash + s.property + s.development + s.transport);
      expect(s.wealth).toBe(va.final?.[seat]?.total);
      expect(va.players[seat]?.debt).toBe(0);
    }
    expect(totalCash(va)).toBe(va.seats.length * va.economy.startCash + va.bankNet);
  }, 50_000);

  it('rejects wrong-turn, stale, duplicate, forged and out-of-phase actions', async () => {
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
    // Dice, prices, cash, positions and owners never come from a client.
    for (const forged of [
      { type: 'ROLL', turn: v.view.turn, dice: [6, 6] },
      { type: 'BUY', turn: v.view.turn, space: 1, price: 0 },
      { type: 'BUY', turn: v.view.turn, space: 99 },
      { type: 'LOAN', turn: v.view.turn, amount: 1000, cash: 99_999 },
      { type: 'BID', turn: v.view.turn, amount: 300, seat: 1 },
      { type: 'BUILD', turn: v.view.turn, space: 1, levels: 9 },
    ]) {
      expect(await mover.act(v, forged)).toEqual({ ok: false, code: 'INVALID_PAYLOAD' });
    }
    expect(await mover.act(v, { type: 'BUY', turn: v.view.turn, space: 1 })).toEqual({
      ok: false,
      code: 'INVALID_PHASE',
    });
    // Auctioning a space you don't own is refused.
    expect((await mover.act(v, { type: 'AUCTION_START', turn: v.view.turn, space: 1 })).ok).toBe(
      false,
    );
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

  it('buy, rent, a loan and an auction travel over the wire for both players', async () => {
    const [a, b] = await twoPlayers({ ...FAST, dice: () => [1, 0] });
    expect((await a.emit('room:start', {})).ok).toBe(true);
    const first = (await a.waitFor('match:update')) as Update;
    const [owner, renter] = first.view.current === first.you ? [a, b] : [b, a];
    let u = (await waitView(owner, (v, x) => v.phase === 'ROLL' && v.current === x.you)) as Update;
    expect((await owner.act(u, { type: 'ROLL', turn: u.view.turn })).ok).toBe(true);
    u = await waitView(owner, (v) => v.phase === 'DECIDE');
    expect(u.view.decision).toEqual({ kind: 'BUY', space: 1, cost: 600 });
    expect((await owner.act(u, { type: 'BUY', turn: u.view.turn, space: 1 })).ok).toBe(true);
    const me = u.you;

    // The other player walks onto Patna and pays rent.
    let r = await waitView(renter, (v, x) => v.phase === 'ROLL' && v.current === x.you);
    const before = r.view.players[r.you]!.cash;
    expect((await renter.act(r, { type: 'ROLL', turn: r.view.turn })).ok).toBe(true);
    r = await waitView(renter, (v) => v.log.some((e) => e.type === 'PAID' && e.to === me));
    expect(r.view.players[r.you]!.cash).toBeLessThan(before);

    // Owner's next turn: a loan, then Patna goes up for auction and the renter wins it.
    u = await waitView(
      owner,
      (v, x) => v.phase === 'ROLL' && v.current === x.you && v.owner[1] === x.you,
    );
    expect((await owner.act(u, { type: 'LOAN', turn: u.view.turn, amount: 1000 })).ok).toBe(true);
    u = await waitView(owner, (v, x) => v.players[x.you]!.debt === 1100);
    expect((await owner.act(u, { type: 'AUCTION_START', turn: u.view.turn, space: 1 })).ok).toBe(
      true,
    );
    r = await waitView(renter, (v) => v.phase === 'AUCTION');
    expect(r.view.auction?.open).toBe(300);
    expect((await renter.act(r, { type: 'BID', turn: r.view.turn, amount: 300 })).ok).toBe(true);
    const won = await waitView(owner, (v) => v.owner[1] === r.you, 5000);
    expect(won.view.lockedUntil[1]).toBe(won.view.round + 3);
    const sold = await waitView(renter, (v) => v.owner[1] === r.you);
    expect(sold.view.players[r.you]!.spend.property).toBe(300);
  }, 20_000);

  it('a player who reconnects mid-decision gets the exact board back and can finish the turn', async () => {
    const [a, b] = await twoPlayers({ ...FAST, dice: () => [1, 0] });
    expect((await a.emit('room:start', {})).ok).toBe(true);
    const first = (await a.waitFor('match:update')) as Update;
    const mover = first.view.current === first.you ? a : b;
    const v = await waitView(mover, (x, u) => x.phase === 'ROLL' && x.current === u.you);
    expect((await mover.act(v, { type: 'ROLL', turn: v.view.turn })).ok).toBe(true);
    const deciding = await waitView(mover, (x) => x.phase === 'DECIDE');
    expect(deciding.view.decision).toEqual({ kind: 'BUY', space: 1, cost: 600 });
    const token = mover.ready.token as string;
    mover.close();
    const back = await t.connect({ token });
    const restored = (await back.waitFor('match:update')) as Update;
    expect(restored.view.players).toEqual(deciding.view.players);
    expect(restored.view.owner).toEqual(deciding.view.owner);
    expect(restored.view.decision).toEqual(deciding.view.decision);
    expect((await back.act(restored, { type: 'BUY', turn: restored.view.turn, space: 1 })).ok).toBe(
      true,
    );
    const bought = await waitView(back, (x) => x.owner[1] !== null);
    expect(bought.view.owner[1]).toBe(restored.you);
  });

  it('acts for an absent player when time runs out (roll, then decline)', async () => {
    const [a, b] = await twoPlayers({
      ...FAST,
      timing: { ...FAST_TIMING, turnMs: 150 },
      dice: () => [1, 0],
    });
    expect((await a.emit('room:start', {})).ok).toBe(true);
    const after = await waitView(b, (v) => v.turn >= 3, 6000);
    // Nobody acted: rolls happened automatically, offers were declined.
    expect(after.view.owner.every((o) => o === null)).toBe(true);
    expect(after.view.log.some((e) => e.type === 'DECLINED')).toBe(true);
  });

  it('insolvency: the bank settles what you can’t pay, writes off the rest, and you keep playing', async () => {
    const [a, b] = await twoPlayers(
      { ...FAST, dice: () => [2, 2], economy: { startCash: 1000, rentShare: 10 } },
      5,
    );
    expect((await a.emit('room:start', {})).ok).toBe(true);
    const first = (await a.waitFor('match:update')) as Update;
    const [owner, debtor] = first.view.current === first.you ? [a, b] : [b, a];
    let u = await waitView(owner, (v, x) => v.phase === 'ROLL' && v.current === x.you);
    expect((await owner.act(u, { type: 'ROLL', turn: u.view.turn })).ok).toBe(true);
    u = await waitView(owner, (v) => v.phase === 'DECIDE');
    expect((await owner.act(u, { type: 'BUY', turn: u.view.turn, space: 4 })).ok).toBe(true);
    autoPlay(owner);

    // Rent on Bhubaneswar is far more than the debtor has: raise money, or let the bank handle it.
    let d = await waitView(debtor, (v, x) => v.phase === 'ROLL' && v.current === x.you);
    expect((await debtor.act(d, { type: 'ROLL', turn: d.view.turn })).ok).toBe(true);
    d = await waitView(debtor, (v) => v.phase === 'RAISE');
    expect(d.view.raise?.total).toBeGreaterThan(d.view.players[d.you]!.cash);
    expect((await debtor.act(d, { type: 'BANK_HANDLES_IT', turn: d.view.turn })).ok).toBe(true);
    d = await waitView(debtor, (v, x) => v.players[x.you]!.insolvent);
    const me = d.view.players[d.you]!;
    expect(me.cash).toBe(0);
    expect(me.debt).toBe(0);
    expect(d.view.writtenOff).toBeGreaterThan(0);
    expect(d.view.log.some((e) => e.type === 'INSOLVENT' && e.seat === d.you)).toBe(true);
    // Still in the match: the debtor gets its next turn.
    const next = await waitView(
      debtor,
      (v, x) => v.phase === 'ROLL' && v.current === x.you && v.turn > d.view.turn,
    );
    expect(next.view.seats).toContain(next.you);
    expect(totalCash(next.view)).toBe(
      next.view.seats.length * next.view.economy.startCash + next.view.bankNet,
    );
  });

  it('a bidder who reconnects mid-auction sees the same auction and can still win it', async () => {
    const [a, b] = await twoPlayers({
      ...FAST,
      timing: { ...FAST_TIMING, auctionMs: 4000, auctionMaxMs: 8000 },
      dice: () => [1, 0],
    });
    expect((await a.emit('room:start', {})).ok).toBe(true);
    const first = (await a.waitFor('match:update')) as Update;
    const [seller, bidder] = first.view.current === first.you ? [a, b] : [b, a];
    let u = await waitView(seller, (v, x) => v.phase === 'ROLL' && v.current === x.you);
    expect((await seller.act(u, { type: 'ROLL', turn: u.view.turn })).ok).toBe(true);
    u = await waitView(seller, (v) => v.phase === 'DECIDE');
    expect((await seller.act(u, { type: 'BUY', turn: u.view.turn, space: 1 })).ok).toBe(true);
    let r = await waitView(bidder, (v, x) => v.phase === 'ROLL' && v.current === x.you);
    expect((await bidder.act(r, { type: 'ROLL', turn: r.view.turn })).ok).toBe(true);
    u = await waitView(
      seller,
      (v, x) => v.phase === 'ROLL' && v.current === x.you && v.turn > r.view.turn,
    );
    expect((await seller.act(u, { type: 'AUCTION_START', turn: u.view.turn, space: 1 })).ok).toBe(
      true,
    );
    r = await waitView(bidder, (v) => v.phase === 'AUCTION');
    const token = bidder.ready.token as string;
    bidder.close();
    const back = await t.connect({ token });
    const restored = (await back.waitFor('match:update')) as Update;
    expect(restored.view.phase).toBe('AUCTION');
    expect(restored.view.auction).toEqual(r.view.auction);
    const open = restored.view.auction?.open as number;
    expect(
      (await back.act(restored, { type: 'BID', turn: restored.view.turn, amount: open })).ok,
    ).toBe(true);
    const won = await waitView(back, (v) => v.owner[1] === restored.you, 10_000);
    expect(won.view.players[won.you]!.spend.property).toBe(open);
  }, 20_000);
});
