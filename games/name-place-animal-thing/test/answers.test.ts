import { describe, expect, it } from 'vitest';
import {
  answerKey,
  cleanAnswer,
  formatProblem,
  isBlank,
  looksValid,
  pluralFolding,
} from '../src/shared';

describe('normalisation', () => {
  it('keeps what the player wrote, tidied: spaces collapsed, invisible characters removed', () => {
    expect(cleanAnswer('  New   Delhi ')).toBe('New Delhi');
    expect(cleanAnswer('De​lhi')).toBe('Delhi');
    expect(cleanAnswer('Ｄｅｌｈｉ')).toBe('Delhi'); // full-width → NFKC
    expect(cleanAnswer('Élan')).toBe('Élan');
  });

  it('compares case-, accent-, space- and punctuation-insensitively', () => {
    const same = ['Delhi', 'delhi', ' DELHI ', 'Delhi.', 'De-lhi', 'D e l h i'];
    expect(new Set(same.map(answerKey))).toEqual(new Set(['delhi']));
    expect(answerKey('St. Louis')).toBe(answerKey('st louis'));
    expect(answerKey('St-Louis')).toBe('stlouis');
    expect(answerKey('Ōsaka')).toBe('osaka');
    expect(answerKey('New Delhi')).not.toBe(answerKey('Delhi'));
    expect(answerKey('Dehli')).not.toBe(answerKey('Delhi'));
  });

  it('treats empty, spaces-only and punctuation-only answers as blank', () => {
    for (const raw of ['', '   ', '...', " - ' ", '​']) expect(isBlank(raw), raw).toBe(true);
    expect(isBlank('Om')).toBe(false);
  });
});

describe('format rules (the mechanical part of the automatic check)', () => {
  it.each([
    ['Delhi', 'D', null],
    ['delhi', 'D', null],
    ['Élan', 'E', null],
    ["D'Souza", 'D', null],
    ['Dum aloo', 'D', null],
    ['Yo-yo', 'Y', null],
    ['Om', 'O', null],
    ['Apple', 'D', 'LETTER'],
    ['A Dog', 'D', 'LETTER'], // no article skipping
    ['D', 'D', 'SHORT'],
    ['D.', 'D', 'SHORT'],
    ['7 Up', 'S', 'CHARACTERS'],
    ['Delhi 6', 'D', 'CHARACTERS'],
    ['Delhi!', 'D', 'CHARACTERS'],
    ['Dog 🐶', 'D', 'CHARACTERS'],
    ['दिल्ली', 'D', 'CHARACTERS'],
    ['D'.repeat(31), 'D', 'CHARACTERS'],
  ])('%j for %s → %s', (raw, letter, expected) => {
    expect(formatProblem(raw, letter)).toBe(expected);
  });

  it('gives the phone a local hint that matches the format rules', () => {
    expect(looksValid('Delhi', 'D')).toBe(true);
    expect(looksValid('Apple', 'D')).toBe(false);
    expect(looksValid('', 'D')).toBe(false);
    expect(looksValid('Delhi', null)).toBe(false);
  });
});

describe('duplicates: plural folding', () => {
  it('folds -s and -es plurals onto a present singular of 3+ letters', () => {
    const fold = pluralFolding(['mango', 'mangoes', 'apple', 'apples', 'bus', 'buses', 'tomatoes']);
    expect(fold.get('mangoes')).toBe('mango');
    expect(fold.get('apples')).toBe('apple');
    expect(fold.get('buses')).toBe('bus');
    expect(fold.get('tomatoes')).toBe('tomatoes'); // no singular given → stays itself
  });

  it('does not fold short stems or unrelated words', () => {
    const fold = pluralFolding(['bu', 'bus', 'paris', 'pari']);
    expect(fold.get('bus')).toBe('bus'); // "bu" is too short to be a singular
    expect(fold.get('paris')).toBe('pari'); // known edge: only ever 10 → 5, never invalid
    expect(pluralFolding(['dog', 'dogs', 'dogses']).get('dogs')).toBe('dog');
  });
});
