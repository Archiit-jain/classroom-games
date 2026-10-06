import type { FixtureView } from '@cg/game-sdk/fixture';
import type { MatchUpdate } from '@cg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { EVENT_BUCKETS } from '../../src/transport/eventBuckets';
import { newActionId, setupRoom, startServer, type TestClient, type TestServer } from '../helpers';
import {
  burst,
  captureLog,
  expectHealthy,
  expectNoPrototypePollution,
  sendMalformed,
} from './harness';

/** Phase 10 §5, §9, §17: protocol abuse over real sockets. */
let ts: TestServer;
afterEach(async () => {
  await ts?.close();
});

/** Rate limits high enough that every malformed payload reaches validation. */
const UNLIMITED = { burst: 10_000, perSecond: 10_000 };
const noLimits = {
  rateLimits: Object.fromEntries(
    [
      'socket',
      'nickname',
      'roomCreate',
      'roomJoin',
      'roomAdmin',
      'matchAction',
      'stream',
      'report',
      'reaction',
      'ping',
      'matchmaking',
      'browse',
      'codeGuess',
    ].map((k) => [k, UNLIMITED]),
  ),
};

type Update = MatchUpdate<FixtureView, unknown>;

async function runningMatch(host: TestClient, guest: TestClient): Promise<Update> {
  await setupRoom(host, guest);
  expect((await host.emit('room:start', {})).ok).toBe(true);
  return (await host.waitFor('match:update')) as Update;
}

describe('malformed requests', () => {
  it('every client event refuses every malformed payload cleanly, in and out of a match', async () => {
    const log = captureLog();
    ts = await startServer(noLimits, { log });
    const host = await ts.player('Host');
    const guest = await ts.player('Guest');
    const events = [...Object.keys(EVENT_BUCKETS), 'time:ping'];
    // Outside a room…
    for (const event of events) await sendMalformed(guest, event);
    // …and inside a running match (deeper code paths are reachable from here).
    await runningMatch(host, guest);
    for (const event of events) {
      const codes = await sendMalformed(host, event);
      // Never an internal error: bad input is the client's problem, reported as such.
      expect([...codes], event).not.toContain('INTERNAL_ERROR');
    }
    expect(log.errors).toEqual([]);
    expectNoPrototypePollution();
    await expectHealthy(ts.url);
  });

  it('answers never carry stack traces or internals', async () => {
    ts = await startServer(noLimits);
    const c = await ts.player('Prober');
    const answers = await Promise.all([
      c.emitRaw('room:join', { code: 'ABCDEF' }),
      c.emitRaw('match:action', { matchId: 'm_x', version: 1, actionId: 'a', action: {} }),
      c.emitRaw('match:resync', { matchId: 'm_nope' }),
      c.emitRaw('public:join', { roomId: 'r_nope' }),
      c.emitRaw('report:submit', { playerId: 'p_nope', reason: 'SPAM' }),
    ]);
    for (const answer of answers) {
      const raw = JSON.stringify(answer);
      expect(raw).not.toMatch(/stack|at \w+ \(|redis|ioredis|\.ts:\d|Error:/iu);
      expect(Object.keys(answer as object).sort()).toEqual(expect.arrayContaining(['code', 'ok']));
      expect(
        Object.keys(answer as object).every((k) => ['ok', 'code', 'retryAfterMs'].includes(k)),
      ).toBe(true);
    }
  });
});

describe('game actions', () => {
  it('a player cannot act in, or read, a match they are not part of', async () => {
    ts = await startServer();
    const [a, b, outsider, friend] = await Promise.all([
      ts.player('Anu'),
      ts.player('Bela'),
      ts.player('Outsider'),
      ts.player('Friend'),
    ]);
    const first = await runningMatch(a, b);
    await setupRoom(outsider, friend); // the outsider is in another room
    const forged = await outsider.act(first, { type: 'ADD', amount: 3 });
    expect(forged.ok).toBe(false);
    const peek = await outsider.emit('match:resync', { matchId: first.matchId });
    expect(peek.ok).toBe(false);
    expect(outsider.all('match:update')).toHaveLength(0);
    // The real match did not move.
    const again = await a.emit('match:resync', { matchId: first.matchId });
    expect(again.ok).toBe(true);
    expect((a.last('match:update') as Update).version).toBe(first.version);
  });

  it('a garbage action in a valid envelope is refused without changing the match', async () => {
    const log = captureLog();
    ts = await startServer(noLimits, { log });
    const a = await ts.player('Anu');
    const b = await ts.player('Bela');
    const first = await runningMatch(a, b);
    const mover = first.view.turn === first.you ? a : b;
    const ref = (mover.last('match:update') ?? first) as Update;
    const garbage: unknown[] = [
      null,
      {},
      { type: 'ADD' },
      { type: 'ADD', amount: 0 },
      { type: 'ADD', amount: 4 },
      { type: 'ADD', amount: -3 },
      { type: 'ADD', amount: 1.5 },
      { type: 'ADD', amount: '3' },
      { type: 'ADD', amount: 1e308 },
      { type: 'ADD', amount: 3, extra: true },
      { type: 'WIN' },
      [{ type: 'ADD', amount: 3 }],
    ];
    for (const action of garbage) {
      const res = await mover.act(ref, action);
      expect(res.ok, JSON.stringify(action)).toBe(false);
    }
    // Wrong seat (the other player) and a version the server never issued.
    const other = mover === a ? b : a;
    expect((await other.act(ref, { type: 'ADD', amount: 1 })).ok).toBe(false);
    expect(
      (await mover.act({ ...ref, version: ref.version + 50 }, { type: 'ADD', amount: 1 })).ok,
    ).toBe(false);
    // Nothing moved, and the same player can still make a legal move.
    const ok = await mover.act(ref, { type: 'ADD', amount: 1 });
    expect(ok.ok).toBe(true);
    expect(log.errors).toEqual([]);
  });

  it('a burst of duplicate action ids executes once', async () => {
    ts = await startServer(noLimits);
    const a = await ts.player('Anu');
    const b = await ts.player('Bela');
    const first = await runningMatch(a, b);
    const mover = first.view.turn === first.you ? a : b;
    const ref = (mover.last('match:update') ?? first) as Update;
    const id = newActionId();
    const tally = await burst(20, () => mover.act(ref, { type: 'ADD', amount: 1 }, id));
    expect(tally.ok).toBe(1);
    expect(tally.DUPLICATE_ACTION).toBe(19);
  });
});
