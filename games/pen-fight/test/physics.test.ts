import { describe, expect, it } from 'vitest';
import { DEFAULT_PHYSICS, simulateShot } from '../src/server';
import {
  ANGLE_SCALE,
  KEYFRAME_EVERY,
  buildTracks,
  deskAfter,
  frameTick,
  poseAt,
  type Boundary,
  type Pen,
} from '../src/shared';

const DESK = deskAfter(0); // 10 000 × 7000
const HUGE: Boundary = { w: 1e9, h: 1e9 };
const pen = (seat: number, x: number, y: number, a = 0): Pen => ({ seat, x, y, a, alive: true });
const QUARTER = Math.round((Math.PI / 2) * ANGLE_SCALE);

describe('a single flick', () => {
  it('slides a lone pen straight, about power × fullPowerSlide, without spin when hit in the middle', () => {
    for (const power of [0.25, 0.5, 1]) {
      const r = simulateShot([pen(0, 0, 0)], HUGE, 0, { anchor: 0, angle: 0, power });
      const [p] = r.final as [Pen];
      expect(p.x / 1000).toBeCloseTo(DEFAULT_PHYSICS.fullPowerSlide * power, 0);
      expect(p.y).toBe(0);
      expect(p.a).toBe(0);
    }
  });

  it('spins the pen when flicked off-centre — the sign follows the anchor', () => {
    const at = (anchor: number) =>
      simulateShot([pen(0, 0, 0)], HUGE, 0, { anchor, angle: Math.PI / 2, power: 0.5 })
        .final[0] as Pen;
    expect(at(1).a).toBeGreaterThan(1000);
    expect(at(-1).a).toBeLessThan(-1000);
    expect(at(1).a).toBe(-at(-1).a);
    // The same impulse moves the pen just as far, spin or not.
    expect(Math.abs(at(1).y - at(0).y)).toBeLessThan(50);
  });

  it('is deterministic and stores integers only', () => {
    const table = [
      pen(0, -3000, -2000, 3000),
      pen(1, 3000, 2000, 21000),
      pen(2, -3000, 2000, -8000),
    ];
    const shot = { anchor: 0.3, angle: 0.588, power: 0.9 };
    const a = simulateShot(table, DESK, 0, shot);
    const b = simulateShot(table, DESK, 0, shot);
    expect(a).toEqual(b);
    for (const p of a.final)
      for (const v of [p.x, p.y, p.a]) expect(Number.isInteger(v)).toBe(true);
  });

  it('matches the golden result for a fixed shot (same Node version)', () => {
    const table = [pen(0, -3000, 0, QUARTER), pen(1, 0, 0, QUARTER), pen(2, 2000, 1500, 7000)];
    const r = simulateShot(table, DESK, 0, { anchor: 0.2, angle: 0, power: 0.8 });
    expect({ steps: r.steps, final: r.final, collisions: r.collisions }).toMatchSnapshot();
  });

  it('stops at the step cap even if pens are still moving', () => {
    const r = simulateShot(
      [pen(0, 0, 0)],
      HUGE,
      0,
      { anchor: 0, angle: 0, power: 1 },
      {
        ...DEFAULT_PHYSICS,
        maxSteps: 30,
      },
    );
    expect(r.steps).toBe(30);
    expect(r.frames).toHaveLength(30 / KEYFRAME_EVERY);
  });
});

describe('collisions and bouncing', () => {
  it('reports a hit once, with its strength, and passes momentum on', () => {
    const r = simulateShot([pen(0, -3000, 0, QUARTER), pen(1, 0, 0, QUARTER)], DESK, 0, {
      anchor: 0,
      angle: 0,
      power: 0.6,
    });
    expect(r.collisions).toHaveLength(1);
    expect(r.collisions[0]).toMatchObject({ a: 0, b: 1 });
    expect(r.collisions[0]?.impulse).toBeGreaterThan(0);
    const [shooter, target] = r.final as [Pen, Pen];
    expect(target.x).toBeGreaterThan(500); // knocked forward
    expect(shooter.x).toBeLessThan(target.x); // never passes through (bullet bodies)
    // Without the other pen the shooter would have slid much further.
    const alone = simulateShot([pen(0, -3000, 0, QUARTER)], HUGE, 0, {
      anchor: 0,
      angle: 0,
      power: 0.6,
    });
    expect(shooter.x).toBeLessThan((alone.final[0] as Pen).x);
  });

  it('never tunnels through a pen at full power', () => {
    for (let a = 0; a < 8; a++) {
      const r = simulateShot(
        [pen(0, -4000, 0, QUARTER), pen(1, -1500, 0, Math.round((a * Math.PI * ANGLE_SCALE) / 8))],
        HUGE,
        0,
        { anchor: 0, angle: 0, power: 1 },
      );
      expect(r.collisions.length).toBeGreaterThan(0);
    }
  });
});

