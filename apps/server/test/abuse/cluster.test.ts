import type { FixtureView } from '@cg/game-sdk/fixture';
import { createDrawAndGuessGame } from '@cg/game-draw-and-guess/server';
import type { DrawEvent, DrawView, WordEntry } from '@cg/game-draw-and-guess/shared';
import type { MatchUpdate } from '@cg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { startCluster, type TestCluster } from '../clusterHelpers';
import {
  autoPlay,
  eventually,
  setupGameRoom,
  setupRoom,
  sleep,
  testFixture,
  type TestClient,
} from '../helpers';
import { captureLog, expectNoSecretInFrames } from './harness';

/** Phase 10 §4, §11, §14–15 across several instances (a real Redis in CI). */
let c: TestCluster | null = null;
afterEach(async () => {
  await c?.close();
  c = null;
});

const hosts = (cl: TestCluster) => cl.nodes.filter((n) => n.server.cluster.isHost).length;
const hostIndex = (cl: TestCluster) => cl.nodes.findIndex((n) => n.server.cluster.isHost);

/** Samples how many instances act as host, every few ms, until stopped. */
function watchHosts(cl: TestCluster): { max(): number; stop(): void } {
  let max = 0;
  const timer = setInterval(() => {
    max = Math.max(max, hosts(cl));
  }, 5);
  return { max: () => max, stop: () => clearInterval(timer) };
}

describe('rate limits across instances', () => {
  it('reconnecting through another instance does not reset a session’s limits', async () => {
    c = await startCluster(2, {
      overrides: { rateLimits: { roomJoin: { burst: 3, perSecond: 0.01 } } },
    });
    const guesser = await c.player(1, 'Guesser');
    for (let i = 0; i < 3; i++) {
      expect(await guesser.emit('room:join', { code: 'ZZZZZZ' })).toEqual(
        expect.objectContaining({ code: 'ROOM_NOT_FOUND' }),
      );
    }
    // A fresh socket on the other instance (fresh gateway buckets)…
    guesser.close();
    const again = await c.connect(0, guesser.ready.token as string);
    // …still meets the host's shared count.
    expect(await again.emit('room:join', { code: 'ZZZZZZ' })).toEqual(
      expect.objectContaining({ ok: false, code: 'RATE_LIMITED' }),
    );
  });
});

type FixUpdate = MatchUpdate<FixtureView, unknown>;

