/**
 * Reusable abuse-test layer (Phase 10 §19): malformed payloads, bursts, crowds,
 * forged identities, reconnect storms, frame recording and "the server is still
 * fine" checks. Used by the abuse/*.test.ts files and the cluster tests.
 */
import { C2S } from '@cg/protocol/schemas';
import { expect } from 'vitest';
import type { Logger } from '../../src/log';
import { TestClient, type ConnectOptions } from '../helpers';

/** A logger that keeps error/warn lines so a test can assert the server stayed healthy. */
export function captureLog(): Logger & { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  return {
    errors,
    warnings,
    error: (msg, fields) => errors.push(`${msg} ${JSON.stringify(fields ?? {})}`),
    warn: (msg, fields) => warnings.push(`${msg} ${JSON.stringify(fields ?? {})}`),
    info: () => undefined,
    debug: () => undefined,
  };
}

/**
 * Payloads every client→server event must refuse cleanly (wrong types, extra or
 * missing fields, prototype tricks, deep nesting, oversized strings). Each is sent
 * as the event's single argument.
 */
export const MALFORMED_PAYLOADS: unknown[] = [
  undefined,
  null,
  0,
  -1,
  'text',
  '',
  true,
  [],
  [1, 2, 3],
  {},
  { unexpected: 1 },
  { __proto__: { polluted: true } },
  JSON.parse('{"__proto__":{"polluted":true}}') as unknown,
  { constructor: { prototype: { polluted: true } } },
  { matchId: 'x'.repeat(5_000) },
  { code: { $gt: '' } },
  { text: ['a'] },
  { nickname: 12 },
  { gameId: null, extra: true },
  { a: { b: { c: { d: { e: { f: { g: { h: { i: { j: {} } } } } } } } } } },
  Array.from({ length: 2_000 }, (_, i) => i),
];

/**
 * Sends every malformed payload to `event` (with an acknowledgement) and returns the
 * distinct answers. Every answer must be a clean failure — never a success, a crash or
 * silence. Payloads that happen to be valid for the event are skipped.
 */
export async function sendMalformed(client: TestClient, event: string): Promise<Set<string>> {
  const codes = new Set<string>();
  const schema = (C2S as Record<string, { safeParse(v: unknown): { success: boolean } }>)[event];
  for (const payload of MALFORMED_PAYLOADS) {
    // Only payloads the event's own schema refuses, as the server will receive them
    // (Socket.IO's parser drops "__proto__" keys, so such a payload may arrive as {}).
    if (schema?.safeParse(asReceived(payload)).success) continue;
    const ack = (await client.emitRaw(event, payload)) as { ok: boolean; code?: string };
    expect(ack, `${event} answered ${JSON.stringify(ack)} to ${JSON.stringify(payload)}`).toEqual(
      expect.objectContaining({ ok: false }),
    );
    codes.add(ack.code ?? '?');
  }
  // No acknowledgement / extra arguments / a function as payload: ignored, not crashed.
  client.emitNoAck(event, { any: 1 });
  client.emitNoAck(event);
  return codes;
}

/** A payload after the JSON round trip, without "__proto__" keys (as Socket.IO delivers it). */
function asReceived(payload: unknown): unknown {
  if (payload === undefined) return undefined;
  return JSON.parse(JSON.stringify(payload), (key: string, value: unknown) =>
    key === '__proto__' ? undefined : value,
  ) as unknown;
}

/** No malformed payload polluted Object.prototype (the server runs in this process). */
export function expectNoPrototypePollution(): void {
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
}

/** Fires `count` copies of `send` at once and tallies the answers' codes ("ok" for success). */
export async function burst(
  count: number,
  send: (i: number) => Promise<unknown>,
): Promise<Record<string, number>> {
  const answers = await Promise.allSettled(Array.from({ length: count }, (_, i) => send(i)));
  const tally: Record<string, number> = {};
  for (const a of answers) {
    const key =
      a.status === 'rejected'
        ? 'no-answer'
        : (a.value as { ok?: boolean; code?: string }).ok
          ? 'ok'
          : ((a.value as { code?: string }).code ?? '?');
    tally[key] = (tally[key] ?? 0) + 1;
  }
  return tally;
}

/** `count` clients connected at once (optionally all with nicknames). */
export async function crowd(
  url: string,
  count: number,
  options: ConnectOptions & { nicknames?: boolean } = {},
): Promise<TestClient[]> {
  const clients = await Promise.all(
    Array.from({ length: count }, () => TestClient.connect(url, options)),
  );
  if (options.nicknames) {
    await Promise.all(
      clients.map((c, i) => c.emit('session:setNickname', { nickname: `Player${i}` })),
    );
  }
  return clients;
}

/** Tokens a forger might try: wrong, malformed, oversized, look-alike and typed wrongly. */
export function forgedTokens(real: string): unknown[] {
  return [
    'a'.repeat(43),
    `${real.slice(0, -1)}${real.endsWith('A') ? 'B' : 'A'}`,
    real.toUpperCase() === real ? real.toLowerCase() : real.toUpperCase(),
    ` ${real}`,
    real.slice(0, 19),
    'x'.repeat(129),
    'x'.repeat(10_000),
    '',
    12345,
    { token: real },
    [real],
    null,
  ];
}

/** Reconnects with the same token `times` times in quick succession; returns the last client. */
export async function reconnectStorm(
  url: string,
  token: string,
  times: number,
): Promise<{ last: TestClient; all: TestClient[] }> {
  const all: TestClient[] = [];
  for (let i = 0; i < times; i++) all.push(await TestClient.connect(url, { token }));
  return { last: all[all.length - 1] as TestClient, all };
}

/** Fails if any recorded frame contains one of `secrets` (case-insensitive). */
export function expectNoSecretInFrames(
  frames: readonly string[],
  secrets: readonly string[],
  label = 'frame',
): void {
  for (const secret of secrets) {
    const needle = secret.toLowerCase();
    const leak = frames.find((f) => f.toLowerCase().includes(needle));
    expect(leak, `${label} leaked "${secret}"`).toBeUndefined();
  }
}

/** The server still answers a fresh client normally (after an attack). */
export async function expectHealthy(url: string): Promise<void> {
  const probe = await TestClient.connect(url);
  const pong = (await probe.emitRaw('time:ping', { clientTs: 1 })) as { ok: boolean };
  expect(pong.ok).toBe(true);
  const nick = await probe.emit('session:setNickname', { nickname: 'Probe' });
  expect(nick.ok).toBe(true);
  probe.close();
}
