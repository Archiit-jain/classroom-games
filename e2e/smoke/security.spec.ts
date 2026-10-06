import { expect, test } from '@playwright/test';
import { createBusinessGame } from '../../games/business/src/server/engine';
import { createDotsAndBoxesGame } from '../../games/dots-and-boxes/src/server/engine';
import { createDrawAndGuessGame } from '../../games/draw-and-guess/src/server/engine';
import { createNpatGame } from '../../games/name-place-animal-thing/src/server/engine';
import { createPenFightGame } from '../../games/pen-fight/src/server/engine';
import { createRmcsGame } from '../../games/rmcs/src/server/engine';
import { createSixteenParchiGame } from '../../games/sixteen-parchi/src/server/engine';
import { createRng } from '../../packages/game-sdk/src/rng';
import { RawSocket } from './rawSocket';

/**
 * Production security smoke (Phase 10 §16–18, §27): controlled, low-volume checks a
 * deployed site must pass — headers, origin checks, malformed requests, chat
 * moderation, reactions, and one real move in every game. Uses a handful of sessions
 * and private rooms; nothing here floods the site.
 *
 *   SMOKE_URL=https://<deployment> pnpm smoke
 */
const URL = process.env.SMOKE_URL ?? 'http://localhost:4300';
const HTTPS = URL.startsWith('https://');

async function player(name: string): Promise<RawSocket> {
  const s = await RawSocket.connect(URL);
  const named = await s.emit('session:setNickname', { nickname: name });
  expect(named.ok, `nickname ${name}`).toBe(true);
  return s;
}

test('production: security headers, HTTPS and origin checks', async ({ request }) => {
  const page = await request.get(URL);
  expect(page.status()).toBe(200);
  const h = page.headers();
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['content-security-policy']).toContain("default-src 'self'");
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(h['permissions-policy']).toContain('camera=()');
  if (HTTPS) {
    expect(h['strict-transport-security']).toContain('max-age=');
    const plain = await request.get(URL.replace('https://', 'http://'), { maxRedirects: 0 });
    expect([301, 308]).toContain(plain.status());
  }
  const handshake = '/api/socket/socket.io/?EIO=4&transport=polling';
  const foreign = await request.get(`${URL}${handshake}`, {
    headers: { origin: 'https://evil.example' },
  });
  expect(foreign.status()).toBe(403);
  const own = await request.get(`${URL}${handshake}`, {
    headers: { origin: new globalThis.URL(URL).origin },
  });
  expect(own.status()).toBe(200);
  // Operator metrics are not public.
  expect((await request.get(`${URL}/api/socket/metrics`)).status()).toBe(404);
});

test('production: malformed requests are refused cleanly', async () => {
  const s = await player('Prober');
  for (const [event, payload] of [
    ['room:join', { code: { $gt: '' } }],
    ['room:join', { code: 'x'.repeat(5_000) }],
    ['room:create', { gameId: null }],
    ['match:action', { matchId: 'm_x', version: 1, actionId: 'a', action: { type: 'ROLL' }, x: 1 }],
    ['chat:send', { text: 42 }],
    ['chat:react', { reactionId: 'HACK' }],
    ['public:join', { roomId: ['r'] }],
    ['session:setNickname', JSON.parse('{"__proto__":{"admin":true},"nickname":7}') as unknown],
  ] as const) {
    const answer = await s.emit(event, payload);
    expect(answer, `${event} ${JSON.stringify(payload).slice(0, 60)}`).toEqual({
      ok: false,
      code: 'INVALID_PAYLOAD',
    });
  }
  // A wrong code is just "not found" — no detail.
  expect(await s.emit('room:join', { code: 'ZZZZZZ' })).toEqual({
    ok: false,
    code: 'ROOM_NOT_FOUND',
  });
  // No acknowledgement, unknown events: ignored; the connection stays usable.
  s.emitNoAck('room:create', { gameId: 'rmcs' });
  s.emitNoAck('admin:shutdown', {});
  expect((await s.emit('time:ping', { clientTs: 1 })).ok).toBe(true);
  // A broken packet ends only that connection.
  const broken = await player('Broken');
  broken.sendRaw('42["room:join"');
  await expect.poll(() => broken.open, { timeout: 10_000 }).toBe(false);
  expect((await s.emit('time:ping', { clientTs: 2 })).ok).toBe(true);
  // Never a stack trace or an internal detail in anything we were sent.
  for (const frame of [...s.frames, ...broken.frames]) {
    expect(frame).not.toMatch(/stack|ioredis|\.ts:\d|at Object\./u);
  }
  s.close();
});

