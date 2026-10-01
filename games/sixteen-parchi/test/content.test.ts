import { createModerator } from '@cg/moderation';
import { describe, expect, it } from 'vitest';
import { CATEGORY_LABELS, ITEM_LABELS } from '../content/en';
import { hasItemIcon } from '../src/client/icons/items';
import { ALL_ITEM_IDS, CATEGORIES } from '../src/shared';

describe('category content pack (en)', () => {
  const moderator = createModerator();

  it('labels every category and item, and draws an original icon for every item', () => {
    for (const c of CATEGORIES) expect(CATEGORY_LABELS[c.id]).toBeTruthy();
    for (const id of ALL_ITEM_IDS) {
      expect(ITEM_LABELS[id], id).toBeTruthy();
      expect(hasItemIcon(id), id).toBe(true);
    }
    // No stray labels for items that do not exist.
    expect(Object.keys(ITEM_LABELS).sort()).toEqual([...ALL_ITEM_IDS].sort());
  });

  it('only uses labels that pass the chat moderator', () => {
    for (const label of [...Object.values(CATEGORY_LABELS), ...Object.values(ITEM_LABELS)]) {
      expect(moderator.moderate(label), label).toMatchObject({ display: label, flags: [] });
    }
  });

  it('keeps item labels short enough for a phone slip', () => {
    for (const label of Object.values(ITEM_LABELS)) expect(label.length).toBeLessThanOrEqual(13);
  });
});
