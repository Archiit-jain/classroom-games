import type { BucketSpec } from '../config';

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/** Token-bucket rate limiter keyed by (subject, bucket name). */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly specs: Record<string, BucketSpec>,
    private readonly now: () => number = Date.now,
  ) {}

  private refill(subject: string, name: string): { bucket: Bucket; spec: BucketSpec } {
    const spec = this.specs[name];
    if (!spec) throw new Error(`Unknown rate-limit bucket "${name}"`);
    const key = `${subject}\u0000${name}`;
    const now = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: spec.burst, updatedAt: now };
      this.buckets.set(key, bucket);
    } else {
      const elapsed = (now - bucket.updatedAt) / 1000;
      bucket.tokens = Math.min(spec.burst, bucket.tokens + elapsed * spec.perSecond);
      bucket.updatedAt = now;
    }
    return { bucket, spec };
  }

  /** Consumes one token; returns false (and consumes nothing) when the bucket is empty. */
  take(subject: string, name: string): boolean {
    const { bucket } = this.refill(subject, name);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  retryAfterMs(subject: string, name: string): number {
    const { bucket, spec } = this.refill(subject, name);
    if (bucket.tokens >= 1) return 0;
    return Math.ceil(((1 - bucket.tokens) / spec.perSecond) * 1000);
  }

  /** Drops buckets that have fully refilled (they carry no information). */
  sweep(): void {
    for (const [key, bucket] of this.buckets) {
      const name = key.split('\u0000')[1] as string;
      const spec = this.specs[name];
      if (!spec) continue;
      const elapsed = (this.now() - bucket.updatedAt) / 1000;
      if (bucket.tokens + elapsed * spec.perSecond >= spec.burst) this.buckets.delete(key);
    }
  }
}
