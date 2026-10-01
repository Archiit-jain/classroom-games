/**
 * Game-action sending (ADR-014). Every intent gets a fresh random `actionId`;
 * the server executes each id at most once. On top of that, an identical
 * action that is still waiting for its acknowledgement is not sent again —
 * a double tap resolves with the first send's result.
 */

export interface ActionPayload {
  matchId: string;
  version: number;
  actionId: string;
  action: unknown;
}

type Ack = { ok: true; version: number } | { ok: false; code: string; retryAfterMs?: number };

export function randomActionId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** JSON with sorted object keys, so {a,b} and {b,a} are the same action. */
function stableKey(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
}

export function createActionSender<A extends Ack>(
  send: (payload: ActionPayload) => Promise<A>,
  makeId: () => string = randomActionId,
) {
  const inFlight = new Map<string, Promise<A>>();
  return (ref: { matchId: string; version: number }, action: unknown): Promise<A> => {
    const key = `${ref.matchId}|${stableKey(action)}`;
    const pending = inFlight.get(key);
    if (pending) return pending;
    const promise = send({
      matchId: ref.matchId,
      version: ref.version,
      actionId: makeId(),
      action,
    }).finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
  };
}
