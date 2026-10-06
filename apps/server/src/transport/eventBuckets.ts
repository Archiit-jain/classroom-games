import type { C2SEventName } from '@cg/protocol';
import type { ServerConfig } from '../config';

export type BucketName = keyof ServerConfig['rateLimits'];

/**
 * The per-session rate bucket of every client event (null = the service applies its
 * own limits: chat cooldowns, the report budget, the Browse feed). Both the gateway
 * (cheap drop before anything is forwarded) and the room host (one shared count for
 * the whole cluster, whichever instance the player reconnects through) apply it.
 */
export const EVENT_BUCKETS: Record<Exclude<C2SEventName, 'time:ping'>, BucketName | null> = {
  'session:setNickname': 'nickname',
  'room:create': 'roomCreate',
  'room:join': 'roomJoin',
  'room:leave': 'roomAdmin',
  'room:setGame': 'roomAdmin',
  'room:updateSettings': 'roomAdmin',
  'room:addBot': 'roomAdmin',
  'room:removeBot': 'roomAdmin',
  'room:kick': 'roomAdmin',
  'room:start': 'roomAdmin',
  'room:playAgain': 'roomAdmin',
  'room:backToLobby': 'roomAdmin',
  'room:reclaimSeat': 'roomAdmin',
  // Public matchmaking: a coarse guard; the host also applies the `matchmaking` bucket.
  'public:play': 'roomJoin',
  'public:join': 'roomJoin',
  'public:browse': null,
  'public:playWithBots': 'roomCreate',
  'public:resultsChoice': 'roomAdmin',
  'match:action': 'matchAction',
  'match:resync': 'matchAction',
  'match:stream': 'stream',
  'chat:send': null,
  'chat:react': 'reaction',
  'report:submit': null,
};
