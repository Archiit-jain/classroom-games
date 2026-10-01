import type { Accent } from '@cg/game-sdk/client';

/**
 * The category content pack, language-neutral: ids and colours only. English
 * labels live in `content/en`; icons are original SVGs in `src/client/icons`.
 * Rules (enforced by tests): exactly four items per category, unique ids, four
 * distinct colours per category. No brands, logos, religious, political or
 * national symbols.
 */
export interface ItemDef {
  id: string;
  /** Slip colour band. Never the only cue: the icon and label are always shown. */
  accent: Accent;
}

export interface CategoryDef {
  id: string;
  items: readonly [ItemDef, ItemDef, ItemDef, ItemDef];
}

export const CATEGORIES: readonly CategoryDef[] = [
  {
    id: 'fruits',
    items: [
      { id: 'mango', accent: 'orange' },
      { id: 'banana', accent: 'yellow' },
      { id: 'apple', accent: 'pink' },
      { id: 'grapes', accent: 'violet' },
    ],
  },
  {
    id: 'animals',
    items: [
      { id: 'lion', accent: 'yellow' },
      { id: 'elephant', accent: 'violet' },
      { id: 'monkey', accent: 'orange' },
      { id: 'peacock', accent: 'cyan' },
    ],
  },
  {
    id: 'sports',
    items: [
      { id: 'cricket', accent: 'pink' },
      { id: 'football', accent: 'lime' },
      { id: 'badminton', accent: 'cyan' },
      { id: 'chess', accent: 'violet' },
    ],
  },
  {
    id: 'street-food',
    items: [
      { id: 'samosa', accent: 'orange' },
      { id: 'pani-puri', accent: 'lime' },
      { id: 'jalebi', accent: 'yellow' },
      { id: 'vada-pav', accent: 'pink' },
    ],
  },
  {
    id: 'vehicles',
    items: [
      { id: 'auto-rickshaw', accent: 'yellow' },
      { id: 'bus', accent: 'pink' },
      { id: 'train', accent: 'cyan' },
      { id: 'bicycle', accent: 'lime' },
    ],
  },
  {
    id: 'stationery',
    items: [
      { id: 'pencil', accent: 'yellow' },
      { id: 'eraser', accent: 'pink' },
      { id: 'sharpener', accent: 'cyan' },
      { id: 'ruler', accent: 'violet' },
    ],
  },
  {
    id: 'sky',
    items: [
      { id: 'sun', accent: 'orange' },
      { id: 'moon', accent: 'violet' },
      { id: 'star', accent: 'yellow' },
      { id: 'rainbow', accent: 'pink' },
    ],
  },
  {
    id: 'music',
    items: [
      { id: 'tabla', accent: 'orange' },
      { id: 'guitar', accent: 'pink' },
      { id: 'flute', accent: 'lime' },
      { id: 'trumpet', accent: 'yellow' },
    ],
  },
  {
    id: 'toys',
    items: [
      { id: 'kite', accent: 'pink' },
      { id: 'spinning-top', accent: 'orange' },
      { id: 'marbles', accent: 'cyan' },
      { id: 'yo-yo', accent: 'violet' },
    ],
  },
  {
    id: 'ocean',
    items: [
      { id: 'fish', accent: 'orange' },
      { id: 'crab', accent: 'pink' },
      { id: 'octopus', accent: 'violet' },
      { id: 'whale', accent: 'cyan' },
    ],
  },
];

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

/** Every item id in the pack (ids are unique across categories). */
export const ALL_ITEM_IDS = CATEGORIES.flatMap((c) => c.items.map((i) => i.id));

export function categoryById(id: string): CategoryDef | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

export function itemDef(itemId: string): ItemDef | undefined {
  for (const c of CATEGORIES) {
    const found = c.items.find((i) => i.id === itemId);
    if (found) return found;
  }
  return undefined;
}
