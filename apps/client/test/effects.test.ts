import { describe, expect, it } from 'vitest';
import { looksLowEnd, resolveEffects } from '../src/platform/effects';

describe('effects mode', () => {
  it('always honours the OS reduced-motion setting', () => {
    expect(resolveEffects({ preference: 'full', detected: 'full', osReducedMotion: true })).toBe(
      'reduced',
    );
  });

  it('uses the player choice over the device check', () => {
    expect(resolveEffects({ preference: 'lite', detected: 'full', osReducedMotion: false })).toBe(
      'lite',
    );
    expect(resolveEffects({ preference: 'full', detected: 'lite', osReducedMotion: false })).toBe(
      'full',
    );
  });

  it('falls back to the device check in auto mode', () => {
    expect(resolveEffects({ preference: 'auto', detected: 'lite', osReducedMotion: false })).toBe(
      'lite',
    );
    expect(resolveEffects({ preference: 'auto', detected: 'full', osReducedMotion: false })).toBe(
      'full',
    );
  });

  it('flags obviously low-end hardware', () => {
    expect(looksLowEnd({ deviceMemory: 2, hardwareConcurrency: 8 })).toBe(true);
    expect(looksLowEnd({ hardwareConcurrency: 2 })).toBe(true);
    expect(looksLowEnd({ deviceMemory: 8, hardwareConcurrency: 8 })).toBe(false);
    expect(looksLowEnd({})).toBe(false);
  });
});
