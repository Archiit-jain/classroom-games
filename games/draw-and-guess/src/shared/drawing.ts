import type { Op, RelayedOp } from './types';

export interface Stroke {
  id: number;
  tool: 'pen' | 'eraser';
  colour: number;
  size: number;
  /** Flat [x, y, x, y, …] in canvas units. */
  points: number[];
}

/**
 * One turn's picture, rebuilt from the op log: a stroke chunk continues the last
 * stroke when the ids match (otherwise it starts a new one), undo drops the last
 * stroke, clear wipes everything. The drawer and every viewer apply the same ops in
 * the same order, so they see the same picture.
 */
export class Drawing {
  turn = 0;
  strokes: Stroke[] = [];
  /** Bumped whenever strokes are removed (undo, clear, new turn): caches must rebuild. */
  epoch = 0;
  /** Bumped on every change. */
  revision = 0;
  /** Ids only ever grow within a turn, even after undo/clear. */
  private nextId = 0;

  reset(turn: number): void {
    this.turn = turn;
    this.strokes = [];
    this.nextId = 0;
    this.epoch++;
    this.revision++;
  }

  apply(op: Op): void {
    if (op.op === 'stroke') {
      this.nextId = Math.max(this.nextId, op.id + 1);
      const last = this.strokes.at(-1);
      if (last && last.id === op.id) {
        last.points.push(...op.points);
      } else {
        const { id, tool, colour, size } = op;
        this.strokes.push({ id, tool, colour, size, points: [...op.points] });
      }
    } else if (this.strokes.length > 0) {
      this.strokes = op.op === 'undo' ? this.strokes.slice(0, -1) : [];
      this.epoch++;
    }
    this.revision++;
  }

  /**
   * Applies a relayed op. An op from a newer turn starts a fresh picture; one from
   * an older turn (late delivery) is ignored. Returns whether the picture changed.
   */
  receive(op: RelayedOp): boolean {
    if (op.turn < this.turn) return false;
    if (op.turn > this.turn) this.reset(op.turn);
    this.apply(op);
    return true;
  }

  /** Rebuilds from a full replay: the newest turn in it (or `atLeastTurn`, if newer). */
  replay(ops: readonly RelayedOp[], atLeastTurn: number): void {
    const turn = ops.reduce((t, op) => Math.max(t, op.turn), atLeastTurn);
    this.reset(turn);
    for (const op of ops) if (op.turn === turn) this.apply(op);
  }

  /** An id no stroke of this turn has used yet. */
  nextStrokeId(): number {
    return this.nextId;
  }
}
