import { Box, Circle, Vec2, World, type Body, type Contact } from 'planck';
import {
  ANGLE_SCALE,
  KEYFRAME_EVERY,
  PEN_HALF_LENGTH,
  PEN_RADIUS,
  PHYSICS_HZ,
  POS_SCALE,
  type Boundary,
  type Collision,
  type Pen,
  type PenFrame,
  type Shot,
} from '../shared/types';
import { outsideDesk } from '../shared/table';

/**
 * Physics constants. All of them are play-test values (design §14), kept in the
 * game's options so they can be tuned without touching the rules.
 */
export interface PhysicsParams {
  /** Table friction: how quickly a sliding pen slows down (1/s). */
  linearDamping: number;
  /** How quickly a spinning pen stops spinning (1/s). */
  angularDamping: number;
  restitution: number;
  friction: number;
  density: number;
  /** How far (world units) a lone pen slides after a full-power flick through its centre. */
  fullPowerSlide: number;
  /** Steps until the simulation stops regardless (spec: 8 s at 60 Hz). */
  maxSteps: number;
  /** A pen counts as resting below these speeds (units/s, rad/s)… */
  restSpeed: number;
  restSpin: number;
  /** …for this many consecutive steps (then the shot is over). */
  restSteps: number;
  /** Pen–pen hits weaker than this impulse are not reported (no spark). */
  collisionImpulse: number;
  maxCollisions: number;
}

/**
 * Measured starting points (design §14 proposed 1.6 / 2.5 and a 12-unit slide; the
 * Phase 5 sweep showed that made almost every hit a knockout, with 3–4 s replays).
 */
export const DEFAULT_PHYSICS: PhysicsParams = {
  linearDamping: 5,
  angularDamping: 7,
  restitution: 0.45,
  friction: 0.25,
  density: 1,
  fullPowerSlide: 7,
  maxSteps: 8 * PHYSICS_HZ,
  restSpeed: 0.03,
  restSpin: 0.06,
  restSteps: 6,
  collisionImpulse: 0.05,
  maxCollisions: 40,
};

export interface ShotResult {
  /** Every pen on the desk before the flick. */
  start: PenFrame[];
  frames: PenFrame[][];
  steps: number;
  collisions: Collision[];
  /** Pens whose centre left the desk, in order, with the tick and distance from centre. */
  eliminations: { seat: number; tick: number; dist: number }[];
  /** Every pen afterwards (eliminated ones where they left, `alive: false`). */
  final: Pen[];
}

const q = (v: number) => Math.round(v * POS_SCALE);
const qa = (v: number) => Math.round(v * ANGLE_SCALE);

/** A pen is a thin box with a round cap at each end — one rigid body (Planck has no capsule). */
function createPen(world: World, pen: Pen, p: PhysicsParams): Body {
  const body = world.createBody({
    type: 'dynamic',
    position: Vec2(pen.x / POS_SCALE, pen.y / POS_SCALE),
    angle: pen.a / ANGLE_SCALE,
    linearDamping: p.linearDamping,
    angularDamping: p.angularDamping,
    bullet: true,
    userData: pen.seat,
  });
  const fixture = { density: p.density, friction: p.friction, restitution: p.restitution };
  body.createFixture(new Box(PEN_HALF_LENGTH, PEN_RADIUS), fixture);
  body.createFixture(new Circle(Vec2(PEN_HALF_LENGTH, 0), PEN_RADIUS), fixture);
  body.createFixture(new Circle(Vec2(-PEN_HALF_LENGTH, 0), PEN_RADIUS), fixture);
  return body;
}

/** Is a centre (world units) strictly outside the desk? Exactly on the edge stays in. */
const isOutside = (x: number, y: number, b: Boundary) =>
  outsideDesk(x * POS_SCALE, y * POS_SCALE, b);

/**
 * Simulates one flick — the spec's PhysicsEngine.simulateShot. Pure: a fresh
 * world is built from the (integer) pens, the flick impulse is applied at the
 * anchor point, and the world steps at a fixed 60 Hz until every pen rests or the
 * cap is reached. A pen whose centre of mass leaves the desk is eliminated at that
 * step and removed. Same input → same output (same Node build).
 */
