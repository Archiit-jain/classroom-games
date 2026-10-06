import { randomBytes } from 'node:crypto';
import { errorFields, type Logger } from '../log';
import type { SharedStore } from './SharedStore';

/** Shared-store keys and channels (one namespace per deployment). */
export const KEYS = {
  host: 'cg:host',
  hostEpoch: 'cg:host:epoch',
  instance: (id: string) => `cg:inst:${id}`,
  inbox: (id: string) => `cg:to:${id}`,
  all: 'cg:all',
} as const;

/** A request a gateway sends to the host. */
export interface HostCall {
  op: string;
  data: unknown;
  /** The instance that sent it. */
  from: string;
}

/** Something the host sends to the instance holding a socket. */
export type GatewayMessage =
  | { t: 'deliver'; socketIds: string[]; event: string; payload: unknown }
  | { t: 'displace'; socketId: string };

type Wire =
  | { t: 'call'; id: string; from: string; op: string; data: unknown }
  | { t: 'reply'; id: string; ok: true; value: unknown }
  | { t: 'reply'; id: string; ok: false; notHost: true }
  | GatewayMessage;

type Broadcast = { t: 'host-released' } | { t: 'host-changed'; host: string };

export interface ClusterOptions {
  store: SharedStore;
  log: Logger;
  instanceId?: string;
  /** Host lease lifetime and how often it is renewed. */
  leaseTtlMs?: number;
  renewEveryMs?: number;
  /** How long a forwarded call may take before it is given up. */
  callTimeoutMs?: number;
  /**
   * Hand the host role over when this instance holds no sockets. Needed where the
   * platform pauses instances without open requests (Vercel); off for one process.
   */
  releaseWhenIdle?: boolean;
  /** Sockets currently connected to this instance. */
  localSocketCount(): number;
  /** Becoming host: rebuild the authoritative services from the shared store. */
  becomeHost(fence: string): Promise<void>;
  /** No longer host (handed over or fenced off): drop the authoritative services. */
  stopHosting(): void;
  /** Before handing over: write everything to the shared store. */
  flush(): Promise<void>;
  /** Host side: handle a forwarded call. */
  handleCall(call: HostCall): unknown;
  /** Gateway side: deliver to local sockets. */
  deliver(message: GatewayMessage): void;
}

export class ClusterError extends Error {}

/**
 * Coordinates server instances (ADR-023). Exactly one instance at a time holds
 * the host lease and runs every room's authoritative services; the others are
 * gateways that forward their sockets' requests to it and deliver its messages.
 * With a single process this instance is simply always the host.
 */
export class Cluster {
  readonly instanceId: string;
  private readonly store: SharedStore;
  private readonly log: Logger;
  private readonly leaseTtlMs: number;
  private readonly renewEveryMs: number;
  private readonly callTimeoutMs: number;
  private readonly releaseWhenIdle: boolean;

