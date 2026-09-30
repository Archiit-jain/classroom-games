import type { z } from 'zod';
import type { ErrorCode } from './errors';
import type { C2S } from './schemas';
import type {
  ChatMessage,
  GameInfo,
  MatchEnd,
  MatchUpdate,
  RoomView,
  TakeoverReason,
} from './views';

export type C2SEventName = keyof typeof C2S;
export type C2SPayload<K extends C2SEventName> = z.input<(typeof C2S)[K]>;

type Empty = Record<never, never>;

/** What a successful acknowledgement carries for each client → server event. */
export interface C2SResults {
  'session:setNickname': { nickname: string };
  'room:create': { room: RoomView };
  'room:join': { room: RoomView };
  'room:leave': Empty;
  'room:setGame': Empty;
  'room:updateSettings': Empty;
  'room:addBot': Empty;
  'room:removeBot': Empty;
  'room:kick': Empty;
  'room:start': Empty;
  'room:playAgain': Empty;
  'room:backToLobby': Empty;
  'room:reclaimSeat': Empty;
  'match:action': { version: number };
  'match:resync': { update: MatchUpdate };
  'chat:send': Empty;
  'report:submit': Empty;
  'time:ping': { clientTs: number; serverNow: number };
}

export type AckFailure = { ok: false; code: ErrorCode; retryAfterMs?: number };
export type Ack<T> = ({ ok: true } & T) | AckFailure;

export type ClientToServerEvents = {
  [K in C2SEventName]: (payload: C2SPayload<K>, ack: (res: Ack<C2SResults[K]>) => void) => void;
};

export interface SessionReady {
  playerId: string;
  nickname: string | null;
  /** Only present when the server created a new session; the client must store it. */
  token?: string;
  games: GameInfo[];
  serverNow: number;
}

/** Room notifications that are not full snapshots. */
export type RoomEvent =
  | { type: 'KICKED' }
  | { type: 'ROOM_CLOSED' }
  | { type: 'HOST_CHANGED'; hostId: string }
  | { type: 'SEAT_TAKEN_OVER'; reason: TakeoverReason }
  | { type: 'SEAT_RECLAIMED' }
  /** The game engine failed; the room returned to its lobby. */
  | { type: 'MATCH_ABORTED' };

export type SystemNoticeCode = 'SERVER_RESTARTING';

export interface ServerToClientEvents {
  'session:ready': (payload: SessionReady) => void;
  'session:displaced': () => void;
  'room:snapshot': (payload: { room: RoomView | null }) => void;
  'room:event': (payload: RoomEvent) => void;
  'match:update': (payload: MatchUpdate) => void;
  'match:end': (payload: MatchEnd) => void;
  'chat:message': (payload: ChatMessage) => void;
  'chat:history': (payload: { messages: ChatMessage[] }) => void;
  'system:notice': (payload: { code: SystemNoticeCode }) => void;
}

/** Socket.IO handshake `auth` payload. */
export interface HandshakeAuth {
  token?: string;
}
