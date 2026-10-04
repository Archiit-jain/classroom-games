import type { EffectsMode } from '@cg/game-sdk/client';

/**
 * Board movement timing (ms). The pawn walks every space in ALL effects modes — movement
 * is gameplay, not decoration; Reduced only drops the hop bounce. Each value stays under
 * the server's hold (diceMs 900, hopMs 190, landingMs 700) so the board never lags.
 */
export const DICE_MS = { full: 850, lite: 600, reduced: 350 } as const;
export const HOP_MS = { full: 170, lite: 160, reduced: 160 } as const;
export const LAND_MS = { full: 450, lite: 300, reduced: 150 } as const;

/** How long a roll takes on the board: dice (if any), every hop, the landing. */
export const walkMs = (withDice: boolean, steps: number, effects: EffectsMode) =>
  (withDice ? DICE_MS[effects] : 0) + (steps + 1) * HOP_MS[effects] + LAND_MS[effects];
