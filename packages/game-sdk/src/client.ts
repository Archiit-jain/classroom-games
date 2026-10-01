import type { ComponentType, LazyExoticComponent } from 'react';
import type { SeatView } from '@cg/protocol';

/** Effects level chosen by the platform (reduced-motion preference, device capability, user choice). */
export type EffectsMode = 'full' | 'lite' | 'reduced';

/** Color Burst Arcade accent colours (see @cg/ui tokens). */
export type Accent = 'pink' | 'yellow' | 'cyan' | 'lime' | 'orange' | 'violet';

/** A quick reaction to show as a bubble over a seat (already filtered for muted players). */
export interface BoardReaction {
  /** Unique per reaction — a new key means a new bubble. */
  key: string;
  seat: number;
  emoji: string;
  /** Accessible, translated description ("Laughing"). */
  label: string;
}

export interface BoardProps<V, A, E> {
  /** The view currently being presented (may briefly lag the newest one while animations play). */
  view: V;
  /** Events that arrived with the presented update, in order, for animation. */
  events: readonly E[];
  /** Version of the presented update. Changes with every update — handy as an animation key. */
  version: number;
  me: number;
  seats: readonly SeatView[];
  /** Sends an intent to the server. Resolves true when accepted; the platform shows any error. */
  send(action: A): Promise<boolean>;
  effects: EffectsMode;
  /** Converts a server timestamp into milliseconds remaining on this device's clock. */
  msUntil(serverTs: number): number;
  /** Reactions on screen right now, oldest first (only for games with `reactions: true`). */
  reactions: readonly BoardReaction[];
}

export interface SettingsProps<Settings> {
  settings: Settings;
  editable: boolean;
  onChange(next: Settings): void;
}

export type MessageCatalog = Record<string, string>;

/** A game-specific number shown on the results screen, read from `GameResults.stats[seat][key]`. */
export interface ResultStat {
  key: string;
  /** Key into the game's `messages` for the column label. */
  labelKey: string;
}

/** Client-side half of a game: its board, optional settings form, UI strings and presentation hints. */
export interface GameClientModule<V, A, E, Settings> {
  id: string;
  /** Must include `name` and `description`. */
  messages: MessageCatalog;
  accent: Accent;
  /** Small game icon for cards and headers (inline SVG, no network). */
  Icon: ComponentType<{ size?: number }>;
  Board: LazyExoticComponent<ComponentType<BoardProps<V, A, E>>>;
  Settings?: LazyExoticComponent<ComponentType<SettingsProps<Settings>>>;
  /**
   * How long (ms) the board needs to animate an event in a given effects mode.
   * The platform's animation director waits this long before presenting the
   * next update. Unknown/instant events: 0.
   */
  eventDuration?(event: E, effects: EffectsMode): number;
  /** Game-specific columns for the results screen (e.g. total score). */
  resultStats?: ResultStat[];
  /**
   * The board draws quick-reaction bubbles over its seats, so the platform
   * shows the reaction picker during matches of this game.
   */
  reactions?: boolean;
  /** Confetti on the podium in lite mode too (default true; full mode always has it). */
  liteConfetti?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGameClientModule = GameClientModule<any, any, any, any>;

/** Replaces {name} placeholders. Unknown placeholders stay visible so they get noticed. */
export function formatMessage(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
