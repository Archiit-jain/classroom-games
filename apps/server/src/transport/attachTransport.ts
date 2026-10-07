import type { Ack, C2SEventName, C2SResults, HandshakeAuth, Result } from '@cg/protocol';
import { C2S } from '@cg/protocol/schemas';
import { ClusterError, type Cluster } from '../cluster/Cluster';
import type { ServerConfig } from '../config';
import { errorFields, type Logger } from '../log';
import type { GameRegistry } from '../runtime/GameRegistry';
import type { RateLimiter } from '../util/RateLimiter';
import { EVENT_BUCKETS, type BucketName } from './eventBuckets';
import type { IoServer, IoSocket } from './types';

export interface TransportDeps {
  config: ServerConfig;
  cluster: Cluster;
  registry: GameRegistry;
  /** This instance's per-session buckets (socket flood guard, per-event limits). */
  limiter: RateLimiter;
  log: Logger;
  isShuttingDown: () => boolean;
}

/** Concurrent sockets per IP (on this instance). Generous: a whole classroom can share one IP. */
class ConnectionCounter {
  private readonly counts = new Map<string, number>();

  tryAcquire(ip: string, max: number): boolean {
    const n = this.counts.get(ip) ?? 0;
    if (n >= max) return false;
    this.counts.set(ip, n + 1);
    return true;
  }

  release(ip: string): void {
    const n = (this.counts.get(ip) ?? 1) - 1;
    if (n <= 0) this.counts.delete(ip);
    else this.counts.set(ip, n);
  }
}

/**
 * Client address. Behind a trusted reverse proxy (TRUST_PROXY=true) the proxy
 * appends the real client address as the LAST X-Forwarded-For entry; earlier
 * entries are client-controlled and ignored.
 */
function clientIp(socket: IoSocket, trustProxy: boolean): string {
  if (trustProxy) {
    const header = socket.handshake.headers['x-forwarded-for'];
    const value = Array.isArray(header) ? header.join(',') : header;
    const last = value
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .pop();
    if (last) return last;
  }
  return socket.handshake.address || 'unknown';
}

/** The host's answer to a forwarded request; cluster trouble counts as "busy". */
async function hostCall(cluster: Cluster, op: string, data: unknown): Promise<Result<object>> {
  try {
    return (await cluster.call(op, data)) as Result<object>;
  } catch (err) {
    if (err instanceof ClusterError) return { ok: false, code: 'SERVER_BUSY' };
    throw err;
  }
}

/**
 * The socket-facing half of every server instance (ADR-023). It checks what can
 * be checked here (origin, connections per IP, flood guard, rate buckets,
 * payload shape) and forwards everything else to the room host — which is this
 * instance itself when it holds the host lease.
 */
export function attachTransport(io: IoServer, deps: TransportDeps): { settled(): Promise<void> } {
  const connections = new ConnectionCounter();
  const { cluster } = deps;
  // Departures still being reported to the host (awaited before leaving the cluster).
  const departing = new Set<Promise<unknown>>();

  io.use((socket, next) => {
    if (deps.isShuttingDown()) return next(new Error('SERVER_BUSY'));
    const ip = clientIp(socket, deps.config.trustProxy);
    if (!connections.tryAcquire(ip, deps.config.limits.maxConnectionsPerIp)) {
      return next(new Error('RATE_LIMITED'));
    }
    const auth = (socket.handshake.auth ?? {}) as HandshakeAuth;
    const started = Date.now();
    hostCall(cluster, 'resolve', { token: auth.token, ip })
      .then((resolved) => {
        const ms = Date.now() - started;
        // Players wait for this before the home screen works: slow ones are worth a line.
        if (ms > 300) deps.log.info('slow handshake', { ms, ok: resolved.ok });
        if (!resolved.ok) {
          connections.release(ip);
          next(new Error(resolved.code));
          return;
        }
        const value = resolved.value as {
          sessionId: string;
          nickname: string | null;
          token?: string;
        };
        socket.data.sessionId = value.sessionId;
        socket.data.nickname = value.nickname;
        socket.data.ip = ip;
        if (value.token) socket.data.newToken = value.token;
        next();
      })
      .catch((err: unknown) => {
        connections.release(ip);
        deps.log.error('handshake failed', errorFields(err));
        next(new Error('SERVER_BUSY'));
      });
  });

  io.on('connection', (socket) => {
    const sessionId = socket.data.sessionId;
    socket.emit('session:ready', {
      playerId: sessionId,
      nickname: socket.data.nickname,
      ...(socket.data.newToken ? { token: socket.data.newToken } : {}),
      games: deps.registry.infos(),
      serverNow: Date.now(),
    });
    // Attach first (restores the player's room and match), then accept requests.
    const attached = hostCall(cluster, 'attach', { sessionId, socketId: socket.id }).then(
      (res) => {
        if (!res.ok) socket.disconnect(true);
      },
      () => {
        socket.disconnect(true);
      },
    );
    bindEvents(socket, sessionId, deps, attached);
    socket.on('disconnect', () => {
      connections.release(socket.data.ip);
      const done = attached
        .then(() => hostCall(cluster, 'detach', { sessionId, socketId: socket.id }))
        .catch(() => undefined)
        .finally(() => {
          departing.delete(done);
          cluster.socketsChanged();
        });
      departing.add(done);
    });
  });

  return {
    settled: async () => {
      await Promise.allSettled([...departing]);
    },
  };
}

