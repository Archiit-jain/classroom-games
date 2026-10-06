import type { AnyGameModule } from '@cg/game-sdk';
import type { FixtureEvent, FixtureView } from '@cg/game-sdk/fixture';
import type { MatchStream, MatchUpdate, RoomView } from '@cg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { createBusinessGame } from '@cg/game-business/server';
import type { BusinessView } from '@cg/game-business/shared';
import { createDotsAndBoxesGame } from '@cg/game-dots-and-boxes/server';
import { BANK } from '@cg/game-name-place-animal-thing/content';
import { createNpatGame } from '@cg/game-name-place-animal-thing/server';
import { CATEGORIES, type NpatView } from '@cg/game-name-place-animal-thing/shared';
import { allEdges, edgeId, isDrawn, type DotsView } from '@cg/game-dots-and-boxes/shared';
import type { GameServer } from '../src/app';
import { KEYS } from '../src/cluster/Cluster';
import { STATE_KEYS } from '../src/cluster/HostServices';
import {
  autoPlay,
  eventually,
  newActionId,
  setupGameRoom,
  setupRoom,
  sleep,
  testFixture,
  type TestClient,
} from './helpers';
import { startCluster, type TestCluster } from './clusterHelpers';
import { createSketchGame } from './streamGame';

let c: TestCluster | null = null;
afterEach(async () => {
  await c?.close();
  c = null;
});

type Update = MatchUpdate<FixtureView, FixtureEvent>;
const latest = (client: TestClient) => client.all('match:update').at(-1) as Update | undefined;
const hostIndex = (cl: TestCluster) => cl.nodes.findIndex((n) => n.server.cluster.isHost);

describe('several server instances sharing one store', () => {
  it('lets players on different instances play one match together', async () => {
    c = await startCluster(2);
    expect(hostIndex(c)).toBe(0); // the first instance became host; the other is a gateway
    const a = await c.player(0, 'Archit');
    const b = await c.player(1, 'Priya');
    const code = await setupRoom(a, b);
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    await b.waitForRoom((r) => r?.members.length === 2);
    autoPlay(a);
    autoPlay(b);
    expect((await a.emit('room:start', {})).ok).toBe(true);
    const endA = await a.waitFor('match:end', () => true, 10_000);
    const endB = await b.waitFor('match:end', () => true, 10_000);
    expect(endB).toEqual(endA);
    // Both saw the same authoritative sequence of versions.
    const versions = (cl: TestClient) => cl.all('match:update').map((u) => (u as Update).version);
    expect(versions(b).at(-1)).toBe(versions(a).at(-1));
  });

  it('keeps duplicate-action and version protection for players on a gateway', async () => {
    c = await startCluster(2, { games: [testFixture({ turnMs: 5000 })] });
    const a = await c.player(0, 'Archit');
    const b = await c.player(1, 'Priya');
    await setupRoom(b, a); // the room is created from the gateway instance
    expect((await b.emit('room:start', {})).ok).toBe(true);
    const first = (await b.waitFor('match:update')) as Update;
    const mover = first.view.turn === first.you ? b : a;
    const view = (await mover.waitFor('match:update')) as Update;
    const id = newActionId();
    expect((await mover.act(view, { type: 'ADD', amount: 1 }, id)).ok).toBe(true);
    expect(await mover.act(view, { type: 'ADD', amount: 1 }, id)).toEqual({
      ok: false,
      code: 'DUPLICATE_ACTION',
    });
    expect(
      await mover.act({ matchId: view.matchId, version: 999 }, { type: 'ADD', amount: 1 }),
    ).toEqual({ ok: false, code: 'STALE_VERSION' });
  });

  it('moves a session between instances: reconnecting elsewhere resumes the room and seat', async () => {
    c = await startCluster(2, { games: [testFixture({ turnMs: 400 })] });
    const a = await c.player(0, 'Archit');
    const b = await c.player(0, 'Priya');
    await setupRoom(a, b);
    autoPlay(a);
    expect((await a.emit('room:start', {})).ok).toBe(true);
    const before = (await b.waitFor('match:update')) as Update;
    const token = b.ready.token as string;
    b.close(); // e.g. Vercel closed the connection at its maximum duration
    const back = await c.connect(1, token); // …and the reconnect lands on another instance
    expect(back.ready.playerId).toBe(b.ready.playerId);
    const room = await back.waitForRoom((r) => r?.phase === 'IN_GAME');
    expect(room?.match?.seats.find((s) => s.memberId === back.ready.playerId)?.controller).toBe(
      'HUMAN',
    );
    const resumed = (await back.waitFor('match:update')) as Update;
    expect(resumed.matchId).toBe(before.matchId);
    expect(resumed.version).toBeGreaterThanOrEqual(before.version);
  });

  it('displaces an older tab connected to another instance', async () => {
    c = await startCluster(2);
    const first = await c.player(0, 'Archit');
    const second = await c.connect(1, first.ready.token as string);
    await first.waitFor('session:displaced');
    expect(second.ready.playerId).toBe(first.ready.playerId);
  });

  it('relays streamed data between instances', async () => {
    c = await startCluster(2, { games: [createSketchGame()] });
    const artist = await c.player(1, 'Archit');
    const guest = await c.player(0, 'Priya');
    await setupGameRoom('sketch', artist, guest);
    expect((await artist.emit('room:start', {})).ok).toBe(true);
    const first = (await artist.waitFor('match:update')) as MatchUpdate;
    await guest.waitFor('match:update');
    expect(await artist.emit('match:stream', { matchId: first.matchId, chunk: { n: 7 } })).toEqual({
      ok: true,
    });
    const got = (await guest.waitFor('match:stream')) as MatchStream;
    expect(got.chunks).toEqual([{ n: 7 }]);
  });
});

