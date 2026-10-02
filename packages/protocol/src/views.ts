import type { ReactionId } from './limits';

/** Read-only shapes the server sends to clients. */

export type RoomKind = 'PRIVATE' | 'PUBLIC';
export type RoomPhase = 'LOBBY' | 'STARTING' | 'IN_GAME' | 'RESULTS' | 'CLOSED';

/** AWAY = socket lost (inside or past the reconnect grace period). */
export type MemberStatus = 'CONNECTED' | 'AWAY';

export interface HumanMemberView {
  kind: 'HUMAN';
  id: string;
  nickname: string;
  status: MemberStatus;
}

export interface BotMemberView {
  kind: 'BOT';
  id: string;
  name: string;
}

export type MemberView = HumanMemberView | BotMemberView;

/** Why a bot is currently playing a human's seat. */
export type TakeoverReason = 'DISCONNECTED' | 'IDLE' | 'LEFT';

export interface SeatView {
  seat: number;
  /** Player id or bot id of the room member who owns this seat. */
  memberId: string;
  memberKind: 'HUMAN' | 'BOT';
  displayName: string;
  /** Who is making moves for this seat right now. */
  controller: 'HUMAN' | 'BOT';
  /** Set when a bot is standing in for a human. */
  takeover: { reason: TakeoverReason; botName: string } | null;
}

export interface Placement {
  seat: number;
  /** 1-based. Tied seats share a place (1, 1, 3, …). */
  place: number;
}

export interface GameResults {
  placements: Placement[];
  /** Optional per-seat numbers the results screen can show (e.g. score). */
  stats?: Record<number, Record<string, number>>;
}

export interface MatchSummaryView {
  matchId: string;
  gameId: string;
  seats: SeatView[];
  results: GameResults | null;
}

export interface RoomView {
  id: string;
  kind: RoomKind;
  /** Shareable join code (private rooms only). */
  code: string | null;
  gameId: string;
  settings: unknown;
  phase: RoomPhase;
  hostId: string | null;
  /** Server timestamp when STARTING ends. */
  startsAt: number | null;
  capacity: number;
  minPlayers: number;
  members: MemberView[];
  match: MatchSummaryView | null;
}

export interface GameInfo {
  id: string;
  minPlayers: number;
  maxPlayers: number;
  supportsBots: boolean;
  defaultSettings: unknown;
}

/** One per-viewer update of a running match. `view` is always complete. */
export interface MatchUpdate<View = unknown, Event = unknown> {
  matchId: string;
  gameId: string;
  version: number;
  /** Seat of the receiving player. */
  you: number;
  events: Event[];
  view: View;
  serverNow: number;
}

/**
 * Streamed game data (e.g. drawing strokes), separate from `match:update`. With `reset`,
 * `chunks` is everything so far (after a reconnect/resync) and replaces what the client had.
 */
export interface MatchStream {
  matchId: string;
  chunks: unknown[];
  reset: boolean;
}

export interface MatchEnd {
  matchId: string;
  results: GameResults;
}

/** A quick reaction, shown as a bubble over the sender's seat. */
export interface Reaction {
  fromId: string;
  seat: number;
  reactionId: ReactionId;
  sentAt: number;
}

export interface ChatMessage {
  id: string;
  fromId: string;
  fromName: string;
  isBot: boolean;
  /** Already moderated by the server. */
  text: string;
  sentAt: number;
  /** 'ROOM' for normal chat; games may define restricted channels. */
  channel: string;
}
