import type { EdgeId } from './types';

/**
 * Grid geometry for n×n boxes: (n+1)² dots, n(n+1) horizontal and n(n+1)
 * vertical lines (2n(n+1) in all), n² boxes.
 */

export interface Edge {
  o: 'h' | 'v';
  r: number;
  c: number;
}

/** Board lines, as stored in the state. */
export interface Lines {
  n: number;
  h: readonly (number | null)[];
  v: readonly (number | null)[];
}

export const edgeCount = (n: number) => 2 * n * (n + 1);
export const boxCount = (n: number) => n * n;

export const edgeId = (o: 'h' | 'v', r: number, c: number): EdgeId => `${o}:${r}:${c}` as EdgeId;

/** Parses and bounds-checks an edge id for an n×n grid; null when invalid. */
export function parseEdge(id: string, n: number): Edge | null {
  const m = /^([hv]):(\d{1,2}):(\d{1,2})$/u.exec(id);
  if (!m) return null;
  const o = m[1] as 'h' | 'v';
  const r = Number(m[2]);
  const c = Number(m[3]);
  const ok = o === 'h' ? r <= n && c < n : r < n && c <= n;
  return ok ? { o, r, c } : null;
}

export const indexOf = (e: Edge, n: number) => (e.o === 'h' ? e.r * n + e.c : e.r * (n + 1) + e.c);

/** Who drew a line (null = not drawn). */
export function drawnBy(lines: Lines, e: Edge): number | null {
  return (e.o === 'h' ? lines.h : lines.v)[indexOf(e, lines.n)] ?? null;
}

export const isDrawn = (lines: Lines, e: Edge) => drawnBy(lines, e) !== null;

/** Every line of an n×n grid. */
export function allEdges(n: number): Edge[] {
  const out: Edge[] = [];
  for (let r = 0; r <= n; r++) for (let c = 0; c < n; c++) out.push({ o: 'h', r, c });
  for (let r = 0; r < n; r++) for (let c = 0; c <= n; c++) out.push({ o: 'v', r, c });
  return out;
}

/** The four sides of box (r, c): top, bottom, left, right. */
export function sidesOf(r: number, c: number): Edge[] {
  return [
    { o: 'h', r, c },
    { o: 'h', r: r + 1, c },
    { o: 'v', r, c },
    { o: 'v', r, c: c + 1 },
  ];
}

/** The boxes (indices r·n + c) a line borders: one on the outside, two inside. */
export function boxesOf(e: Edge, n: number): number[] {
  const out: number[] = [];
  if (e.o === 'h') {
    if (e.r > 0) out.push((e.r - 1) * n + e.c);
    if (e.r < n) out.push(e.r * n + e.c);
  } else {
    if (e.c > 0) out.push(e.r * n + e.c - 1);
    if (e.c < n) out.push(e.r * n + e.c);
  }
  return out;
}

/** How many of a box's four sides are drawn. */
export function sidesDrawn(lines: Lines, box: number): number {
  const r = Math.floor(box / lines.n);
  const c = box % lines.n;
  return sidesOf(r, c).filter((e) => isDrawn(lines, e)).length;
}

/** The free lines. */
export function freeEdges(lines: Lines): Edge[] {
  return allEdges(lines.n).filter((e) => !isDrawn(lines, e));
}

/** Boxes that drawing `e` would complete (they have the other three sides). */
export function wouldComplete(lines: Lines, e: Edge): number[] {
  if (isDrawn(lines, e)) return [];
  return boxesOf(e, lines.n).filter((b) => sidesDrawn(lines, b) === 3);
}

/** A free line is "safe" when it gives no box its third side (nothing to take next). */
export function isSafe(lines: Lines, e: Edge): boolean {
  return boxesOf(e, lines.n).every((b) => sidesDrawn(lines, b) < 2);
}
