import { ANGLE_SCALE, DESK_HEIGHT, PEN_HALF_LENGTH, POS_SCALE, type Pen } from '../shared';

/** Drag length (canvas units) for full strength: 35 % of the desk's short side (play-test value). */
export const FULL_DRAG = Math.round(0.35 * DESK_HEIGHT * POS_SCALE);
/** Releasing closer than this to where the drag started cancels the flick. */
export const DEAD_ZONE = 250;
export const MIN_POWER = 0.05;

export interface Point {
  x: number;
  y: number;
}

const HALF = PEN_HALF_LENGTH * POS_SCALE;
const axisOf = (pen: Pen): Point => ({
  x: Math.cos(pen.a / ANGLE_SCALE),
  y: Math.sin(pen.a / ANGLE_SCALE),
});

/** Where along the pen a point is: −1 (one end) … 1 (the other), clamped. */
export function anchorAt(pen: Pen, p: Point): number {
  const axis = axisOf(pen);
  const along = ((p.x - pen.x) * axis.x + (p.y - pen.y) * axis.y) / HALF;
  return Math.max(-1, Math.min(1, Math.round(along * 100) / 100));
}

/** The point on the pen for an anchor. */
export function anchorPoint(pen: Pen, anchor: number): Point {
  const axis = axisOf(pen);
  return { x: pen.x + axis.x * anchor * HALF, y: pen.y + axis.y * anchor * HALF };
}

/** Distance from a point to the pen (its centre line). */
export function distanceToPen(pen: Pen, p: Point): number {
  const q = anchorPoint(pen, anchorAt(pen, p));
  return Math.hypot(p.x - q.x, p.y - q.y);
}

/**
 * Slingshot: the flick goes the opposite way to the drag, as hard as the drag is
 * long (full at FULL_DRAG). Null inside the dead zone (= cancel).
 */
export function shotFromDrag(from: Point, to: Point): { angle: number; power: number } | null {
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  const length = Math.hypot(dx, dy);
  if (length < DEAD_ZONE) return null;
  return {
    angle: Math.atan2(dy, dx),
    power: Math.min(1, Math.max(MIN_POWER, length / FULL_DRAG)),
  };
}