describe('elimination', () => {
  const tap = { anchor: 0, angle: Math.PI, power: 0.05 }; // a tiny flick far away

  it('eliminates a pen when its centre of mass leaves the desk — not when it only overhangs', () => {
    // Centre exactly on the edge, and centre inside with an end hanging over: both stay.
    const r = simulateShot(
      [pen(0, -3000, 0), pen(1, 5000, 0, QUARTER), pen(2, 4600, 2000, 0)],
      DESK,
      0,
      tap,
    );
    expect(r.eliminations).toEqual([]);
    expect(r.final.every((p) => p.alive)).toBe(true);
  });

  it('records the tick and distance, takes the pen off, and keeps where it left', () => {
    const r = simulateShot([pen(0, 2000, 0, QUARTER), pen(1, 4200, 0, QUARTER)], DESK, 0, {
      anchor: 0,
      angle: 0,
      power: 0.7,
    });
    expect(r.eliminations.map((e) => e.seat)).toContain(1);
    const out = r.eliminations.find((e) => e.seat === 1);
    expect(out?.tick).toBeGreaterThan(0);
    expect(out?.dist).toBeGreaterThan(5000);
    const gone = r.final.find((p) => p.seat === 1) as Pen;
    expect(gone.alive).toBe(false);
    expect(Math.abs(gone.x)).toBeGreaterThan(5000);
    // Its exit position is in the keyframe after it left, and nothing after that.
    const tracks = buildTracks(r.start, r.frames, r.steps);
    const last = tracks.get(1)?.at(-1);
    expect(last?.[1]).toBe(gone.x);
  });

  it('counts self-eliminations', () => {
    const r = simulateShot([pen(0, 4000, 0), pen(1, -3000, 0)], DESK, 0, {
      anchor: 0,
      angle: 0,
      power: 0.6,
    });
    expect(r.eliminations.map((e) => e.seat)).toEqual([0]);
  });

  it('can knock out several pens in one shot, each at its own tick', () => {
    // A pen lying across the desk hits two pens near the edge at once.
    const r = simulateShot(
      [pen(0, 2600, 0, QUARTER), pen(1, 4300, -800, QUARTER), pen(2, 4300, 800, QUARTER)],
      DESK,
      0,
      { anchor: 0, angle: 0, power: 1 },
    );
    expect(r.eliminations.map((e) => e.seat).sort()).toEqual([1, 2]);
    const ticks = r.eliminations.map((e) => e.tick);
    expect([...ticks].sort((x, y) => x - y)).toEqual(ticks); // reported in order
  });
});

describe('keyframes and replay', () => {
  const table = [
    pen(0, -3000, -500, QUARTER),
    pen(1, 0, 0, 5000),
    pen(2, 2500, 1500, 0),
    pen(3, -2000, 2500, 9000),
  ];
  const r = simulateShot(table, DESK, 0, { anchor: 0.4, angle: 0.15, power: 0.9 });

  it('sends only pens that moved, ends on the final state, and stays small', () => {
    expect(r.start).toHaveLength(4);
    expect(frameTick(r.frames.length - 1, r.frames.length, r.steps)).toBe(r.steps);
    const resting = r.frames.at(-1)?.length ?? 0;
    expect(resting).toBeLessThanOrEqual(4);
    expect(JSON.stringify(r.frames).length).toBeLessThan(16 * 1024);
    const end = poseAt(buildTracks(r.start, r.frames, r.steps), r.steps);
    for (const p of r.final.filter((x) => x.alive)) {
      expect(end.get(p.seat)).toEqual({ x: p.x, y: p.y, a: p.a });
    }
  });

  it('interpolates between keyframes, angles the short way round', () => {
    const tracks = new Map([
      [
        0,
        [
          [0, 0, 0, 31000],
          [2, 100, -100, -31000],
        ] as [number, number, number, number][],
      ],
    ]);
    const mid = poseAt(tracks, 1).get(0);
    expect(mid?.x).toBe(50);
    expect(mid?.y).toBe(-50);
    // 3.1 rad → −3.1 rad is a small turn across ±π, not a whole turn back.
    expect(Math.abs((mid?.a ?? 0) - 31000)).toBeLessThan(1000);
    expect(poseAt(tracks, 99).get(0)).toEqual({ x: 100, y: -100, a: -31000 });
  });
});
