import type { ChatMessage, GameInfo, MatchEnd, RoomView } from '@cg/protocol';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'displaced';

export interface MatchState {
  matchId: string;
  gameId: string;
  version: number;
  you: number;
  view: unknown;
  /** Events from the latest update, for animations. */
  events: unknown[];
}

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
}

export interface AppState {
  connection: ConnectionStatus;
  /** True when connecting takes long enough that the server is probably waking up. */
  slow: boolean;
  /** True when still not connected after the server's maximum wake-up time. */
  unreachable: boolean;
  serverRestarting: boolean;
  session: { playerId: string; nickname: string | null } | null;
  games: GameInfo[];
  room: RoomView | null;
  match: MatchState | null;
  results: MatchEnd | null;
  chat: ChatMessage[];
  /** Players this device has muted or reported (hidden locally). */
  hidden: string[];
  toasts: Toast[];
}

export const initialState: AppState = {
  connection: 'connecting',
  slow: false,
  unreachable: false,
  serverRestarting: false,
  session: null,
  games: [],
  room: null,
  match: null,
  results: null,
  chat: [],
  hidden: [],
  toasts: [],
};

/** Minimal external store for useSyncExternalStore. */
export class Store<S> {
  private listeners = new Set<() => void>();

  constructor(private state: S) {}

  get = (): S => this.state;

  set(patch: Partial<S> | ((s: S) => Partial<S>)): void {
    const next = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}
