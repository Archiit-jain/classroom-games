import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { RedisSharedStore } from '../src/cluster/RedisSharedStore';
import { MemorySharedStore, type SharedStore } from '../src/cluster/SharedStore';
import { sleep } from './helpers';

const REDIS_URL = process.env.REDIS_URL;

/**
 * One contract, two implementations: the in-memory store (development, tests)
 * and Redis (production). The Redis run needs REDIS_URL (CI starts a Redis service).
 */
const implementations: [string, () => SharedStore, boolean][] = [
  ['MemorySharedStore', () => new MemorySharedStore(), true],
  ['RedisSharedStore', () => new RedisSharedStore(REDIS_URL as string), !!REDIS_URL],
];

for (const [name, make, enabled] of implementations) {
  describe.skipIf(!enabled)(`${name} (shared-store contract)`, () => {
    const store = enabled ? make() : (null as unknown as SharedStore);
    // Unique keys per run, so a shared Redis is never polluted across runs.
    const ns = `t:${randomBytes(4).toString('hex')}:`;
    afterAll(async () => {
      await store?.close();
    });

    it('acquires a lease once, renews and releases it only for its holder', async () => {
      const key = `${ns}lease`;
      expect(await store.acquire(key, 'a', 5000)).toBe(true);
      expect(await store.acquire(key, 'b', 5000)).toBe(false);
      expect(await store.renew(key, 'b', 5000)).toBe(false);
      expect(await store.renew(key, 'a', 5000)).toBe(true);
      await store.release(key, 'b');
      expect(await store.get(key)).toBe('a');
      await store.release(key, 'a');
      expect(await store.get(key)).toBeNull();
    });

    it('expires leases and values after their TTL', async () => {
      const key = `${ns}ttl`;
      expect(await store.acquire(key, 'a', 120)).toBe(true);
      await store.put(`${ns}put`, 'x', 120);
      await sleep(250);
      expect(await store.get(key)).toBeNull();
      expect(await store.get(`${ns}put`)).toBeNull();
      expect(await store.acquire(key, 'b', 5000)).toBe(true);
    });

    it('commits writes and deletes atomically — only while the fence holds', async () => {
      const fence = `${ns}fence`;
      await store.acquire(fence, 'epoch-1', 5000);
      await store.put(`${ns}old`, 'gone soon', 5000);
      const ok = await store.commit(
        fence,
        'epoch-1',
        [
          { key: `${ns}r:1`, value: '{"a":1}', ttlMs: 5000 },
          { key: `${ns}r:2`, value: '{"b":2}', ttlMs: 5000 },
        ],
        [`${ns}old`],
      );
      expect(ok).toBe(true);
      expect(await store.get(`${ns}old`)).toBeNull();
      expect((await store.loadPrefix(`${ns}r:`)).sort((x, y) => x[0].localeCompare(y[0]))).toEqual([
        [`${ns}r:1`, '{"a":1}'],
        [`${ns}r:2`, '{"b":2}'],
      ]);
      // A stale holder (old epoch) can never overwrite.
      expect(
        await store.commit(
          fence,
          'epoch-0',
          [{ key: `${ns}r:1`, value: 'stale', ttlMs: 5000 }],
          [],
        ),
      ).toBe(false);
      expect(await store.get(`${ns}r:1`)).toBe('{"a":1}');
    });

    it('counts and keeps capped lists', async () => {
      expect(await store.incr(`${ns}n`, 5000)).toBe(1);
      expect(await store.incr(`${ns}n`, 5000)).toBe(2);
      for (let i = 0; i < 5; i++) await store.pushCapped(`${ns}list`, String(i), 3, 5000);
      if (store instanceof MemorySharedStore)
        expect(store.list(`${ns}list`)).toEqual(['4', '3', '2']);
    });

    it('delivers published messages in order to subscribers, and stops after unsubscribe', async () => {
      const got: string[] = [];
      const unsubscribe = await store.subscribe(`${ns}ch`, (m) => got.push(m));
      for (let i = 0; i < 20; i++) await store.publish(`${ns}ch`, `m${i}`);
      const deadline = Date.now() + 3000;
      while (got.length < 20 && Date.now() < deadline) await sleep(10);
      expect(got).toEqual(Array.from({ length: 20 }, (_, i) => `m${i}`));
      await unsubscribe();
      await store.publish(`${ns}ch`, 'late');
      await sleep(100);
      expect(got).toHaveLength(20);
    });
  });
}
