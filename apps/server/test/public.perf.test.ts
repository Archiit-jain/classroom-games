import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AnyGameModule } from '@cg/game-sdk';
import { describe, expect, it } from 'vitest';
import { createGameServer, type GameServer } from '../src/app';
import { MemorySharedStore, type SharedStore } from '../src/cluster/SharedStore';
import { loadConfig, mergeConfig } from '../src/config';
import { eventually, testFixture, TestClient } from './helpers';

/**
 * Matchmaking measurements (Phase 9 §33). Opt-in: `PERF=1 pnpm vitest run public.perf` (report: $PERF_OUT or <tmp>/cg-matchmaking-perf.json).
 * Two instances share one store (a counting wrapper: the operations Redis would see); the
 * players sit on the gateway instance so every call crosses instances.
 */
const enabled = process.env.PERF === '1';

function counting(inner: SharedStore) {
  const counts: Record<string, number> = {};
  const store = new Proxy(inner, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        counts[String(prop)] = (counts[String(prop)] ?? 0) + 1;
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return { store, counts };
}

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

const ms = (n: number) => Math.round(n * 10) / 10;
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return {
    n: s.length,
    avg: ms(s.reduce((a, b) => a + b, 0) / s.length),
    p90: ms(s[Math.floor(s.length * 0.9)] ?? 0),
    max: ms(s.at(-1) ?? 0),
  };
};

describe.skipIf(!enabled)('public matchmaking measurements', () => {
  it('latency, store operations, cross-instance messages and Browse pushes', async () => {
    const { store, counts } = counting(new MemorySharedStore());
    const servers: GameServer[] = [];
    const urls: string[] = [];
    for (let i = 0; i < 2; i++) {
      const server = createGameServer({
        config: mergeConfig(loadConfig({}, { host: '127.0.0.1', logLevel: 'silent' }), {
          limits: { newSessionsPerIpPerMinute: 100_000 },
          rateLimits: { matchmaking: { burst: 1000, perSecond: 1000 } },
          matchmaking: { fillWindowMs: 60_000, browsePushMs: 250 },
        }),
        store,
        games: [publicFixture()],
        cluster: {
          instanceId: `perf${i}`,
          leaseTtlMs: 2000,
          renewEveryMs: 500,
          callTimeoutMs: 3000,
        },
      });
      urls.push(`http://127.0.0.1:${await server.listen(0)}`);
      servers.push(server);
    }
    await eventually(() => servers.some((s) => s.cluster.isHost));
    const gateway = urls[servers.findIndex((s) => !s.cluster.isHost)] as string;
    const clients: TestClient[] = [];
    const player = async (name: string) => {
      const c = await TestClient.connect(gateway, {});
      clients.push(c);
      await c.emit('session:setNickname', { nickname: name });
      return c;
    };
    const viewer = await player('Viewer');
    await viewer.emit('public:browse', { on: true });
    await viewer.waitFor('public:rooms');

    const before = { ...counts };
    const create: number[] = [];
    const joins: number[] = [];
    const N = 40; // 40 players → 10 full rooms (target 4): 10 creations, 30 joins
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      const p = await player(`P${i}`);
      const start = performance.now();
      const res = await p.emit('public:play', { gameId: 'alpha' });
      const took = performance.now() - start;
      expect(res.ok).toBe(true);
      (i % 4 === 0 ? create : joins).push(took);
    }
    const elapsed = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 600));
    const delta = Object.fromEntries(
      Object.entries(counts).map(([k, v]) => [k, v - (before[k] ?? 0)]),
    );
    const pushes = viewer.all('public:rooms').length;
    const report = {
      players: N,
      createRoomMs: stats(create),
      joinRoomMs: stats(joins),
      storeOps: delta,
      crossInstanceMessages: delta.publish ?? 0,
      browsePushes: pushes,
      browsePushesPerSecond: ms(pushes / (elapsed / 1000)),
      elapsedMs: Math.round(elapsed),
    };
    writeFileSync(
      process.env.PERF_OUT ?? join(tmpdir(), 'cg-matchmaking-perf.json'),
      JSON.stringify(report, null, 1),
    );
    for (const c of clients) c.close();
    await Promise.allSettled(servers.map((s) => s.close()));
  }, 60_000);
});
