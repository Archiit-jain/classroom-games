import { appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRng, type AnyGameModule } from '@cg/game-sdk';
import type { MatchUpdate } from '@cg/protocol';
import { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import { defaultGames } from '../src/app';
import { loadConfig } from '../src/config';
import { TestClient, sleep } from './helpers';

/**
 * Lightweight load/stress test (Phase 10 §20) — NOT a capacity benchmark.
 *
 *   LOAD=1 LOAD_URL=http://localhost:4300 LOAD_TOKEN=<METRICS_TOKEN> \
 *     [REDIS_URL=…] [LOAD_SECONDS=60] pnpm vitest run apps/server/test/load
 *
 * Against a running production build (tools/serve-production.mjs started with
 * METRICS_TOKEN). Clients play real public matches with each game's own bot logic,
 * chat, react and reconnect. Report: $LOAD_OUT (default <tmp>/cg-load.json), and the
 * GitHub job summary in CI.
 */
const enabled = process.env.LOAD === '1';
const URL_ = process.env.LOAD_URL ?? 'http://localhost:4300';
const TOKEN = process.env.LOAD_TOKEN ?? '';
const SECONDS = Number(process.env.LOAD_SECONDS ?? 60);
const PATH = process.env.LOAD_SOCKET_PATH ?? '/api/socket/socket.io';

const games = new Map<string, AnyGameModule>(
  defaultGames(loadConfig({}, { enableFixtureGame: false })).map((g) => [g.manifest.id, g]),
);
const PUBLIC_GAMES = [...games.keys()];

interface Tally {
  latency: Record<string, number[]>;
  errors: Record<string, number>;
  noAnswer: number;
  unexpectedDisconnects: number;
  matchesStarted: Set<string>;
  matchesEnded: Set<string>;
  actionsOk: number;
  chatsOk: number;
  reconnects: number;
}

const newTally = (): Tally => ({
  latency: {},
  errors: {},
  noAnswer: 0,
  unexpectedDisconnects: 0,
  matchesStarted: new Set(),
  matchesEnded: new Set(),
  actionsOk: 0,
  chatsOk: 0,
  reconnects: 0,
});

/** Sends a request, records its latency and outcome. */
async function timed<T>(tally: Tally, label: string, send: () => Promise<T>): Promise<T | null> {
  const start = performance.now();
  try {
    const ack = await send();
    (tally.latency[label] ??= []).push(performance.now() - start);
    const res = ack as { ok?: boolean; code?: string };
    if (res && res.ok === false) {
      const key = `${label}:${res.code}`;
      tally.errors[key] = (tally.errors[key] ?? 0) + 1;
    }
    return ack;
  } catch {
    tally.noAnswer++;
    return null;
  }
}

/** One simulated player: plays its seat with the game's bot logic, chats, reacts. */
class LoadPlayer {
  client!: TestClient;
  private memory: unknown = null;
  private matchId: string | null = null;
  private busy = false;
  private stopped = false;
  private readonly rng = createRng(Math.floor(Math.random() * 1e9));
  private intentionalClose = false;
  /** Reactions only make sense during a match (outside one they are refused). */
  private inMatch = false;

  constructor(
    private readonly index: number,
    private readonly tally: Tally,
  ) {}

  async start(): Promise<void> {
    await this.attach(await TestClient.connect(URL_, { path: PATH }));
    await timed(this.tally, 'setNickname', () =>
      this.client.emit('session:setNickname', { nickname: `Load${this.index}` }),
    );
    await this.play();
  }

  private async attach(client: TestClient): Promise<void> {
    this.client = client;
    client.socket.on('disconnect', () => {
      if (!this.intentionalClose && !this.stopped) this.tally.unexpectedDisconnects++;
    });
    client.socket.on('match:update', (u) => this.onUpdate(u as MatchUpdate));
    client.socket.on('match:end', (end) => {
      this.inMatch = false;
      this.tally.matchesEnded.add((end as { matchId: string }).matchId);
      void this.afterMatch();
    });
  }

  private async play(): Promise<void> {
    if (this.stopped) return;
    const gameId = PUBLIC_GAMES[this.index % PUBLIC_GAMES.length] as string;
    await timed(this.tally, 'public:play', () => this.client.emit('public:play', { gameId }));
  }

  private async afterMatch(): Promise<void> {
    await sleep(500 + Math.random() * 1500);
    if (this.stopped) return;
    const stay = Math.random() < 0.5;
    await timed(this.tally, 'resultsChoice', () =>
      this.client.emit('public:resultsChoice', { stay }),
    );
    if (!stay) {
      await timed(this.tally, 'room:leave', () => this.client.emit('room:leave', {}));
      await this.play();
    }
  }

  private onUpdate(update: MatchUpdate): void {
    const game = games.get(update.gameId);
    if (!game || this.stopped) return;
    this.tally.matchesStarted.add(update.matchId);
    this.inMatch = true;
    if (this.matchId !== update.matchId || update.reset) {
      this.matchId = update.matchId;
      this.memory = game.bot.createMemory(update.you);
    }
    this.memory = game.bot.observe(this.memory, update.events as never[]);
    if (this.busy) return;
    const decision = game.bot.decide(update.view as never, this.memory, {
      seat: update.you,
      now: Date.now(),
      rng: this.rng,
    });
    if (!decision) return;
    this.busy = true;
    const think = Math.min(decision.thinkMs, 600);
    setTimeout(
      () => void this.carryOut(update, decision).finally(() => (this.busy = false)),
      think,
    );
  }

  private async carryOut(update: MatchUpdate, decision: unknown): Promise<void> {
    const d = decision as
      | { kind: 'ACTION'; action: unknown }
      | { kind: 'CHAT'; text: string }
      | { kind: 'STREAM'; steps: { delayMs: number; chunk: unknown }[] };
    if (d.kind === 'ACTION') {
      const res = (await timed(this.tally, 'match:action', () =>
        this.client.act(update, d.action),
      )) as { ok?: boolean } | null;
      if (res?.ok) this.tally.actionsOk++;
    } else if (d.kind === 'CHAT') {
      await timed(this.tally, 'chat:guess', () => this.client.emit('chat:send', { text: d.text }));
    } else {
      for (const step of d.steps.slice(0, 40)) {
        await sleep(Math.min(step.delayMs, 200));
        if (this.stopped) return;
        const res = (await timed(this.tally, 'match:stream', () =>
          this.client.emit('match:stream', { matchId: update.matchId, chunk: step.chunk }),
        )) as { ok?: boolean } | null;
        if (!res?.ok) return;
      }
    }
  }

  async chat(n: number): Promise<void> {
    const res = (await timed(this.tally, 'chat:send', () =>
      this.client.emit('chat:send', { text: `gg ${this.index}-${n}` }),
    )) as { ok?: boolean } | null;
    if (res?.ok) this.tally.chatsOk++;
  }

  async react(): Promise<void> {
    if (!this.inMatch) return;
    await timed(this.tally, 'chat:react', () =>
      this.client.emit('chat:react', { reactionId: 'CLAP' }),
    );
  }

  async reconnect(): Promise<void> {
    const token = this.client.ready.token as string;
    this.intentionalClose = true;
    this.client.close();
    this.intentionalClose = false;
    await sleep(300);
    const start = performance.now();
    await this.attach(await TestClient.connect(URL_, { token, path: PATH }));
    (this.tally.latency.reconnect ??= []).push(performance.now() - start);
    this.tally.reconnects++;
  }

  stop(): void {
    this.stopped = true;
    this.intentionalClose = true;
    this.client?.close();
  }
}

async function metrics(): Promise<Record<string, unknown> | null> {
  if (!TOKEN) return null;
  const res = await fetch(`${URL_}/api/socket/metrics`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
}

async function redisCalls(redis: Redis | null): Promise<number | null> {
  if (!redis) return null;
  const info = await redis.info('commandstats');
  let calls = 0;
  for (const m of info.matchAll(/calls=(\d+)/gu)) calls += Number(m[1]);
  return calls;
}

const pct = (xs: number[], p: number) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] as number);
};

