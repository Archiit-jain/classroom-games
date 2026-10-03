import { createModerator } from '@cg/moderation';
import { describe, expect, it } from 'vitest';
import { ALIASES, BANK } from '../content/en';
import { CATEGORIES, LETTERS, answerKey, formatProblem, isBlank } from '../src/shared';

describe('answer bank (en)', () => {
  const moderator = createModerator();

  it('has at least 5 different answers for every round letter in every category', () => {
    for (const c of CATEGORIES) {
      expect(Object.keys(BANK[c]).sort(), c).toEqual([...LETTERS].sort());
      for (const letter of LETTERS) {
        const list = BANK[c][letter] ?? [];
        expect(new Set(list.map(answerKey)).size, `${c} ${letter}`).toBeGreaterThanOrEqual(5);
      }
    }
  });

  it('only contains answers that pass the format rules for their letter', () => {
    for (const c of CATEGORIES) {
      for (const [letter, list] of Object.entries(BANK[c])) {
        for (const w of list) {
          expect(isBlank(w), w).toBe(false);
          expect(formatProblem(w, letter), `${c}: ${w}`).toBeNull();
        }
      }
    }
  });

  it('only contains answers and variants that pass the moderator', () => {
    const all = CATEGORIES.flatMap((c) => [...Object.values(BANK[c]).flat(), ...ALIASES[c].flat()]);
    for (const text of all) {
      expect(moderator.moderate(text), text).toMatchObject({ display: text, flags: [] });
    }
  });

  it('keeps variants to one first letter, so they can only ever merge same-letter answers', () => {
    for (const c of CATEGORIES) {
      for (const variants of ALIASES[c]) {
        expect(variants.length, variants.join()).toBeGreaterThanOrEqual(2);
        expect(new Set(variants.map((v) => answerKey(v)[0])).size, variants.join()).toBe(1);
        expect(new Set(variants.map(answerKey)).size, variants.join()).toBe(variants.length);
      }
    }
  });
});
