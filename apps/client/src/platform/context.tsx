import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { EffectsMode } from '@cg/game-sdk/client';
import type { GameConnection } from './connection';
import type { AppState } from './store';

const ConnectionContext = createContext<GameConnection | null>(null);

export function ConnectionProvider({
  connection,
  children,
}: {
  connection: GameConnection;
  children: ReactNode;
}) {
  return <ConnectionContext.Provider value={connection}>{children}</ConnectionContext.Provider>;
}

export function useConnection(): GameConnection {
  const connection = useContext(ConnectionContext);
  if (!connection) throw new Error('useConnection must be used inside <ConnectionProvider>');
  return connection;
}

export function useAppState(): AppState {
  const connection = useConnection();
  return useSyncExternalStore(connection.store.subscribe, connection.store.get);
}

/**
 * Effects level for animations. Honors the OS "reduce motion" setting.
 * The automatic "lite" mode for slow devices arrives with the first animated game.
 */
export function useEffectsMode(): EffectsMode {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mql = window.matchMedia?.(query);
    if (!mql) return;
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return reduced ? 'reduced' : 'full';
}

/** Re-renders every `ms` while mounted (for countdowns). */
export function useTick(ms = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
