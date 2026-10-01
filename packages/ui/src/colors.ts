import type { Accent } from '@cg/game-sdk/client';

export const ACCENTS: readonly Accent[] = ['pink', 'cyan', 'yellow', 'lime', 'orange', 'violet'];

export const accentVar = (accent: Accent): string => `var(--cb-${accent})`;
export const accentDeepVar = (accent: Accent): string => `var(--cb-${accent}-deep)`;

/** A stable, distinct colour per seat. */
export const seatAccent = (seat: number): Accent =>
  ACCENTS[((seat % ACCENTS.length) + ACCENTS.length) % ACCENTS.length] as Accent;
