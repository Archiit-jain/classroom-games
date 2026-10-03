import { MAX_ANSWER_LENGTH, MIN_ANSWER_LETTERS, type Category, type InvalidReason } from './types';

/** Format controls, zero-width characters and other invisible marks. */
const INVISIBLE = /[\p{Cc}\p{Cf}\u{2028}\u{2029}]/gu;
/** Latin letters (accented ones too), spaces and the punctuation names use. */
const ALLOWED = /^[\p{Script=Latin}\p{M} .'’-]+$/u;
const LETTER = /\p{Script=Latin}/u;

/**
 * What a player sees of an answer: NFKC, invisible characters removed, trimmed,
 * runs of whitespace collapsed. Capitalisation and accents are kept.
 */
export function cleanAnswer(raw: string): string {
  return raw.normalize('NFKC').replace(INVISIBLE, '').replace(/\s+/gu, ' ').trim();
}

/** Lower case without accents: "Élan" → "elan". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * The comparison key: folded, letters only. "St. Louis", "st louis" and
 * "St-Louis" all become "stlouis".
 */
export function answerKey(raw: string): string {
  return fold(cleanAnswer(raw)).replace(/[^a-z]/gu, '');
}

/** True when there is nothing to score (empty, or only spaces/punctuation). */
export function isBlank(raw: string): boolean {
  return !LETTER.test(cleanAnswer(raw));
}

/**
 * The mechanical rules every answer must pass (not moderation, not meaning).
 * Null = fine. Callers check `isBlank` first.
 */
export function formatProblem(raw: string, letter: string): InvalidReason | null {
  const text = cleanAnswer(raw);
  if (!ALLOWED.test(text) || text.length > MAX_ANSWER_LENGTH) return 'CHARACTERS';
  const key = answerKey(text);
  if (key.length < MIN_ANSWER_LETTERS) return 'SHORT';
  if (key[0] !== letter.toLowerCase()) return 'LETTER';
  return null;
}

/** The local hint on a phone: does this answer pass the format rules? (The server decides.) */
export function looksValid(raw: string, letter: string | null): boolean {
  return letter !== null && !isBlank(raw) && formatProblem(raw, letter) === null;
}

/**
 * Merges plural forms into one key: of the keys present, "mangoes" joins "mango"
 * and "apples" joins "apple" when the shorter key has at least 3 letters.
 * Returns key → representative key.
 */
export function pluralFolding(keys: readonly string[]): Map<string, string> {
  const present = new Set(keys);
  const out = new Map<string, string>();
  for (const key of [...present].sort((a, b) => a.length - b.length || a.localeCompare(b))) {
    let target = key;
    for (const cut of [2, 1]) {
      const suffix = cut === 2 ? 'es' : 's';
      const base = key.slice(0, -cut);
      if (key.endsWith(suffix) && base.length >= 3 && present.has(base)) {
        target = out.get(base) ?? base;
        break;
      }
    }
    out.set(key, target);
  }
  return out;
}

export const groupId = (category: Category, key: string) => `${category}:${key}`;
