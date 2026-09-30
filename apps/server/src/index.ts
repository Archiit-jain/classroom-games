import { createGameServer } from './app';
import { loadConfig } from './config';
import { createLogger, errorFields } from './log';

const config = loadConfig(process.env);
const log = createLogger(config.logLevel);
const server = createGameServer({ config, log });

const port = await server.listen();
log.info('server listening', {
  port,
  games: server.services.registry.infos().map((g) => g.id),
  allowedOrigins: config.allowedOrigins,
});

let stopping = false;
const stop = (signal: string) => {
  if (stopping) return;
  stopping = true;
  log.info('signal received', { signal });
  server
    .shutdown()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      log.error('shutdown failed', errorFields(err));
      process.exit(1);
    });
};
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
