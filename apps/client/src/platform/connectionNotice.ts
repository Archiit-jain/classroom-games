import type { AppState } from './store';

/** What the connection banner should say, or null when there is nothing to say. */
export type ConnectionNotice =
  | 'displaced'
  | 'restarting'
  | 'connecting'
  | 'reconnecting'
  /** Production: a sleeping free-tier server can take up to a minute to start. */
  | 'waking'
  /** Production: still not connected after that minute. */
  | 'unreachable'
  /** Development: the local game server is simply not running. */
  | 'devServerDown';

type ConnectionState = Pick<AppState, 'connection' | 'slow' | 'unreachable' | 'serverRestarting'>;

export function connectionNotice(state: ConnectionState, dev: boolean): ConnectionNotice | null {
  if (state.connection === 'displaced') return 'displaced';
  if (state.serverRestarting) return 'restarting';
  if (state.connection === 'connected') return null;
  // A local server starts in well under the "slow" threshold, so in development
  // a slow connect means it is not running — never that it is waking up.
  if (state.slow && dev) return 'devServerDown';
  if (state.unreachable) return 'unreachable';
  if (state.slow) return 'waking';
  return state.connection === 'reconnecting' ? 'reconnecting' : 'connecting';
}
