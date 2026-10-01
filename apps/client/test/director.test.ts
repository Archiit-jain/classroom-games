import { describe, expect, it } from 'vitest';
import { AnimationDirector, type PresentableUpdate } from '../src/platform/director';

interface U extends PresentableUpdate {
  label: string;
}

/** A manual clock so tests control exactly when animations finish. */
function harness(durations: Record<string, number>, maxLagMs = 1500) {
  const shown: Array<{ label: string; events: number }> = [];
  const timers: Array<{ at: number; fn: () => void; cancelled: boolean }> = [];
  let now = 0;
  const director = new AnimationDirector<U>({
    durationOf: (u) => u.events.reduce<number>((s, e) => s + (durations[e as string] ?? 0), 0),
    onPresent: (u) => shown.push({ label: u.label, events: u.events.length }),
    schedule: (fn, ms) => {
      const t = { at: now + ms, fn, cancelled: false };
      timers.push(t);
      return () => {
        t.cancelled = true;
      };
    },
    maxLagMs,
  });
  const advance = (ms: number) => {
    now += ms;
    for (const t of [...timers]) {
      if (!t.cancelled && t.at <= now) {
        t.cancelled = true;
        t.fn();
      }
    }
  };
  const update = (version: number, events: string[], matchId = 'm1'): U => ({
    matchId,
    version,
    events,
    label: `${matchId}@${version}`,
  });
  return { director, shown, advance, update };
}

describe('AnimationDirector', () => {
  it('presents an update immediately when idle', () => {
    const { director, shown, update } = harness({ deal: 800 });
    director.push(update(1, ['deal']));
    expect(shown).toEqual([{ label: 'm1@1', events: 1 }]);
  });

  it('holds the next update until the current animation finishes', () => {
    const { director, shown, update, advance } = harness({ deal: 800, flip: 400 });
    director.push(update(1, ['deal']));
    director.push(update(2, ['flip']));
    expect(shown.map((s) => s.label)).toEqual(['m1@1']);
    advance(799);
    expect(shown.map((s) => s.label)).toEqual(['m1@1']);
    advance(1);
    expect(shown.map((s) => s.label)).toEqual(['m1@1', 'm1@2']);
  });

  it('fast-forwards to the newest update when the backlog exceeds the lag budget', () => {
    const { director, shown, update, advance } = harness({ big: 900 });
    director.push(update(1, ['big']));
    director.push(update(2, ['big']));
    director.push(update(3, ['big'])); // 1800 ms queued > 1500 ms budget
    advance(900);
    expect(shown).toEqual([
      { label: 'm1@1', events: 1 },
      { label: 'm1@3', events: 0 }, // events of skipped updates dropped
    ]);
    expect(director.pending).toBe(0);
  });

  it('ignores duplicate and out-of-order versions', () => {
    const { director, shown, update } = harness({});
    director.push(update(2, []));
    director.push(update(2, []));
    director.push(update(1, []));
    expect(shown.map((s) => s.label)).toEqual(['m1@2']);
  });

  it('passes instant updates straight through', () => {
    const { director, shown, update } = harness({});
    director.push(update(1, ['x']));
    director.push(update(2, ['y']));
    director.push(update(3, []));
    expect(shown.map((s) => s.label)).toEqual(['m1@1', 'm1@2', 'm1@3']);
  });

  it('resets when a new match starts, dropping the old queue', () => {
    const { director, shown, update, advance } = harness({ slow: 1000 });
    director.push(update(1, ['slow']));
    director.push(update(2, ['slow']));
    director.push(update(1, [], 'm2'));
    expect(shown.map((s) => s.label)).toEqual(['m1@1', 'm2@1']);
    advance(5000);
    expect(shown.map((s) => s.label)).toEqual(['m1@1', 'm2@1']);
  });
});
