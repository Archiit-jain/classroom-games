import type { EffectsMode } from '@cg/game-sdk/client';
import { KEYS, storage } from './storage';

/** What the player chose. `auto` = decide from the OS setting and device capability. */
export type EffectsPreference = 'auto' | 'full' | 'lite';

export interface EffectsState {
  preference: EffectsPreference;
  /** Result of the automatic device check (used when preference is `auto`). */
  detected: 'full' | 'lite';
  osReducedMotion: boolean;
}

/** OS reduced-motion always wins; otherwise the player's choice, else the device check. */
export function resolveEffects(state: EffectsState): EffectsMode {
  if (state.osReducedMotion) return 'reduced';
  if (state.preference !== 'auto') return state.preference;
  return state.detected;
}

/** Cheap hardware hints (Chrome/Android expose deviceMemory). */
export function looksLowEnd(nav: { hardwareConcurrency?: number; deviceMemory?: number }): boolean {
  return (
    (nav.deviceMemory !== undefined && nav.deviceMemory <= 2) ||
    (nav.hardwareConcurrency !== undefined && nav.hardwareConcurrency <= 2)
  );
}

type Listener = () => void;

/** Small observable store for the effects setting. */
export class EffectsController {
  private state: EffectsState;
  private readonly listeners = new Set<Listener>();

  constructor() {
    const saved = storage.get(KEYS.effects);
    const preference: EffectsPreference = saved === 'full' || saved === 'lite' ? saved : 'auto';
    const mql =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    this.state = {
      preference,
      detected: looksLowEnd(navigator as Navigator & { deviceMemory?: number }) ? 'lite' : 'full',
      osReducedMotion: mql?.matches ?? false,
    };
    mql?.addEventListener('change', () => this.update({ osReducedMotion: mql.matches }));
    if (this.state.detected === 'full') this.sampleFrameRate();
  }

  get = (): EffectsState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setPreference(preference: EffectsPreference): void {
    storage.set(KEYS.effects, preference);
    this.update({ preference });
  }

  private update(patch: Partial<EffectsState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /**
   * After the page settles, count frames for one second. A device that can't
   * hold ~40 fps while idle gets lite effects automatically.
   */
  private sampleFrameRate(): void {
    if (typeof requestAnimationFrame !== 'function') return;
    window.setTimeout(() => {
      if (document.visibilityState !== 'visible') return;
      let frames = 0;
      const start = performance.now();
      const loop = (t: number) => {
        frames++;
        if (t - start < 1000) requestAnimationFrame(loop);
        else if ((frames * 1000) / (t - start) < 40) this.update({ detected: 'lite' });
      };
      requestAnimationFrame(loop);
    }, 2500);
  }
}
