/**
 * Every error the server can report. The server never sends English sentences:
 * the client maps each code to a translated, user-friendly message.
 */
export const ERROR_CODES = [
  // Transport / generic
  'INVALID_PAYLOAD',
  'RATE_LIMITED',
  'SERVER_BUSY',
  'INTERNAL_ERROR',
  // Nickname
  'NICKNAME_REQUIRED',
  'NICKNAME_INVALID',
  'NICKNAME_REJECTED',
  'NICKNAME_TAKEN',
  'NICKNAME_LOCKED_IN_ROOM',
  // Rooms
  'GAME_NOT_FOUND',
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'ROOM_IN_PROGRESS',
  'ALREADY_IN_ROOM',
  'NOT_IN_ROOM',
  'NOT_HOST',
  'REMOVED_FROM_ROOM',
  'INVALID_SETTINGS',
  'TOO_MANY_PLAYERS_FOR_GAME',
  'NOT_ENOUGH_PLAYERS',
  'BOTS_NOT_SUPPORTED',
  'INVALID_PHASE',
  'PLAYER_NOT_FOUND',
  'BOT_NOT_FOUND',
  'CANNOT_TARGET_SELF',
  // Matches
  'MATCH_NOT_FOUND',
  'STALE_VERSION',
  'DUPLICATE_ACTION',
  'NOT_YOUR_TURN',
  'ILLEGAL_ACTION',
  'NOT_ELIGIBLE',
  'SEAT_NOT_RECLAIMABLE',
  'SEAT_CONTROLLED_BY_BOT',
  // Chat
  'CHAT_EMPTY',
  'CHAT_COOLDOWN',
  'CHAT_BLOCKED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Codes a game engine may return from `validateAction`. */
export type GameErrorCode = Extract<
  ErrorCode,
  'NOT_YOUR_TURN' | 'ILLEGAL_ACTION' | 'NOT_ELIGIBLE' | 'INVALID_PHASE'
>;

/** Codes a game's chat interceptor may use to block a message. */
export type ChatErrorCode = Extract<ErrorCode, 'CHAT_BLOCKED'>;

export type Result<T> =
  { ok: true; value: T } | { ok: false; code: ErrorCode; retryAfterMs?: number };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T = never>(code: ErrorCode, retryAfterMs?: number): Result<T> =>
  retryAfterMs === undefined ? { ok: false, code } : { ok: false, code, retryAfterMs };