describe('Redis trouble', () => {
  it('only the host’s Redis connection hangs: it steps down first, one host at a time, play goes on', async () => {
    const log = captureLog();
    c = await startCluster(2, { faults: true, games: [testFixture({ turnMs: 400 })], log });
    const host = hostIndex(c);
    const other = 1 - host;
    // Both players on the healthy instance; the failing host only hosts.
    const a = await c.player(other, 'Anu');
    const b = await c.player(other, 'Bela');
    await setupRoom(a, b);
    await a.emit('room:updateSettings', { settings: { target: 40 } });
    autoPlay(a, 1);
    autoPlay(b, 1);
    expect((await a.emit('room:start', {})).ok).toBe(true);
    await a.waitFor('match:update', (u) => (u as FixUpdate).version >= 3, 5000);
    await sleep(200); // let the host save its progress

    const watch = watchHosts(c);
    const failing = c.nodes[host] as TestCluster['nodes'][number];
    failing.fault?.setMode('hang');
    let steppedDownAt = 0;
    await eventually(
      () => {
        if (!failing.server.cluster.isHost && !steppedDownAt) steppedDownAt = Date.now();
        return c?.nodes[other]?.server.cluster.isHost === true;
      },
      5000,
      2,
    );
    const tookOverAt = Date.now();
    expect(steppedDownAt).toBeGreaterThan(0);
    expect(steppedDownAt).toBeLessThanOrEqual(tookOverAt);

    // The match carries on under the new host and reaches its end once.
    const end = await a.waitFor('match:end', () => true, 20_000);
    expect(end.results.placements).toHaveLength(2);
    // The old host's connection comes back: its queued commands run, but they are
    // fenced (stale lease) — it does not become host again or overwrite anything.
    failing.fault?.setMode('ok');
    await sleep(500);
    watch.stop();
    expect(watch.max()).toBe(1);
    expect(hosts(c)).toBe(1);
    expect(c.nodes[other]?.server.cluster.isHost).toBe(true);
    const results = await b.waitForRoom((r) => r?.phase === 'RESULTS');
    expect(results?.match?.results).toEqual(end.results);
    expect(a.all('match:end')).toHaveLength(1);
    expect(log.errors.filter((e) => /engine|handler failed|unhandled/iu.test(e))).toEqual([]);
  });

  it('Redis down for every instance, then back: requests fail safely, the room survives', async () => {
    c = await startCluster(2, { faults: true });
    const a = await c.player(1, 'Anu');
    const b = await c.player(1, 'Bela');
    const code = await setupRoom(a, b);
    await sleep(200); // saved
    for (const node of c.nodes) node.fault?.setMode('fail');
    // Requests answer with a clean failure (or time out); nothing crashes.
    const during = await Promise.race([
      a.emit('chat:send', { text: 'anyone there?' }),
      sleep(3500).then(() => ({ ok: false, code: 'NO_ANSWER' })),
    ]);
    expect(during.ok).toBe(false);
    await sleep(800); // longer than the lease: nobody may act as host now
    expect(hosts(c)).toBe(0);
    for (const node of c.nodes) node.fault?.setMode('ok');
    // A host is elected again and restores the room from the last commit.
    await eventually(() => hosts(c as TestCluster) === 1, 5000);
    const late = await c.player(0, 'Late');
    expect(await late.emit('room:join', { code })).toEqual(expect.objectContaining({ ok: true }));
    const room = await a.waitForRoom((r) => (r?.members.length ?? 0) === 3, 5000);
    expect(room?.members.map((m) => (m.kind === 'HUMAN' ? m.nickname : m.name)).sort()).toEqual([
      'Anu',
      'Bela',
      'Late',
    ]);
  });
});

describe('failover idempotence', () => {
  async function crashHost(cl: TestCluster): Promise<void> {
    const host = hostIndex(cl);
    const crashed = (cl.nodes[host] as TestCluster['nodes'][number]).server;
    await crashed.cluster.abandon();
    crashed.io.close();
    await eventually(() => hosts(cl) === 1, 5000);
  }

  it('an action acknowledged before a host crash is not applied again when retried', async () => {
    // Long turns: no timeout move may change the counter while the host fails over.
    c = await startCluster(3, { games: [testFixture({ turnMs: 60_000 })] });
    const gateway = [0, 1, 2].find((i) => i !== hostIndex(c as TestCluster)) as number;
    const a = await c.player(gateway, 'Anu');
    const b = await c.player(gateway, 'Bela');
    await setupRoom(a, b);
    expect((await a.emit('room:start', {})).ok).toBe(true);
    const first = (await a.waitFor('match:update')) as FixUpdate;
    const mover = first.view.turn === first.you ? a : b;
    const ref = (mover.all('match:update').at(-1) ?? first) as FixUpdate;
    const id = 'retry-me-after-a-crash';
    expect((await mover.act(ref, { type: 'ADD', amount: 2 }, id)).ok).toBe(true);
    const after = (await mover.waitFor(
      'match:update',
      (u) => (u as FixUpdate).version > ref.version,
    )) as FixUpdate;
    await sleep(250); // committed
    await crashHost(c);
    // The client never saw its acknowledgement (say) and retries with the same id.
    const retry = await mover.act(after, { type: 'ADD', amount: 2 }, id);
    expect(retry).toEqual(expect.objectContaining({ ok: false, code: 'DUPLICATE_ACTION' }));
    const resynced = await mover.emit('match:resync', { matchId: first.matchId });
    expect(resynced.ok).toBe(true);
    const total = (resynced.ok ? (resynced.update as FixUpdate) : after).view.counter;
    expect(total).toBe(after.view.counter); // added once, not twice
  });

  it('a host crash on the results screen: the room comes back there, one new match starts', async () => {
    c = await startCluster(3, { games: [testFixture()] });
    const gateway = [0, 1, 2].find((i) => i !== hostIndex(c as TestCluster)) as number;
    const a = await c.player(gateway, 'Anu');
    const b = await c.player(gateway, 'Bela');
    await setupRoom(a, b);
    autoPlay(a, 3);
    autoPlay(b, 3);
    expect((await a.emit('room:start', {})).ok).toBe(true);
    await a.waitForRoom((r) => r?.phase === 'RESULTS', 15_000);
    await sleep(250);
    a.clear('room:snapshot'); // whatever arrives now comes from the new host's restore
    await crashHost(c);
    const restored = await a.waitForRoom((r) => r !== null, 5000);
    expect(restored?.phase).toBe('RESULTS');
    // A double "Play again" (two taps, a retry) starts one match.
    const tally = await Promise.all([a.emit('room:playAgain', {}), a.emit('room:playAgain', {})]);
    expect(tally.filter((t) => t.ok)).toHaveLength(1);
    await a.waitForRoom((r) => r?.phase === 'IN_GAME', 5000);
    const matchIds = new Set((a.all('match:update') as FixUpdate[]).map((u) => u.matchId));
    expect(matchIds.size).toBe(2); // the first match and exactly one new one
  });
});