function bindEvents(
  socket: IoSocket,
  sessionId: string,
  deps: TransportDeps,
  attached: Promise<void>,
): void {
  // Coarse per-socket flood guard: excess packets are dropped before any handler runs.
  socket.use((_packet, next) => {
    if (deps.limiter.take(sessionId, 'socket')) next();
  });

  const bind = (name: C2SEventName, bucket: BucketName | null): void => {
    (socket as unknown as { on(event: string, fn: (...args: unknown[]) => void): void }).on(
      name,
      (payload: unknown, ack: unknown) => {
        if (typeof ack !== 'function') return; // every event must be acknowledged
        const reply = ack as (response: Ack<C2SResults[typeof name]>) => void;
        if (bucket && !deps.limiter.take(sessionId, bucket)) {
          reply({
            ok: false,
            code: 'RATE_LIMITED',
            retryAfterMs: deps.limiter.retryAfterMs(sessionId, bucket),
          });
          return;
        }
        const parsed = C2S[name].safeParse(payload);
        if (!parsed.success) {
          reply({ ok: false, code: 'INVALID_PAYLOAD' });
          return;
        }
        attached
          .then(() =>
            // The address rides along (memory only) for the host's per-IP code-guess budget.
            hostCall(deps.cluster, 'event', {
              sessionId,
              name,
              payload: parsed.data,
              ip: socket.data.ip,
            }),
          )
          .then((result) => {
            if (result.ok) reply({ ok: true, ...result.value } as Ack<C2SResults[typeof name]>);
            else
              reply({
                ok: false,
                code: result.code,
                ...(result.retryAfterMs ? { retryAfterMs: result.retryAfterMs } : {}),
              });
          })
          .catch((err: unknown) => {
            deps.log.error('handler failed', { event: name, ...errorFields(err) });
            reply({ ok: false, code: 'INTERNAL_ERROR' });
          });
      },
    );
  };

  for (const [name, bucket] of Object.entries(EVENT_BUCKETS)) {
    bind(name as C2SEventName, bucket);
  }

  // Answered here: clock sync needs no host.
  (socket as unknown as { on(event: string, fn: (...args: unknown[]) => void): void }).on(
    'time:ping',
    (payload: unknown, ack: unknown) => {
      if (typeof ack !== 'function') return;
      const reply = ack as (r: unknown) => void;
      if (!deps.limiter.take(sessionId, 'ping')) {
        reply({
          ok: false,
          code: 'RATE_LIMITED',
          retryAfterMs: deps.limiter.retryAfterMs(sessionId, 'ping'),
        });
        return;
      }
      const parsed = C2S['time:ping'].safeParse(payload);
      if (!parsed.success) reply({ ok: false, code: 'INVALID_PAYLOAD' });
      else reply({ ok: true, clientTs: parsed.data.clientTs, serverNow: Date.now() });
    },
  );
}
