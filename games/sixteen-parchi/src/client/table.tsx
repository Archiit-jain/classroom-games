import { formatMessage, type BoardReaction, type EffectsMode } from '@cg/game-sdk/client';
import { Avatar, ReactionBubble, durationFor, seatAccent } from '@cg/ui';
import { motion } from 'motion/react';
import { useEffect, useState, type RefObject } from 'react';
import { ITEM_LABELS } from '../../content/en';
import type { Finish, PassMove } from '../shared/types';
import { Medal } from './icons/game';
import { parchiMessages as m, type ParchiMessageKey } from './messages';
import { Slip } from './Slip';

export const f = (key: ParchiMessageKey, params?: Record<string, string | number>) =>
  formatMessage(m[key], params);
export const placeLabel = (place: number) =>
  f(`place${Math.min(4, Math.max(1, place))}` as ParchiMessageKey);
export const itemLabel = (item: string) => ITEM_LABELS[item] ?? item;

/**
 * Seats relative to the viewer: you at the bottom; play goes clockwise, so
 * the seat after yours is drawn on your LEFT (you pass left, receive from the right).
 */
export const POSITIONS = ['bottom', 'left', 'top', 'right'] as const;
export type Position = (typeof POSITIONS)[number];
export const positionOf = (seat: number, me: number): Position =>
  POSITIONS[(((seat - me) % 4) + 4) % 4] as Position;

/** Where things sit on the table, as fractions of its box (flights and arrows). */
const ANCHOR: Record<Position, [number, number]> = {
  bottom: [0.5, 0.88],
  left: [0.11, 0.47],
  top: [0.5, 0.11],
  right: [0.89, 0.47],
};
const PASS_SPOT: [number, number] = [0.5, 0.58];
const HAND_ENTRY: [number, number] = [0.5, 1.08];
/** Angle of each position on the direction ring (SVG degrees, clockwise from +x). */
const ANGLE: Record<Position, number> = { bottom: 90, left: 180, top: 270, right: 360 };

