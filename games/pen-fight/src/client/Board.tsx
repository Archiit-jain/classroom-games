import type { BoardProps, BoardReaction, EffectsMode } from '@cg/game-sdk/client';
import type { SeatView } from '@cg/protocol';
import {
  Avatar,
  CountdownRing,
  ReactionBubble,
  Stamp,
  accentVar,
  durationFor,
  seatAccent,
} from '@cg/ui';
import { AnimatePresence, motion } from 'motion/react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ANGLE_SCALE,
  DESK_HEIGHT,
  DESK_WIDTH,
  PEN_HALF_LENGTH,
  PEN_RADIUS,
  PHYSICS_HZ,
  POS_SCALE,
  buildTracks,
  deskAfter,
  poseAt,
  type Boundary,
  type FightAction,
  type FightEvent,
  type FightView,
  type Pose,
} from '../shared';
import { MIN_POWER, anchorAt, anchorPoint, distanceToPen, shotFromDrag, type Point } from './aim';
import { CrownIcon } from './icons';
import { f, placeLabel } from './messages';
import './pen-fight.css';

type ShotPlayed = Extract<FightEvent, { type: 'SHOT_PLAYED' }>;

/** Ticks (1/60 s) a knocked-out pen takes to tip off the edge. */
const FALL_TICKS = 24;
/** Margin around the desk (canvas units) so falling pens stay visible. */
const MARGIN = 600;
const W = DESK_WIDTH * POS_SCALE;
const H = DESK_HEIGHT * POS_SCALE;
const HALF = PEN_HALF_LENGTH * POS_SCALE;
/** Pens are drawn a little thicker than their physics body so they read on a phone. */
const DRAWN_THICKNESS = PEN_RADIUS * POS_SCALE * 3;
const DEG = 180 / Math.PI;

// ───────────────────────────── orientation ─────────────────────────────

