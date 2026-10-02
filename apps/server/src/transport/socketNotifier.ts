import type { Notifier } from '../notifier';
import type { SessionManager } from '../session/SessionManager';
import type { IoServer } from './types';

/** Delivers notifier messages to each player's single active socket. */
export function createSocketNotifier(io: IoServer, sessions: SessionManager): Notifier {
  const to = (playerIds: readonly string[]) => {
    const socketIds: string[] = [];
    for (const id of playerIds) {
      const socketId = sessions.get(id)?.socketId;
      if (socketId) socketIds.push(socketId);
    }
    return socketIds.length > 0 ? io.to(socketIds) : null;
  };

  return {
    roomSnapshot: (ids, room) => to(ids)?.emit('room:snapshot', { room }),
    roomEvent: (id, event) => to([id])?.emit('room:event', event),
    matchUpdate: (id, update) => to([id])?.emit('match:update', update),
    matchEnd: (ids, end) => to(ids)?.emit('match:end', end),
    matchStream: (ids, stream) => to(ids)?.emit('match:stream', stream),
    chatMessage: (ids, message) => to(ids)?.emit('chat:message', message),
    chatHistory: (id, messages) => to([id])?.emit('chat:history', { messages: [...messages] }),
    reaction: (ids, reaction) => to(ids)?.emit('chat:reaction', reaction),
  };
}
