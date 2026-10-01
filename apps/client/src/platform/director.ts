/**
 * Animation director (spec §15). Server updates arrive as {version, events,
 * view}; the director presents them one at a time so each update's events can
 * animate before the next view replaces it.
 *
 * - An update that arrives while nothing is animating is presented at once.
 * - While an update animates (its total event duration), newer ones queue.
 * - If the queued animations would put the screen more than `maxLagMs`
 *   behind, it fast-forwards: the newest update is presented immediately and
 *   the skipped events are dropped (views are complete, so nothing is lost
 *   except animation).
 * - A different match resets everything.
 */

export interface PresentableUpdate {
  matchId: string;
  version: number;
  events: readonly unknown[];
}

export interface DirectorOptions<U extends PresentableUpdate> {
  /** Total animation time (ms) the board needs for this update's events. */
  durationOf(update: U): number;
  onPresent(update: U): void;
  schedule(fn: () => void, ms: number): () => void;
  maxLagMs?: number;
}

export class AnimationDirector<U extends PresentableUpdate> {
  private queue: U[] = [];
  private presented: U | null = null;
  private cancelTimer: (() => void) | null = null;
  private readonly maxLagMs: number;

  constructor(private readonly options: DirectorOptions<U>) {
    this.maxLagMs = options.maxLagMs ?? 1500;
  }

  get current(): U | null {
    return this.presented;
  }

  get pending(): number {
    return this.queue.length;
  }

  push(update: U): void {
    const last = this.queue[this.queue.length - 1] ?? this.presented;
    if (last && last.matchId !== update.matchId) {
      this.reset();
    } else if (last && update.version <= last.version) {
      return; // duplicate or out-of-order delivery
    }
    this.queue.push(update);
    this.pump();
  }

  reset(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.queue = [];
    this.presented = null;
  }

  dispose(): void {
    this.reset();
  }

  private pump(): void {
    if (this.cancelTimer || this.queue.length === 0) return;
    const backlog = this.queue.reduce((sum, u) => sum + Math.max(0, this.options.durationOf(u)), 0);
    if (this.queue.length > 1 && backlog > this.maxLagMs) {
      const newest = this.queue[this.queue.length - 1] as U;
      this.queue = [];
      this.show({ ...newest, events: [] }, 0);
      return;
    }
    const next = this.queue.shift() as U;
    this.show(next, Math.max(0, this.options.durationOf(next)));
  }

  private show(update: U, ms: number): void {
    this.presented = update;
    this.options.onPresent(update);
    if (ms > 0) {
      this.cancelTimer = this.options.schedule(() => {
        this.cancelTimer = null;
        this.pump();
      }, ms);
    } else {
      this.pump();
    }
  }
}