describe('Dots & Boxes across instances', () => {
  it('plays a whole 4×4 match with the players on different instances', async () => {
    c = await startCluster(2, {
      games: [createDotsAndBoxesGame({ botThinkMs: [10, 30], botChainMs: [5, 15] })],
    });
    const a = await c.player(0, 'Archit');
    const b = await c.player(1, 'Priya');
    await setupGameRoom('dots-and-boxes', b, a);
    await b.emit('room:updateSettings', { settings: { grid: 4 } });
    for (const client of [a, b]) {
      client.socket.on('match:update', (update) => {
        const u = update as MatchUpdate<DotsView>;
        if (u.view.phase !== 'PLAYING' || u.view.turn !== u.you) return;
        const e = allEdges(u.view.n).find(
          (x) => !isDrawn({ n: u.view.n, h: u.view.h, v: u.view.v }, x),
        );
        if (e)
          void client.act(u, { type: 'DRAW', edge: edgeId(e.o, e.r, e.c) }).catch(() => undefined);
      });
    }
    expect((await b.emit('room:start', {})).ok).toBe(true);
    const endA = await a.waitFor('match:end', () => true, 20_000);
    const endB = await b.waitFor('match:end', () => true, 20_000);
    expect(endB).toEqual(endA);
    const boxes = endA.results.stats as Record<number, { boxes: number }>;
    expect(boxes[0]!.boxes + boxes[1]!.boxes).toBe(16);
  });
});

