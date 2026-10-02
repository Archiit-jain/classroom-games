/**
 * Pen Fight — shared types (engine, physics, bot and board).
 * Rules: docs/GAME_RULES/PEN_FIGHT.md (spec §13). Design: docs/design/PEN_FIGHT_DESIGN.md.
 *
 * Positions are stored as integers — milli-units (1/1000 of a world unit) and
 * angles in 1/10000 rad — exactly what clients receive, so views, replays and the
 * next simulation always agree.
 */

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

/** Integer scale of stored positions (per world unit) and angles (per radian). */
export const POS_SCALE = 1000;
export const ANGLE_SCALE = 10_000;

/** The desk (world units, centred on 0,0) and the pen shape. Play-test values. */
export const DESK_WIDTH = 10;
export const DESK_HEIGHT = 7;
export const PEN_HALF_LENGTH = 1.0;
export const PEN_RADIUS = 0.08;

/** Physics steps per second (spec) and keyframes: one every N steps. */
export const PHYSICS_HZ = 60;
export const KEYFRAME_EVERY = 2;

export type Phase = 'AIMING' | 'PLAYBACK' | 'SHRINKING' | 'OVER';

export type SeatMap<T> = Record<number, T>;

/** A pen on the desk (integers, see above). */
export interface Pen {
  seat: number;
  x: number;
  y: number;
  a: number;
  alive: boolean;
}

/** The desk edge: a rectangle centred on 0,0, in milli-units. */
export interface Boundary {
  w: number;
  h: number;
}

/** A flick: where on the pen (anchor −1…1 along it), which way (radians) and how hard (0…1). */
export interface Shot {
  anchor: number;
  angle: number;
  power: number;
}

/** One pen in a keyframe: [seat, x, y, angle] (integers). */
export type PenFrame = [number, number, number, number];

export interface Collision {
  tick: number;
  a: number;
  b: number;
  impulse: number;
}

export interface ShotElimination {
  seat: number;
  tick: number;
}

/** Why and when a pen left the desk — everything ranking needs. */
export interface Elimination {
  seat: number;
  cause: 'SHOT' | 'SHRINK';
  /** Sequence number of the shot or shrink (later = ranks higher). */
  seq: number;
  /** Physics tick within a shot (later = ranks higher). 0 for shrinks. */
  tick: number;
  /** Distance of the pen's centre from the desk centre (milli-units; closer ranks higher at a shrink). */
  dist: number;
  /** Who flicked (shots), or null. */
  by: number | null;
  round: number;
}

export interface LastShot {
  seat: number;
  eliminated: number[];
}

export interface FightTiming {
  aimMs: number;
  /** Added after the replay before the next turn (spec: + 0.5 s). */
  afterReplayMs: number;
  shrinkMs: number;
}

export interface FightState {
  phase: Phase;
  seats: number[];
  /** Turn order (seeded shuffle), fixed for the match. */
  order: number[];
  round: number;
  /** Seats still to play this round, after the active one. */
  queue: number[];
  active: number;
  pens: Pen[];
  boundary: Boundary;
  /** The next, smaller desk while sudden death is armed (shown for a whole round first). */
  preview: Boundary | null;
  /** Shrinks applied so far. */
  shrinks: number;
  /** Consecutive full rounds without an elimination (until sudden death arms). */
  quietRounds: number;
  suddenDeath: boolean;
  eliminatedThisRound: boolean;
  eliminations: Elimination[];
  /** Shots + shrinks so far (orders eliminations). */
  seq: number;
  /** Consecutive skipped turns per seat (idle detection). */
  skips: SeatMap<number>;
  /** Opponents knocked out by each seat's flicks. */
  knockouts: SeatMap<number>;
  lastShot: LastShot | null;
  phaseEndsAt: number;
  phaseMs: number;
  timing: FightTiming;
}

export type FightAction = { type: 'FLICK' } & Shot;

export type FightEvent =
  | { type: 'TURN_STARTED'; seat: number; round: number; deadline: number }
  | { type: 'TURN_SKIPPED'; seat: number }
  | {
      type: 'SHOT_PLAYED';
      seat: number;
      shot: Shot;
      /** Every pen on the desk before the flick. */
      start: PenFrame[];
      /** One per KEYFRAME_EVERY physics steps (the last one at `steps`): only pens that moved. */
      frames: PenFrame[][];
      steps: number;
      collisions: Collision[];
      eliminations: ShotElimination[];
      durationMs: number;
    }
  | { type: 'SUDDEN_DEATH_ARMED'; next: Boundary }
  | { type: 'DESK_SHRUNK'; boundary: Boundary; eliminated: number[]; next: Boundary | null }
  | { type: 'MATCH_OVER' };

/** Everything is public in Pen Fight: the view is the whole table. */
export interface FightView {
  phase: Phase;
  round: number;
  order: number[];
  active: number;
  pens: Pen[];
  boundary: Boundary;
  preview: Boundary | null;
  suddenDeath: boolean;
  quietRounds: number;
  eliminations: Elimination[];
  /** Places so far (eliminated seats only; final once the match is over). */
  places: SeatMap<number>;
  knockouts: SeatMap<number>;
  lastShot: LastShot | null;
  phaseEndsAt: number;
  phaseMs: number;
}

/** No host settings in v1. */
export type FightSettings = Record<string, never>;
