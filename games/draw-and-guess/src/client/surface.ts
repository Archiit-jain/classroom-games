import { getStroke } from 'perfect-freehand';
import { BRUSH_SIZES, CANVAS_WIDTH, Drawing, PALETTE, type Stroke } from '../shared';

/** perfect-freehand's outline polygon → a smooth closed path (its recommended quadratic join). */
function outlinePath(outline: number[][]): Path2D {
  const path = new Path2D();
  const n = outline.length;
  const first = outline[0];
  if (!first || n < 2) return path;
  path.moveTo(first[0] as number, first[1] as number);
  for (let i = 0; i < n; i++) {
    const [ax, ay] = outline[i] as [number, number];
    const [bx, by] = outline[(i + 1) % n] as [number, number];
    path.quadraticCurveTo(ax, ay, (ax + bx) / 2, (ay + by) / 2);
  }
  path.closePath();
  return path;
}

/** Paints one stroke in canvas units (the context is already scaled). Erasers cut through to the paper. */
function paintStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, done: boolean): void {
  const points: [number, number][] = [];
  for (let i = 0; i + 1 < stroke.points.length; i += 2) {
    points.push([stroke.points[i] as number, stroke.points[i + 1] as number]);
  }
  const eraser = stroke.tool === 'eraser';
  const outline = getStroke(points, {
    size: BRUSH_SIZES[stroke.size] ?? BRUSH_SIZES[1],
    thinning: eraser ? 0 : 0.35,
    smoothing: 0.5,
    streamline: 0.3,
    simulatePressure: !eraser,
    last: done,
  });
  ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over';
  ctx.fillStyle = eraser ? '#000' : (PALETTE[stroke.colour] ?? PALETTE[0]);
  ctx.fill(outlinePath(outline));
}

/**
 * Renders a Drawing onto a canvas. Finished strokes are baked into an offscreen
 * cache, so each frame only repaints the stroke still being drawn; undo, clear and
 * resizes rebuild the cache. The canvas itself is transparent — the paper is CSS.
 */
class DrawingRenderer {
  private readonly cache = document.createElement('canvas');
  private bakedEpoch = -1;
  private baked = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  resize(width: number, height: number): void {
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = this.cache.width = width;
    this.canvas.height = this.cache.height = height;
    this.bakedEpoch = -1;
  }

  render(drawing: Drawing): void {
    const ctx = this.canvas.getContext('2d');
    const cache = this.cache.getContext('2d');
    if (!ctx || !cache) return;
    const { width, height } = this.canvas;
    const scale = width / CANVAS_WIDTH;
    if (this.bakedEpoch !== drawing.epoch) {
      cache.setTransform(1, 0, 0, 1, 0, 0);
      cache.clearRect(0, 0, width, height);
      this.baked = 0;
      this.bakedEpoch = drawing.epoch;
    }
    const settled = Math.max(0, drawing.strokes.length - 1);
    cache.setTransform(scale, 0, 0, scale, 0, 0);
    for (; this.baked < settled; this.baked++) {
      paintStroke(cache, drawing.strokes[this.baked] as Stroke, true);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, width, height);
    if (width > 0 && height > 0) ctx.drawImage(this.cache, 0, 0);
    const live = drawing.strokes[settled];
    if (live) {
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      paintStroke(ctx, live, false);
    }
  }
}

/**
 * The board's picture: the Drawing model plus a renderer attached to the canvas
 * element. Changes are painted on the next animation frame (coalesced).
 */
export class DrawingSurface {
  readonly drawing = new Drawing();
  private renderer: DrawingRenderer | null = null;
  private frame = 0;
  private readonly listeners = new Set<() => void>();

  attach(canvas: HTMLCanvasElement): () => void {
    this.renderer = new DrawingRenderer(canvas);
    this.invalidate();
    return () => {
      if (this.frame) cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.renderer = null;
    };
  }

  resize(width: number, height: number): void {
    this.renderer?.resize(width, height);
    this.invalidate();
  }

  /** Call after changing `drawing`. */
  invalidate(): void {
    for (const listener of this.listeners) listener();
    if (this.frame || !this.renderer) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderer?.render(this.drawing);
    });
  }

  /** For useSyncExternalStore: notified on every change. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  strokeCount = (): number => this.drawing.strokes.length;
}
