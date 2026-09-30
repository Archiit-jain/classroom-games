import type { ClientToServerEvents, ServerToClientEvents } from '@cg/protocol';
import type { Server, Socket } from 'socket.io';

export interface SocketData {
  sessionId: string;
  ip: string;
  /** Set only when the handshake created a brand-new session. */
  newToken?: string;
}

type InterServerEvents = Record<string, never>;

export type IoServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
export type IoSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
