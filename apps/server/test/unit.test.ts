import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toAll, toSeats, type AnyGameModule, type RuntimeRequest } from '@cg/game-sdk';
import { createFixtureGame, type FixtureEvent, type FixtureView } from '@cg/game-sdk/fixture';
import type { GameResults, MatchUpdate } from '@cg/protocol';
import { loadConfig } from '../src/config';
import { createLogger } from '../src/log';
import { InMemoryFlagStore } from '../src/reports/ReportService';
import { GameRegistry } from '../src/runtime/GameRegistry';
import { GameRuntime } from '../src/runtime/GameRuntime';
import { normalizeSocketUrl } from '../src/transport/socketUrl';
import { RateLimiter } from '../src/util/RateLimiter';
import { isOriginAllowed } from '../src/transport/origins';
import { TimerService } from '../src/util/TimerService';
import { simultaneousGame } from './simultaneousGame';

const log = createLogger('silent');

describe('RateLimiter', () => {
  it('allows a burst, then refills over time', () => {
    let now = 0;
    const limiter = new RateLimiter({ x: { burst: 3, perSecond: 1 } }, () => now);
    expect([1, 2, 3, 4].map(() => limiter.take('a', 'x'))).toEqual([true, true, true, false]);
    expect(limiter.retryAfterMs('a', 'x')).toBe(1000);
    expect(limiter.take('b', 'x')).toBe(true); // separate subject
    now = 1000;
    expect(limiter.take('a', 'x')).toBe(true);
    expect(limiter.take('a', 'x')).toBe(false);
  });

  it('supports buckets whose spec comes with the call, kept separate per name', () => {
    let now = 0;
    const limiter = new RateLimiter({ chat: { burst: 1, perSecond: 1 } }, () => now);
    const spec = { burst: 2, perSecond: 0.5 };
    expect([1, 2, 3].map(() => limiter.take('a', 'game', spec))).toEqual([true, true, false]);
    expect(limiter.retryAfterMs('a', 'game')).toBe(2000);
    expect(limiter.take('a', 'chat')).toBe(true); // the configured bucket is untouched
    now = 2000;
    expect(limiter.take('a', 'game', spec)).toBe(true);
    now = 60_000;
    limiter.sweep(); // refilled buckets are dropped, including call-defined ones
    expect([1, 2, 3].map(() => limiter.take('a', 'game', spec))).toEqual([true, true, false]);
  });

  it('rejects unknown buckets loudly', () => {
    expect(() => new RateLimiter({}).take('a', 'nope')).toThrow(/Unknown/);
  });
});

