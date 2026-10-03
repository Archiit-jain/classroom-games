import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AnyGameModule } from '@cg/game-sdk';
import { fixtureGame } from '@cg/game-sdk/fixture';
import { createBusinessGame } from '@cg/game-business/server';
import { createDotsAndBoxesGame } from '@cg/game-dots-and-boxes/server';
import { createDrawAndGuessGame } from '@cg/game-draw-and-guess/server';
import { createNpatGame } from '@cg/game-name-place-animal-thing/server';
import { createPenFightGame } from '@cg/game-pen-fight/server';
import { createRmcsGame } from '@cg/game-rmcs/server';
import { createSixteenParchiGame } from '@cg/game-sixteen-parchi/server';
import { createModerator, type Moderator } from '@cg/moderation';
import { NICKNAME_MAX_LENGTH, NICKNAME_MIN_LENGTH } from '@cg/protocol';
import { Server } from 'socket.io';
import type { ChatService } from './chat/ChatService';
import { Cluster, type ClusterOptions } from './cluster/Cluster';
import { HostServices } from './cluster/HostServices';
import { RedisSharedStore } from './cluster/RedisSharedStore';
import { MemorySharedStore, type SharedStore } from './cluster/SharedStore';
import type { ServerConfig } from './config';
import { createLogger, type Logger } from './log';
import type { ReportService, ReportSink } from './reports/ReportService';
import type { RoomManager } from './rooms/RoomManager';
import { GameRegistry } from './runtime/GameRegistry';
import type { SessionManager } from './session/SessionManager';
import { attachTransport } from './transport/attachTransport';
import { isOriginAllowed } from './transport/origins';
import type { IoServer } from './transport/types';
import { RateLimiter } from './util/RateLimiter';
import type { TimerService } from './util/TimerService';

export interface GameServerOptions {
  config: ServerConfig;
  /** Games to register. Defaults to `defaultGames(config, moderator)`. */
  games?: AnyGameModule[];
  moderator?: Moderator;
  reportSink?: ReportSink;
  log?: Logger;
  /**
   * Shared state. Defaults to Redis when `config.redisUrl` is set, otherwise an
   * in-process store. Tests pass one MemorySharedStore to several servers to
   * simulate a multi-instance deployment.
   */
  store?: SharedStore;
  /** Cluster timing (tests use short leases). */
  cluster?: Pick<ClusterOptions, 'instanceId' | 'leaseTtlMs' | 'renewEveryMs' | 'callTimeoutMs'>;
}

export interface HostServicesView {
  registry: GameRegistry;
  sessions: SessionManager;
  rooms: RoomManager;
  chat: ChatService;
  reports: ReportService;
  reportSink: ReportSink;
  timers: TimerService;
}

export interface GameServer {
  config: ServerConfig;
  httpServer: HttpServer;
  io: IoServer;
  cluster: Cluster;
  /** The authoritative services — only on the instance that currently hosts the rooms. */
  readonly services: HostServicesView;
  /** Joins the cluster (and becomes host if nobody is). `listen` calls it. */
  start(): Promise<void>;
  /** Starts listening; resolves with the bound port. */
  listen(port?: number): Promise<number>;
  /** Warns connected players, waits `shutdownGraceMs`, then closes. */
  shutdown(): Promise<void>;
  /** Closes immediately (handing the host role and state over first). */
  close(): Promise<void>;
}

/** Product games (in menu order), plus the fixture game outside production. */
export function defaultGames(config: ServerConfig, moderator?: Moderator): AnyGameModule[] {
  return [
    createRmcsGame({ timeScale: config.gameTimeScale }),
    createSixteenParchiGame({ timeScale: config.gameTimeScale }),
    createDrawAndGuessGame({ timeScale: config.gameTimeScale }),
    createPenFightGame({ timeScale: config.gameTimeScale }),
    createDotsAndBoxesGame({ timeScale: config.gameTimeScale }),
    createNpatGame({
      timeScale: config.gameTimeScale,
      // Answers go through the same moderator as chat (censored = invalid).
      ...(moderator ? { moderate: (text: string) => moderator.moderate(text) } : {}),
    }),
    createBusinessGame({
      timeScale: config.gameTimeScale,
      // e2e only (never in production): everyone walks 4 spaces and rent can't be paid.
      ...(config.businessTestScenario === 'insolvency'
        ? { dice: () => [2, 2] as [number, number], economy: { startCash: 1000, rentShare: 10 } }
        : {}),
    }),
    ...(config.enableFixtureGame ? [fixtureGame] : []),
  ];
}