export function simulateShot(
  pens: readonly Pen[],
  boundary: Boundary,
  shooter: number,
  shot: Shot,
  p: PhysicsParams = DEFAULT_PHYSICS,
  /** Keyframes and collisions are only needed for a real shot, not a bot's what-if. */
  record = true,
): ShotResult {
  const world = new World({ gravity: Vec2(0, 0) });
  const alive = pens.filter((pen) => pen.alive);
  const bodies = new Map<number, Body>();
  for (const pen of alive) bodies.set(pen.seat, createPen(world, pen, p));
  const start: PenFrame[] = alive.map((pen) => [pen.seat, pen.x, pen.y, pen.a]);

  // The flick: an impulse in `angle`'s direction at `anchor` along the pen.
  const body = bodies.get(shooter);
  if (body) {
    const speed = shot.power * p.fullPowerSlide * p.linearDamping;
    const impulse = body.getMass() * speed;
    const point = body.getWorldPoint(Vec2(shot.anchor * PEN_HALF_LENGTH, 0));
    body.applyLinearImpulse(
      Vec2(Math.cos(shot.angle) * impulse, Math.sin(shot.angle) * impulse),
      point,
      true,
    );
  }

  // Report each pen–pen hit once per touch, with its strength (sparks, shake).
  let tick = 0;
  const collisions: Collision[] = [];
  const pending = new Set<string>();
  const pairOf = (c: Contact): [number, number, string] => {
    const a = c.getFixtureA().getBody().getUserData() as number;
    const b = c.getFixtureB().getBody().getUserData() as number;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    return [lo, hi, `${lo}:${hi}`];
  };
  if (record) {
    world.on('begin-contact', (c) => {
      pending.add(pairOf(c)[2]);
    });
    world.on('end-contact', (c) => {
      pending.delete(pairOf(c)[2]);
    });
    world.on('post-solve', (c, impulse) => {
      const [a, b, key] = pairOf(c);
      if (!pending.has(key)) return;
      const strength = Math.max(...impulse.normalImpulses.slice(0, c.getManifold().pointCount));
      if (strength < p.collisionImpulse) return;
      pending.delete(key);
      if (collisions.length < p.maxCollisions) {
        collisions.push({ tick, a, b, impulse: Math.round(strength * 1000) });
      }
    });
  }

  const frames: PenFrame[][] = [];
  const last = new Map<number, string>(start.map((f) => [f[0], f.slice(1).join()]));
  const eliminations: ShotResult['eliminations'] = [];
  const final = new Map<number, Pen>(alive.map((pen) => [pen.seat, { ...pen }]));
  const snapshot = (seat: number, b: Body): PenFrame => {
    const pos = b.getPosition();
    return [seat, q(pos.x), q(pos.y), qa(b.getAngle())];
  };
  const exiting: PenFrame[] = [];
  const emitFrame = () => {
    const frame: PenFrame[] = exiting.splice(0);
    for (const [seat, b] of bodies) {
      const f = snapshot(seat, b);
      const key = f.slice(1).join();
      if (last.get(seat) !== key) {
        last.set(seat, key);
        frame.push(f);
      }
    }
    frames.push(frame);
  };

  let resting = 0;
  while (tick < p.maxSteps) {
    tick++;
    world.step(1 / PHYSICS_HZ, 8, 3);
    for (const [seat, b] of [...bodies]) {
      const c = b.getWorldCenter();
      if (!isOutside(c.x, c.y, boundary)) continue;
      // Record where it left (shown in the next keyframe, for the fall), then take it off.
      const f = snapshot(seat, b);
      if (record) exiting.push(f);
      final.set(seat, { seat, x: f[1], y: f[2], a: f[3], alive: false });
      eliminations.push({ seat, tick, dist: Math.round(Math.hypot(c.x, c.y) * POS_SCALE) });
      world.destroyBody(b);
      bodies.delete(seat);
    }
    const still = [...bodies.values()].every(
      (b) =>
        !b.isAwake() ||
        (b.getLinearVelocity().length() < p.restSpeed &&
          Math.abs(b.getAngularVelocity()) < p.restSpin),
    );
    resting = still ? resting + 1 : 0;
    const done = resting >= p.restSteps || bodies.size === 0;
    if (record && (tick % KEYFRAME_EVERY === 0 || done || tick === p.maxSteps)) emitFrame();
    if (done) break;
  }

  for (const [seat, b] of bodies) {
    const f = snapshot(seat, b);
    final.set(seat, { seat, x: f[1], y: f[2], a: f[3], alive: true });
  }
  return {
    start,
    frames,
    steps: tick,
    collisions,
    eliminations,
    final: pens.map((pen) => final.get(pen.seat) ?? pen),
  };
}
