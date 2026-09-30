import { errorFields, type Logger } from '../log';

/**
 * Named, replaceable timers. Setting a key that already exists replaces the old
 * timer. Keys are namespaced ("room:<id>:start", "match:<id>:<timer>") so a
 * whole room or match can be cleared at once.
 */
export class TimerService {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly log: Logger) {}

  set(key: string, ms: number, fn: () => void): void {
    this.clear(key);
    const handle = setTimeout(
      () => {
        this.timers.delete(key);
        try {
          fn();
        } catch (err) {
          this.log.error('timer callback failed', { key, ...errorFields(err) });
        }
      },
      Math.max(0, ms),
    );
    handle.unref?.();
    this.timers.set(key, handle);
  }

  has(key: string): boolean {
    return this.timers.has(key);
  }

  clear(key: string): void {
    const handle = this.timers.get(key);
    if (handle) {
      clearTimeout(handle);
      this.timers.delete(key);
    }
  }

  clearPrefix(prefix: string): void {
    for (const key of [...this.timers.keys()]) {
      if (key.startsWith(prefix)) this.clear(key);
    }
  }

  get size(): number {
    return this.timers.size;
  }

  dispose(): void {
    for (const handle of this.timers.values()) clearTimeout(handle);
    this.timers.clear();
  }
}
