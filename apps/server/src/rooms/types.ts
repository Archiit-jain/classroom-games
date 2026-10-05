import type { ChatMessage, GameResults, RoomKind, RoomPhase, TakeoverReason } from '@cg/protocol';
import type { GameRuntime, RuntimeSnapshot } from '../runtime/GameRuntime';

export interface HumanMember {
  kind: 'HUMAN';
  id: string;
  nickname: string;
  nicknameKey: string;
  joinedAt: number;
  connected: boolean;
  /** While disconnected: when the reconnect grace period ends (server ms). */
  graceUntil: number | null;
}

export interface BotMember {
  kind: 'BOT';
  id: string;
  name: string;
  joinedAt: number;
}

export type Member = HumanMember | BotMember;

export interface SeatState {
  seat: number;
  memberId: string;
  memberKind: 'HUMAN' | 'BOT';
  displayName: string;
  /** A bot standing in for the human who owns this seat. */
  takeover: { botId: string; botName: string; reason: TakeoverReason } | null;
  /** The human left or was removed; the bot keeps the seat for the rest of the match. */
  forfeited: boolean;
}

export interface ActiveMatch {
  matchId: string;
  gameId: string;
  runtime: GameRuntime;
  seats: SeatState[];
  results: GameResults | null;
  /** Seats whose human asked for their seat back but the game said "not yet". */
  pendingReclaims: Set<number>;
}

export interface Room {
  id: string;
  kind: RoomKind;
  code: string | null;
  gameId: string;
  settings: unknown;
  phase: RoomPhase;
  hostId: string | null;
  members: Member[];
  /** Players removed by the host; they cannot rejoin this room. */
  barred: Set<string>;
  match: ActiveMatch | null;
  startsAt: number | null;
  createdAt: number;
  /** When the room last had zero connected humans (for idle cleanup). */
  noHumansSince: number | null;
  /** Last N censored ROOM-channel messages, for reconnecting players. In memory only. */
  chat: ChatMessage[];
  /** PUBLIC rooms only: matchmaking state (persisted with the snapshot). */
  public: PublicState | null;
}

/** Matchmaking state of a public room (docs/design/PUBLIC_LOBBY_DESIGN.md §4). */
export interface PublicState {
  /** FILLING: when bots fill the empty seats and the match starts (server ms). */
  fillEndsAt: number | null;
  /** Since when exactly one human has been connected (for "Play with bots"). */
  loneSince: number | null;
  /** RESULTS: when the room goes back to matchmaking. */
  resultsEndsAt: number | null;
  /** RESULTS: humans who chose "Play again". */
  staying: string[];
}

/** A room as plain JSON: what the shared store keeps so another instance can continue it. */
export interface RoomSnapshot extends Omit<Room, 'barred' | 'match'> {
  barred: string[];
  match:
    | (Omit<ActiveMatch, 'runtime' | 'pendingReclaims'> & {
        runtime: RuntimeSnapshot;
        pendingReclaims: number[];
      })
    | null;
}