/**
 * One server instance (ADR-023): a Socket.IO gateway for the players connected
 * here, plus — while it holds the cluster's host lease — the authoritative
 * services for every room. With one process (development) it is always the host.
 */
export function createGameServer(options: GameServerOptions): GameServer {
  const { config } = options;
  const log = options.log ?? createLogger(config.logLevel);
  let shuttingDown = false;

  const moderator =
    options.moderator ??
    createModerator({
      nickname: { minLength: NICKNAME_MIN_LENGTH, maxLength: NICKNAME_MAX_LENGTH },
    });
  const registry = new GameRegistry();
  for (const game of options.games ?? defaultGames(config, moderator)) registry.register(game);
  const ownsStore = !options.store;
  const store: SharedStore =
    options.store ??
    (config.redisUrl ? new RedisSharedStore(config.redisUrl) : new MemorySharedStore());

  const httpServer = createServer((req, res) => {
    if (req.method === 'GET' && req.url?.split('?')[0]?.endsWith('/healthz')) {
      res.writeHead(shuttingDown ? 503 : 200, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify({ status: shuttingDown ? 'shutting_down' : 'ok' }));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  });

  const io: IoServer = new Server(httpServer, {
    path: config.socketPath,
    maxHttpBufferSize: config.limits.maxMessageBytes,
    cors: {
      origin: (origin, callback) =>
        callback(null, !origin || isOriginAllowed(origin, config.allowedOrigins)),
      methods: ['GET', 'POST'],
    },
    // Browsers always send Origin; reject unknown sites. Non-browser clients send none.
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      callback(null, !origin || isOriginAllowed(origin, config.allowedOrigins));
    },
  });

  let host: HostServices | null = null;
  const cluster: Cluster = new Cluster({
    store,
    log,
    releaseWhenIdle: config.releaseHostWhenIdle,
    ...options.cluster,
    localSocketCount: () => io.sockets.sockets.size,
    becomeHost: async (fence) => {
      host = await HostServices.start({
        config,
        log,
        registry,
        moderator,
        store,
        cluster,
        fence,
        hasLocalSocket: (socketId) => io.sockets.sockets.has(socketId),
        ...(options.reportSink ? { reportSink: options.reportSink } : {}),
      });
    },
    stopHosting: () => {
      host?.dispose();
      host = null;
    },
    flush: async () => {
      await host?.flush();
    },
    handleCall: (call) => (host ? host.handle(call) : { ok: false, code: 'SERVER_BUSY' }),
    deliver: (message) => {
      if (message.t === 'deliver') {
        (io.to(message.socketIds) as unknown as { emit(e: string, p: unknown): void }).emit(
          message.event,
          message.payload,
        );
        return;
      }
      const old = io.sockets.sockets.get(message.socketId);
      old?.emit('session:displaced');
      old?.disconnect(true);
    },
  });

  // Per-instance protections (the host applies chat/report limits itself).
  const limiter = new RateLimiter(config.rateLimits);
  const transport = attachTransport(io, {
    config,
    cluster,
    registry,
    limiter,
    log,
    isShuttingDown: () => shuttingDown,
  });
  const sweeper = setInterval(() => limiter.sweep(), config.timing.sweepIntervalMs);
  sweeper.unref();

  let started: Promise<void> | null = null;
  const start = () => (started ??= cluster.start());

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    clearInterval(sweeper);
    // Disconnect our players first (the host hears about it), then leave the cluster:
    // a host instance hands its role and state over as it goes.
    await new Promise<void>((resolve) => {
      io.close(() => resolve());
    });
    await transport.settled();
    await cluster.stop();
    if (ownsStore) await store.close();
  };

  return {
    config,
    httpServer,
    io,
    cluster,
    get services(): HostServicesView {
      if (!host) throw new Error('This instance does not host the rooms right now');
      const h: HostServices = host;
      return {
        registry,
        sessions: h.sessions,
        rooms: h.rooms,
        chat: h.chat,
        reports: h.reports,
        reportSink: h.reportSink,
        timers: h.timers,
      };
    },
    start,
    listen: async (port = config.port) => {
      await start();
      return new Promise<number>((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, config.host, () => {
          httpServer.off('error', reject);
          resolve((httpServer.address() as AddressInfo).port);
        });
      });
    },
    shutdown: async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      log.info('shutting down', { graceMs: config.timing.shutdownGraceMs });
      io.emit('system:notice', { code: 'SERVER_RESTARTING' });
      await new Promise((r) => setTimeout(r, config.timing.shutdownGraceMs));
      await close();
    },
    close,
  };
}
