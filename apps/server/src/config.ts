import { CHAT_MAX_LENGTH, MAX_MESSAGE_BYTES, REACTION_INTERVAL_MS } from '@cg/protocol';
import { z } from 'zod';
import type { LogLevel } from './log';

export interface BucketSpec {
  burst: number;
  perSecond: number;
}

/** All server tunables (spec Appendix A). Override per environment or per test. */
export interface ServerConfig {
  port: number;
  host: string;
  /** NODE_ENV=production: no development defaults, shared state required. */
  production: boolean;
  allowedOrigins: string[];
  /**
   * Shared state for multi-instance deployments (Redis URL). Unset = in this
   * process only (local development and tests). Required in production.
   */
  redisUrl: string | null;
  /** The Socket.IO path this server answers on (the client must use the same). */
  socketPath: string;
  /**
   * Hand the room-host role over when this instance holds no sockets — for
   * platforms that pause idle instances (Vercel). Off for a single process.
   */
  releaseHostWhenIdle: boolean;
  trustProxy: boolean;
  enableFixtureGame: boolean;
  /**
   * Test-only Business scenario (e2e): `scripted` makes every roll 6 + 6 (spaces 12, 24,
   * START, 12, …) with small start cash and steep rent, so one player goes insolvent and
   * the other comes back to build a hotel. Never set in production.
   */
  businessTestScenario: 'scripted' | null;
  /** Multiplies game phase timers (dev/e2e speed-ups). Always 1 in production. */
  gameTimeScale: number;
  logLevel: LogLevel;
  timing: {
    reconnectGraceMs: number;
    startingCountdownMs: number;
    roomIdleCloseMs: number;
    sessionIdleExpiryMs: number;
    anonymousSessionExpiryMs: number;
    sweepIntervalMs: number;
    shutdownGraceMs: number;
  };
  chat: {
    maxLength: number;
    burst: number;
    perSecond: number;
    cooldownMs: number;
    bufferSize: number;
  };
  reports: { maxFlags: number; flagTtlMs: number };
  limits: {
    maxMessageBytes: number;
    maxRooms: number;
    maxSessions: number;
    maxConnectionsPerIp: number;
    newSessionsPerIpPerMinute: number;
  };
  rateLimits: {
    socket: BucketSpec;
    nickname: BucketSpec;
    roomCreate: BucketSpec;
    roomJoin: BucketSpec;
    roomAdmin: BucketSpec;
    matchAction: BucketSpec;
    stream: BucketSpec;
    report: BucketSpec;
    reaction: BucketSpec;
    ping: BucketSpec;
  };
}

export const DEFAULT_CONFIG: ServerConfig = {
  port: 3001,
  host: '0.0.0.0',
  production: false,
  redisUrl: null,
  socketPath: '/socket.io',
  releaseHostWhenIdle: false,
  // Development defaults. Production MUST set ALLOWED_ORIGINS (unknown sites are refused).
  // "*.localhost" lets you open several separate sessions locally (p1.localhost, p2.localhost…).
  allowedOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://*.localhost:5173'],
  trustProxy: false,
  enableFixtureGame: true,
  businessTestScenario: null,
  gameTimeScale: 1,
  logLevel: 'info',
  timing: {
    reconnectGraceMs: 30_000,
    startingCountdownMs: 3_000,
    roomIdleCloseMs: 5 * 60_000,
    sessionIdleExpiryMs: 24 * 60 * 60_000,
    anonymousSessionExpiryMs: 10 * 60_000,
    sweepIntervalMs: 30_000,
    shutdownGraceMs: 5_000,
  },
  chat: {
    maxLength: CHAT_MAX_LENGTH,
    burst: 5,
    perSecond: 1,
    cooldownMs: 30_000,
    bufferSize: 50,
  },
  reports: { maxFlags: 1_000, flagTtlMs: 24 * 60 * 60_000 },
  limits: {
    maxMessageBytes: MAX_MESSAGE_BYTES,
    maxRooms: 500,
    maxSessions: 20_000,
    maxConnectionsPerIp: 60,
    newSessionsPerIpPerMinute: 30,
  },
  rateLimits: {
    socket: { burst: 40, perSecond: 20 },
    nickname: { burst: 5, perSecond: 0.2 },
    roomCreate: { burst: 3, perSecond: 5 / 60 },
    roomJoin: { burst: 10, perSecond: 20 / 60 },
    roomAdmin: { burst: 10, perSecond: 2 },
    matchAction: { burst: 20, perSecond: 10 },
    // Streamed games (drawing strokes): about 20 chunks per second (spec §12).
    stream: { burst: 30, perSecond: 20 },
    report: { burst: 3, perSecond: 5 / 60 },
    // Quick reactions: one per 1.5 s (spec Appendix A).
    reaction: { burst: 1, perSecond: 1000 / REACTION_INTERVAL_MS },
    ping: { burst: 10, perSecond: 2 },
  },
};

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K];
};
export type ConfigOverrides = DeepPartial<ServerConfig>;

