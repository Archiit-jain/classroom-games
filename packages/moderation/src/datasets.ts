import { DataSet, englishDataset, parseRawPattern } from 'obscenity';

/**
 * Word lists on top of obscenity's English dataset.
 *
 * Patterns use obscenity syntax: `|` marks a word boundary. They are matched
 * AFTER obscenity's transformers, which collapse repeated letters — so every
 * pattern is written in collapsed form ("gaand" → "gand", "chootiya" → "chotiya").
 *
 * Maintenance note: these lists are the weak point of any filter. Extend them
 * with a test case for each addition (see test/moderation.test.ts).
 */

export interface PhraseMeta {
  category: 'english' | 'hinglish' | 'insult' | 'custom';
}

/** Romanised Hindi / Hinglish abuse. Deliberately excluded (too many innocent uses):
 *  "chod" (as in "chod do" = leave it), "saala", "kutta", "chakka" (cricket six), "rand". */
const HINGLISH: string[] = [
  '|madarchod',
  '|maderchod',
  '|madarjat',
  '|behenchod',
  '|behanchod',
  '|bhenchod',
  '|bhanchod',
  '|benchod',
  '|chutiy',
  '|chutia',
  '|chotiya',
  '|chut|',
  '|bhosd',
  '|bhosri',
  '|gandu',
  '|gand|',
  '|lund|',
  '|lauda|',
  '|lawda|',
  '|loda|',
  '|lodu|',
  '|laude|',
  '|lawde|',
  '|randi',
  '|randwa',
  '|harami',
  '|haramkhor',
  '|bhadwa',
  '|bhadwe',
  '|bhadve',
  '|chinal|',
  '|jhant',
  '|jhatu|',
  '|kutiya|',
  '|kamina|',
  '|kamine|',
  '|kaminey|',
  '|hijra|',
  '|hijde|',
  // Common abbreviations of the above.
  '|bc|',
  '|mc|',
  '|bsdk|',
  '|bkl|',
  '|mkc|',
  '|tmkc|',
  '|mkb|',
];

/** Direct insults / self-harm taunts. The product brief's own example censors "stupid". */
const INSULTS: string[] = [
  '|stupid|',
  '|idiot',
  '|dumb|',
  '|moron',
  '|loser',
  '|kys|',
  '|kill yourself|',
  '|kill urself|',
];

/**
 * Legitimate words that contain a blocked sequence. Obscenity's English dataset
 * already whitelists many; these are extra ones found by our tests.
 */
export const EXTRA_ALLOWED_TERMS: string[] = [
  'classroom',
  'class',
  'pass',
  'passed',
  'password',
  'bass',
  'glass',
  'grass',
  'assassin',
  'assessment',
  'assignment',
  'embassy',
  'scunthorpe',
  'cocktail',
  'peacock',
  'hancock',
  'shuttlecock',
  'therapist',
  'analysis',
  'analyst',
  'canal',
  'cumulative',
  'document',
  'circumstance',
  'titan',
  'title',
  'constitution',
  'dickens',
  'sussex',
  'essex',
  'middlesex',
  'hello',
  'shell',
  'scrap',
  'skyscraper',
];

export function buildDataset(extraBlocked: readonly string[] = []): DataSet<PhraseMeta> {
  const dataset = new DataSet<PhraseMeta>();
  // Keep the English dataset (profanity, sexual terms, slurs) as the base.
  dataset.addAll(englishDataset as unknown as DataSet<PhraseMeta>);

  const add = (source: string, category: PhraseMeta['category']) =>
    dataset.addPhrase((phrase) =>
      phrase.setMetadata({ category }).addPattern(parseRawPattern(source)),
    );

  for (const p of HINGLISH) add(p, 'hinglish');
  for (const p of INSULTS) add(p, 'insult');
  for (const p of extraBlocked) add(p, 'custom');
  return dataset;
}
