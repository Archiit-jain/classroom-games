import type { Room } from './types';

/** Behaviour that differs between room kinds (private: a human host; public: the server). */
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

/** Public rooms are run by the server: nobody manages them; only the lobby is joinable. */
export const publicRoomPolicy: RoomPolicy = {
  canManage: () => false,
  isJoinable: (room) => room.phase === 'LOBBY',
};

export function policyFor(room: Room): RoomPolicy {
  return room.kind === 'PRIVATE' ? privateRoomPolicy : publicRoomPolicy;
}