describe('host hand-over and failover', () => {
  it('hands the host role over when the host instance stops, and play continues', async () => {
    c = await startCluster(2, { games: [testFixture({ turnMs: 300 })] });
    const a = await c.player(0, 'Archit');
    const b = await c.player(1, 'Priya');
    await setupRoom(b, a);
    await b.emit('room:addBot', {});
    autoPlay(b);
    expect((await b.emit('room:start', {})).ok).toBe(true);
    await b.waitFor('match:update', (u) => (u as Update).version >= 3, 5000);
    const counterBefore = (latest(b) as Update).view.counter;

    await (c.nodes[0] as TestCluster['nodes'][number]).server.close(); // the host goes away
    await eventually(() => (c as TestCluster).nodes[1]?.server.cluster.isHost === true, 5000);
    // The match keeps going on the new host: timers, the bot and the human gateway player.
    const later = (await b.waitFor(
      'match:update',
      (u) => (u as Update).view.counter > counterBefore + 3,
      8000,
    )) as Update;
    expect(later.matchId).toBe((latest(b) as Update).matchId);
    // The player of the stopped instance counts as disconnected (grace), not lost.
    const room = await b.waitForRoom(
      (r) =>
        r?.members.some(
          (m) => m.kind === 'HUMAN' && m.id === a.ready.playerId && m.status === 'AWAY',
        ) ?? false,
    );
    expect(room?.phase).toBe('IN_GAME');
  });

  it('replaces a crashed host after its lease expires, firing overdue timers', async () => {
    c = await startCluster(2, { games: [testFixture({ turnMs: 250 })] });
    const a = await c.player(0, 'Archit');
    const b = await c.player(1, 'Priya');
    await setupRoom(a, b);
    // A long match (slow bot-free play) so the absent player's grace ends mid-match.
    await a.emit('room:updateSettings', { settings: { target: 30, turnSeconds: 10 } });
    autoPlay(b, 1);
    expect((await a.emit('room:start', {})).ok).toBe(true);
    await b.waitFor('match:update', (u) => (u as Update).version >= 2, 5000);
    await sleep(250); // let the host write its latest snapshot
    const crashed = (c.nodes[0] as TestCluster['nodes'][number]).server;
    await crashed.cluster.abandon(); // no hand-over: lease and heartbeat just expire
    crashed.io.close();

    await eventually(() => (c as TestCluster).nodes[1]?.server.cluster.isHost === true, 5000);
    const lastBefore = (latest(b) as Update).version;
    // Turn timers continue (the absent player's turns time out) and the game goes on.
    const after = (await b.waitFor(
      'match:update',
      (u) => (u as Update).version > lastBefore + 2,
      8000,
    )) as Update;
    expect(after.view.phase).toBeDefined();
    const room = await b.waitForRoom(
      (r) =>
        r?.members.some(
          (m) => m.kind === 'HUMAN' && m.id === a.ready.playerId && m.status === 'AWAY',
        ) ?? false,
      5000,
    );
    expect(room).not.toBeNull();
    // The absent player's seat goes to a bot (idle turns or the end of their grace,
    // whichever comes first) and the match plays on to its end on the new host.
    const takenOver = await b.waitForRoom(
      (r) =>
        r?.match?.seats.find((seat) => seat.memberId === a.ready.playerId)?.controller === 'BOT',
      6000,
    );
    expect(takenOver?.phase).toBe('IN_GAME');
    const end = await b.waitFor('match:end', () => true, 15_000);
    expect(end.results.placements).toHaveLength(2);
    // The player who kept playing was never mistaken for idle.
    const final = await b.waitForRoom((r) => r?.phase === 'RESULTS');
    expect(
      final?.match?.seats.find((seat) => seat.memberId === b.ready.playerId)?.takeover,
    ).toBeNull();
  });

  it('hands over when the host has no players left (Vercel pauses idle instances)', async () => {
    c = await startCluster(2, { releaseWhenIdle: true, games: [testFixture({ turnMs: 400 })] });
    const a = await c.player(0, 'Archit');
    const b = await c.player(1, 'Priya');
    await setupRoom(b, a); // Priya (on the gateway) is the room's host
    a.close(); // the host instance's only socket closes
    await eventually(() => (c as TestCluster).nodes[1]?.server.cluster.isHost === true, 5000);
    expect((c.nodes[0] as TestCluster['nodes'][number]).server.cluster.isHost).toBe(false);
    // The room lives on: the remaining player still manages it from the new host.
    expect((await b.emit('room:addBot', {})).ok).toBe(true);
    const room = await b.waitForRoom((r) => r?.members.some((m) => m.kind === 'BOT') ?? false);
    expect(room?.members.find((m) => m.id === a.ready.playerId)?.kind).toBe('HUMAN');
  });

  it('fences off a host that lost its lease: it can no longer write state', async () => {
    c = await startCluster(2);
    const a = await c.player(0, 'Archit');
    const old = (c.nodes[0] as TestCluster['nodes'][number]).server;
    // Someone else holds the lease now (e.g. the old host was paused for too long).
    const lease = (await c.store.get(KEYS.host)) as string;
    await c.store.release(KEYS.host, lease);
    await c.store.acquire(KEYS.host, 'inst1:999', 60_000);
    await eventually(() => !old.cluster.isHost, 3000);
    // Its later changes never reach the store.
    const before = await c.store.loadPrefix(STATE_KEYS.rooms);
    expect((await a.emit('room:create', { gameId: 'fixture' })).ok).toBe(false);
    await sleep(300);
    expect(await c.store.loadPrefix(STATE_KEYS.rooms)).toEqual(before);
  });

  it('persists rooms and sessions to the shared store', async () => {
    c = await startCluster(1);
    const a = await c.player(0, 'Archit');
    const created = await a.emit('room:create', { gameId: 'fixture' });
    if (!created.ok) throw new Error('create failed');
    await sleep(250);
    const rooms = await c.store.loadPrefix(STATE_KEYS.rooms);
    expect(rooms).toHaveLength(1);
    const snapshot = JSON.parse((rooms[0] as [string, string])[1]) as { code: string };
    expect(snapshot.code).toBe(created.room.code);
    expect(await c.store.get(STATE_KEYS.session(a.ready.playerId))).toContain(
      '"nickname":"Archit"',
    );
  });

  describe('Name Place Animal Thing across instances', () => {
    type NpatUpdate = MatchUpdate<NpatView, unknown>;
    const SECRET = 'Qzorbadraft';
    const npat = () =>
      createNpatGame({
        timing: {
          answerMs: 120_000,
          letterMs: 60,
          stopUnlockMs: 200,
          flushMs: 150,
          reviewMs: 8000,
          resultMs: 200,
        },
        botFirstMs: [100, 200],
        botNextMs: [30, 60],
      });
    const last = (cl: TestClient) => cl.all('match:update').at(-1) as NpatUpdate;
    const leaked = (cl: TestClient) =>
      JSON.stringify([...cl.received.entries()]).includes('Qzorba');
    const sheet = (letter: string) =>
      Object.fromEntries(CATEGORIES.map((cat) => [cat, BANK[cat][letter]?.[0]]));

    /** Two players on the instance that is NOT the host; the host has no players. */
    async function onGateway() {
      c = await startCluster(2, { games: [npat()] });
      await eventually(() => hostIndex(c as TestCluster) >= 0);
      const host = hostIndex(c);
      const gw = 1 - host;
      const a = await c.player(gw, 'Archit');
      const b = await c.player(gw, 'Priya');
      const k = await c.player(gw, 'Kabir'); // three humans: voting is on (2 votes needed)
      await setupGameRoom('name-place-animal-thing', a, b, k);
      await a.emit('room:updateSettings', { settings: { rounds: 3 } });
      expect((await a.emit('room:start', {})).ok).toBe(true);
      const w = (await a.waitFor(
        'match:update',
        (u) => (u as NpatUpdate).view.phase === 'WRITING',
        5000,
      )) as NpatUpdate;
      return { a, b, k, host, gw, matchId: w.matchId, letter: w.view.letter as string };
    }
    const crashHost = async (host: number) => {
      const crashed = (c as TestCluster).nodes[host]?.server as GameServer;
      await crashed.cluster.abandon();
      crashed.io.close();
      await eventually(
        () => (c as TestCluster).nodes[1 - host]?.server.cluster.isHost === true,
        5000,
      );
    };

    it('forwards private drafts through the gateway and keeps them private across a host crash', async () => {
      const { a, b, host, matchId, letter } = await onGateway();
      for (let seq = 1; seq <= 3; seq++) {
        const r = await a.emit('match:stream', {
          matchId,
          chunk: { round: 1, seq, answers: { name: SECRET.slice(0, 8 + seq) } },
        });
        expect(r.ok).toBe(true);
      }
      await sleep(300); // the host's next snapshot write
      // Server-side state in the shared store (never sent to clients) holds the draft for failover.
      const rooms = await c!.store.loadPrefix(STATE_KEYS.rooms);
      expect(rooms.some(([, json]) => json.includes(SECRET))).toBe(true);
      expect(leaked(b)).toBe(false);

      await crashHost(host);
      // The owner's draft survived; an older autosave is still refused on the new host.
      const mine = await a.emit('match:resync', { matchId });
      expect(mine.ok && (mine.update.view as NpatView).mine.name).toBe(SECRET);
      expect(
        (await a.emit('match:stream', { matchId, chunk: { round: 1, seq: 2, answers: {} } })).ok,
      ).toBe(false);
      const theirs = await b.emit('match:resync', { matchId });
      expect(JSON.stringify(theirs)).not.toContain('Qzorba');
      expect(leaked(b)).toBe(false);

      // The round still ends and reveals normally on the new host.
      await b.waitFor('match:update', (u) => (u as NpatUpdate).view.stopOpen, 4000);
      expect((await b.act(last(b), { type: 'STOP', round: 1, answers: sheet(letter) })).ok).toBe(
        true,
      );
      await b.waitFor('match:update', (u) => (u as NpatUpdate).view.phase === 'REVIEW', 5000);
      expect(leaked(b)).toBe(true);
    }, 30_000);

    it('keeps votes through a host crash during the review', async () => {
      const { a, b, k, host, matchId, letter } = await onGateway();
      const odd = `${letter}zorbaville`;
      await a.emit('match:stream', {
        matchId,
        chunk: { round: 1, seq: 1, answers: { place: odd } },
      });
      await b.waitFor('match:update', (u) => (u as NpatUpdate).view.stopOpen, 4000);
      await b.act(last(b), { type: 'STOP', round: 1, answers: sheet(letter) });
      const review = (await b.waitFor(
        'match:update',
        (u) => (u as NpatUpdate).view.phase === 'REVIEW',
        5000,
      )) as NpatUpdate;
      const aSeat = last(a).you;
      const group = review.view.review?.answers.place.find((x) => x.seat === aSeat)
        ?.group as string;
      expect((await b.act(last(b), { type: 'VOTE', round: 1, group, out: true })).ok).toBe(true);
      await sleep(300);
      await crashHost(host);
      const after = await b.emit('match:resync', { matchId });
      const g =
        after.ok && (after.update.view as NpatView).review?.groups.find((x) => x.id === group);
      expect(g && g.votes).toBe(1);
      // Voting twice is still refused after the restore; the second vote (2 of 2) counts.
      expect(await b.act(last(b), { type: 'VOTE', round: 1, group, out: true })).toMatchObject({
        ok: false,
      });
      expect((await k.act(last(k), { type: 'VOTE', round: 1, group, out: true })).ok).toBe(true);
      for (const p of [a, b, k])
        expect((await p.act(last(p), { type: 'DONE', round: 1 })).ok).toBe(true);
      const scored = (await a.waitFor(
        'match:update',
        (u) => Boolean((u as NpatUpdate).view.last),
        5000,
      )) as NpatUpdate;
      expect(scored.view.last?.rejected).toEqual([group]);
    }, 30_000);
  });

  describe('Business across instances', () => {
    type BizUpdate = MatchUpdate<BusinessView, unknown>;
    const biz = () =>
      createBusinessGame({
        timing: {
          turnMs: 8000,
          hopMs: 0,
          landingMs: 0,
          eventMs: 0,
          skipMs: 0,
          auctionMs: 6000,
          auctionExtendMs: 1000,
          auctionMaxMs: 12_000,
        },
        dice: () => [1, 1], // two spaces a turn: Ranchi, Bhubaneswar, Guwahati… no event space early
      });
    const last = (cl: TestClient) => cl.all('match:update').at(-1) as BizUpdate;
    const conserved = (v: BusinessView) =>
      v.seats.reduce((n, x) => n + (v.players[x]?.cash ?? 0), 0) ===
      v.seats.length * v.economy.startCash + v.bankNet;

    /** One turn for whoever is current: roll; `buyer` buys what it lands on, others decline. */
    async function play(players: TestClient[], buyer: TestClient): Promise<void> {
      const mover = players.find((p) => last(p).view.current === last(p).you) as TestClient;
      const v = last(mover);
      expect((await mover.act(v, { type: 'ROLL', turn: v.view.turn })).ok).toBe(true);
      const at = (await mover.waitFor(
        'match:update',
        (u) =>
          (u as BizUpdate).version > v.version &&
          ((u as BizUpdate).view.turn > v.view.turn || (u as BizUpdate).view.phase === 'DECIDE'),
        5000,
      )) as BizUpdate;
      if (at.view.phase === 'DECIDE' && at.view.decision && at.view.turn === v.view.turn) {
        const d = at.view.decision;
        const action =
          mover === buyer && d.kind === 'BUY'
            ? { type: 'BUY', turn: at.view.turn, space: d.space }
            : { type: 'SKIP', turn: at.view.turn };
        expect((await mover.act(at, action)).ok).toBe(true);
      }
      for (const p of players) {
        await p.waitFor('match:update', (u) => (u as BizUpdate).view.turn > v.view.turn, 5000);
      }
    }

    it('keeps one Business room in sync across instances, and an auction survives a host crash', async () => {
      c = await startCluster(2, { games: [biz()] });
      await eventually(() => hostIndex(c as TestCluster) >= 0);
      const host = hostIndex(c);
      const a = await c.player(host, 'Archit'); // on the host
      const b = await c.player(1 - host, 'Priya'); // on the other instance
      await setupGameRoom('business', a, b);
      await a.emit('room:updateSettings', {
        settings: { rounds: 12, board: 'india-classic', eventFrequency: 'normal' },
      });
      expect((await a.emit('room:start', {})).ok).toBe(true);
      await a.waitFor('match:update');
      await b.waitFor('match:update');
      for (let k = 0; k < 4; k++) await play([a, b], a);
      expect(last(b).view.owner).toEqual(last(a).view.owner);
      expect(last(b).view.players).toEqual(last(a).view.players);
      expect(conserved(last(b).view)).toBe(true);
      const mine = last(a).view.owner.flatMap((o, i) => (o === last(a).you ? [i] : []));
      expect(mine.length).toBeGreaterThan(0);

      // Archit (on the host) puts a city up for auction; then the host crashes mid-auction.
      if (last(a).view.current !== last(a).you) await play([a, b], a);
      const v = last(a);
      const space = mine[0] as number;
      expect((await a.act(v, { type: 'AUCTION_START', turn: v.view.turn, space })).ok).toBe(true);
      const auction = (await b.waitFor(
        'match:update',
        (u) => (u as BizUpdate).view.phase === 'AUCTION',
        5000,
      )) as BizUpdate;
      await sleep(300); // the host's next snapshot
      const crashed = c.nodes[host]?.server as GameServer;
      await crashed.cluster.abandon();
      crashed.io.close();
      await eventually(
        () => (c as TestCluster).nodes[1 - host]?.server.cluster.isHost === true,
        5000,
      );

      // The restored auction is exactly the one before the crash…
      const r = await b.emit('match:resync', { matchId: auction.matchId });
      if (!r.ok) throw new Error('resync failed');
      const after = r.update.view as BusinessView;
      expect(after.phase).toBe('AUCTION');
      expect(after.auction).toEqual(auction.view.auction);
      expect(after.players).toEqual(auction.view.players);
      expect(after.owner).toEqual(auction.view.owner);
      expect(conserved(after)).toBe(true);
      // …and Priya can win it on the new host, whose timer closes it.
      const open = after.auction?.open as number;
      expect((await b.act(r.update, { type: 'BID', turn: after.turn, amount: open })).ok).toBe(
        true,
      );
      const won = (await b.waitFor(
        'match:update',
        (u) => (u as BizUpdate).view.owner[space] === last(b).you,
        15_000,
      )) as BizUpdate;
      expect(won.view.phase).not.toBe('AUCTION');
      expect(won.view.players[won.you]?.spend.property).toBe(open);
      expect(conserved(won.view)).toBe(true);
    }, 45_000);
  });
});