test('production: chat moderation, repeats and reactions between two players', async () => {
  const host = await player('Mira');
  const guest = await player('Nikhil');
  const created = await host.emit('room:create', { gameId: 'rmcs' });
  const room = created.room as { code: string };
  expect((await guest.emit('room:join', { code: room.code })).ok).toBe(true);

  expect((await host.emit('chat:send', { text: 'you are stupid' })).ok).toBe(true);
  expect((await host.emit('chat:send', { text: 'call me on 98765 43210' })).ok).toBe(true);
  const texts = async () => (guest.all('chat:message') as { text: string }[]).map((m) => m.text);
  await expect.poll(texts).toContain('you are ******');
  await expect.poll(texts).toContain('call me on [removed]');
  expect((await texts()).join(' ')).not.toMatch(/stupid|98765/u);
  // The same message again (right after itself) is refused, not sent.
  expect(await host.emit('chat:send', { text: 'call me on 98765 43210' })).toEqual({
    ok: false,
    code: 'CHAT_REPEATED',
  });
  // Reactions: refused in the lobby, delivered during a match, then rate-limited.
  expect((await host.emit('chat:react', { reactionId: 'CLAP' })).ok).toBe(false);
  for (let i = 0; i < 2; i++) expect((await host.emit('room:addBot', {})).ok).toBe(true);
  expect((await host.emit('room:start', {})).ok).toBe(true);
  await host.waitFor('match:update', 15_000);
  expect(await host.emit('chat:react', { reactionId: 'CLAP' })).toEqual({ ok: true });
  const reaction = (await guest.waitFor('chat:reaction')) as { fromId: string };
  expect(reaction.fromId).toBe(host.ready.playerId);
  expect(await host.emit('chat:react', { reactionId: 'FIRE' })).toEqual(
    expect.objectContaining({ ok: false, code: 'RATE_LIMITED' }),
  );
  host.close();
  guest.close();
});

// One real move in every game: a private room with bots; the human's seat is played
// with the game's own bot logic (so every move is legal) until the server accepts some.
const GAMES = [
  createRmcsGame(),
  createSixteenParchiGame(),
  createDrawAndGuessGame(),
  createPenFightGame(),
  createDotsAndBoxesGame(),
  createNpatGame(),
  createBusinessGame(),
];

for (const game of GAMES) {
  test(`production: ${game.manifest.id} starts and accepts real moves`, async () => {
    test.setTimeout(150_000);
    const s = await player('Smoke');
    const created = await s.emit('room:create', { gameId: game.manifest.id });
    expect(created.ok).toBe(true);
    const needed = game.manifest.players.min === 4 ? 3 : Math.max(1, game.manifest.players.min - 1);
    for (let i = 0; i < needed; i++) expect((await s.emit('room:addBot', {})).ok).toBe(true);
    expect((await s.emit('room:start', {})).ok).toBe(true);

    let memory: unknown = null;
    let matchId = '';
    let accepted = 0;
    let busy = false;
    const rng = createRng(7);
    const done = new Promise<void>((resolve) => {
      s.on('match:update', (raw) => {
        const u = raw as {
          matchId: string;
          version: number;
          you: number;
          view: unknown;
          events: unknown[];
        };
        if (u.matchId !== matchId) {
          matchId = u.matchId;
          memory = game.bot.createMemory(u.you);
        }
        memory = game.bot.observe(memory as never, u.events as never[]);
        if (busy || accepted >= 2) return;
        const decision = game.bot.decide(u.view as never, memory as never, {
          seat: u.you,
          now: Date.now(),
          rng,
        });
        if (!decision) return;
        busy = true;
        void (async () => {
          if (decision.kind === 'ACTION') {
            const a = await s.emit('match:action', {
              matchId: u.matchId,
              version: u.version,
              actionId: `smoke_${game.manifest.id}_${u.version}_${Date.now()}`,
              action: decision.action,
            });
            if (a.ok) accepted++;
          } else if (decision.kind === 'CHAT') {
            if ((await s.emit('chat:send', { text: decision.text })).ok) accepted++;
          } else {
            for (const step of decision.steps.slice(0, 5)) {
              if ((await s.emit('match:stream', { matchId: u.matchId, chunk: step.chunk })).ok)
                accepted++;
            }
          }
          busy = false;
          if (accepted >= 2) resolve();
        })();
      });
    });
    await Promise.race([done, new Promise((r) => setTimeout(r, 120_000))]);
    expect(accepted, `${game.manifest.id}: server-accepted moves`).toBeGreaterThanOrEqual(1);
    await s.emit('room:leave', {});
    s.close();
  });
}
