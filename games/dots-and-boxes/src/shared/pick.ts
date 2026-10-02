import { allEdges, isDrawn, type Edge, type Lines } from './grid';

export interface PickOptions {
  /** Farther than this (in cells) from every free line: nothing (e.g. outside the paper). */
  maxDistance?: number;
  /**
   * When the two nearest free lines are within this distance of each other (in
   * cells) — a touch at a dot or a box centre — nothing is picked, so a
   * neighbouring line is never drawn by accident.
   */
  ambiguity?: number;
}

/** Distance from point (x = column, y = row, in cells) to a line segment. */
export function distanceToEdge(e: Edge, x: number, y: number): number {
  // h:r:c runs from (c, r) to (c+1, r); v:r:c from (c, r) to (c, r+1).
  const along = e.o === 'h' ? x - e.c : y - e.r;
  const across = e.o === 'h' ? y - e.r : x - e.c;
  const t = Math.min(1, Math.max(0, along));
  return Math.hypot(along - t, across);
}

/**
 * The free line nearest to a touch or the mouse — every free line owns the area
 * closer to it than to any other, so targets are as large as possible. Returns
 * null when nothing is near, or when the touch is ambiguous.
 */
export function nearestFreeEdge(
  lines: Lines,
  x: number,
  y: number,
  { maxDistance = 0.75, ambiguity = 0.15 }: PickOptions = {},
): Edge | null {
  let best: { e: Edge; d: number } | null = null;
  let second = Number.POSITIVE_INFINITY;
  for (const e of allEdges(lines.n)) {
    if (isDrawn(lines, e)) continue;
    const d = distanceToEdge(e, x, y);
    if (!best || d < best.d) {
      if (best) second = best.d;
      best = { e, d };
    } else if (d < second) {
      second = d;
    }
  }
  if (!best || best.d > maxDistance) return null;
  if (second - best.d < ambiguity) return null;
  return best.e;
}
