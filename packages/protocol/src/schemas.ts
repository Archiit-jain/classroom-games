import { z } from 'zod';
import { ACTION_ID_PATTERN, CHAT_MAX_LENGTH, REACTION_IDS, REPORT_REASONS } from './limits';

/**
 * Client → server payload schemas (server-side validation). Kept in their own
 * entry point (`@cg/protocol/schemas`) so the browser bundle never pulls in zod.
 * Every inbound event is validated against these before any handler runs;
 * unknown keys are rejected.
 */

const id = z.string().min(1).max(64);
const empty = z.strictObject({});

export const C2S = {
  'session:setNickname': z.strictObject({ nickname: z.string().max(64) }),

  'room:create': z.strictObject({ gameId: id }),
  'room:join': z.strictObject({ code: z.string().max(16) }),
  'room:leave': empty,
  'room:setGame': z.strictObject({ gameId: id }),
  'room:updateSettings': z.strictObject({ settings: z.record(z.string().max(32), z.unknown()) }),
  'room:addBot': empty,
  'room:removeBot': z.strictObject({ botId: id }),
  'room:kick': z.strictObject({ playerId: id }),
  'room:start': empty,
  'room:playAgain': empty,
  'room:backToLobby': empty,
  'room:reclaimSeat': empty,

  'match:action': z.strictObject({
    matchId: id,
    version: z.number().int().nonnegative(),
    /** Client-generated, unique per intent. A repeated id is rejected (DUPLICATE_ACTION). */
    actionId: z.string().regex(ACTION_ID_PATTERN),
    action: z.unknown(),
  }),
  'match:resync': z.strictObject({ matchId: id }),
  /** One chunk of a streamed game (e.g. drawing strokes); the game validates its shape. */
  'match:stream': z.strictObject({ matchId: id, chunk: z.unknown() }),

  // Raw text may be longer than the limit before trimming; the service enforces the real limit.
  'chat:send': z.strictObject({ text: z.string().max(CHAT_MAX_LENGTH * 2) }),
  'chat:react': z.strictObject({ reactionId: z.enum(REACTION_IDS) }),
  'report:submit': z.strictObject({ playerId: id, reason: z.enum(REPORT_REASONS) }),

  'time:ping': z.strictObject({ clientTs: z.number().finite() }),
} as const;
