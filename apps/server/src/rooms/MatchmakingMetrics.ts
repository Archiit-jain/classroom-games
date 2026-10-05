import type { ErrorCode } from '@cg/protocol';

type Counter =
  | 'requests'
  | 'roomsCreated'
  | 'joins'
  | 'cancelled'
  | 'fillsCompleted'
  | 'botSeatsFilled'
  | 'matchesStarted'
  | 'playWithBots'
  | 'browsePushes'
  | 'hostTakeovers';

const WAIT_SAMPLES = 500;

/**
 * Lightweight matchmaking counters for one hosting term (design §8): logged once a minute
 * and readable through the operator-only metrics endpoint. No personal data is kept.
 */
export class MatchmakingMetrics {
  private readonly counts = new Map<Counter, number>();
  private readonly failures = new Map<string, number>();
  /** How long humans waited from joining to their match starting (ms), newest last. */
  private readonly waits: number[] = [];
  private readonly since = Date.now();
  private changed = false;

  count(name: Counter, by = 1): void {
    this.counts.set(name, (this.counts.get(name) ?? 0) + by);
    this.changed = true;
  }

  failedJoin(code: ErrorCode): void {
    this.failures.set(code, (this.failures.get(code) ?? 0) + 1);
    this.changed = true;
  }

  waited(ms: number[]): void {
    this.waits.push(...ms.map((x) => Math.max(0, Math.round(x))));
    if (this.waits.length > WAIT_SAMPLES) this.waits.splice(0, this.waits.length - WAIT_SAMPLES);
    this.changed = true;
  }

  /** True once since the last call when anything was recorded (for the periodic log line). */
  takeChanged(): boolean {
    const was = this.changed;
    this.changed = false;
    return was;
  }

  snapshot() {
    const sorted = [...this.waits].sort((a, b) => a - b);
    const avg = sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : 0;
    const p90 = sorted.length
      ? (sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] ?? 0)
      : 0;
    return {
      since: this.since,
      counts: Object.fromEntries(this.counts),
      failedJoins: Object.fromEntries(this.failures),
      wait: { samples: sorted.length, avgMs: avg, p90Ms: p90 },
    };
  }
}
