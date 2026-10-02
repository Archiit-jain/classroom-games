import { describe, expect, it } from 'vitest';
import {
  DEAD_ZONE,
  FULL_DRAG,
  anchorAt,
  anchorPoint,
  distanceToPen,
  shotFromDrag,
} from '../src/client/aim';
import type { Pen } from '../src/shared';

const pen: Pen = { seat: 0, x: 1000, y: 500, a: 0, alive: true }; // lying along +x, half-length 1000

describe('aiming (client input → flick)', () => {
  it('turns the touch point into the anchor along the pen, clamped to its ends', () => {
    expect(anchorAt(pen, { x: 1000, y: 900 })).toBe(0);
    expect(anchorAt(pen, { x: 1500, y: 450 })).toBe(0.5);
    expect(anchorAt(pen, { x: -5000, y: 500 })).toBe(-1);
    expect(anchorPoint(pen, 1)).toEqual({ x: 2000, y: 500 });
    expect(distanceToPen(pen, { x: 1500, y: 800 })).toBe(300);
  });

  it('flicks opposite to the drag, as hard as the drag is long', () => {
    const from = { x: 0, y: 0 };
    const half = shotFromDrag(from, { x: -FULL_DRAG / 2, y: 0 });
    expect(half?.angle).toBeCloseTo(0);
    expect(half?.power).toBeCloseTo(0.5);
    expect(shotFromDrag(from, { x: 0, y: FULL_DRAG * 3 })).toEqual({
      angle: -Math.PI / 2,
      power: 1,
    });
  });

  it('cancels when released inside the dead zone', () => {
    expect(shotFromDrag({ x: 0, y: 0 }, { x: DEAD_ZONE - 1, y: 0 })).toBeNull();
  });
});
