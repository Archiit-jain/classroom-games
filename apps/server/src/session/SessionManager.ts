import type { Moderator } from '@cg/moderation';
import { fail, ok, type Result } from '@cg/protocol';
import type { ServerConfig } from '../config';
import { hashToken, newId, newToken } from '../util/ids';

export interface Session {
  /** Public player id. Safe to share with other players. */
  id: string;
  /** SHA-256 of the secret reconnect token. The token itself is never stored. */
  tokenHash: string;
  nickname: string | null;
  nicknameKey: string | null;
  socketId: string | null;
  /** The server instance holding that socket (multi-instance deployments). */
  instanceId: string | null;
  roomId: string | null;
  /** Subscribed to the public Browse feed (kept with the session across host hand-overs). */
  browsing?: boolean;
  createdAt: number;
  lastSeenAt: number;
}

/** Told about every session that may have changed or was forgotten (for persistence). */
export interface SessionChanges {
  touched(id: string): void;
  removed(id: string): void;
}

/**
 * Anonymous identities. A session is proven by its secret token (sent in the
 * Socket.IO handshake); other players only ever see `session.id`.
 */
export class SessionManager {
  private readonly byId = new Map<string, Session>();
  private readonly byTokenHash = new Map<string, Session>();
  private readonly newSessionTimesByIp = new Map<string, number[]>();

  constructor(
    private readonly config: ServerConfig,
    private readonly moderator: Moderator,
    private readonly now: () => number = Date.now,
    private readonly changes: SessionChanges | null = null,
  ) {}

  /** Every session (snapshots). */
  all(): Session[] {
    return [...this.byId.values()];
  }

  /** Adds sessions continued from a snapshot (another instance hosted them before). */
  restore(sessions: readonly Session[]): void {
    for (const session of sessions) {
      this.byId.set(session.id, session);
      this.byTokenHash.set(session.tokenHash, session);
    }
  }

  /** Finds the session for a token, or creates a new one (returning its token once). */
  resolve(token: unknown, ip: string): Result<{ session: Session; token?: string }> {
    if (typeof token === 'string' && token.length >= 20 && token.length <= 128) {
      const existing = this.byTokenHash.get(hashToken(token));
      if (existing) {
        existing.lastSeenAt = this.now();
        this.changes?.touched(existing.id);
        return ok({ session: existing });
      }
    }
    if (this.byId.size >= this.config.limits.maxSessions) return fail('SERVER_BUSY');
    if (!this.allowNewSession(ip)) return fail('RATE_LIMITED');

    const secret = newToken();
    const now = this.now();
    const session: Session = {
      id: newId('p'),
      tokenHash: hashToken(secret),
      nickname: null,
      nicknameKey: null,
      socketId: null,
      instanceId: null,
      roomId: null,
      createdAt: now,
      lastSeenAt: now,
    };
    this.byId.set(session.id, session);
    this.byTokenHash.set(session.tokenHash, session);
    this.changes?.touched(session.id);
    return ok({ session, token: secret });
  }

  private allowNewSession(ip: string): boolean {
    const now = this.now();
    const recent = (this.newSessionTimesByIp.get(ip) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= this.config.limits.newSessionsPerIpPerMinute) {
      this.newSessionTimesByIp.set(ip, recent);
      return false;
    }
    recent.push(now);
    this.newSessionTimesByIp.set(ip, recent);
    return true;
  }

  /** Reads a session without counting it as changed (e.g. to deliver a message). */
  peek(id: string): Session | undefined {
    return this.byId.get(id);
  }

  get(id: string): Session | undefined {
    const session = this.byId.get(id);
    // Callers may change what they get (e.g. the room), so it counts as touched.
    if (session) this.changes?.touched(id);
    return session;
  }

  /**
   * Marks `socketId` (on server instance `instanceId`) as the session's only active
   * socket; returns the one it replaced, if any.
   */
  attachSocket(
    session: Session,
    socketId: string,
    instanceId: string | null = null,
  ): { socketId: string; instanceId: string | null } | null {
    const previous =
      session.socketId && session.socketId !== socketId
        ? { socketId: session.socketId, instanceId: session.instanceId }
        : null;
    session.socketId = socketId;
    session.instanceId = instanceId;
    session.lastSeenAt = this.now();
    this.changes?.touched(session.id);
    return previous;
  }

  /** Returns true when `socketId` was the active socket (i.e. the player really disconnected). */
  detachSocket(session: Session, socketId: string): boolean {
    if (session.socketId !== socketId) return false;
    session.socketId = null;
    session.instanceId = null;
    session.lastSeenAt = this.now();
    this.changes?.touched(session.id);
    return true;
  }

  setNickname(session: Session, raw: string): Result<{ nickname: string }> {
    if (session.roomId) return fail('NICKNAME_LOCKED_IN_ROOM');
    const check = this.moderator.validateNickname(raw);
    if (!check.ok)
      return fail(check.reason === 'INVALID' ? 'NICKNAME_INVALID' : 'NICKNAME_REJECTED');
    session.nickname = check.nickname;
    session.nicknameKey = check.key;
    this.changes?.touched(session.id);
    return ok({ nickname: check.nickname });
  }

  /** Forgets idle sessions that are neither connected nor in a room. */
  sweep(): string[] {
    const now = this.now();
    const removed: string[] = [];
    for (const session of this.byId.values()) {
      if (session.socketId || session.roomId) continue;
      const limit = session.nickname
        ? this.config.timing.sessionIdleExpiryMs
        : this.config.timing.anonymousSessionExpiryMs;
      if (now - session.lastSeenAt > limit) {
        this.byId.delete(session.id);
        this.byTokenHash.delete(session.tokenHash);
        this.changes?.removed(session.id);
        removed.push(session.id);
      }
    }
    for (const [ip, times] of this.newSessionTimesByIp) {
      if (times.every((t) => now - t >= 60_000)) this.newSessionTimesByIp.delete(ip);
    }
    return removed;
  }

  get size(): number {
    return this.byId.size;
  }
}