describe('loadConfig', () => {
  const PROD = {
    NODE_ENV: 'production',
    REDIS_URL: 'rediss://default:secret@example.upstash.io:6379',
    ALLOWED_ORIGINS: 'https://games.example',
  };

  it('never enables the fixture game or time scaling in production', () => {
    const c = loadConfig({ ...PROD, ENABLE_FIXTURE_GAME: 'true', GAME_TIME_SCALE: '0.25' });
    expect(c.enableFixtureGame).toBe(false);
    expect(c.gameTimeScale).toBe(1);
    expect(loadConfig({}).enableFixtureGame).toBe(true);
    expect(loadConfig({ ENABLE_FIXTURE_GAME: 'false' }).enableFixtureGame).toBe(false);
  });

  it('refuses to run in production without shared state or with development origins', () => {
    expect(() => loadConfig({ ...PROD, REDIS_URL: undefined })).toThrow(/REDIS_URL/);
    expect(() => loadConfig({ NODE_ENV: 'production', REDIS_URL: PROD.REDIS_URL })).toThrow(
      /ALLOWED_ORIGINS/,
    );
    expect(() => loadConfig({ ...PROD, ALLOWED_ORIGINS: 'http://localhost:5173' })).toThrow(
      /localhost/,
    );
    const c = loadConfig(PROD);
    expect(c.production).toBe(true);
    expect(c.allowedOrigins).toEqual(['https://games.example']);
    expect(c.allowedOrigins.some((o) => o.includes('localhost'))).toBe(false);
  });

  it('on Vercel allows only the deployment’s own HTTPS domains and hands the host role over when idle', () => {
    const c = loadConfig({
      NODE_ENV: 'production',
      REDIS_URL: PROD.REDIS_URL,
      VERCEL: '1',
      VERCEL_URL: 'classroom-games-abc123.vercel.app',
      VERCEL_PROJECT_PRODUCTION_URL: 'classroom-games.vercel.app',
      SOCKET_PATH: '/api/socket',
    });
    expect(c.allowedOrigins).toEqual([
      'https://classroom-games.vercel.app',
      'https://classroom-games-abc123.vercel.app',
    ]);
    expect(c.releaseHostWhenIdle).toBe(true);
    expect(c.trustProxy).toBe(true);
    expect(c.socketPath).toBe('/api/socket');
    // Local development: one process, in-memory state, the dev origins.
    const dev = loadConfig({});
    expect(dev.redisUrl).toBeNull();
    expect(dev.releaseHostWhenIdle).toBe(false);
    expect(dev.socketPath).toBe('/socket.io');
  });

  it('parses origins, port and proxy trust', () => {
    const c = loadConfig({
      ALLOWED_ORIGINS: 'https://a.example, https://b.example',
      PORT: '8080',
      TRUST_PROXY: 'true',
    });
    expect(c.allowedOrigins).toEqual(['https://a.example', 'https://b.example']);
    expect(c.port).toBe(8080);
    expect(c.trustProxy).toBe(true);
  });

  it('rejects invalid values', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow();
    expect(() => loadConfig({ TRUST_PROXY: 'yes' })).toThrow();
  });

  it('merges overrides deeply', () => {
    const c = loadConfig({}, { timing: { reconnectGraceMs: 5 } });
    expect(c.timing.reconnectGraceMs).toBe(5);
    expect(c.timing.startingCountdownMs).toBe(3000);
  });
});

describe('normalizeSocketUrl (Vercel Function route → Socket.IO path)', () => {
  it.each([
    ['/api/socket/socket.io/?EIO=4&transport=websocket', '/socket.io/?EIO=4&transport=websocket'],
    ['/socket.io/?EIO=4&transport=websocket', '/socket.io/?EIO=4&transport=websocket'],
    ['/api/socket?EIO=4&transport=websocket', '/socket.io/?EIO=4&transport=websocket'],
    ['/api/socket/?EIO=4&transport=websocket', '/socket.io/?EIO=4&transport=websocket'],
    ['/api/socket/healthz', '/api/socket/healthz'],
    ['/other', '/other'],
  ])('%s → %s', (url, expected) => {
    expect(normalizeSocketUrl(url, '/socket.io')).toBe(expected);
  });
});

describe('isOriginAllowed', () => {
  const allowed = ['https://games.example', 'http://*.localhost:5173'];
  it.each([
    ['https://games.example', true],
    ['http://p2.localhost:5173', true],
    ['http://localhost:5173', false], // wildcard needs exactly one label
    ['http://a.b.localhost:5173', false],
    ['http://evil.localhost:5174', false],
    ['https://p2.localhost:5173', false],
    ['https://games.example.evil.com', false],
    ['http://-bad.localhost:5173', false],
  ])('%s → %s', (origin, expected) => {
    expect(isOriginAllowed(origin, allowed)).toBe(expected);
  });
});

describe('InMemoryFlagStore', () => {
  it('is bounded and expires old flags', () => {
    let now = 0;
    const store = new InMemoryFlagStore(2, 1000, () => now);
    const flag = (at: number) => ({
      roomId: 'r',
      reportedId: 'p',
      reporterId: 'q',
      reason: 'CHAT' as const,
      at,
    });
    store.record(flag(0));
    store.record(flag(1));
    store.record(flag(2));
    expect(store.list().map((f) => f.at)).toEqual([1, 2]);
    now = 1500;
    expect(store.list().map((f) => f.at)).toEqual([]);
  });
});

describe('GameRegistry', () => {
  it('rejects inconsistent manifests', () => {
    const base = createFixtureGame();
    const reg = new GameRegistry().register(base);
    expect(() => reg.register(base)).toThrow(/already registered/);
    const bad = { ...base, manifest: { ...base.manifest, id: 'bad', players: { min: 3, max: 2 } } };
    expect(() => new GameRegistry().register(bad)).toThrow(/player range/);
    const streamed = {
      ...base,
      manifest: { ...base.manifest, id: 'streamy', sync: 'STREAMED' as const },
    };
    expect(() => new GameRegistry().register(streamed)).toThrow(/stream module/);
  });
});