describe('public matchmaking across instances', () => {
  /** The fixture game, offered in public play. */
  const publicFixture = (): AnyGameModule => {
    const base = testFixture();
    return {
      ...base,
      manifest: {
        ...base.manifest,
        id: 'alpha',
        publicMatch: { enabled: true, targetPlayers: 4, minHumans: 2 },
      },
    } as AnyGameModule;
  };
  const roomOf = async (cl: TestClient, test: (r: RoomView) => boolean, ms = 6000) =>
    (await cl.waitForRoom((r) => r !== null && test(r), ms)) as RoomView;
  const kinds = (r: RoomView) => r.members.map((m) => m.kind).sort();

  it('players on different instances find the same room, timer, start and bots', async () => {
    c = await startCluster(2, {
      games: [publicFixture()],
      overrides: { matchmaking: { fillWindowMs: 800, browsePushMs: 20 } },
    });
    await eventually(() => hostIndex(c as TestCluster) >= 0);
    const host = hostIndex(c);
    const a = await c.player(host, 'Archit'); // on the host
    const b = await c.player(1 - host, 'Priya'); // on the other instance
    const viewer = await c.player(1 - host, 'Viewer');
    await viewer.emit('public:browse', { on: true });
    const ra = await a.emit('public:play', { gameId: 'alpha' });
    if (!ra.ok) throw new Error(ra.code);
    // The Browse feed on the other instance sees the room created through the host.
    await viewer.waitFor('public:rooms', (p) => p.rooms.some((x) => x.roomId === ra.room.id));
    const rb = await b.emit('public:play', { gameId: 'alpha' });
    expect(rb.ok && rb.room.id).toBe(ra.room.id);
    const fa = await roomOf(a, (r) => r.public?.state === 'FILLING');
    const fb = await roomOf(b, (r) => r.public?.state === 'FILLING');
    expect(fb.public?.fillEndsAt).toBe(fa.public?.fillEndsAt); // one timer, the same for both
    const sa = await roomOf(a, (r) => r.phase === 'IN_GAME');
    const sb = await roomOf(b, (r) => r.phase === 'IN_GAME');
    expect(sb.match?.matchId).toBe(sa.match?.matchId);
    expect(kinds(sa)).toEqual(['BOT', 'BOT', 'HUMAN', 'HUMAN']);
    expect(sb.match?.seats).toEqual(sa.match?.seats);
    await viewer.waitFor('public:rooms', (p) => !p.rooms.some((x) => x.roomId === ra.room.id));
  });

  it('a host crash during the fill window: same room, timer resumes, bots fill exactly once', async () => {
    c = await startCluster(3, {
      games: [publicFixture()],
      overrides: { matchmaking: { fillWindowMs: 2500 } },
    });
    await eventually(() => hostIndex(c as TestCluster) >= 0);
    const host = hostIndex(c);
    const [g1, g2] = [0, 1, 2].filter((i) => i !== host) as [number, number];
    const a = await c.player(g1, 'Archit'); // both players on gateways: their sockets survive
    const b = await c.player(g2, 'Priya');
    const ra = await a.emit('public:play', { gameId: 'alpha' });
    const rb = await b.emit('public:play', { gameId: 'alpha' });
    if (!ra.ok || !rb.ok) throw new Error('play failed');
    expect(rb.room.id).toBe(ra.room.id);
    const before = await roomOf(a, (r) => r.public?.state === 'FILLING');
    await sleep(300); // the host's next snapshot
    const crashed = c.nodes[host]?.server as GameServer;
    await crashed.cluster.abandon();
    crashed.io.close();
    await eventually(
      () => hostIndex(c as TestCluster) >= 0 && hostIndex(c as TestCluster) !== host,
      5000,
    );
    // The restored room is the same one with the same deadline; it starts once, with 2 bots.
    const started = await roomOf(a, (x) => x.phase === 'IN_GAME', 8000);
    expect(started.id).toBe(before.id);
    expect(kinds(started)).toEqual(['BOT', 'BOT', 'HUMAN', 'HUMAN']);
    const seen = await roomOf(b, (x) => x.phase === 'IN_GAME');
    expect(seen.match?.matchId).toBe(started.match?.matchId);
    // Exactly one match start reached each player (no duplicate fill / start).
    const starts = new Set(
      a.all('room:snapshot').flatMap((p) => (p.room?.match ? [p.room.match.matchId] : [])),
    );
    expect(starts.size).toBe(1);
  }, 30_000);
});
