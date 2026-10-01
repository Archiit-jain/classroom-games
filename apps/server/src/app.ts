import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AnyGameModule } from '@cg/game-sdk';
import { fixtureGame } from '@cg/game-sdk/fixture';
import { createRmcsGame } from '@cg/game-rmcs/server';
import { createModerator, type Moderator } from '@cg/moderation';
import { NICKNAME_MAX_LENGTH, NICKNAME_MIN_LENGTH } from '@cg/protocol';
import { Server } from 'socket.io';
import { BotManager } from './bots/BotManager';
import { ChatService } from './chat/ChatService';
import type { ServerConfig } from './config';
import { createLogger, type Logger } from './log';
import { InMemoryFlagStore, ReportService, type ReportSink } from './reports/ReportService';
import { InMemoryRoomStore } from './rooms/RoomStore';
import { RoomManager } from './rooms/RoomManager';
import { GameRegistry } from './runtime/GameRegistry';
import { SessionManager } from './session/SessionManager';
import { attachTransport } from './transport/attachTransport';
import { isOriginAllowed } from './transport/origins';
import { createSocketNotifier } from './transport/socketNotifier';
import type { IoServer } from './transport/types';
import { RateLimiter } from './util/RateLimiter';
import { TimerService } from './util/TimerService';

export interface GameServerOptions {
  config: ServerConfig;
  /** Games to register. Defaults to `defaultGames(config)`. */
  games?: AnyGameModule[];
  moderator?: Moderator;
  reportSink?: ReportSink;
  log?: Logger;
}

export interface GameServer {
  config: ServerConfig;
  httpServer: HttpServer;
  io: IoServer;
  services: {
    registry: GameRegistry;
    sessions: SessionManager;
    rooms: RoomManager;
    chat: ChatService;
    reports: ReportService;
    reportSink: ReportSink;
    timers: TimerService;
  };
  /** Starts listening; resolves with the bound port. */
  listen(port?: number): Promise<number>;
  /** Warns connected players, waits `shutdownGraceMs`, then closes. */
  shutdown(): Promise<void>;
  /** Closes immediately. */
  close(): Promise<void>;
}

/** Product games (in menu order), plus the fixture game outside production. */
export function defaultGames(config: ServerConfig): AnyGameModule[] {
  return [
    createRmcsGame({ timeScale: config.gameTimeScale }),
    ...(config.enableFixtureGame ? [fixtureGame] : []),
  ];
}

export function createGameServer(options: GameServerOptions): GameServer {
  const { config } = options;
  const log = options.log ?? createLogger(config.logLevel);
  let shuttingDown = false;

  const registry = new GameRegistry();
  for (const game of options.games ?? defaultGames(config)) registry.register(game);

  const moderator =
    options.moderator ??
    createModerator({
      nickname: { minLength: NICKNAME_MIN_LENGTH, maxLength: NICKNAME_MAX_LENGTH },
    });
  const timers = new TimerService(log);
  const limiter = new RateLimiter({
    ...config.rateLimits,
    chat: { burst: config.chat.burst, perSecond: config.chat.perSecond },
  });
  const sessions = new SessionManager(config, moderator);

  const httpServer = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
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

  const notifier = createSocketNotifier(io, sessions);
  const bots = new BotManager({ timers, log });
  const rooms = new RoomManager({
    config,
    store: new InMemoryRoomStore(),
    registry,
    sessions,
    moderator,
    timers,
    bots,
    notifier,
    log,
  });
  const chat = new ChatService({ config, moderator, rooms, notifier, limiter });
  const reportSink =
    options.reportSink ?? new InMemoryFlagStore(config.reports.maxFlags, config.reports.flagTtlMs);
  const reports = new ReportService({ sink: reportSink, rooms, limiter, log });

  attachTransport(io, {
    config,
    sessions,
    rooms,
    chat,
    reports,
    registry,
    limiter,
    log,
    isShuttingDown: () => shuttingDown,
  });

  const sweeper = setInterval(() => {
    rooms.sweep();
    sessions.sweep();
    limiter.sweep();
    chat.sweep();
  }, config.timing.sweepIntervalMs);
  sweeper.unref();

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    clearInterval(sweeper);
    rooms.dispose();
    timers.dispose();
    await new Promise<void>((resolve) => {
      io.close(() => resolve());
    });
  };

  return {
    config,
    httpServer,
    io,
    services: { registry, sessions, rooms, chat, reports, reportSink, timers },
    listen: (port = config.port) =>
      new Promise<number>((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, config.host, () => {
          httpServer.off('error', reject);
          resolve((httpServer.address() as AddressInfo).port);
        });
      }),
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
