import type { AnyGameModule } from '@cg/game-sdk';
import { Redis } from 'ioredis';
import { createGameServer, type GameServer } from '../src/app';
import { RedisSharedStore } from '../src/cluster/RedisSharedStore';
import { MemorySharedStore, type SharedStore } from '../src/cluster/SharedStore';
import { loadConfig, mergeConfig, type ConfigOverrides } from '../src/config';
import type { Logger } from '../src/log';
import { FaultyStore } from './faultyStore';
import { testFixture, TestClient } from './helpers';

/**
 * Several real server instances (own ports, own Socket.IO servers) sharing one
 * store — the same arrangement as Vercel instances sharing Redis (ADR-023).
 * With REDIS_URL set (CI) the instances share a real Redis (database 1, emptied
 * before each test); otherwise one in-memory store.
 */
export const REDIS_URL = process.env.REDIS_URL;
const REDIS_TEST_DB = REDIS_URL ? `${REDIS_URL.replace(/\/\d*$/u, '')}/1` : null;

export async function freshStore(): Promise<{ store: SharedStore; close(): Promise<void> }> {
  if (!REDIS_TEST_DB) return { store: new MemorySharedStore(), close: async () => undefined };
  const admin = new Redis(REDIS_TEST_DB);
  await admin.flushdb();
  await admin.quit();
  const store = new RedisSharedStore(REDIS_TEST_DB);
  return { store, close: () => store.close() };
}

export interface TestCluster {
  store: SharedStore;
  nodes: {
    server: GameServer;
    url: string;
    /** This instance's own store connection (with `faults`), to cut it off in a test. */
    fault: FaultyStore | null;
  }[];
  /** Connects a client to instance `i` (optionally resuming a session). */
  connect(i: number, token?: string): Promise<TestClient>;
  player(i: number, nickname: string): Promise<TestClient>;
  close(): Promise<void>;
}

export async function startCluster(
  count: number,
  options: {
    games?: AnyGameModule[];
    overrides?: ConfigOverrides;
    releaseWhenIdle?: boolean;
    /** Give every instance its own FaultyStore over the shared one (Phase 10 §14). */
    faults?: boolean;
    log?: Logger;
  } = {},
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
    const fault = options.faults ? new FaultyStore(store) : null;
    const server = createGameServer({
      config,
      store: fault ?? store,
      ...(options.log ? { log: options.log } : {}),
      games: options.games ?? [testFixture()],
      cluster: { instanceId: `inst${i}`, leaseTtlMs: 600, renewEveryMs: 150, callTimeoutMs: 1500 },
    });
    const port = await server.listen(0);
    nodes.push({ server, url: `http://127.0.0.1:${port}`, fault });
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