/** Size of an element, kept up to date with a ResizeObserver. */
export function useElementSize(ref: RefObject<HTMLElement | null>): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((s) => (s.w === width && s.h === height ? s : { w: width, h: height }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

// ───────────────────────────── seats ─────────────────────────────

export interface SeatSpotProps {
  seat: number;
  position: Position;
  name: string;
  isMe: boolean;
  isBot: boolean;
  selected: boolean;
  finish: Finish | undefined;
  justFinished: boolean;
  reaction: BoardReaction | undefined;
  dealKey: number | null;
  effects: EffectsMode;
}

/** How far toward the table centre a seat's slips start when dealt. */
const DEAL_FROM: Record<Position, { x: number; y: number }> = {
  bottom: { x: 0, y: -90 },
  top: { x: 0, y: 90 },
  left: { x: 90, y: 0 },
  right: { x: -90, y: 0 },
};

export function SeatSpot(p: SeatSpotProps) {
  const classes = [
    'sp-seat',
    `sp-seat--${p.position}`,
    p.isMe && 'is-me',
    p.finish && 'is-done',
    p.selected && 'is-selected',
  ]
    .filter(Boolean)
    .join(' ');
  const label = p.finish
    ? f('finishedSeat', { name: p.name, place: placeLabel(p.finish.place) })
    : p.name;
  const waveMs = durationFor(p.effects, 300, 120);
  return (
    <div className={classes} aria-label={label}>
      <div className="sp-seat__who">
        <span className="sp-seat__avatar">
          <Avatar name={p.name} accent={seatAccent(p.seat)} size={p.isMe ? 36 : 42} />
          <ReactionBubble reaction={p.reaction} />
        </span>
        <span className="sp-seat__name">
          <span className="sp-seat__label">{p.name}</span>
          {p.isMe && <span className="badge badge--you">{m.you}</span>}
          {p.isBot && <span className="badge badge--bot">{m.bot}</span>}
        </span>
      </div>

      {p.finish && p.isMe ? (
        // Your own set is shown large below the table; here just the medal.
        <span className="sp-done__medal">
          <Medal place={p.finish.place} size={28} />
        </span>
      ) : p.finish ? (
        <FinishedSet finish={p.finish} fresh={p.justFinished} effects={p.effects} />
      ) : (
        !p.isMe && (
          <div className="sp-seat__stack" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => {
              const from = DEAL_FROM[p.position];
              const lifted = p.selected && i === 3;
              return (
                <motion.span
                  key={`${p.dealKey ?? 0}-${i}`}
                  className="sp-seat__mini"
                  style={{ rotate: `${(i - 1.5) * 9}deg` }}
                  initial={
                    p.dealKey !== null && p.effects !== 'reduced'
                      ? { x: from.x, y: from.y, opacity: 0, scale: 0.5 }
                      : false
                  }
                  animate={{ x: 0, y: lifted ? -7 : 0, opacity: 1, scale: 1 }}
                  transition={{
                    duration: durationFor(p.effects, 360, 160) / 1000,
                    delay: p.dealKey !== null ? (i * waveMs) / 1000 : 0,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                >
                  <Slip item={null} folded size="mini" />
                </motion.span>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}

/** A finished player's medal and their revealed set (flips face up when fresh). */
export function FinishedSet({
  finish,
  fresh,
  effects,
}: {
  finish: Finish;
  fresh: boolean;
  effects: EffectsMode;
}) {
  const full = effects === 'full' && fresh;
  return (
    <div className="sp-done">
      <motion.span
        className="sp-done__medal"
        initial={fresh && effects !== 'reduced' ? { scale: 0, rotate: -40, y: -20 } : false}
        animate={{ scale: 1, rotate: 0, y: 0 }}
        transition={
          full
            ? { type: 'spring', stiffness: 420, damping: 13, delay: 0.55 }
            : { duration: durationFor(effects, 300, 160) / 1000 }
        }
      >
        <Medal place={finish.place} size={34} />
      </motion.span>
      <span className="sp-done__set" aria-hidden="true">
        {finish.items.map((item, i) => (
          <motion.span
            key={i}
            className="sp-done__slip"
            initial={fresh && effects !== 'reduced' ? { y: -16, opacity: 0 } : false}
            animate={{ y: 0, opacity: 1 }}
            transition={{
              duration: durationFor(effects, 260, 140) / 1000,
              delay: fresh ? i * 0.06 : 0,
            }}
          >
            <Slip item={item} folded={false} size="mini" />
          </motion.span>
        ))}
      </span>
    </div>
  );
}

// ───────────────────────────── direction ring ─────────────────────────────

/**
 * The faint clockwise ring: one arc per pass between consecutive active seats,
 * with an arrowhead in the middle. Re-routes around finished seats.
 */
export function DirectionRing({ active, me }: { active: readonly number[]; me: number }) {
  if (active.length < 2) return null;
  const sorted = [...active].sort((a, b) => a - b);
  const rx = 39;
  const ry = 36;
  const point = (deg: number) => {
    const r = (deg * Math.PI) / 180;
    return { x: 50 + rx * Math.cos(r), y: 50 + ry * Math.sin(r) };
  };
  const edges = sorted.map((from, i) => {
    const to = sorted[(i + 1) % sorted.length] as number;
    const a = ANGLE[positionOf(from, me)];
    let b = ANGLE[positionOf(to, me)];
    while (b <= a) b += 360;
    const start = point(a + 14);
    const end = point(b - 14);
    const mid = (a + b) / 2;
    return { key: `${from}-${to}`, start, end, large: b - a - 28 > 180 ? 1 : 0, mid };
  });
  return (
    <div className="sp-ring" aria-hidden="true">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        {edges.map((e) => (
          <path
            key={e.key}
            d={`M ${e.start.x} ${e.start.y} A ${rx} ${ry} 0 ${e.large} 1 ${e.end.x} ${e.end.y}`}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      {edges.map((e) => {
        const p = point(e.mid);
        return (
          <span
            key={e.key}
            className="sp-ring__arrow"
            style={{ left: `${p.x}%`, top: `${p.y}%`, rotate: `${e.mid - 180}deg` }}
          />
        );
      })}
    </div>
  );
}

// ───────────────────────────── pass flights ─────────────────────────────

/**
 * The folded slips flying one seat clockwise (at most four in flight).
 * Full: curved paths with flutter; lite: straight slides; reduced: nothing.
 */
export function PassFlights({
  moves,
  me,
  size,
  effects,
  flightKey,
}: {
  moves: readonly PassMove[];
  me: number;
  size: { w: number; h: number };
  effects: EffectsMode;
  flightKey: number;
}) {
  if (effects === 'reduced' || size.w === 0) return null;
  const at = (fraction: [number, number]) => ({ x: fraction[0] * size.w, y: fraction[1] * size.h });
  const duration = durationFor(effects, 800, 480) / 1000;
  return (
    <div className="sp-flights" aria-hidden="true">
      {moves.map(({ from, to }, i) => {
        const a = at(from === me ? PASS_SPOT : ANCHOR[positionOf(from, me)]);
        const b = at(to === me ? HAND_ENTRY : ANCHOR[positionOf(to, me)]);
        // Curve toward the middle of the table.
        const c = at([0.5, 0.5]);
        const mid = {
          x: (a.x + b.x) / 2 + (c.x - (a.x + b.x) / 2) * 0.45,
          y: (a.y + b.y) / 2 + (c.y - (a.y + b.y) / 2) * 0.45,
        };
        const full = effects === 'full';
        return (
          <motion.span
            key={`${flightKey}-${i}`}
            className="sp-flight"
            initial={{ x: a.x, y: a.y, opacity: 1, rotate: 0 }}
            animate={{
              x: full ? [a.x, mid.x, b.x] : [a.x, b.x],
              y: full ? [a.y, mid.y, b.y] : [a.y, b.y],
              rotate: full ? [0, i % 2 ? 24 : -24, i % 2 ? -8 : 8, 0] : 0,
              opacity: [1, 1, 0],
            }}
            transition={{ duration, ease: 'easeInOut' }}
          >
            <Slip item={null} folded size="mini" />
          </motion.span>
        );
      })}
    </div>
  );
}