describe('GameRuntime', () => {
  let timers: TimerService;
  beforeEach(() => {
    vi.useFakeTimers();
    timers = new TimerService(log);
  });
  afterEach(() => {
    timers.dispose();
    vi.useRealTimers();
  });

  function makeRuntime(game: AnyGameModule = createFixtureGame({ turnMs: 1000 }), seatCount = 3) {
    const updates: MatchUpdate<FixtureView, FixtureEvent>[][] = Array.from(
      { length: seatCount },
      () => [],
    );
    const requests: RuntimeRequest[] = [];
    const over: GameResults[] = [];
    const crashes: unknown[] = [];
    const runtime = new GameRuntime({
      matchId: 'm_test',
      game,
      settings: game.defaultSettings,
      seatCount,
      seed: 42,
      timers,
      log,
      hooks: {
        deliver: (seat, update) =>
          updates[seat]?.push(update as MatchUpdate<FixtureView, FixtureEvent>),
        onRequest: (r) => requests.push(r),
        onOver: (r) => over.push(r),
        afterTransition: () => undefined,
        onCrash: (e) => crashes.push(e),
        deliverStream: () => undefined,
      },
    });
    return { runtime, updates, requests, over, crashes };
  }

  it('passes the roster to setup (default: no bots) without changing other games', () => {
    const fixture = createFixtureGame({ turnMs: 1000 });
    const seen: unknown[] = [];
    const spy: AnyGameModule = {
      ...fixture,
      setup: (...args: Parameters<AnyGameModule['setup']>) => {
        seen.push(args[3]);
        return fixture.setup(args[0], args[1], args[2]);
      },
    };
    makeRuntime(spy).runtime.start();
    makeRuntime(spy).runtime.start({ bots: [2] });
    expect(seen).toEqual([{ bots: [] }, { bots: [2] }]);
    // The fixture ignores the roster: identical first views with or without it.
    const plain = makeRuntime();
    plain.runtime.start();
    const withRoster = makeRuntime();
    withRoster.runtime.start({ bots: [1, 2] });
    expect(withRoster.updates.map((u) => u[0]?.view)).toEqual(plain.updates.map((u) => u[0]?.view));
  });

  it('delivers one filtered update per seat, with private events only to their owner', () => {
    const { runtime, updates } = makeRuntime();
    runtime.start();
    expect(runtime.version).toBe(1);
    for (const seat of [0, 1, 2]) {
      const first = updates[seat]?.[0];
      expect(first?.you).toBe(seat);
      const dealt = first?.events.filter((e) => e.type === 'LUCKY_DEALT') ?? [];
      expect(dealt).toHaveLength(1);
      expect(dealt[0]).toEqual({ type: 'LUCKY_DEALT', lucky: first?.view.yourLucky });
      expect(first?.view.revealedLucky).toBeNull();
    }
  });

  it('validates actions: turn order, schema, versions', () => {
    const { runtime } = makeRuntime();
    runtime.start();
    expect(runtime.submitAction(1, 1, null, { type: 'ADD', amount: 1 })).toEqual({
      ok: false,
      code: 'NOT_YOUR_TURN',
    });
    expect(runtime.submitAction(0, 1, null, { type: 'ADD', amount: 9 })).toEqual({
      ok: false,
      code: 'INVALID_PAYLOAD',
    });
    expect(runtime.submitAction(0, 99, null, { type: 'ADD', amount: 1 })).toEqual({
      ok: false,
      code: 'STALE_VERSION',
    });
    expect(runtime.submitAction(0, 1, null, { type: 'ADD', amount: 2 })).toEqual({
      ok: true,
      value: { version: 2 },
    });
    // Acting on an older (but issued) version is fine: legality is checked against the current state.
    expect(runtime.submitAction(1, 1, null, { type: 'ADD', amount: 2 }).ok).toBe(true);
  });

  describe('action versions and action ids (ADR-014)', () => {
    const pick = (value: number) => ({ type: 'PICK', value });
    const state = (runtime: GameRuntime) =>
      (runtime as unknown as { state: { picks: Record<number, number | null>; round: number } })
        .state;

    it('rejects a duplicate action id and applies the action once', () => {
      const { runtime } = makeRuntime(simultaneousGame, 3);
      runtime.start();
      expect(runtime.submitAction(0, 1, 'dup-aaaaaaaa', pick(4))).toEqual({
        ok: true,
        value: { version: 2 },
      });
      expect(runtime.submitAction(0, 2, 'dup-aaaaaaaa', pick(4))).toEqual({
        ok: false,
        code: 'DUPLICATE_ACTION',
      });
      expect(runtime.version).toBe(2);
      expect(state(runtime).picks).toEqual({ 0: 4, 1: null, 2: null });
    });

    it('accepts valid actions from different players that were sent from slightly old versions', () => {
      const { runtime } = makeRuntime(simultaneousGame, 3);
      runtime.start();
      const seen = runtime.version; // all three players look at the same view
      expect(runtime.submitAction(0, seen, 'p0-aaaaaaaa', pick(1)).ok).toBe(true);
      expect(runtime.submitAction(1, seen, 'p1-aaaaaaaa', pick(2)).ok).toBe(true);
      expect(runtime.submitAction(2, seen, 'p2-aaaaaaaa', pick(3)).ok).toBe(true);
      expect(state(runtime).round).toBe(2);
      expect(runtime.version).toBe(seen + 3);
    });

    it('accepts a stale-but-valid action and still rejects a stale-and-illegal one', () => {
      const { runtime } = makeRuntime(simultaneousGame, 3);
      runtime.start();
      runtime.submitAction(0, 1, 'a0-aaaaaaaa', pick(1));
      runtime.submitAction(1, 2, 'a1-aaaaaaaa', pick(1));
      // Seat 2 acts on version 1 although the match is now at version 3: still legal.
      expect(runtime.submitAction(2, 1, 'a2-aaaaaaaa', pick(1)).ok).toBe(true);
      // Seat 0 acts on an old version in round 2 again: legal (new round) → accepted.
      expect(runtime.submitAction(0, 1, 'a3-aaaaaaaa', pick(2)).ok).toBe(true);
      // Seat 0 tries to pick twice in the same round from an old view: the rules refuse.
      expect(runtime.submitAction(0, 2, 'a4-aaaaaaaa', pick(3))).toEqual({
        ok: false,
        code: 'ILLEGAL_ACTION',
      });
    });

    it('rejects future/unknown versions without consuming the action id', () => {
      const { runtime } = makeRuntime(simultaneousGame, 2);
      runtime.start();
      expect(runtime.submitAction(0, runtime.version + 1, 'fut-aaaaaaaa', pick(1))).toEqual({
        ok: false,
        code: 'STALE_VERSION',
      });
      expect(runtime.submitAction(0, 10_000, 'fut-aaaaaaaa', pick(1))).toEqual({
        ok: false,
        code: 'STALE_VERSION',
      });
      expect(runtime.submitAction(0, runtime.version, 'fut-aaaaaaaa', pick(1)).ok).toBe(true);
    });

    it('refuses a replayed action id even when the replayed move would be legal again', () => {
      const { runtime } = makeRuntime(simultaneousGame, 2);
      runtime.start();
      expect(runtime.submitAction(0, 1, 'rep-aaaaaaaa', pick(5)).ok).toBe(true);
      expect(runtime.submitAction(1, 2, 'rep-bbbbbbbb', pick(6)).ok).toBe(true);
      expect(state(runtime).round).toBe(2); // seat 0 may legally pick again now
      expect(runtime.submitAction(0, runtime.version, 'rep-aaaaaaaa', pick(5))).toEqual({
        ok: false,
        code: 'DUPLICATE_ACTION',
      });
      expect(state(runtime).picks[0]).toBeNull();
      expect(runtime.submitAction(0, runtime.version, 'rep-cccccccc', pick(5)).ok).toBe(true);
    });

    it('treats an id as used even when its first attempt was illegal', () => {
      const { runtime } = makeRuntime(simultaneousGame, 2);
      runtime.start();
      runtime.submitAction(0, 1, 'ill-aaaaaaaa', pick(1));
      expect(runtime.submitAction(0, 2, 'ill-bbbbbbbb', pick(2))).toEqual({
        ok: false,
        code: 'ILLEGAL_ACTION',
      });
      runtime.submitAction(1, 2, 'ill-cccccccc', pick(3)); // round 2 begins
      expect(runtime.submitAction(0, runtime.version, 'ill-bbbbbbbb', pick(2))).toEqual({
        ok: false,
        code: 'DUPLICATE_ACTION',
      });
    });
  });

  it('runs engine timers and forwards idle requests', () => {
    const { runtime, updates, requests } = makeRuntime(
      createFixtureGame({ turnMs: 1000, idleAfterTimeouts: 1 }),
      2,
    );
    runtime.start();
    vi.advanceTimersByTime(1000);
    const last = updates[0]?.at(-1);
    expect(last?.view.lastMove).toEqual({ seat: 0, amount: 1, auto: true });
    expect(requests).toEqual([{ type: 'MARK_IDLE', seat: 0 }]);
  });

  it('reports the end of the match and stops its timers', () => {
    const { runtime, over } = makeRuntime(createFixtureGame({ turnMs: 1000 }), 2);
    runtime.start();
    let seat = 0;
    while (!runtime.isOver) {
      expect(runtime.submitAction(seat, runtime.version, null, { type: 'ADD', amount: 3 }).ok).toBe(
        true,
      );
      seat = 1 - seat;
    }
    expect(over).toHaveLength(1);
    expect(timers.size).toBe(0);
    expect(runtime.submitAction(0, runtime.version, null, { type: 'ADD', amount: 1 })).toEqual({
      ok: false,
      code: 'INVALID_PHASE',
    });
  });

  it('turns an engine exception into a crash callback instead of throwing', () => {
    const base = createFixtureGame();
    const broken: AnyGameModule = {
      ...base,
      applyAction: () => {
        throw new Error('boom');
      },
    };
    const { runtime, crashes } = makeRuntime(broken, 2);
    runtime.start();
    expect(runtime.submitAction(0, 1, null, { type: 'ADD', amount: 1 }).ok).toBe(true);
    expect(crashes).toHaveLength(1);
  });

  it('queues re-entrant transitions instead of interleaving them', () => {
    const order: string[] = [];
    const game = createFixtureGame({ turnMs: 1000, idleAfterTimeouts: 1 });
    const runtime: GameRuntime = new GameRuntime({
      matchId: 'm_re',
      game,
      settings: game.defaultSettings,
      seatCount: 2,
      seed: 1,
      timers,
      log,
      hooks: {
        deliver: (seat, u) => order.push(`deliver:${seat}:v${u.version}`),
        onRequest: () => {
          order.push('request');
          runtime.seatChanged(0, 'BOT_TOOK_OVER'); // re-entrant
          order.push('request-returned');
        },
        onOver: () => undefined,
        afterTransition: () => order.push('after'),
        onCrash: () => undefined,
        deliverStream: () => undefined,
      },
    });
    runtime.start();
    order.length = 0;
    vi.advanceTimersByTime(1000);
    expect(order).toEqual([
      'deliver:0:v2',
      'deliver:1:v2',
      'request',
      'request-returned',
      'after',
      'deliver:0:v3',
      'deliver:1:v3',
      'after',
    ]);
  });

  it('applies CONSUME decisions from a chat interceptor', () => {
    const base = createFixtureGame();
    const game: AnyGameModule = {
      ...base,
      chat: {
        intercept: (s, seat, text) =>
          text === 'secret'
            ? {
                kind: 'CONSUME',
                transition: {
                  state: s,
                  events: [toSeats([seat], { type: 'NOTE' }), toAll({ type: 'PING' })],
                },
              }
            : { kind: 'PASS' },
      },
    };
    const { runtime, updates } = makeRuntime(game, 2);
    runtime.start();
    expect(runtime.interceptChat(1, 'hello')).toEqual({ kind: 'PASS' });
    expect(runtime.interceptChat(1, 'secret')?.kind).toBe('CONSUME');
    expect(updates[1]?.at(-1)?.events).toEqual([{ type: 'NOTE' }, { type: 'PING' }]);
    expect(updates[0]?.at(-1)?.events).toEqual([{ type: 'PING' }]);
  });
});