type DrawUpdate = MatchUpdate<DrawView, DrawEvent>;
const PACK: WordEntry[] = [
  { word: 'umbrella', aliases: [], difficulty: 'easy' },
  { word: 'kite', aliases: [], difficulty: 'medium' },
  { word: 'rainbow', aliases: [], difficulty: 'hard' },
];

describe('Draw & Guess privacy across instances', () => {
  it('no guesser frame names a card — via a gateway, a reconnect and a host failover', async () => {
    c = await startCluster(3, {
      games: [
        createDrawAndGuessGame({
          pack: PACK,
          timing: { chooseMs: 4000, drawMs: 9000, revealMs: 300 },
        }),
      ],
    });
    const host = hostIndex(c);
    const [n1, n2] = [0, 1, 2].filter((i) => i !== host) as [number, number];
    // Nobody plays on the host instance: its crash only moves the host role.
    const drawer = await c.player(n1, 'Archit');
    const g1 = await c.player(n1, 'Priya');
    let g2: TestClient = await c.player(n2, 'Kabir');
    await setupGameRoom('draw-and-guess', drawer, g1, g2);
    expect((await drawer.emit('room:start', {})).ok).toBe(true);
    const choosing = (await drawer.waitFor('match:update', (u) =>
      (u as DrawUpdate).events.some((e) => e.type === 'WORD_OPTIONS'),
    )) as DrawUpdate;
    const cards = choosing.view.options.map((o) => o.word);
    expect(cards).toHaveLength(3);
    expect((await drawer.act(choosing, { type: 'CHOOSE', option: 0 })).ok).toBe(true);
    await g1.waitFor('match:update', (u) => (u as DrawUpdate).view.phase === 'DRAWING');
    await drawer.emit('match:stream', {
      matchId: choosing.matchId,
      chunk: { op: 'stroke', id: 0, tool: 'pen', colour: 3, size: 1, points: [1, 2, 3, 4] },
    });
    await sleep(250); // saved

    // The host crashes mid-drawing; another instance restores the round.
    const crashed = (c.nodes[host] as TestCluster['nodes'][number]).server;
    await crashed.cluster.abandon();
    crashed.io.close();
    await eventually(() => hosts(c as TestCluster) === 1, 5000);
    // One guesser drops and comes back through the other instance.
    const token = g2.ready.token as string;
    const before = g2.frames;
    g2.close();
    g2 = await c.connect(n1, token);
    await g2.waitFor('match:update', (u) => (u as DrawUpdate).view.phase === 'DRAWING', 5000);
    await sleep(300);
    // A wrong guess still works after the failover.
    expect((await g1.emit('chat:send', { text: 'apple' })).ok).toBe(true);
    await sleep(200);

    for (const [label, frames] of [
      ['guesser on a gateway', g1.frames],
      ['guesser before reconnect', before],
      ['guesser after reconnect', g2.frames],
    ] as const) {
      expect(frames.length, label).toBeGreaterThan(3);
      expectNoSecretInFrames(frames, cards, label);
    }
    // The drawer still has the word after the restore (so the scan above is meaningful).
    expect(drawer.frames.some((f) => f.includes(cards[0] as string))).toBe(true);
  });
});
