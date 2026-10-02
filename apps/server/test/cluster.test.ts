import type { AnyGameModule } from '@cg/game-sdk';
import type { FixtureEvent, FixtureView } from '@cg/game-sdk/fixture';
import type { MatchStream, MatchUpdate } from '@cg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { createGameServer, type GameServer } from '../src/app';
import { KEYS } from '../src/cluster/Cluster';
import { STATE_KEYS } from '../src/cluster/HostServices';
import { Redis } from 'ioredis';
import { RedisSharedStore } from '../src/cluster/RedisSharedStore';
import { MemorySharedStore, type SharedStore } from '../src/cluster/SharedStore';
import { loadConfig, mergeConfig, type ConfigOverrides } from '../src/config';
import {
  autoPlay,
  eventually,
  newActionId,
  setupGameRoom,
  setupRoom,
  sleep,
  testFixture,
  TestClient,
} from './helpers';
import { createSketchGame } from './streamGame';

/**
 * Several real server instances (own ports, own Socket.IO servers) sharing one
 * store — the same arrangement as Vercel instances sharing Redis (ADR-023).
 * With REDIS_URL set (CI) the instances share a real Redis (database 1, emptied
 * before each test); otherwise one in-memory store.
 */
const REDIS_URL = process.env.REDIS_URL;
const REDIS_TEST_DB = REDIS_URL ? `${REDIS_URL.replace(/\/\d*$/u, '')}/1` : null;

async function freshStore(): Promise<{ store: SharedStore; close(): Promise<void> }> {
  if (!REDIS_TEST_DB) return { store: new MemorySharedStore(), close: async () => undefined };
  const admin = new Redis(REDIS_TEST_DB);
  await admin.flushdb();
  await admin.quit();
  const store = new RedisSharedStore(REDIS_TEST_DB);
  return { store, close: () => store.close() };
}

interface TestCluster {
  store: SharedStore;
  nodes: { server: GameServer; url: string }[];
  /** Connects a client to instance `i` (optionally resuming a session). */
  connect(i: number, token?: string): Promise<TestClient>;
  player(i: number, nickname: string): Promise<TestClient>;
  close(): Promise<void>;
}

let c: TestCluster | null = null;
afterEach(async () => {
  await c?.close();
  c = null;
});

async function startCluster(
  count: number,
  options: { games?: AnyGameModule[]; overrides?: ConfigOverrides; releaseWhenIdle?: boolean } = {},
): Promise<TestCluster> {
  const shared = await freshStore();
  const { store } = shared;
  const nodes: TestCluster['nodes'] = [];
  const clients: TestClient[] = [];
  for (let i = 0; i < count; i++) {
    const config = mergeConfig(
      loadConfig(
        {},
        {
          host: '127.0.0.1',
          logLevel: 'silent',
          releaseHostWhenIdle: options.releaseWhenIdle ?? false,
          timing: { reconnectGraceMs: 1500, startingCountdownMs: 50 },
          limits: { newSessionsPerIpPerMinute: 10_000 },
        },
      ),
      options.overrides ?? {},
    );
    const server = createGameServer({
      config,
      store,
      games: options.games ?? [testFixture()],
      cluster: { instanceId: `inst${i}`, leaseTtlMs: 600, renewEveryMs: 150, callTimeoutMs: 1500 },
    });
    const port = await server.listen(0);
    nodes.push({ server, url: `http://127.0.0.1:${port}` });
  }
  const connect = async (i: number, token?: string) => {
    const client = await TestClient.connect((nodes[i] as TestCluster['nodes'][number]).url, {
      ...(token ? { token } : {}),
    });
    clients.push(client);
    return client;
  };
  return {
    store,
    nodes,
    connect,
    async player(i, nickname) {
      const client = await connect(i);
      const res = await client.emit('session:setNickname', { nickname });
      if (!res.ok) throw new Error(`setNickname failed: ${res.code}`);
      return client;
    },
    async close() {
      for (const client of clients) client.close();
      await Promise.allSettled(nodes.map((n) => n.server.close()));
      await shared.close();
    },
  };
}

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
});
