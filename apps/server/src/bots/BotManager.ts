import { createRng, type SeatIndex, type SeededRng } from '@cg/game-sdk';
import type { MatchUpdate } from '@cg/protocol';
import { errorFields, type Logger } from '../log';
import type { GameRuntime } from '../runtime/GameRuntime';
import { randomSeed } from '../util/ids';
import type { TimerService } from '../util/TimerService';

interface BotSeat {
  key: string;
  runtime: GameRuntime;
  seat: SeatIndex;
  memory: unknown;
  rng: SeededRng;
  pending: boolean;
}

export interface BotManagerDeps {
  timers: TimerService;
  log: Logger;
  /** Chat-based bot moves (e.g. drawing-game guesses) are routed here. */
  onChat?: (matchId: string, seat: SeatIndex, text: string) => void;
}

/**
 * Drives bot-controlled seats. A bot sees exactly what a human in that seat
 * would: the filtered view plus the filtered events. Its moves go through the
 * same `submitAction` validation path as a human's.
 */
export class BotManager {
  private readonly seats = new Map<string, BotSeat>();

  constructor(private readonly deps: BotManagerDeps) {}

  private static key(matchId: string, seat: SeatIndex): string {
    return `${matchId}:${seat}`;
  }

  /**
   * Puts a bot in a seat. With `considerNow` the bot looks at the current view
   * immediately (mid-match takeover); otherwise it waits for the next update.
   */
  attach(runtime: GameRuntime, seat: SeatIndex, considerNow: boolean): void {
    const key = BotManager.key(runtime.matchId, seat);
    this.detach(runtime.matchId, seat);
    const entry: BotSeat = {
      key,
      runtime,
      seat,
      memory: runtime.game.bot.createMemory(seat),
      rng: createRng(randomSeed()),
      pending: false,
    };
    this.seats.set(key, entry);
    if (considerNow && runtime.isStarted) this.consider(entry, runtime.viewFor(seat).view);
  }

  detach(matchId: string, seat: SeatIndex): void {
    const key = BotManager.key(matchId, seat);
    this.deps.timers.clear(`bot:${key}`);
    this.seats.delete(key);
  }

  detachMatch(matchId: string): void {
    for (const entry of [...this.seats.values()]) {
      if (entry.runtime.matchId === matchId) this.detach(matchId, entry.seat);
    }
  }

  isAttached(matchId: string, seat: SeatIndex): boolean {
    return this.seats.has(BotManager.key(matchId, seat));
  }

  onUpdate(matchId: string, seat: SeatIndex, update: MatchUpdate): void {
    const entry = this.seats.get(BotManager.key(matchId, seat));
    if (!entry) return;
    entry.memory = entry.runtime.game.bot.observe(entry.memory, update.events);
    if (!entry.pending) this.consider(entry, update.view);
  }

  private decide(entry: BotSeat, view: unknown) {
    return entry.runtime.game.bot.decide(view, entry.memory, {
      seat: entry.seat,
      now: Date.now(),
      rng: entry.rng,
    });
  }

  private consider(entry: BotSeat, view: unknown): void {
    if (entry.runtime.isOver) return;
    const decision = this.decide(entry, view);
    if (!decision) return;
    entry.pending = true;
    this.deps.timers.set(`bot:${entry.key}`, decision.thinkMs, () => this.act(entry));
  }

  /** After "thinking", re-decide on the freshest view, then act. */
  private act(entry: BotSeat): void {
    entry.pending = false;
    if (this.seats.get(entry.key) !== entry || entry.runtime.isOver) return;
    try {
      const decision = this.decide(entry, entry.runtime.viewFor(entry.seat).view);
      if (!decision) return;
      if (decision.kind === 'ACTION') {
        const result = entry.runtime.submitAction(entry.seat, null, null, decision.action);
        if (!result.ok) {
          this.deps.log.warn('bot action rejected', {
            matchId: entry.runtime.matchId,
            seat: entry.seat,
            code: result.code,
          });
        }
      } else {
        this.deps.onChat?.(entry.runtime.matchId, entry.seat, decision.text);
      }
    } catch (err) {
      this.deps.log.error('bot failed', {
        matchId: entry.runtime.matchId,
        seat: entry.seat,
        ...errorFields(err),
      });
    }
  }
}
