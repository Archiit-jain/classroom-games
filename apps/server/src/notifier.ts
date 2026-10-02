import type {
  ChatMessage,
  MatchEnd,
  MatchStream,
  MatchUpdate,
  Reaction,
  RoomEvent,
  RoomView,
} from '@cg/protocol';

/**
 * Outbound messages, addressed by player id. The transport layer implements
 * this over Socket.IO; services never touch sockets directly (and tests can
 * substitute a recording implementation).
 */
export interface Notifier {
  roomSnapshot(playerIds: readonly string[], room: RoomView | null): void;
  roomEvent(playerId: string, event: RoomEvent): void;
  matchUpdate(playerId: string, update: MatchUpdate): void;
  matchEnd(playerIds: readonly string[], end: MatchEnd): void;
  matchStream(playerIds: readonly string[], stream: MatchStream): void;
  chatMessage(playerIds: readonly string[], message: ChatMessage): void;
  chatHistory(playerId: string, messages: readonly ChatMessage[]): void;
  reaction(playerIds: readonly string[], reaction: Reaction): void;
}
