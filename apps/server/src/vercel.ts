/**
 * Vercel Function entry (ADR-023): the same game server as `index.ts`, but
 * exported instead of listening — Vercel routes HTTP and WebSocket upgrade
 * requests for `/api/socket/*` to it. Each Function instance is one cluster
 * member; the rooms' state and messages are shared through Redis (REDIS_URL).
 */
import type { IncomingMessage } from 'node:http';
import { createGameServer } from './app';
import { loadConfig } from './config';
import { createLogger } from './log';
import { normalizeSocketUrl } from './transport/socketUrl';

const config = loadConfig(process.env);
const log = createLogger(config.logLevel);
const server = createGameServer({ config, log });

const rewrite = (req: IncomingMessage) => {
  if (req.url) req.url = normalizeSocketUrl(req.url, config.socketPath);
};
server.httpServer.prependListener('request', rewrite);
server.httpServer.prependListener('upgrade', rewrite);

await server.start();
log.info('function instance ready', {
  instanceId: server.cluster.instanceId,
  // Where this function actually runs (the request log's region is only the entry point).
  region: process.env.VERCEL_REGION ?? null,
});

export default server.httpServer;
