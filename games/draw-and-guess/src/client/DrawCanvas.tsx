import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { CANVAS_HEIGHT, CANVAS_WIDTH, MAX_POINTS_PER_CHUNK, type Op } from '../shared';
import type { DrawingSurface } from './surface';

export interface Brush {
  tool: 'pen' | 'eraser';
  colour: number;
  size: number;
}

/** Points are batched and sent this often while drawing (≈ 16 chunks/s, under the 20/s limit). */
const FLUSH_MS = 60;
/** Points closer than this (canvas units) to the previous one are skipped. */
const MIN_STEP = 12;
/** Backing-store cap: device pixels across, whatever the screen. */
const MAX_PIXEL_WIDTH = 2048;

interface LiveStroke extends Brush {
  id: number;
  last: [number, number];
  pending: number[];
  timer: number;
}

const clamp = (v: number, max: number) => Math.min(max, Math.max(0, Math.round(v)));

/**
 * The 4:3 paper canvas. Everyone sees the surface's drawing; the drawer also
 * draws on it: points are applied locally at once and sent in small batches.
 */
export function DrawCanvas({
  surface,
  canDraw,
  brush,
  send,
  label,
  hidden,
  children,
}: {
  surface: DrawingSurface;
  canDraw: boolean;
  brush: Brush;
  send(op: Op): void;
  label: string;
  /** Hidden by this viewer (safety): the drawing keeps updating underneath. */
  hidden: boolean;
  /** Overlays (word cards, the reveal stamp, …). */
  children?: ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef<LiveStroke | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    return canvas ? surface.attach(canvas) : undefined;
  }, [surface]);

  // Keep the backing store matched to the on-screen size × devicePixelRatio.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.min(MAX_PIXEL_WIDTH, Math.round(entry.contentRect.width * dpr));
      surface.resize(width, Math.round((width * CANVAS_HEIGHT) / CANVAS_WIDTH));
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [surface]);

  const flush = () => {
    const stroke = live.current;
    if (!stroke) return;
    while (stroke.pending.length > 0) {
      const points = stroke.pending.splice(0, MAX_POINTS_PER_CHUNK * 2);
      const { id, tool, colour, size } = stroke;
      send({ op: 'stroke', id, tool, colour, size, points });
    }
  };

  const finish = () => {
    const stroke = live.current;
    if (!stroke) return;
    window.clearInterval(stroke.timer);
    flush();
    live.current = null;
  };

  // Time's up (or the turn ended) mid-stroke: stop without sending more.
  useEffect(() => {
    if (canDraw) return;
    if (live.current) window.clearInterval(live.current.timer);
    live.current = null;
  }, [canDraw]);
  // Unmounted mid-stroke: stop the batch timer.
  useEffect(
    () => () => {
      if (live.current) window.clearInterval(live.current.timer);
    },
    [],
  );

  const toCanvas = (e: { clientX: number; clientY: number }): [number, number] => {
    const rect = (canvasRef.current as HTMLCanvasElement).getBoundingClientRect();
    return [
      clamp(((e.clientX - rect.left) / rect.width) * CANVAS_WIDTH, CANVAS_WIDTH - 1),
      clamp(((e.clientY - rect.top) / rect.height) * CANVAS_HEIGHT, CANVAS_HEIGHT - 1),
    ];
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!canDraw || e.button > 0 || live.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const point = toCanvas(e);
    const id = surface.drawing.nextStrokeId();
    live.current = {
      ...brush,
      id,
      last: point,
      pending: [...point],
      timer: window.setInterval(flush, FLUSH_MS),
    };
    surface.drawing.apply({ op: 'stroke', id, ...brush, points: [...point] });
    surface.invalidate();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const stroke = live.current;
    if (!stroke) return;
    const native = e.nativeEvent;
    const samples = native.getCoalescedEvents?.() ?? [];
    for (const sample of samples.length > 0 ? samples : [native]) {
      const point = toCanvas(sample);
      if (Math.hypot(point[0] - stroke.last[0], point[1] - stroke.last[1]) < MIN_STEP) continue;
      stroke.last = point;
      stroke.pending.push(...point);
      const { id, tool, colour, size } = stroke;
      surface.drawing.apply({ op: 'stroke', id, tool, colour, size, points: [...point] });
    }
    surface.invalidate();
  };

  return (
    <div className={`dg-paper${canDraw ? ' dg-paper--drawing' : ''}`} ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="dg-canvas"
        role="img"
        aria-label={label}
        style={hidden ? { visibility: 'hidden' } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
      />
      {children}
    </div>
  );
}
