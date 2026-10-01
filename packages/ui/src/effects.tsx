import type { EffectsMode } from '@cg/game-sdk/client';
import { MotionConfig } from 'motion/react';
import { createContext, useContext, useEffect, type ReactNode } from 'react';

const EffectsContext = createContext<EffectsMode>('full');

/**
 * Provides the effects mode to every primitive and board, configures Motion
 * accordingly and exposes it to CSS as `html[data-effects]`.
 */
export function EffectsRoot({ mode, children }: { mode: EffectsMode; children: ReactNode }) {
  useEffect(() => {
    document.documentElement.dataset.effects = mode;
  }, [mode]);
  return (
    <EffectsContext.Provider value={mode}>
      <MotionConfig reducedMotion={mode === 'reduced' ? 'always' : 'never'}>
        {children}
      </MotionConfig>
    </EffectsContext.Provider>
  );
}

export function useEffects(): EffectsMode {
  return useContext(EffectsContext);
}

/**
 * Duration for an animation in the current mode: full as designed, lite
 * shortened (default 60 %), reduced = 0 (instant).
 */
export function durationFor(
  mode: EffectsMode,
  fullMs: number,
  liteMs = Math.round(fullMs * 0.6),
): number {
  if (mode === 'reduced') return 0;
  return mode === 'lite' ? liteMs : fullMs;
}
