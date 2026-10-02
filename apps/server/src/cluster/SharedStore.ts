/**
 * The small set of shared-memory and messaging operations the multi-instance
 * layer needs (ADR-023). Production uses Redis (`RedisSharedStore`); local
 * development and tests use `MemorySharedStore`, which several in-process
 * server instances can share to simulate a cluster.
 */
export interface SharedStore {
  get(key: string): Promise<string | null>;
  /** Sets `key = value` (expiring after `ttlMs`) only if the key is absent. */
  acquire(key: string, value: string, ttlMs: number): Promise<boolean>;
  /** Extends the TTL only while `key` still equals `value`. Returns whether it does. */
  renew(key: string, value: string, ttlMs: number): Promise<boolean>;
  /** Deletes `key` only while it equals `value`. */
  release(key: string, value: string): Promise<void>;
  /** Sets `key = value` with a TTL (unconditionally). */
  put(key: string, value: string, ttlMs: number): Promise<void>;
  /**
   * Atomically applies the writes and deletes — but only while `fenceKey` still
   * equals `fenceValue` (so an instance that lost its lease can never overwrite).
   */
  commit(
    fenceKey: string,
    fenceValue: string,
    writes: StoreWrite[],
    deletes: string[],
  ): Promise<boolean>;
  /** Every key/value whose key starts with `prefix`. */
  loadPrefix(prefix: string): Promise<[string, string][]>;
  /** Increments a counter (created with `ttlMs` if new). */
  incr(key: string, ttlMs: number): Promise<number>;
  /** Pushes to a list kept to the newest `max` entries, expiring after `ttlMs`. */
  pushCapped(key: string, value: string, max: number, ttlMs: number): Promise<void>;
  publish(channel: string, message: string): Promise<void>;
  /** Returns a function that unsubscribes. Messages on one channel arrive in order. */
  subscribe(channel: string, onMessage: (message: string) => void): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

export interface StoreWrite {
  key: string;
  value: string;
  ttlMs: number;
}

interface Entry {
  value: string;
  expiresAt: number;
}

/** A process-local SharedStore. Messages are delivered asynchronously, as with Redis. */
export class MemorySharedStore implements SharedStore {
  private readonly data = new Map<string, Entry>();
  private readonly lists = new Map<string, { items: string[]; expiresAt: number }>();
  private readonly channels = new Map<string, Set<(message: string) => void>>();

  constructor(private readonly now: () => number = Date.now) {}

  private live(key: string): Entry | undefined {
    const entry = this.data.get(key);
    if (entry && entry.expiresAt <= this.now()) {
      this.data.delete(key);
      return undefined;
    }
    return entry;
  }

  private setEntry(key: string, value: string, ttlMs: number): void {
    this.data.set(key, {
      value,
      expiresAt: ttlMs > 0 ? this.now() + ttlMs : Number.POSITIVE_INFINITY,
    });
  }

  async get(key: string): Promise<string | null> {
    return this.live(key)?.value ?? null;
  }

  async acquire(key: string, value: string, ttlMs: number): Promise<boolean> {
    if (this.live(key)) return false;
    this.setEntry(key, value, ttlMs);
    return true;
  }

  async renew(key: string, value: string, ttlMs: number): Promise<boolean> {
    if (this.live(key)?.value !== value) return false;
    this.setEntry(key, value, ttlMs);
    return true;
  }

  async release(key: string, value: string): Promise<void> {
    if (this.live(key)?.value === value) this.data.delete(key);
  }

  async put(key: string, value: string, ttlMs: number): Promise<void> {
    this.setEntry(key, value, ttlMs);
  }

  async commit(
    fenceKey: string,
    fenceValue: string,
    writes: StoreWrite[],
    deletes: string[],
  ): Promise<boolean> {
    if (this.live(fenceKey)?.value !== fenceValue) return false;
    for (const w of writes) this.setEntry(w.key, w.value, w.ttlMs);
    for (const key of deletes) this.data.delete(key);
    return true;
  }

  async loadPrefix(prefix: string): Promise<[string, string][]> {
    const out: [string, string][] = [];
    for (const key of [...this.data.keys()]) {
      if (!key.startsWith(prefix)) continue;
      const entry = this.live(key);
      if (entry) out.push([key, entry.value]);
    }
    return out;
  }

  async incr(key: string, ttlMs: number): Promise<number> {
    const current = this.live(key);
    const next = (current ? Number(current.value) : 0) + 1;
    if (current) current.value = String(next);
    else this.setEntry(key, String(next), ttlMs);
    return next;
  }

  async pushCapped(key: string, value: string, max: number, ttlMs: number): Promise<void> {
    const list = this.lists.get(key);
    const items = list && list.expiresAt > this.now() ? list.items : [];
    items.unshift(value);
    items.length = Math.min(items.length, max);
    this.lists.set(key, { items, expiresAt: this.now() + ttlMs });
  }

  /** Test helper: the list written by `pushCapped`. */
  list(key: string): string[] {
    return [...(this.lists.get(key)?.items ?? [])];
  }

  async publish(channel: string, message: string): Promise<void> {
    const subscribers = this.channels.get(channel);
    if (!subscribers) return;
    for (const fn of subscribers) setImmediate(() => fn(message));
  }

  async subscribe(
    channel: string,
    onMessage: (message: string) => void,
  ): Promise<() => Promise<void>> {
    let set = this.channels.get(channel);
    if (!set) {
      set = new Set();
      this.channels.set(channel, set);
    }
    set.add(onMessage);
    return async () => {
      this.channels.get(channel)?.delete(onMessage);
    };
  }

  async close(): Promise<void> {
    // Shared between instances in tests: closing one instance must not wipe the others.
  }
}
