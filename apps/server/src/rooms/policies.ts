import type { Room } from './types';

/**
 * Behaviour that differs between room kinds. v1 ships the private policy;
 * the public (server-controlled) policy arrives with matchmaking in Phase 9.
 */
export interface RoomPolicy {
  /** May this player manage the room (game, settings, bots, removals, start)? */
  canManage(room: Room, playerId: string): boolean;
  /** May a new player join right now? */
  isJoinable(room: Room): boolean;
}

export const privateRoomPolicy: RoomPolicy = {
  canManage: (room, playerId) => room.hostId === playerId,
  isJoinable: (room) => room.phase === 'LOBBY',
};

export function policyFor(room: Room): RoomPolicy {
  if (room.kind === 'PRIVATE') return privateRoomPolicy;
  throw new Error('Public rooms are not implemented yet (Phase 9)');
}
