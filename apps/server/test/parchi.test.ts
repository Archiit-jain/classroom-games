import type { MatchUpdate } from '@cg/protocol';
import { createSixteenParchiGame, type ParchiOptions } from '@cg/game-sixteen-parchi/server';
import type { ParchiEvent, ParchiView } from '@cg/game-sixteen-parchi/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  newActionId,
  setupGameRoom,
  startServer,
  type TestClient,
  type TestServer,
} from './helpers';

type Update = MatchUpdate<ParchiView, ParchiEvent>;

const FAST = {
  timing: { dealMs: 40, selectMs: 600, settleMs: 20, passMs: 40, claimMs: 1500, claimHoldMs: 40 },
  botThinkMs: [10, 40] as [number, number],
  botClaimMs: [300, 400] as [number, number],
};
const fastParchi = (options: ParchiOptions = {}) =>
  createSixteenParchiGame({ ...FAST, ...options });
/** Rigged deals that work for any category (the deck gets the category's four items). */
type Deck = (items: readonly string[]) => string[];
/** Everyone is dealt a full set. */
const ALL_LUCKY: Deck = (items) => items.flatMap((item) => [item, item, item, item]);
/** Everyone holds one of each item: nobody can complete a set before the third pass. */
const ONE_EACH: Deck = (items) => [...items, ...items, ...items, ...items];

let t: TestServer;
afterEach(async () => {
  await t?.close();
});

const latest = (c: TestClient) => c.all('match:update').at(-1) as Update | undefined;

/** Picks the safe slip whenever this client may select. */
function autoSelect(client: TestClient): void {
  client.socket.on('match:update', (update) => {
    const u = update as Update;
    if (
      u.view.phase === 'SELECTING' &&
      u.view.mySelection === null &&
      u.view.active.includes(u.you)
    ) {
      const handle = u.view.hand.at(-1)?.handle;
      if (handle) void client.act(u, { type: 'SELECT', handle }).catch(() => undefined);
    }
    if (u.view.canClaim) void client.act(u, { type: 'CLAIM' }).catch(() => undefined);
  });
}

async function fourHumans(options: ParchiOptions = {}) {
  t = await startServer({}, { games: [fastParchi(options)] });
  const players = await Promise.all(['Archit', 'Priya', 'Kabir', 'Meera'].map((n) => t.player(n)));
  const [host, ...guests] = players as [TestClient, ...TestClient[]];
  await setupGameRoom('sixteen-parchi', host, ...guests);
  await host.emit('room:updateSettings', { settings: { category: 'fruits' } });
  return players;
}

