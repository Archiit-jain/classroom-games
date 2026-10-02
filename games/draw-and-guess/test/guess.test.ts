import { describe, expect, it } from 'vitest';
import {
  editDistance,
  fitsPattern,
  hintCap,
  isCloseGuess,
  isCorrectGuess,
  normalizeGuess,
  patternOf,
  type WordEntry,
} from '../src/shared';

const entry = (word: string, ...aliases: string[]): WordEntry => ({
  word,
  aliases,
  difficulty: 'easy',
});
const cat = entry('cat', 'kitten');
const plane = entry('aeroplane', 'airplane', 'plane');
const iceCream = entry('ice cream', 'icecream');

describe('guess matching (spec §12)', () => {
  it('normalises case, accents, punctuation and hyphens', () => {
    expect(normalizeGuess('  Ïs it a CAT?!  ')).toBe('is it a cat');
    expect(normalizeGuess('T-Shirt')).toBe('t shirt');
  });

  it('accepts the word, an alias, or the word as a whole word or phrase', () => {
    expect(isCorrectGuess('cat', cat)).toBe(true);
    expect(isCorrectGuess('Kitten!', cat)).toBe(true);
    expect(isCorrectGuess('is it a cat?', cat)).toBe(true);
    expect(isCorrectGuess('plane', plane)).toBe(true);
    expect(isCorrectGuess('icecream', iceCream)).toBe(true);
    expect(isCorrectGuess('i think ice cream', iceCream)).toBe(true);
  });

  it('does not accept a word hidden inside another word', () => {
    expect(isCorrectGuess('category', cat)).toBe(false);
    expect(isCorrectGuess('cats', cat)).toBe(false);
    expect(isCorrectGuess('ice', iceCream)).toBe(false);
  });

  it('calls a guess close only at one edit from an answer of 4+ letters', () => {
    expect(isCloseGuess('aeroplan', plane)).toBe(true);
    expect(isCloseGuess('airplame', plane)).toBe(true);
    expect(isCloseGuess('cot', cat)).toBe(false); // "cat" has only 3 letters
    expect(isCloseGuess('kiten', cat)).toBe(true); // alias "kitten"
    expect(isCloseGuess('aeroplane', plane)).toBe(false); // correct, not close
    expect(isCloseGuess('banana', plane)).toBe(false);
    expect(editDistance('kitten', 'sitting', 5)).toBe(3);
  });

  it('builds patterns and caps hints at floor(letters / 3), at most two', () => {
    expect(patternOf('ice cream', [])).toBe('___ _____');
    expect(patternOf('t-shirt', [0, 3])).toBe('t-_h___');
    expect(hintCap('cat')).toBe(1);
    expect(hintCap('mango')).toBe(1);
    expect(hintCap('banana')).toBe(2);
    expect(hintCap('watermelon')).toBe(2);
    expect(fitsPattern('ice cream', '___ c____')).toBe(true);
    expect(fitsPattern('icecream', '___ _____')).toBe(false);
    expect(fitsPattern('dog', 'c__')).toBe(false);
  });
});