export function mergeConfig(base: ServerConfig, patch: ConfigOverrides | undefined): ServerConfig {
  return merge(base, patch);
}

function merge<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (!patch) return base;
  const out = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const current = out[key];
    out[key] =
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      current &&
      typeof current === 'object'
        ? merge(current, value as DeepPartial<typeof current>)
        : value;
  }
  return out as T;
}

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const EnvSchema = z.object({
  NODE_ENV: z.string().optional(),
  REDIS_URL: z.string().min(1).optional(),
  SOCKET_PATH: z.string().startsWith('/').optional(),
  RELEASE_HOST_WHEN_IDLE: bool.optional(),
  // Set by Vercel at runtime (system environment variables).
  VERCEL: z.string().optional(),
  VERCEL_URL: z.string().optional(),
  VERCEL_BRANCH_URL: z.string().optional(),
  VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
  PORT: z.coerce.number().int().min(0).max(65_535).optional(),
  HOST: z.string().min(1).optional(),
  ALLOWED_ORIGINS: z.string().optional(),
  TRUST_PROXY: bool.optional(),
  ENABLE_FIXTURE_GAME: bool.optional(),
  BUSINESS_TEST_SCENARIO: z.enum(['scripted']).optional(),
  GAME_TIME_SCALE: z.coerce.number().min(0.05).max(10).optional(),
  LOG_LEVEL: z.enum(['silent', 'error', 'warn', 'info', 'debug']).optional(),
});

/** A configuration that must not run (e.g. production without shared state). */
export class ConfigError extends Error {}

const list = (value: string | undefined) =>
  value
    ?.split(',')
    .map((o) => o.trim())
    .filter(Boolean);

/** The deployment's own HTTPS origins on Vercel (system environment variables). */
function vercelOrigins(env: z.infer<typeof EnvSchema>): string[] {
  return [env.VERCEL_PROJECT_PRODUCTION_URL, env.VERCEL_BRANCH_URL, env.VERCEL_URL]
    .filter((host): host is string => !!host)
    .map((host) => (host.startsWith('http') ? host : `https://${host}`));
}

/**
 * Reads configuration from environment variables, then applies explicit overrides.
 * Production (NODE_ENV=production) never falls back to development defaults: the
 * allowed origins come from ALLOWED_ORIGINS or the Vercel deployment's own domains,
 * and shared state (REDIS_URL) is required — otherwise this throws.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  overrides?: ConfigOverrides,
): ServerConfig {
  const parsed = EnvSchema.parse(env);
  const isProduction = parsed.NODE_ENV === 'production';
  const onVercel = parsed.VERCEL === '1';
  const origins = list(parsed.ALLOWED_ORIGINS);
  const fromEnv: ConfigOverrides = {
    port: parsed.PORT,
    host: parsed.HOST,
    production: isProduction,
    allowedOrigins: isProduction
      ? [...new Set([...(origins ?? []), ...vercelOrigins(parsed)])]
      : origins,
    redisUrl: parsed.REDIS_URL,
    socketPath: parsed.SOCKET_PATH,
    releaseHostWhenIdle: parsed.RELEASE_HOST_WHEN_IDLE ?? onVercel,
    // Vercel's edge sets X-Forwarded-For to the real client address.
    trustProxy: parsed.TRUST_PROXY ?? (onVercel ? true : undefined),
    // The fixture game is a test/dev tool and is never registered in production.
    enableFixtureGame: isProduction ? false : (parsed.ENABLE_FIXTURE_GAME ?? true),
    businessTestScenario: isProduction ? null : (parsed.BUSINESS_TEST_SCENARIO ?? null),
    gameTimeScale: isProduction ? 1 : parsed.GAME_TIME_SCALE,
    logLevel: parsed.LOG_LEVEL,
  };
  const config = merge(merge(DEFAULT_CONFIG, fromEnv), overrides);
  if (config.production) {
    if (config.allowedOrigins.length === 0) {
      throw new ConfigError('ALLOWED_ORIGINS is required in production (or deploy on Vercel)');
    }
    if (config.allowedOrigins.some((o) => /localhost|127\.0\.0\.1/u.test(o))) {
      throw new ConfigError('Production must not allow localhost origins');
    }
    if (!config.redisUrl) {
      throw new ConfigError(
        'REDIS_URL is required in production: players on different instances share rooms through it',
      );
    }
  }
  return config;
}
