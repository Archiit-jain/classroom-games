import {
  ANGLE_SCALE,
  DESK_HEIGHT,
  DESK_WIDTH,
  KEYFRAME_EVERY,
  POS_SCALE,
  type Boundary,
  type Elimination,
  type Pen,
  type PenFrame,
} from './types';

/** Each sudden-death step shrinks the desk by 6 % of its ORIGINAL size (spec). */
export const SHRINK_FRACTION = 0.06;

/** The desk after `step` shrinks (step 0 = the full desk). Never negative. */
export function deskAfter(step: number): Boundary {
  const f = Math.max(0, 1 - SHRINK_FRACTION * step);
  return {
    w: Math.round(DESK_WIDTH * POS_SCALE * f),
    h: Math.round(DESK_HEIGHT * POS_SCALE * f),
  };
}

/** Is a pen's centre (integers) strictly outside a desk? Exactly on the edge stays in. */
export function outsideDesk(x: number, y: number, b: Boundary): boolean {
  return Math.abs(x) > b.w / 2 || Math.abs(y) > b.h / 2;
}

/**
 * Places, best first: the last pen standing is 1st, the rest by reverse
 * elimination order. Same shot → the later tick ranks higher; same shrink → the
 * pen closer to the centre ranks higher; exact ties share a place (spec §13).
 */
export function placesOf(pens: readonly Pen[], eliminations: readonly Elimination[]) {
  const key = (seat: number): [number, number] => {
    const e = eliminations.find((x) => x.seat === seat);
    if (!e) return [Number.POSITIVE_INFINITY, 0];
    return [e.seq, e.cause === 'SHOT' ? e.tick : -e.dist];
  };
  const better = (a: [number, number], b: [number, number]) =>
    a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
  return pens.map((pen) => ({
    seat: pen.seat,
    place: 1 + pens.filter((o) => better(key(o.seat), key(pen.seat))).length,
  }));
}

/** Keyframe `i`'s physics tick (the last frame is at the final step). */
export function frameTick(i: number, frameCount: number, steps: number): number {
  return i === frameCount - 1 ? steps : (i + 1) * KEYFRAME_EVERY;
}

export interface Pose {
  x: number;
  y: number;
  a: number;
}

/** Per pen, its keyframes as [tick, x, y, a] (integers), starting at tick 0. */
export type Tracks = Map<number, [number, number, number, number][]>;

export function buildTracks(
  start: readonly PenFrame[],
  frames: readonly PenFrame[][],
  steps: number,
): Tracks {
  const tracks: Tracks = new Map(start.map(([seat, x, y, a]) => [seat, [[0, x, y, a]]]));
  frames.forEach((frame, i) => {
    const tick = frameTick(i, frames.length, steps);
    for (const [seat, x, y, a] of frame) tracks.get(seat)?.push([tick, x, y, a]);
  });
  return tracks;
}

const TURN = Math.round(2 * Math.PI * ANGLE_SCALE);

/**
 * Where every pen is at a (fractional) tick: linear between keyframes, angles
 * the short way round. Before its first move a pen keeps its start pose; after
 * its last keyframe it stays there.
 */
export function poseAt(tracks: Tracks, tick: number): Map<number, Pose> {
  const poses = new Map<number, Pose>();
  for (const [seat, track] of tracks) {
    let i = 0;
    while (i + 1 < track.length && (track[i + 1] as [number, number, number, number])[0] <= tick)
      i++;
    const [t0, x0, y0, a0] = track[i] as [number, number, number, number];
    const next = track[i + 1];
    if (!next || tick <= t0) {
      poses.set(seat, { x: x0, y: y0, a: a0 });
      continue;
    }
    const [t1, x1, y1, a1] = next;
    const f = (tick - t0) / (t1 - t0);
    let da = (a1 - a0) % TURN;
    if (da > TURN / 2) da -= TURN;
    if (da < -TURN / 2) da += TURN;
    poses.set(seat, { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, a: a0 + da * f });
  }
  return poses;
}
