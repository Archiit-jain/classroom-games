import type { WordEntry } from './types';

/**
 * Guess matching (spec §12). Input is already normalised by the platform
 * moderator (lower case, accents removed, spaces collapsed); here punctuation
 * is dropped and hyphens count as spaces.
 */
export function normalizeGuess(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/-/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const compact = (s: string) => s.replace(/\s/g, '');

/** Every accepted answer for an entry, normalised. */
export function answersOf(entry: WordEntry): string[] {
  return [entry.word, ...entry.aliases].map(normalizeGuess).filter((a) => a.length > 0);
}

function containsPhrase(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((t, k) => haystack[i + k] === t)) return true;
  }
  return false;
}

/**
 * Correct = equal to the word or an alias (spaces ignored, so "icecream" =
 * "ice cream"), or containing it as a whole word/phrase ("is it a cat?").
 */
export function isCorrectGuess(guess: string, entry: WordEntry): boolean {
  const g = normalizeGuess(guess);
  if (!g) return false;
  const tokens = g.split(' ');
  return answersOf(entry).some(
    (answer) => compact(g) === compact(answer) || containsPhrase(tokens, answer.split(' ')),
  );
}

/** Levenshtein distance, stopping early once it exceeds `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(
        (prev[j] as number) + 1,
        (cur[j - 1] as number) + 1,
        (prev[j - 1] as number) + cost,
      );
      cur.push(v);
      best = Math.min(best, v);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length] as number;
}

/** Close = one edit away from the word or an alias of at least 4 letters (and not correct). */
export function isCloseGuess(guess: string, entry: WordEntry): boolean {
  const g = compact(normalizeGuess(guess));
  if (!g || isCorrectGuess(guess, entry)) return false;
  return answersOf(entry).some((answer) => {
    const a = compact(answer);
    return a.length >= 4 && editDistance(g, a, 1) === 1;
  });
}

/** Positions of the letters (not spaces or hyphens) in a word. */
export function letterPositions(word: string): number[] {
  return [...word].flatMap((ch, i) => (/\p{L}|\p{N}/u.test(ch) ? [i] : []));
}

/** How many hint letters a word may get: floor(letters / 3), at most 2 (spec §12). */
export function hintCap(word: string): number {
  return Math.min(2, Math.floor(letterPositions(word).length / 3));
}

/** Blanks for letters, with spaces/hyphens shown and revealed letters filled in. */
export function patternOf(word: string, revealed: readonly number[]): string {
  return [...word]
    .map((ch, i) => (/\p{L}|\p{N}/u.test(ch) && !revealed.includes(i) ? '_' : ch))
    .join('');
}

/** Does a candidate word fit a pattern (same shape, revealed letters equal)? */
export function fitsPattern(candidate: string, pattern: string): boolean {
  if (candidate.length !== pattern.length) return false;
  return [...pattern].every((p, i) => {
    const c = candidate[i] as string;
    if (p === '_') return /\p{L}|\p{N}/u.test(c);
    return p.toLowerCase() === c.toLowerCase();
  });
}
