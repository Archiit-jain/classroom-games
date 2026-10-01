import type { ReactionId } from '@cg/protocol';

/**
 * Glyphs for the fixed reaction set (spec §8). Code points, not literal
 * characters, so no invisible variation selectors sneak into the source.
 */
export const REACTION_EMOJI: Record<ReactionId, string> = {
  LOL: String.fromCodePoint(0x1f602),
  SHOCK: String.fromCodePoint(0x1f631),
  ANGRY: String.fromCodePoint(0x1f624),
  PLEASE: String.fromCodePoint(0x1f64f),
  CLAP: String.fromCodePoint(0x1f44f),
  FIRE: String.fromCodePoint(0x1f525),
  CRY: String.fromCodePoint(0x1f62d),
  SHH: String.fromCodePoint(0x1f92b),
};
