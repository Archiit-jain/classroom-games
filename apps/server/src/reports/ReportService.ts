import { fail, ok, type ReportReason, type Result } from '@cg/protocol';
import type { Logger } from '../log';
import type { RoomManager } from '../rooms/RoomManager';
import type { Session } from '../session/SessionManager';
import type { RateLimiter } from '../util/RateLimiter';

export interface ReportFlag {
  roomId: string;
  reportedId: string;
  reporterId: string;
  reason: ReportReason;
  at: number;
}

/** Where reports go. Replaceable: a real moderation backend only needs `record`. */
export interface ReportSink {
  record(flag: ReportFlag): void;
}

/** v1 sink: a bounded, expiring, in-memory list. Lost on restart by design. */
export class InMemoryFlagStore implements ReportSink {
  private flags: ReportFlag[] = [];

  constructor(
    private readonly maxFlags: number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  record(flag: ReportFlag): void {
    this.prune();
    this.flags.push(flag);
    if (this.flags.length > this.maxFlags) this.flags.splice(0, this.flags.length - this.maxFlags);
  }

  list(): readonly ReportFlag[] {
    this.prune();
    return this.flags;
  }

  private prune(): void {
    const cutoff = this.now() - this.ttlMs;
    if (this.flags.length && (this.flags[0] as ReportFlag).at < cutoff) {
      this.flags = this.flags.filter((f) => f.at >= cutoff);
    }
  }
}

type Empty = Record<never, never>;

/**
 * Accepts player reports. A report NEVER kicks, bans or skips anyone in v1;
 * it records a flag (room, player, reason — no message or drawing content).
 * Hiding the reported player locally is done by the reporter's client.
 */
export class ReportService {
  constructor(
    private readonly deps: {
      sink: ReportSink;
      rooms: RoomManager;
      limiter: RateLimiter;
      log: Logger;
      now?: () => number;
    },
  ) {}

  submit(session: Session, reportedId: string, reason: ReportReason): Result<Empty> {
    const ctx = this.deps.rooms.context(session);
    if (!ctx) return fail('NOT_IN_ROOM');
    if (reportedId === session.id) return fail('CANNOT_TARGET_SELF');
    const { room } = ctx;
    const isMember = room.members.some((m) => m.kind === 'HUMAN' && m.id === reportedId);
    const wasSeated = room.match?.seats.some(
      (s) => s.memberKind === 'HUMAN' && s.memberId === reportedId,
    );
    if (!isMember && !wasSeated) return fail('PLAYER_NOT_FOUND');
    if (!this.deps.limiter.take(session.id, 'report')) return fail('RATE_LIMITED');

    const flag: ReportFlag = {
      roomId: room.id,
      reportedId,
      reporterId: session.id,
      reason,
      at: (this.deps.now ?? Date.now)(),
    };
    this.deps.sink.record(flag);
    this.deps.log.info('player reported', { roomId: room.id, reportedId, reason });
    return ok({});
  }
}
