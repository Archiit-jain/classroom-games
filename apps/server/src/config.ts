import { CHAT_MAX_LENGTH, MAX_MESSAGE_BYTES } from '@cg/protocol';
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
  allowedOrigins: string[];
  trustProxy: boolean;
  enableFixtureGame: boolean;
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
    report: BucketSpec;
    ping: BucketSpec;
  };
}

export const DEFAULT_CONFIG: ServerConfig = {
  port: 3001,
  host: '0.0.0.0',
  // Development defaults. Production MUST set ALLOWED_ORIGINS (unknown sites are refused).
  // "*.localhost" lets you open several separate sessions locally (p1.localhost, p2.localhost…).
  allowedOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://*.localhost:5173'],
  trustProxy: false,
  enableFixtureGame: true,
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
    report: { burst: 3, perSecond: 5 / 60 },
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
  PORT: z.coerce.number().int().min(0).max(65_535).optional(),
  HOST: z.string().min(1).optional(),
  ALLOWED_ORIGINS: z.string().optional(),
  TRUST_PROXY: bool.optional(),
  ENABLE_FIXTURE_GAME: bool.optional(),
  LOG_LEVEL: z.enum(['silent', 'error', 'warn', 'info', 'debug']).optional(),
});

/** Reads configuration from environment variables, then applies explicit overrides. */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  overrides?: ConfigOverrides,
): ServerConfig {
  const parsed = EnvSchema.parse(env);
  const isProduction = parsed.NODE_ENV === 'production';
  const fromEnv: ConfigOverrides = {
    port: parsed.PORT,
    host: parsed.HOST,
    allowedOrigins: parsed.ALLOWED_ORIGINS?.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    trustProxy: parsed.TRUST_PROXY,
    // The fixture game is a test/dev tool and is never registered in production.
    enableFixtureGame: isProduction ? false : (parsed.ENABLE_FIXTURE_GAME ?? true),
    logLevel: parsed.LOG_LEVEL,
  };
  return merge(merge(DEFAULT_CONFIG, fromEnv), overrides);
}
