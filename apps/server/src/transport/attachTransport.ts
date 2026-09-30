import {
  ok,
  type Ack,
  type C2SEventName,
  type C2SResults,
  type HandshakeAuth,
  type Result,
} from '@cg/protocol';
import { C2S } from '@cg/protocol/schemas';
import type { z } from 'zod';
import type { ChatService } from '../chat/ChatService';
import type { ServerConfig } from '../config';
import { errorFields, type Logger } from '../log';
import type { ReportService } from '../reports/ReportService';
import type { RoomManager } from '../rooms/RoomManager';
import type { GameRegistry } from '../runtime/GameRegistry';
import type { Session, SessionManager } from '../session/SessionManager';
import type { RateLimiter } from '../util/RateLimiter';
import type { IoServer, IoSocket } from './types';

export interface TransportDeps {
  config: ServerConfig;
  sessions: SessionManager;
  rooms: RoomManager;
  chat: ChatService;
  reports: ReportService;
  registry: GameRegistry;
  limiter: RateLimiter;
  log: Logger;
  isShuttingDown: () => boolean;
}

type BucketName = keyof ServerConfig['rateLimits'];

/** Concurrent sockets per IP. Generous on purpose: a whole classroom can share one IP. */
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

export function attachTransport(io: IoServer, deps: TransportDeps): void {
  const connections = new ConnectionCounter();

  io.use((socket, next) => {
    if (deps.isShuttingDown()) return next(new Error('SERVER_BUSY'));
    const ip = clientIp(socket, deps.config.trustProxy);
    if (!connections.tryAcquire(ip, deps.config.limits.maxConnectionsPerIp)) {
      return next(new Error('RATE_LIMITED'));
    }
    const auth = (socket.handshake.auth ?? {}) as HandshakeAuth;
    const resolved = deps.sessions.resolve(auth.token, ip);
    if (!resolved.ok) {
      connections.release(ip);
      return next(new Error(resolved.code));
    }
    socket.data.sessionId = resolved.value.session.id;
    socket.data.ip = ip;
    if (resolved.value.token) socket.data.newToken = resolved.value.token;
    next();
  });

  io.on('connection', (socket) => {
    const session = deps.sessions.get(socket.data.sessionId);
    if (!session) {
      connections.release(socket.data.ip);
      socket.disconnect(true);
      return;
    }
    onConnection(io, socket, session, deps);
    socket.on('disconnect', () => {
      connections.release(socket.data.ip);
      if (deps.sessions.detachSocket(session, socket.id)) deps.rooms.onDisconnected(session);
    });
  });
}

function onConnection(io: IoServer, socket: IoSocket, session: Session, deps: TransportDeps): void {
  // One active socket per session: a newer tab takes over from an older one.
  const previous = deps.sessions.attachSocket(session, socket.id);
  if (previous) {
    const old = io.sockets.sockets.get(previous);
    old?.emit('session:displaced');
    old?.disconnect(true);
  }

  socket.emit('session:ready', {
    playerId: session.id,
    nickname: session.nickname,
    ...(socket.data.newToken ? { token: socket.data.newToken } : {}),
    games: deps.registry.infos(),
    serverNow: Date.now(),
  });
  deps.rooms.onConnected(session);

  // Coarse per-socket flood guard: excess packets are dropped before any handler runs.
  socket.use((_packet, next) => {
    if (deps.limiter.take(session.id, 'socket')) next();
  });

  const bind = <K extends C2SEventName>(
    name: K,
    bucket: BucketName | null,
    handler: (payload: z.output<(typeof C2S)[K]>) => Result<C2SResults[K]>,
  ): void => {
    (socket as unknown as { on(event: string, fn: (...args: unknown[]) => void): void }).on(
      name,
      (payload: unknown, ack: unknown) => {
        if (typeof ack !== 'function') return; // every event must be acknowledged
        const reply = ack as (response: Ack<C2SResults[K]>) => void;
        try {
          if (bucket && !deps.limiter.take(session.id, bucket)) {
            reply({
              ok: false,
              code: 'RATE_LIMITED',
              retryAfterMs: deps.limiter.retryAfterMs(session.id, bucket),
            });
            return;
          }
          const parsed = C2S[name].safeParse(payload);
          if (!parsed.success) {
            reply({ ok: false, code: 'INVALID_PAYLOAD' });
            return;
          }
          const result = handler(parsed.data as z.output<(typeof C2S)[K]>);
          if (result.ok) reply({ ok: true, ...result.value } as Ack<C2SResults[K]>);
          else
            reply({
              ok: false,
              code: result.code,
              ...(result.retryAfterMs ? { retryAfterMs: result.retryAfterMs } : {}),
            });
        } catch (err) {
          deps.log.error('handler failed', { event: name, ...errorFields(err) });
          reply({ ok: false, code: 'INTERNAL_ERROR' });
        }
      },
    );
  };

  const { rooms } = deps;
  bind('session:setNickname', 'nickname', (p) => deps.sessions.setNickname(session, p.nickname));
  bind('room:create', 'roomCreate', (p) => rooms.create(session, p.gameId));
  bind('room:join', 'roomJoin', (p) => rooms.join(session, p.code));
  bind('room:leave', 'roomAdmin', () => rooms.leave(session));
  bind('room:setGame', 'roomAdmin', (p) => rooms.setGame(session, p.gameId));
  bind('room:updateSettings', 'roomAdmin', (p) => rooms.updateSettings(session, p.settings));
  bind('room:addBot', 'roomAdmin', () => rooms.addBot(session));
  bind('room:removeBot', 'roomAdmin', (p) => rooms.removeBot(session, p.botId));
  bind('room:kick', 'roomAdmin', (p) => rooms.kick(session, p.playerId));
  bind('room:start', 'roomAdmin', () => rooms.start(session));
  bind('room:playAgain', 'roomAdmin', () => rooms.playAgain(session));
  bind('room:backToLobby', 'roomAdmin', () => rooms.backToLobby(session));
  bind('room:reclaimSeat', 'roomAdmin', () => rooms.reclaimSeat(session));
  bind('match:action', 'matchAction', (p) =>
    rooms.submitAction(session, p.matchId, p.version, p.action),
  );
  bind('match:resync', 'matchAction', (p) => rooms.resync(session, p.matchId));
  // Chat and reports apply their own limits (cooldowns, per-report budget).
  bind('chat:send', null, (p) => deps.chat.send(session, p.text));
  bind('report:submit', null, (p) => deps.reports.submit(session, p.playerId, p.reason));
  bind('time:ping', 'ping', (p) => ok({ clientTs: p.clientTs, serverNow: Date.now() }));
}
