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

/** What a public room is doing, as the player sees it. */
export type PublicRoomState = 'WAITING' | 'FILLING' | 'STARTING' | 'IN_GAME' | 'RESULTS';

/** Matchmaking details of a PUBLIC room (null for private rooms). */
export interface PublicRoomView {
  state: PublicRoomState;
  targetPlayers: number;
  minHumans: number;
  /** FILLING: server time when bots fill the empty seats and the match starts. */
  fillEndsAt: number | null;
  /** Length of the fill window (for countdown displays). */
  fillWindowMs: number;
  /** WAITING alone: server time from which "Play with bots" is offered. */
  playWithBotsAt: number | null;
  /** RESULTS: server time when the room returns to matchmaking. */
  resultsEndsAt: number | null;
  /** RESULTS: humans who chose "Play again". */
  staying: string[];
}

/** One joinable public room in the Browse feed. `roomId` is an opaque handle (never shown). */
export interface PublicRoomListing {
  roomId: string;
  gameId: string;
  humans: number;
  targetPlayers: number;
  maxPlayers: number;
  state: 'WAITING' | 'FILLING';
  fillEndsAt: number | null;
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
  public: PublicRoomView | null;
}

export interface GameInfo {
  id: string;
  minPlayers: number;
  maxPlayers: number;
  supportsBots: boolean;
  defaultSettings: unknown;
  /** Public matchmaking values from the game's manifest. */
  publicMatch: { enabled: boolean; targetPlayers: number; minHumans: number };
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
  /**
   * The whole current state, sent on (re)connect, seat reclaim and after a new room
   * host restored the match (failover). It replaces what the client has even at a
   * LOWER version (progress a failed host never saved), instead of being ignored as
   * out of order.
   */
  reset?: true;
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