async function runLevel(clients: number, redis: Redis | null) {
  const tally = newTally();
  const before = await metrics();
  const callsBefore = await redisCalls(redis);
  const started = Date.now();
  let peakRss = 0;
  let peakLoop = 0;
  const sampler = setInterval(() => {
    void metrics().then((m) => {
      const p = (m as { value?: { process?: { rssMb: number; loopDelayP99Ms: number } } })?.value
        ?.process;
      if (p) {
        peakRss = Math.max(peakRss, p.rssMb);
        peakLoop = Math.max(peakLoop, p.loopDelayP99Ms);
      }
    });
  }, 2000);

  const players = Array.from({ length: clients }, (_, i) => new LoadPlayer(i, tally));
  // Arrive over ~2 s, like a class opening the link.
  await Promise.all(
    players.map(async (p, i) => {
      await sleep((i * 2000) / clients);
      await p.start();
    }),
  );
  const end = started + SECONDS * 1000;
  let tick = 0;
  while (Date.now() < end) {
    await sleep(1000);
    tick++;
    // Chat every ~5 s, a reaction every ~4 s, spread over players.
    await Promise.all(
      players.map(async (p, i) => {
        if ((tick + i) % 5 === 0) await p.chat(tick);
        if ((tick + i) % 4 === 0) await p.react();
      }),
    );
    // Halfway: one player in five drops and reconnects.
    if (tick === Math.floor(SECONDS / 2)) {
      await Promise.all(players.filter((_, i) => i % 5 === 0).map((p) => p.reconnect()));
    }
  }
  clearInterval(sampler);
  const after = await metrics();
  const callsAfter = await redisCalls(redis);
  for (const p of players) p.stop();
  await sleep(500);

  const elapsedS = (Date.now() - started) / 1000;
  const procBefore = (before as { value?: { process?: Record<string, number> } })?.value?.process;
  const procAfter = (after as { value?: { process?: Record<string, number> } })?.value?.process;
  const cpuMs =
    procBefore && procAfter
      ? (procAfter.cpuUserMs as number) +
        (procAfter.cpuSystemMs as number) -
        (procBefore.cpuUserMs as number) -
        (procBefore.cpuSystemMs as number)
      : null;
  const totalRequests = Object.values(tally.latency).reduce((n, xs) => n + xs.length, 0);
  return {
    clients,
    seconds: Math.round(elapsedS),
    requests: totalRequests,
    latencyMs: Object.fromEntries(
      Object.entries(tally.latency).map(([k, xs]) => [
        k,
        { n: xs.length, p50: pct(xs, 50), p95: pct(xs, 95), p99: pct(xs, 99) },
      ]),
    ),
    errors: tally.errors,
    noAnswer: tally.noAnswer,
    unexpectedDisconnects: tally.unexpectedDisconnects,
    reconnects: tally.reconnects,
    matchesStarted: tally.matchesStarted.size,
    matchesEnded: tally.matchesEnded.size,
    actionsOk: tally.actionsOk,
    chatsOk: tally.chatsOk,
    serverCpuPercent: cpuMs === null ? null : Math.round((cpuMs / (elapsedS * 1000)) * 1000) / 10,
    serverPeakRssMb: peakRss || null,
    serverPeakLoopDelayP99Ms: peakLoop || null,
    redisCommands: callsBefore !== null && callsAfter !== null ? callsAfter - callsBefore : null,
    redisCommandsPerSecond:
      callsBefore !== null && callsAfter !== null
        ? Math.round((callsAfter - callsBefore) / elapsedS)
        : null,
    matchmaking: (after as { value?: Record<string, unknown> })?.value
      ? Object.fromEntries(
          Object.entries((after as { value: Record<string, unknown> }).value).filter(
            ([k]) => k !== 'process',
          ),
        )
      : null,
  };
}

describe.skipIf(!enabled)('lightweight load test', () => {
  it('20 then 40 concurrent players: public matches, chat, reactions, reconnects', async () => {
    const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null;
    const levels = [];
    for (const clients of [20, 40]) levels.push(await runLevel(clients, redis));
    await redis?.quit();
    const report = { url: URL_, note: 'Lightweight stress test, not a capacity benchmark', levels };
    writeFileSync(
      process.env.LOAD_OUT ?? join(tmpdir(), 'cg-load.json'),
      JSON.stringify(report, null, 1),
    );
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `## Load test (lightweight)\n\n\`\`\`json\n${JSON.stringify(report, null, 1)}\n\`\`\`\n`,
      );
    }
    for (const level of levels) {
      // Gross failures only: the numbers themselves are reported, not asserted.
      expect(level.unexpectedDisconnects).toBe(0);
      expect(level.matchesStarted).toBeGreaterThan(0);
      expect(level.noAnswer).toBeLessThan(level.requests * 0.01);
    }
  }, 600_000);
});
