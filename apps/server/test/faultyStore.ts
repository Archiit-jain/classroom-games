import type { SharedStore, StoreWrite } from '../src/cluster/SharedStore';

export type FaultMode = 'ok' | 'fail' | 'hang';

/**
 * One instance's connection to the shared store, with injectable faults (Phase 10 §14):
 *
 * - `fail`: every command rejects (Redis unreachable, connection refused);
 * - `hang`: commands wait until the connection comes back, like ioredis's offline
 *   queue during a disconnect; pub/sub messages sent meanwhile are lost, as with
 *   real Redis pub/sub;
 * - `ok`: everything passes through (queued commands run in order).
 *
 * Several instances share one inner store, each through its own FaultyStore, so a
 * test can cut a single instance off while the others keep working.
 */
export class FaultyStore implements SharedStore {
  private mode: FaultMode = 'ok';
  private waiting: Array<() => void> = [];

  constructor(private readonly inner: SharedStore) {}

  setMode(mode: FaultMode): void {
    this.mode = mode;
    if (mode !== 'hang') {
      const resume = this.waiting;
      this.waiting = [];
      for (const go of resume) go();
    }
  }

  private async run<T>(op: () => Promise<T>): Promise<T> {
    while (this.mode !== 'ok') {
      if (this.mode === 'fail') throw new Error('Connection is closed.');
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    return op();
  }

  get(key: string) {
    return this.run(() => this.inner.get(key));
  }
  acquire(key: string, value: string, ttlMs: number) {
    return this.run(() => this.inner.acquire(key, value, ttlMs));
  }
  renew(key: string, value: string, ttlMs: number) {
    return this.run(() => this.inner.renew(key, value, ttlMs));
  }
  release(key: string, value: string) {
    return this.run(() => this.inner.release(key, value));
  }
  put(key: string, value: string, ttlMs: number) {
    return this.run(() => this.inner.put(key, value, ttlMs));
  }
  commit(fenceKey: string, fenceValue: string, writes: StoreWrite[], deletes: string[]) {
    return this.run(() => this.inner.commit(fenceKey, fenceValue, writes, deletes));
  }
  loadPrefix(prefix: string) {
    return this.run(() => this.inner.loadPrefix(prefix));
  }
  incr(key: string, ttlMs: number) {
    return this.run(() => this.inner.incr(key, ttlMs));
  }
  pushCapped(key: string, value: string, max: number, ttlMs: number) {
    return this.run(() => this.inner.pushCapped(key, value, max, ttlMs));
  }
  publish(channel: string, message: string) {
    return this.run(() => this.inner.publish(channel, message));
  }
  subscribe(channel: string, onMessage: (message: string) => void) {
    // While cut off, this instance hears nothing (Redis does not queue pub/sub).
    return this.run(() =>
      this.inner.subscribe(channel, (message) => {
        if (this.mode === 'ok') onMessage(message);
      }),
    );
  }
  async close(): Promise<void> {
    // The inner store is shared; the test closes it once.
    this.setMode('ok');
  }
}
