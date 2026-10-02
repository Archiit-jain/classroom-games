import { Redis } from 'ioredis';
import type { SharedStore, StoreWrite } from './SharedStore';

// Compare-and-set scripts: each runs atomically inside Redis.
const RENEW = `if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end`;
const RELEASE = `if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1]) else return 0 end`;
// ARGV: fence value, number of writes, then (key, value, ttl) per write, then keys to delete.
const COMMIT = `if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
local writes = tonumber(ARGV[2])
local i = 3
for _ = 1, writes do
  redis.call('SET', ARGV[i], ARGV[i + 1], 'PX', ARGV[i + 2])
  i = i + 3
end
while i <= #ARGV do
  redis.call('DEL', ARGV[i])
  i = i + 1
end
return 1`;
const INCR = `local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return n`;

/**
 * SharedStore on Redis (any Redis 6+; Upstash from the Vercel Marketplace in
 * production). Uses two connections, as Redis requires: one for commands and
 * one dedicated to pub/sub.
 */
export class RedisSharedStore implements SharedStore {
  private readonly cmd: Redis;
  private readonly sub: Redis;
  private readonly handlers = new Map<string, Set<(message: string) => void>>();

  constructor(url: string) {
    const options = { maxRetriesPerRequest: 3, enableAutoPipelining: true, lazyConnect: false };
    this.cmd = new Redis(url, options);
    this.sub = new Redis(url, { ...options, enableAutoPipelining: false });
    this.sub.on('message', (channel: string, message: string) => {
      for (const fn of this.handlers.get(channel) ?? []) fn(message);
    });
  }

  async get(key: string): Promise<string | null> {
    return this.cmd.get(key);
  }

  async acquire(key: string, value: string, ttlMs: number): Promise<boolean> {
    return (await this.cmd.set(key, value, 'PX', ttlMs, 'NX')) === 'OK';
  }

  async renew(key: string, value: string, ttlMs: number): Promise<boolean> {
    return Number(await this.cmd.eval(RENEW, 1, key, value, String(ttlMs))) === 1;
  }

  async release(key: string, value: string): Promise<void> {
    await this.cmd.eval(RELEASE, 1, key, value);
  }

  async put(key: string, value: string, ttlMs: number): Promise<void> {
    await this.cmd.set(key, value, 'PX', ttlMs);
  }

  async commit(
    fenceKey: string,
    fenceValue: string,
    writes: StoreWrite[],
    deletes: string[],
  ): Promise<boolean> {
    const args = [fenceValue, String(writes.length)];
    for (const w of writes) args.push(w.key, w.value, String(Math.max(1, Math.round(w.ttlMs))));
    args.push(...deletes);
    return Number(await this.cmd.eval(COMMIT, 1, fenceKey, ...args)) === 1;
  }

  async loadPrefix(prefix: string): Promise<[string, string][]> {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.cmd.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== '0');
    const out: [string, string][] = [];
    for (let i = 0; i < keys.length; i += 200) {
      const slice = keys.slice(i, i + 200);
      const values = await this.cmd.mget(...slice);
      slice.forEach((key, j) => {
        const value = values[j];
        if (value !== null && value !== undefined) out.push([key, value]);
      });
    }
    return out;
  }

  async incr(key: string, ttlMs: number): Promise<number> {
    return Number(await this.cmd.eval(INCR, 1, key, String(ttlMs)));
  }

  async pushCapped(key: string, value: string, max: number, ttlMs: number): Promise<void> {
    await this.cmd
      .multi()
      .lpush(key, value)
      .ltrim(key, 0, max - 1)
      .pexpire(key, ttlMs)
      .exec();
  }

  async publish(channel: string, message: string): Promise<void> {
    await this.cmd.publish(channel, message);
  }

  async subscribe(
    channel: string,
    onMessage: (message: string) => void,
  ): Promise<() => Promise<void>> {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
      await this.sub.subscribe(channel);
    }
    set.add(onMessage);
    return async () => {
      const current = this.handlers.get(channel);
      current?.delete(onMessage);
      if (current && current.size === 0) {
        this.handlers.delete(channel);
        await this.sub.unsubscribe(channel);
      }
    };
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.cmd.quit(), this.sub.quit()]);
  }
}
