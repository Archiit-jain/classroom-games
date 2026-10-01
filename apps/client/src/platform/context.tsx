import type { AnyGameClientModule, EffectsMode } from '@cg/game-sdk/client';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { GameConnection } from './connection';
import { AnimationDirector } from './director';
import { resolveEffects, type EffectsController, type EffectsState } from './effects';
import type { AppState, MatchState } from './store';

interface Platform {
  connection: GameConnection;
  effects: EffectsController;
}

const PlatformContext = createContext<Platform | null>(null);

export function PlatformProvider({
  connection,
  effects,
  children,
}: Platform & { children: ReactNode }) {
  return (
    <PlatformContext.Provider value={{ connection, effects }}>{children}</PlatformContext.Provider>
  );
}

function usePlatform(): Platform {
  const platform = useContext(PlatformContext);
  if (!platform) throw new Error('Platform hooks must be used inside <PlatformProvider>');
  return platform;
}

export function useConnection(): GameConnection {
  return usePlatform().connection;
}

export function useAppState(): AppState {
  const connection = useConnection();
  return useSyncExternalStore(connection.store.subscribe, connection.store.get);
}

/** The effects setting (player preference, device check, OS setting) and the resolved mode. */
export function useEffectsSetting(): {
  mode: EffectsMode;
  state: EffectsState;
  controller: EffectsController;
} {
  const { effects } = usePlatform();
  const state = useSyncExternalStore(effects.subscribe, effects.get);
  return { mode: resolveEffects(state), state, controller: effects };
}

/**
 * The match update currently on screen, paced by the animation director so each
 * update's events can play before the next view replaces it.
 */
export function usePresentedMatch(
  module: AnyGameClientModule | undefined,
  effects: EffectsMode,
): MatchState | null {
  const connection = useConnection();
  const [presented, setPresented] = useState<MatchState | null>(() => connection.store.get().match);
  const effectsRef = useRef(effects);

  useEffect(() => {
    effectsRef.current = effects;
  }, [effects]);

  useEffect(() => {
    const director = new AnimationDirector<MatchState>({
      durationOf: (u) =>
        u.events.reduce<number>(
          (sum, e) => sum + (module?.eventDuration?.(e, effectsRef.current) ?? 0),
          0,
        ),
      onPresent: setPresented,
      schedule: (fn, ms) => {
        const handle = setTimeout(fn, ms);
        return () => clearTimeout(handle);
      },
    });
    const current = connection.store.get().match;
    if (current) director.push(current);
    const unsubscribe = connection.subscribeUpdates((update) => director.push(update));
    return () => {
      unsubscribe();
      director.dispose();
    };
  }, [connection, module]);

  return presented;
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
