import { describe, expect, it } from 'vitest';
import { createActionSender, randomActionId } from '../src/platform/actions';
import { ACTION_ID_PATTERN } from '@cg/protocol';

describe('action sender', () => {
  it('generates ids the server accepts, and they are unique', () => {
    const ids = new Set(Array.from({ length: 500 }, () => randomActionId()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(ACTION_ID_PATTERN);
  });

  it('coalesces an identical in-flight action (double tap) into one send', async () => {
    const sent: unknown[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const send = createActionSender(async (payload) => {
      sent.push(payload);
      await gate;
      return { ok: true as const, version: 2 };
    });
    const ref = { matchId: 'm_1', version: 1 };
    const first = send(ref, { type: 'GUESS', target: 2 });
    const second = send(ref, { target: 2, type: 'GUESS' }); // same action, keys reordered
    release();
    expect(await first).toEqual({ ok: true, version: 2 });
    expect(await second).toEqual({ ok: true, version: 2 });
    expect(sent).toHaveLength(1);
  });

  it('sends a new intent (new id) once the previous one was acknowledged', async () => {
    const ids: string[] = [];
    const send = createActionSender(async (payload) => {
      ids.push(payload.actionId);
      return { ok: true as const, version: 1 };
    });
    await send({ matchId: 'm', version: 1 }, { type: 'A' });
    await send({ matchId: 'm', version: 1 }, { type: 'A' });
    await send({ matchId: 'm', version: 1 }, { type: 'B' });
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });
});