const PORTRAIT_QUERY = '(orientation: portrait) and (max-width: 699px)';
const subscribePortrait = (cb: () => void) => {
  const mq = window.matchMedia(PORTRAIT_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};
const isPortrait = () => window.matchMedia(PORTRAIT_QUERY).matches;
/** A phone on its side: too short for the desk under the header, so desk and controls sit side by side. */
const LANDSCAPE_QUERY = '(orientation: landscape) and (max-height: 500px)';
const subscribeLandscape = (cb: () => void) => {
  const mq = window.matchMedia(LANDSCAPE_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};
const isLandscape = () => window.matchMedia(LANDSCAPE_QUERY).matches;

/** World ↔ SVG: on a portrait phone the landscape desk is drawn turned 90° (input mapped back). */
function makeFrame(portrait: boolean) {
  return {
    portrait,
    viewBox: portrait
      ? `${-H / 2 - MARGIN} ${-W / 2 - MARGIN} ${H + 2 * MARGIN} ${W + 2 * MARGIN}`
      : `${-W / 2 - MARGIN} ${-H / 2 - MARGIN} ${W + 2 * MARGIN} ${H + 2 * MARGIN}`,
    toSvg: (x: number, y: number): [number, number] => (portrait ? [-y, x] : [x, y]),
    fromSvg: (sx: number, sy: number): Point => (portrait ? { x: sy, y: -sx } : { x: sx, y: sy }),
    /** Degrees to add to a world angle. */
    turn: portrait ? 90 : 0,
    rect: (b: Boundary) =>
      portrait
        ? { x: -b.h / 2, y: -b.w / 2, width: b.h, height: b.w }
        : { x: -b.w / 2, y: -b.h / 2, width: b.w, height: b.h },
  };
}
type Frame = ReturnType<typeof makeFrame>;

// ───────────────────────────── replay ─────────────────────────────

/**
 * Plays a shot's keyframes on this device's clock; null when there is nothing to play.
 * The pens' movement IS the game, so it plays in every effects mode — reduced motion
 * only drops the decorations (ghosts, sparks, shake, squash).
 */
function useReplay(shot: ShotPlayed | undefined, version: number) {
  const [state, setState] = useState({ version: -1, tick: 0 });
  useEffect(() => {
    if (!shot) return;
    const end = shot.steps + FALL_TICKS;
    let frame = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      const tick = Math.min(end, ((now - t0) / 1000) * PHYSICS_HZ);
      setState({ version, tick });
      if (tick < end) frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [shot, version]);
  if (!shot) return null;
  const tick = state.version === version ? state.tick : 0;
  return { tick, done: tick >= shot.steps + FALL_TICKS };
}

/** Keeps a non-null value on screen for `ms` after `key` changes (then it clears). */
function useFlash(value: string | null, key: number, ms: number): string | null {
  const [state, setState] = useState<{ key: number; value: string | null }>({ key, value: null });
  if (value !== null && state.key !== key) setState({ key, value });
  useEffect(() => {
    if (state.value === null) return;
    const timer = setTimeout(
      () => setState((s) => (s.key === state.key ? { ...s, value: null } : s)),
      ms,
    );
    return () => clearTimeout(timer);
  }, [state.key, state.value, ms]);
  return state.value;
}

interface DrawnPen extends Pose {
  seat: number;
  /** Ticks since it went over the edge (null = on the desk). */
  falling: number | null;
  /** A motion ghost this many ticks behind (full effects). */
  ghost?: number;
}

// ───────────────────────────── board ─────────────────────────────

interface Drag {
  anchor: number;
  from: Point;
  to: Point;
}

export default function PenBoard({
  view,
  events,
  version,
  me,
  seats,
  send,
  effects,
  msUntil,
  reactions,
}: BoardProps<FightView, FightAction, FightEvent>) {
  const portrait = useSyncExternalStore(subscribePortrait, isPortrait, () => false);
  const landscape = useSyncExternalStore(subscribeLandscape, isLandscape, () => false);
  const frame = useMemo(() => makeFrame(portrait), [portrait]);
  const svgRef = useRef<SVGSVGElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // On a phone on its side the page header would push the desk off screen: bring the game
  // itself to the top when it starts that way and whenever the phone is turned.
  useEffect(() => {
    if (landscape) rootRef.current?.scrollIntoView({ block: 'start' });
  }, [landscape]);

  const seatInfo = (seat: number): SeatView | undefined => seats.find((s) => s.seat === seat);
  const nameOf = (seat: number) => seatInfo(seat)?.displayName ?? `#${seat + 1}`;
  const shownName = (seat: number) => (seat === me ? f('you') : nameOf(seat));
  const myPen = view.pens.find((p) => p.seat === me && p.alive);
  const iControl = seatInfo(me)?.controller !== 'BOT';
  const canAim = view.phase === 'AIMING' && view.active === me && !!myPen && iControl;

  // ── what this update shows ──
  const shot = events.find((e): e is ShotPlayed => e.type === 'SHOT_PLAYED');
  const shrunk = events.find(
    (e): e is Extract<FightEvent, { type: 'DESK_SHRUNK' }> => e.type === 'DESK_SHRUNK',
  );
  const armedNow = events.some((e) => e.type === 'SUDDEN_DEATH_ARMED');
  const skipped = events.find(
    (e): e is Extract<FightEvent, { type: 'TURN_SKIPPED' }> => e.type === 'TURN_SKIPPED',
  );
  const replay = useReplay(shot, version);
  // The sudden-death banner shows briefly, then gets out of the way (the status line keeps it).
  const banner = useFlash(shrunk ? 'shrink' : armedNow ? 'armed' : null, version, 1800);
  const tracks = useMemo(
    () => (shot ? buildTracks(shot.start, shot.frames, shot.steps) : null),
    [shot],
  );
  const sparks = useMemo(() => {
    if (!shot || !tracks) return [];
    return shot.collisions.map((c, i) => {
      const poses = poseAt(tracks, c.tick);
      const a = poses.get(c.a);
      const b = poses.get(c.b);
      return {
        key: `${version}-${i}`,
        tick: c.tick,
        impulse: c.impulse,
        x: a && b ? (a.x + b.x) / 2 : 0,
        y: a && b ? (a.y + b.y) / 2 : 0,
      };
    });
  }, [shot, tracks, version]);

  const playing = replay !== null && !replay.done && tracks !== null && shot !== undefined;
  let drawn: DrawnPen[];
  const ghosts: DrawnPen[] = [];
  if (playing) {
    const poses = poseAt(tracks, replay.tick);
    if (effects === 'full') {
      // Motion ghosts behind fast pens: a flick, not a slide.
      for (const back of [3, 6]) {
        for (const [seat, pose] of poseAt(tracks, Math.max(0, replay.tick - back))) {
          const now = poses.get(seat);
          if (now && Math.hypot(now.x - pose.x, now.y - pose.y) > 120 * back) {
            ghosts.push({ seat, ...pose, falling: null, ghost: back });
          }
        }
      }
    }
    drawn = [...poses].map(([seat, pose]) => {
      const out = shot.eliminations.find((e) => e.seat === seat);
      return {
        seat,
        ...pose,
        falling: out && replay.tick >= out.tick ? replay.tick - out.tick : null,
      };
    });
  } else {
    drawn = view.pens.filter((p) => p.alive).map((p) => ({ ...p, falling: null }));
  }
  const tick = replay?.tick ?? 0;
  const liveSparks = playing ? sparks.filter((s) => tick >= s.tick && tick < s.tick + 14) : [];
  const shaking =
    effects === 'full' &&
    playing &&
    sparks.some((s) => s.impulse >= 400 && tick >= s.tick && tick < s.tick + 9);

  // ── aiming: drag (slingshot), spin strip, keyboard ──
  const [drag, setDrag] = useState<Drag | null>(null);
  const [strip, setStrip] = useState<{ turn: string; anchor: number } | null>(null);
  const [keys, setKeys] = useState<{ turn: string; angle: number; power: number } | null>(null);
  const [sending, setSending] = useState(false);
  const turnKey = `${view.round}:${view.active}:${view.phaseEndsAt}`;
  const stripAnchor = strip?.turn === turnKey ? strip.anchor : null;
  const keyAim = keys?.turn === turnKey ? keys : null;

  const worldPoint = (e: { clientX: number; clientY: number }): Point | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return frame.fromSvg(pt.x, pt.y);
  };

  const fire = async (anchor: number, angle: number, power: number) => {
    if (sending) return;
    setSending(true);
    setDrag(null);
    if (effects !== 'reduced' && typeof navigator !== 'undefined') navigator.vibrate?.(25);
    await send({ type: 'FLICK', anchor, angle, power });
    setSending(false);
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!canAim || !myPen || sending || e.button > 0) return;
    const p = worldPoint(e);
    const svg = svgRef.current;
    if (!p || !svg) return;
    const unitsPerPx = (W + 2 * MARGIN) / Math.max(svg.getBoundingClientRect().width, 1);
    // A generous touch target around a thin pen: at least 26 px either side.
    if (distanceToPen(myPen, p) > Math.max(260, 26 * unitsPerPx)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const anchor = stripAnchor ?? anchorAt(myPen, p);
    setDrag({ anchor, from: anchorPoint(myPen, anchor), to: p });
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const p = worldPoint(e);
    if (p) setDrag({ ...drag, to: p });
  };
  const onPointerUp = () => {
    if (!drag) return;
    const aim = shotFromDrag(drag.from, drag.to);
    setDrag(null);
    if (aim && canAim) void fire(drag.anchor, aim.angle, aim.power);
  };

  const towardCentre = myPen ? Math.atan2(-myPen.y, -myPen.x) : 0;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!canAim) return;
    const aim = keyAim ?? { turn: turnKey, angle: towardCentre, power: 0.5 };
    const step = e.shiftKey ? 10 : 2;
    const anchor = stripAnchor ?? 0;
    let next = aim;
    switch (e.key) {
      case 'ArrowLeft':
        next = { ...aim, angle: aim.angle - step / DEG };
        break;
      case 'ArrowRight':
        next = { ...aim, angle: aim.angle + step / DEG };
        break;
      case 'ArrowUp':
        next = { ...aim, power: Math.min(1, aim.power + 0.05) };
        break;
      case 'ArrowDown':
        next = { ...aim, power: Math.max(MIN_POWER, aim.power - 0.05) };
        break;
      case 'a':
      case 'A':
        setStrip({ turn: turnKey, anchor: Math.max(-1, anchor - 0.25) });
        break;
      case 'd':
      case 'D':
        setStrip({ turn: turnKey, anchor: Math.min(1, anchor + 0.25) });
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        void fire(anchor, aim.angle, aim.power);
        return;
      case 'Escape':
        setKeys(null);
        setStrip(null);
        return;
      default:
        return;
    }
    e.preventDefault();
    setKeys(next);
  };

  // The aim preview: from a drag, or from the keyboard.
  let preview: { anchor: number; angle: number; power: number; band: Drag | null } | null = null;
  if (canAim && myPen && drag) {
    const aim = shotFromDrag(drag.from, drag.to);
    if (aim) preview = { anchor: drag.anchor, ...aim, band: drag };
  } else if (canAim && myPen && keyAim) {
    preview = { anchor: stripAnchor ?? 0, angle: keyAim.angle, power: keyAim.power, band: null };
  }
  const shownAnchor = drag?.anchor ?? stripAnchor ?? 0;

  // ── text ──
  const activeName = nameOf(view.active);
  const winner =
    view.phase === 'OVER'
      ? Object.entries(view.places)
          .filter(([, p]) => p === 1)
          .map(([s]) => Number(s))
      : [];
  let status: string;
  if (view.phase === 'OVER') {
    status = winner.length === 1 ? f('wins', { name: nameOf(winner[0] as number) }) : f('draw');
  } else if (view.phase === 'SHRINKING') {
    status = f('shrinking');
  } else if (view.phase === 'PLAYBACK') {
    status = f('flicked', { name: nameOf(view.lastShot?.seat ?? view.active) });
  } else if (canAim) {
    status = f('yourFlick');
  } else {
    status = f('aiming', { name: activeName });
  }
  const knockedOut = playing
    ? shot.eliminations.filter((e) => tick >= e.tick).map((e) => shownName(e.seat))
    : (view.lastShot?.eliminated ?? []).map(shownName);
  const latestReaction = (seat: number): BoardReaction | undefined =>
    [...reactions].reverse().find((r) => r.seat === seat);
  const deskLabel = f('desk', {
    pens: view.pens
      .map((p) =>
        p.alive ? f('penAt', { name: nameOf(p.seat) }) : f('penOut', { name: nameOf(p.seat) }),
      )
      .join(', '),
  });

  const deskRect = frame.rect(view.boundary);
  const original = frame.rect(deskAfter(0));
  const previewRect = view.preview ? frame.rect(view.preview) : null;
  const deskTransition =
    effects === 'reduced'
      ? { duration: 0 }
      : { duration: durationFor(effects, 900, 500) / 1000, ease: 'easeInOut' as const };

  return (
    <div
      ref={rootRef}
      className={`pf${portrait ? ' pf--portrait' : ''}${landscape ? ' pf--landscape' : ''}`}
    >
      <div className="pf-top">
        <span className={`pf-round${view.suddenDeath ? ' pf-round--sd' : ''}`}>
          {f('round', { n: view.round })}
          {view.suddenDeath && ` · ${f('suddenDeath')}`}
        </span>
        <p className="pf-status" aria-live="polite">
          {status}
        </p>
        {view.phase === 'AIMING' && (
          <CountdownRing
            key={turnKey}
            deadline={view.phaseEndsAt}
            totalMs={view.phaseMs}
            msUntil={msUntil}
            size={48}
          />
        )}
      </div>

      <ol className="pf-order" aria-label={f('order')}>
        {view.order.map((seat) => {
          const info = seatInfo(seat);
          // During the replay a pen's place appears only once it has actually gone over the edge.
          const pending =
            playing && shot.eliminations.some((e) => e.seat === seat && tick < e.tick);
          const place = pending ? undefined : view.places[seat];
          return (
            <li
              key={seat}
              className={[
                'pf-player',
                seat === view.active && view.phase === 'AIMING' && 'pf-player--active',
                place !== undefined && view.phase !== 'OVER' && 'pf-player--out',
                seat === me && 'pf-player--me',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <ReactionBubble reaction={latestReaction(seat)} />
              <Avatar
                name={nameOf(seat)}
                accent={seatAccent(seat)}
                size={30}
                botLabel={info?.controller === 'BOT' ? f('bot') : undefined}
              />
              <span className="pf-player__name">{seat === me ? f('you') : nameOf(seat)}</span>
              {place !== undefined && <span className="pf-player__place">{placeLabel(place)}</span>}
            </li>
          );
        })}
      </ol>

      <div
        className={`pf-stage${shaking ? ' pf-stage--shake' : ''}`}
        tabIndex={canAim ? 0 : -1}
        role={canAim ? 'group' : undefined}
        aria-label={canAim ? f('aimControl') : undefined}
        onKeyDown={onKeyDown}
      >
        <svg
          ref={svgRef}
          className={`pf-svg${canAim ? ' pf-svg--aim' : ''}`}
          viewBox={frame.viewBox}
          role="img"
          aria-label={deskLabel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => setDrag(null)}
        >
          <defs>
            <pattern id="pf-grain" width="600" height="600" patternUnits="userSpaceOnUse">
              <path
                d="M0 120h600M0 330h600M0 510h600"
                stroke="rgba(60,28,6,0.16)"
                strokeWidth="26"
              />
            </pattern>
          </defs>
          {/* The original desk's outline stays faintly visible once it shrinks. */}
          <rect {...original} rx={260} className="pf-desk-ghost" />
          <motion.rect
            className="pf-desk"
            rx={240}
            initial={false}
            animate={deskRect}
            transition={deskTransition}
          />
          <motion.rect
            className="pf-desk-grain"
            rx={240}
            initial={false}
            animate={deskRect}
            transition={deskTransition}
          />
          {previewRect && (
            <rect
              {...previewRect}
              rx={200}
              className={`pf-preview${effects === 'reduced' ? '' : ' pf-preview--glow'}`}
            />
          )}

          {preview && myPen && <AimPreview frame={frame} pen={myPen} {...preview} />}

          {ghosts.map((pen) => (
            <PenShape
              key={`ghost-${pen.seat}-${pen.ghost}`}
              frame={frame}
              pen={pen}
              seat={pen.seat}
              mine={false}
              active={false}
              name=""
              effects={effects}
              crowned={false}
            />
          ))}
          {drawn.map((pen) => (
            <PenShape
              key={pen.seat}
              frame={frame}
              pen={pen}
              seat={pen.seat}
              mine={pen.seat === me}
              active={view.phase === 'AIMING' && pen.seat === view.active}
              name={pen.seat === me ? f('you') : nameOf(pen.seat)}
              effects={effects}
              crowned={winner.includes(pen.seat)}
              recoil={
                effects === 'full' && playing && pen.seat === shot.seat && tick < 8
                  ? 1 - tick / 8
                  : 0
              }
            />
          ))}

          {liveSparks.map((s) => {
            const [x, y] = frame.toSvg(s.x, s.y);
            return <Spark key={s.key} x={x} y={y} big={s.impulse >= 400} effects={effects} />;
          })}
        </svg>

        <AnimatePresence>
          {knockedOut.length > 0 && (view.phase === 'PLAYBACK' || playing) && (
            <motion.div
              key={`out-${view.lastShot?.seat}-${version}`}
              className="pf-flash"
              initial={effects === 'reduced' ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <Stamp tone="danger">{f('out')}</Stamp>
              <span className="pf-flash__names">{knockedOut.join(', ')}</span>
            </motion.div>
          )}
          {banner && (
            <motion.div
              key={`sd-${banner}`}
              className="pf-banner"
              role="status"
              initial={effects === 'reduced' ? false : { y: -30, opacity: 0, rotate: -3 }}
              animate={{ y: 0, opacity: 1, rotate: 0 }}
              exit={{ opacity: 0 }}
              transition={
                effects === 'full'
                  ? { type: 'spring', stiffness: 420, damping: 14 }
                  : { duration: 0.2 }
              }
            >
              <strong>{banner === 'shrink' ? f('shrinking') : f('suddenDeath')}</strong>
              {banner === 'armed' && <span>{f('shrinkSoon')}</span>}
            </motion.div>
          )}
          {view.phase === 'OVER' && (
            <motion.div
              key="winner"
              className="pf-flash"
              initial={effects === 'reduced' ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <Stamp tone="success">{winner.length === 1 ? f('winner') : f('draw')}</Stamp>
            </motion.div>
          )}
        </AnimatePresence>
        {skipped && <p className="pf-note">{f('skipped', { name: nameOf(skipped.seat) })}</p>}
      </div>

      {canAim && (
        <div className="pf-controls">
          <p className="pf-hint">{drag ? f('cancelHint') : f('howTo')}</p>
          <label className="pf-spin">
            <span className="pf-spin__label">{f('spin')}</span>
            <input
              type="range"
              className="pf-spin__input"
              min={-100}
              max={100}
              step={5}
              value={Math.round(shownAnchor * 100)}
              aria-label={f('spinStrip')}
              aria-describedby="pf-spin-hint"
              style={{ '--pen': accentVar(seatAccent(me)) } as CSSProperties}
              onChange={(e) => setStrip({ turn: turnKey, anchor: Number(e.target.value) / 100 })}
            />
          </label>
          <p id="pf-spin-hint" className="pf-hint pf-hint--small">
            {f('spinHint')} {f('howToKeys')}
          </p>
          {preview && (
            <p className="sr-only" aria-live="polite">
              {f('aimState', {
                angle: Math.round((((preview.angle * DEG) % 360) + 360) % 360),
                power: Math.round(preview.power * 100),
                spin:
                  preview.anchor > 0.05
                    ? f('spinRight')
                    : preview.anchor < -0.05
                      ? f('spinLeft')
                      : f('spinNone'),
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── pieces ─────────────────────────────

/** How far above its centre a pen (at screen angle `deg`) reaches — the name tag goes above that. */
const tagLift = (deg: number) =>
  Math.abs(Math.sin(deg / DEG)) * HALF + Math.abs(Math.cos(deg / DEG)) * DRAWN_THICKNESS + 120;

function PenShape({
  frame,
  pen,
  seat,
  mine,
  active,
  name,
  effects,
  crowned,
  recoil = 0,
}: {
  frame: Frame;
  pen: DrawnPen;
  /** 1 → 0 just after the flick: a quick squash. */
  recoil?: number;
  seat: number;
  mine: boolean;
  active: boolean;
  name: string;
  effects: EffectsMode;
  crowned: boolean;
}) {
  const [x, y] = frame.toSvg(pen.x, pen.y);
  const deg = (pen.a / ANGLE_SCALE) * DEG + frame.turn;
  const t = DRAWN_THICKNESS;
  const falling = pen.falling !== null;
  const fall = falling ? Math.min(1, (pen.falling as number) / FALL_TICKS) : 0;
  const scale = effects === 'reduced' ? 1 : 1 - 0.55 * fall;
  const squash = `scale(${scale * (1 + 0.1 * recoil)} ${scale * (1 - 0.25 * recoil)})`;
  const ghost = pen.ghost !== undefined;
  const classes = [
    'pf-pen',
    mine && 'pf-pen--mine',
    active && 'pf-pen--active',
    falling && 'pf-pen--falling',
    ghost && 'pf-pen--ghost',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <g
      className={classes}
      transform={`translate(${x} ${y})`}
      style={{
        opacity: ghost
          ? 0.22 / ((pen.ghost as number) / 3)
          : effects === 'reduced'
            ? falling
              ? 0
              : 1
            : 1 - fall,
      }}
      aria-hidden={ghost || undefined}
    >
      {active && <circle r={HALF + 260} className="pf-pen__halo" />}
      <g transform={`rotate(${deg}) ${squash}`}>
        <ellipse cx={60} cy={110} rx={HALF + 40} ry={t * 0.7} className="pf-pen__shadow" />
        {/* barrel, grip, cap (seat colour) and tip */}
        <rect
          x={-HALF}
          y={-t / 2}
          width={HALF * 2 - 160}
          height={t}
          rx={t / 2}
          className="pf-pen__barrel"
        />
        <rect x={HALF - 520} y={-t / 2} width={360} height={t} className="pf-pen__grip" />
        <path
          d={`M${HALF - 160} ${-t / 2} L${HALF} 0 L${HALF - 160} ${t / 2} Z`}
          className="pf-pen__tip"
        />
        <rect
          x={-HALF}
          y={-t / 2 - 10}
          width={430}
          height={t + 20}
          rx={t / 2}
          className="pf-pen__cap"
          style={{ fill: accentVar(seatAccent(seat)) }}
        />
        <rect
          x={-HALF + 120}
          y={-t / 2 - 50}
          width={300}
          height={50}
          rx={20}
          className="pf-pen__clip"
        />
      </g>
      {!falling && !ghost && (
        <g className="pf-pen__tag" transform={`translate(0 ${-(tagLift(deg) + 120)})`}>
          {crowned && (
            <g transform="translate(-220 -760)">
              <CrownIcon size={440} />
            </g>
          )}
          <text textAnchor="middle" className="pf-pen__name">
            {name}
          </text>
        </g>
      )}
    </g>
  );
}

function AimPreview({
  frame,
  pen,
  anchor,
  angle,
  power,
  band,
}: {
  frame: Frame;
  pen: { x: number; y: number; a: number };
  anchor: number;
  angle: number;
  power: number;
  band: Drag | null;
}) {
  const at = anchorPoint({ ...pen, seat: 0, alive: true }, anchor);
  const [ax, ay] = frame.toSvg(at.x, at.y);
  const length = 700 + power * 2300;
  const tipWorld = { x: at.x + Math.cos(angle) * length, y: at.y + Math.sin(angle) * length };
  const [tx, ty] = frame.toSvg(tipWorld.x, tipWorld.y);
  const colour = `hsl(${Math.round(50 - power * 50)} 100% 60%)`; // yellow → red with strength
  const deg = Math.atan2(ty - ay, tx - ax) * DEG;
  // Spin curl: which way the pen will turn (off-centre flicks spin it).
  const spin = Math.sign(anchor * Math.sin(angle - pen.a / ANGLE_SCALE));
  return (
    <g className="pf-aim" aria-hidden="true">
      {band && (
        <line
          x1={ax}
          y1={ay}
          x2={frame.toSvg(band.to.x, band.to.y)[0]}
          y2={frame.toSvg(band.to.x, band.to.y)[1]}
          className="pf-aim__band"
        />
      )}
      <line x1={ax} y1={ay} x2={tx} y2={ty} className="pf-aim__arrow" style={{ stroke: colour }} />
      <path
        d="M0 -140 L220 0 L0 140 Z"
        transform={`translate(${tx} ${ty}) rotate(${deg})`}
        style={{ fill: colour }}
        className="pf-aim__head"
      />
      <circle cx={ax} cy={ay} r={90} className="pf-aim__anchor" />
      {spin !== 0 && Math.abs(anchor) > 0.05 && (
        <path
          d="M -260 0 A 260 260 0 1 1 0 260"
          transform={`translate(${ax} ${ay}) scale(${spin} 1)`}
          className="pf-aim__spin"
        />
      )}
    </g>
  );
}

function Spark({
  x,
  y,
  big,
  effects,
}: {
  x: number;
  y: number;
  big: boolean;
  effects: EffectsMode;
}) {
  if (effects === 'reduced') return null;
  const rays = effects === 'full' ? 8 : 4;
  const r = big ? 520 : 320;
  return (
    <g transform={`translate(${x} ${y})`} className="pf-spark" aria-hidden="true">
      {Array.from({ length: rays }, (_, i) => {
        const a = (i / rays) * Math.PI * 2;
        return (
          <line
            key={i}
            x1={Math.cos(a) * 80}
            y1={Math.sin(a) * 80}
            x2={Math.cos(a) * r}
            y2={Math.sin(a) * r}
          />
        );
      })}
    </g>
  );
}
