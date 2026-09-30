import type { ComponentType, LazyExoticComponent } from 'react';
import type { SeatView } from '@cg/protocol';

/** Effects level chosen by the platform (reduced-motion preference, device capability). */
export type EffectsMode = 'full' | 'lite' | 'reduced';

export interface BoardProps<V, A, E> {
  view: V;
  /** Events that arrived with the latest update, for animation. */
  events: readonly E[];
  version: number;
  me: number;
  seats: readonly SeatView[];
  /** Sends an intent to the server. Resolves true when accepted; the platform shows any error. */
  send(action: A): Promise<boolean>;
  effects: EffectsMode;
  /** Converts a server timestamp into milliseconds remaining on this device's clock. */
  msUntil(serverTs: number): number;
}

export interface SettingsProps<Settings> {
  settings: Settings;
  editable: boolean;
  onChange(next: Settings): void;
}

export type MessageCatalog = Record<string, string>;

/** Client-side half of a game: its board, optional settings form and UI strings. */
export interface GameClientModule<V, A, E, Settings> {
  id: string;
  messages: MessageCatalog;
  Board: LazyExoticComponent<ComponentType<BoardProps<V, A, E>>>;
  Settings?: LazyExoticComponent<ComponentType<SettingsProps<Settings>>>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGameClientModule = GameClientModule<any, any, any, any>;