  private lease: string | null = null;
  private lastRenewAt = 0;
  /** When the running tick started (null between ticks): a stuck tick means a stuck store. */
  private tickStartedAt: number | null = null;
  /** The last tick could not reach the store. */
  private lastTickFailed = false;
  private becoming: Promise<boolean> | null = null;
  private hostCache: { instance: string; at: number } | null = null;
  private readonly pending = new Map<
    string,
    { host: string; resolve: (v: Wire | null) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private interval: ReturnType<typeof setInterval> | null = null;
  private unsubscribers: (() => Promise<void>)[] = [];
  private callSeq = 0;
  private stopped = false;

  constructor(private readonly options: ClusterOptions) {
    this.instanceId = options.instanceId ?? `i_${randomBytes(6).toString('hex')}`;
    this.store = options.store;
    this.log = options.log;
    this.leaseTtlMs = options.leaseTtlMs ?? 15_000;
    this.renewEveryMs = options.renewEveryMs ?? 5_000;
    this.callTimeoutMs = options.callTimeoutMs ?? 5_000;
    this.releaseWhenIdle = options.releaseWhenIdle ?? false;
  }

  get isHost(): boolean {
    return this.lease !== null;
  }

  /** Subscribes, announces this instance and tries to become host if nobody is. */
  async start(): Promise<void> {
    this.unsubscribers.push(
      await this.store.subscribe(KEYS.inbox(this.instanceId), (m) => this.onInbox(m)),
      await this.store.subscribe(KEYS.all, (m) => this.onBroadcast(m)),
    );
    await this.heartbeat();
    await this.tryBecomeHost();
    this.interval = setInterval(() => void this.tick(), this.renewEveryMs);
    this.interval.unref?.();
  }

  /** Whether another instance is still running (its heartbeat has not expired). */
  async isAlive(instanceId: string): Promise<boolean> {
    if (instanceId === this.instanceId) return !this.stopped;
    return (await this.store.get(KEYS.instance(instanceId))) !== null;
  }

  /**
   * Runs a request on the host: here when this instance is host, otherwise
   * forwarded. Becomes host first when nobody is.
   */
  async call(op: string, data: unknown): Promise<unknown> {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.stopped) throw new ClusterError('STOPPED');
      if (this.becoming) await this.becoming; // restoring to become host: wait for it
      if (this.isHost && (await this.confirmHost())) {
        return this.options.handleCall({ op, data, from: this.instanceId });
      }
      const host = await this.resolveHost();
      if (host === this.instanceId) continue; // just became host: handle above
      if (!host) continue;
      const reply = await this.rpc(host, op, data);
      if (reply && reply.t === 'reply' && reply.ok) return reply.value;
      this.hostCache = null; // not host any more, or no answer: look again
    }
    throw new ClusterError('NO_HOST');
  }

  /** Host side: sends a message to the instance holding a socket. */
  send(instanceId: string, message: GatewayMessage): void {
    if (instanceId === this.instanceId) {
      this.options.deliver(message);
      return;
    }
    void this.publish(KEYS.inbox(instanceId), message);
  }

  /** Call when this instance's last socket closes (may hand the host role over). */
  socketsChanged(): void {
    if (this.releaseWhenIdle && this.isHost && this.options.localSocketCount() === 0) {
      void this.handOver();
    }
  }

  /** Stops: hands the host role over (after flushing) and leaves the cluster. */
  async stop(): Promise<void> {
    if (this.stopped) return;
    if (this.isHost) await this.handOver();
    this.stopped = true;
    await this.leave();
    // Gone for good: the host treats this instance's players as disconnected at once.
    await this.store.release(KEYS.instance(this.instanceId), '1').catch(() => undefined);
  }

  /**
   * Test helper — simulates a crash: stops all activity without handing over or
   * removing the heartbeat, so the lease and heartbeat simply expire.
   */
  async abandon(): Promise<void> {
    this.stopped = true;
    this.lease = null;
    // A crashed process loses its in-memory services too: without this, the dead
    // instance's match timers would still fire later (after the test's store is closed).
    this.options.stopHosting();
    await this.leave();
  }

  private async leave(): Promise<void> {
    if (this.interval) clearInterval(this.interval);
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
    await Promise.allSettled(this.unsubscribers.map((u) => u()));
  }

  // ───────────────────────────── host role ─────────────────────────────

  private async tryBecomeHost(): Promise<boolean> {
    if (this.isHost) return true;
    if (this.becoming) return this.becoming;
    this.becoming = (async () => {
      try {
        const epoch = await this.store.incr(KEYS.hostEpoch, 365 * 24 * 3600_000);
        const value = `${this.instanceId}:${epoch}`;
        if (!(await this.store.acquire(KEYS.host, value, this.leaseTtlMs))) return false;
        this.lastRenewAt = Date.now();
        try {
          await this.options.becomeHost(value);
        } catch (err) {
          this.log.error('restore failed', errorFields(err));
          await this.store.release(KEYS.host, value).catch(() => undefined);
          return false;
        }
        this.lease = value;
        this.hostCache = { instance: this.instanceId, at: Date.now() };
        this.retryCallsNotTo(this.instanceId);
        this.log.info('became host', { instanceId: this.instanceId, epoch });
        void this.publish(KEYS.all, { t: 'host-changed', host: this.instanceId });
        return true;
      } catch (err) {
        // The store is unreachable (or was closed): stay a gateway; the next tick retries.
        // Callers fire this without awaiting, so it must never reject.
        this.log.warn('host takeover failed', errorFields(err));
        return false;
      } finally {
        this.becoming = null;
      }
    })();
    return this.becoming;
  }

  /** Still host? Re-checks with the store when the last renewal is old (e.g. after a pause). */
  private async confirmHost(): Promise<boolean> {
    if (!this.lease) return false;
    if (Date.now() - this.lastRenewAt < this.renewEveryMs * 1.5) return true;
    return this.renew();
  }

  private async renew(): Promise<boolean> {
    const lease = this.lease;
    if (!lease) return false;
    let ok = false;
    try {
      ok = await this.store.renew(KEYS.host, lease, this.leaseTtlMs);
    } catch (err) {
      this.log.warn('lease renewal failed', errorFields(err));
    }
    if (ok) {
      this.lastRenewAt = Date.now();
      return true;
    }
    if (this.lease === lease) this.loseHost('lease lost');
    return false;
  }

  /** Fenced off (another instance holds the lease): stop acting as host at once. */
  loseHost(reason: string): void {
    if (!this.lease) return;
    this.log.warn('stopped hosting', { instanceId: this.instanceId, reason });
    this.lease = null;
    this.hostCache = null;
    this.options.stopHosting();
  }

  private async handOver(): Promise<void> {
    const lease = this.lease;
    if (!lease) return;
    try {
      await this.options.flush();
    } catch (err) {
      this.log.error('flush before hand-over failed', errorFields(err));
    }
    this.lease = null;
    this.hostCache = null;
    this.options.stopHosting();
    await this.store.release(KEYS.host, lease).catch(() => undefined);
    this.log.info('handed host role over', { instanceId: this.instanceId });
    void this.publish(KEYS.all, { t: 'host-released' });
  }

  /** Who is host — becoming host ourselves when nobody is. */
  private async resolveHost(): Promise<string | null> {
    if (this.hostCache && Date.now() - this.hostCache.at < 2_000) return this.hostCache.instance;
    const lease = await this.store.get(KEYS.host);
    if (!lease) return (await this.tryBecomeHost()) ? this.instanceId : null;
    const instance = lease.slice(0, lease.lastIndexOf(':'));
    this.hostCache = { instance, at: Date.now() };
    return instance;
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    // Self-fencing: when THIS instance can't reach the store — its previous tick is still
    // waiting (ioredis queues commands while disconnected) or failed — a host whose
    // renewal is overdue by half the lease stops hosting (timers and bots stop) before
    // the lease can expire and another instance take over: never two hosts at once.
    // A freeze (Vercel pausing an idle instance) leaves the store healthy: after it,
    // the next tick simply renews and hosting continues.
    const storeTrouble = this.tickStartedAt !== null || this.lastTickFailed;
    if (storeTrouble && this.isHost && Date.now() - this.lastRenewAt > this.leaseTtlMs / 2) {
      this.loseHost('store unreachable, lease renewal overdue');
    }
    if (this.tickStartedAt !== null) return; // one tick at a time
    this.tickStartedAt = Date.now();
    this.lastTickFailed = false;
    try {
      await this.heartbeat();
      if (this.isHost) {
        await this.renew();
        this.socketsChanged();
      } else if (this.options.localSocketCount() > 0 && !(await this.store.get(KEYS.host))) {
        // Nobody hosts while our players wait (e.g. the host was paused): take over.
        await this.tryBecomeHost();
      }
    } catch (err) {
      this.lastTickFailed = true;
      this.log.warn('cluster tick failed', errorFields(err));
    } finally {
      this.tickStartedAt = null;
    }
  }

  private async heartbeat(): Promise<void> {
    await this.store.put(KEYS.instance(this.instanceId), '1', this.leaseTtlMs);
  }

  // ───────────────────────────── messaging ─────────────────────────────

  private async publish(channel: string, message: Wire | Broadcast): Promise<void> {
    try {
      await this.store.publish(channel, JSON.stringify(message));
    } catch (err) {
      this.log.warn('publish failed', { channel, ...errorFields(err) });
    }
  }

  private rpc(host: string, op: string, data: unknown): Promise<Wire | null> {
    const id = `${this.instanceId}:${++this.callSeq}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(null);
      }, this.callTimeoutMs);
      this.pending.set(id, { host, resolve, timer });
      void this.publish(KEYS.inbox(host), { t: 'call', id, from: this.instanceId, op, data });
    });
  }

  private onInbox(raw: string): void {
    let message: Wire;
    try {
      message = JSON.parse(raw) as Wire;
    } catch {
      return;
    }
    switch (message.t) {
      case 'call':
        void this.answer(message);
        return;
      case 'reply': {
        const waiting = this.pending.get(message.id);
        if (!waiting) return;
        clearTimeout(waiting.timer);
        this.pending.delete(message.id);
        waiting.resolve(message);
        return;
      }
      default:
        this.options.deliver(message);
    }
  }

  private async answer(call: Extract<Wire, { t: 'call' }>): Promise<void> {
    const inbox = KEYS.inbox(call.from);
    if (this.becoming) await this.becoming;
    if (!(this.isHost && (await this.confirmHost()))) {
      void this.publish(inbox, { t: 'reply', id: call.id, ok: false, notHost: true });
      return;
    }
    let value: unknown;
    try {
      value = this.options.handleCall({ op: call.op, data: call.data, from: call.from });
    } catch (err) {
      this.log.error('forwarded call failed', { op: call.op, ...errorFields(err) });
      value = { ok: false, code: 'INTERNAL_ERROR' };
    }
    void this.publish(inbox, { t: 'reply', id: call.id, ok: true, value });
  }

  /** Requests still waiting on a former host are retried at once (not after the timeout). */
  private retryCallsNotTo(host: string): void {
    for (const [id, waiting] of this.pending) {
      if (waiting.host === host) continue;
      clearTimeout(waiting.timer);
      this.pending.delete(id);
      waiting.resolve(null);
    }
  }

  private onBroadcast(raw: string): void {
    let message: Broadcast;
    try {
      message = JSON.parse(raw) as Broadcast;
    } catch {
      return;
    }
    if (message.t === 'host-changed') {
      this.hostCache = { instance: message.host, at: Date.now() };
      this.retryCallsNotTo(message.host);
      return;
    }
    // The host left: an instance with players takes over (a small random delay
    // spreads the attempts; the lease lets exactly one win).
    this.hostCache = null;
    if (this.options.localSocketCount() > 0 && !this.stopped) {
      setTimeout(
        () => void (this.stopped ? undefined : this.tryBecomeHost()),
        Math.floor(Math.random() * 150),
      ).unref?.();
    }
  }
}