describe('16 Parchi over real sockets', () => {
  it('plays a full match with two humans and two bots, never leaking another hand', async () => {
    t = await startServer({}, { games: [fastParchi()] });
    const host = await t.player('Archit');
    const guest = await t.player('Priya');
    await setupGameRoom('sixteen-parchi', host, guest);
    await host.emit('room:addBot', {});
    await host.emit('room:addBot', {});
    autoSelect(host);
    autoSelect(guest);
    expect((await host.emit('room:start', {})).ok).toBe(true);

    const end = await host.waitFor('match:end', () => true, 30_000);
    expect(end.results.placements.map((p) => p.place).sort()).toEqual([1, 2, 3, 4]);

    for (const client of [host, guest]) {
      const updates = client.all('match:update') as Update[];
      const myHandles = new Set<string>();
      for (const u of updates) {
        for (const e of u.events) {
          if (e.type === 'DEALT') e.hand.forEach((c) => myHandles.add(c.handle));
          if (e.type === 'CHIT_RECEIVED') myHandles.add(e.handle);
        }
        // The view only ever holds this seat's own slips.
        for (const c of u.view.hand) expect(myHandles.has(c.handle)).toBe(true);
        // Every slip handle on the wire is one of this seat's own (re-keyed per holder).
        const wire = JSON.stringify(u);
        for (const [, handle] of wire.matchAll(/"handle":"(p[a-z2-9]{7})"/g)) {
          expect(myHandles.has(handle as string)).toBe(true);
        }
        expect(wire).not.toContain('"eligible"');
        expect(wire).not.toContain('"selections"');
      }
    }
  });

  it('ranks simultaneous claims by arrival — everyone sees the same order', async () => {
    const players = await fourHumans({ deck: ALL_LUCKY });
    const [host, p1, p2, p3] = players as [TestClient, TestClient, TestClient, TestClient];
    expect((await host.emit('room:start', {})).ok).toBe(true);
    for (const p of players)
      await p.waitFor('match:update', (u) => (u as Update).view.canClaim, 5000);

    // Three players claim at the same moment; the fourth is left with last place.
    const acks = await Promise.all(
      [p2, p3, host].map((p) => p.act(latest(p) as Update, { type: 'CLAIM' })),
    );
    expect(acks.filter((a) => a.ok)).toHaveLength(3);
    const end = await host.waitFor('match:end', () => true, 5000);
    expect(end.results.placements.map((p) => p.place).sort()).toEqual([1, 2, 3, 4]);
    // The seat that did not claim was placed last.
    const lastSeat = latest(p1)?.you;
    expect(end.results.placements.find((p) => p.place === 4)?.seat).toBe(lastSeat);
    // Every client saw the claims in the same order.
    const order = (c: TestClient) =>
      (c.all('match:update') as Update[])
        .flatMap((u) => u.events)
        .filter((e) => e.type === 'CLAIM_ACCEPTED')
        .map((e) => (e as { seat: number }).seat);
    for (const p of players) expect(order(p)).toEqual(order(host));
  });

  it('gives the claimer the better place when the last two both hold full sets', async () => {
    const players = await fourHumans({ deck: ALL_LUCKY });
    expect((await players[0]!.emit('room:start', {})).ok).toBe(true);
    for (const p of players)
      await p.waitFor('match:update', (u) => (u as Update).view.canClaim, 5000);
    const [a, b, c] = players as [TestClient, TestClient, TestClient, TestClient];
    expect((await a.act(latest(a) as Update, { type: 'CLAIM' })).ok).toBe(true);
    expect((await b.act(latest(b) as Update, { type: 'CLAIM' })).ok).toBe(true);
    // Two left, both with full sets: whoever claims takes 3rd, the other 4th.
    expect((await c.act(latest(c) as Update, { type: 'CLAIM' })).ok).toBe(true);
    const end = await a.waitFor('match:end', () => true, 5000);
    const placeOf = (p: TestClient) =>
      end.results.placements.find((x) => x.seat === latest(p)?.you)?.place;
    expect([placeOf(a), placeOf(b), placeOf(c), placeOf(players[3]!)]).toEqual([1, 2, 3, 4]);
  });

  it('refuses duplicate, replayed and false claims', async () => {
    const players = await fourHumans({ deck: ALL_LUCKY });
    const host = players[0] as TestClient;
    expect((await host.emit('room:start', {})).ok).toBe(true);
    const u = (await host.waitFor(
      'match:update',
      (x) => (x as Update).view.canClaim,
      5000,
    )) as Update;
    const id = newActionId();
    const [first, second] = await Promise.all([
      host.act(u, { type: 'CLAIM' }, id),
      host.act(u, { type: 'CLAIM' }, id),
    ]);
    expect([first, second].filter((r) => r.ok)).toHaveLength(1);
    expect([first, second].find((r) => !r.ok)).toEqual({ ok: false, code: 'DUPLICATE_ACTION' });
    // Already claimed: a fresh id is refused by the rules, not executed twice.
    expect(await host.act(latest(host) as Update, { type: 'CLAIM' })).toEqual({
      ok: false,
      code: 'NOT_ELIGIBLE',
    });
  });

  it('hands an idle player to a bot after 3 auto-picks', async () => {
    t = await startServer({}, { games: [fastParchi({ deck: ONE_EACH })] });
    const host = await t.player('Archit');
    await setupGameRoom('sixteen-parchi', host);
    for (let i = 0; i < 3; i++) await host.emit('room:addBot', {});
    expect((await host.emit('room:start', {})).ok).toBe(true);
    // The host never selects: after three timeouts a bot takes the seat.
    const room = await host.waitForRoom(
      (r) => r?.match?.seats.find((s) => s.memberId === host.playerId)?.takeover?.reason === 'IDLE',
      15_000,
    );
    expect(room?.match?.seats.find((s) => s.memberId === host.playerId)?.controller).toBe('BOT');
  });
});
