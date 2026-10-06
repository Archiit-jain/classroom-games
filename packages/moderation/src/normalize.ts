/**
 * Invisible formatting characters used to evade filters or fake look-alike
 * names (soft hyphen, zero-width space/joiners, bidi controls, fillers…).
 * Listed as numbers so no invisible character ever sits in the source.
 */
const INVISIBLE_CODE_POINTS = new Set([
  0x00ad, 0x034f, 0x061c, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x180e, 0x3164, 0xfeff, 0xffa0,
]);
const INVISIBLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x206f],
];

function isInvisible(cp: number): boolean {
  return INVISIBLE_CODE_POINTS.has(cp) || INVISIBLE_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
}

function isControl(cp: number): boolean {
  return cp < 0x20 || (cp >= 0x7f && cp <= 0x9f);
}

/** Removes invisible characters; turns control characters (newlines, tabs…) into spaces. */
export function stripInvisible(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (isInvisible(cp)) continue;
    out += isControl(cp) ? ' ' : ch;
  }
  return out;
}

/**
 * Canonical form of free text for game logic (e.g. guess matching):
 * NFKC, invisible characters removed, accents removed, lower case, single spaces.
 */
export function normalizeText(text: string): string {
  return stripInvisible(text.normalize('NFKC'))
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cyrillic and Greek letters that look like Latin ones ("а" U+0430 vs "a"), folded
 * to Latin so a look-alike nickname counts as the same name in a room (profanity
 * matching already resolves confusables inside the obscenity library). Code points only (no look-alike characters in the source). Each maps one
 * UTF-16 unit to one, so positions in the text stay the same.
 */
const CONFUSABLE_PAIRS: ReadonlyArray<readonly [number, string]> = [
  // Cyrillic lower case
  [0x0430, 'a'],
  [0x0432, 'b'],
  [0x0435, 'e'],
  [0x043a, 'k'],
  [0x043c, 'm'],
  [0x043d, 'h'],
  [0x043e, 'o'],
  [0x0440, 'p'],
  [0x0441, 'c'],
  [0x0442, 't'],
  [0x0443, 'y'],
  [0x0445, 'x'],
  [0x0455, 's'],
  [0x0456, 'i'],
  [0x0457, 'i'],
  [0x0458, 'j'],
  [0x0501, 'd'],
  [0x04cf, 'l'],
  [0x051b, 'q'],
  [0x051d, 'w'],
  [0x0491, 'r'],
  // Cyrillic upper case
  [0x0410, 'A'],
  [0x0412, 'B'],
  [0x0415, 'E'],
  [0x041a, 'K'],
  [0x041c, 'M'],
  [0x041d, 'H'],
  [0x041e, 'O'],
  [0x0420, 'P'],
  [0x0421, 'C'],
  [0x0422, 'T'],
  [0x0423, 'Y'],
  [0x0425, 'X'],
  [0x0405, 'S'],
  [0x0406, 'I'],
  [0x0408, 'J'],
  [0x04c0, 'I'],
  // Greek lower case
  [0x03b1, 'a'],
  [0x03b5, 'e'],
  [0x03b9, 'i'],
  [0x03ba, 'k'],
  [0x03bd, 'v'],
  [0x03bf, 'o'],
  [0x03c1, 'p'],
  [0x03c4, 't'],
  [0x03c5, 'u'],
  [0x03c7, 'x'],
  // Greek upper case
  [0x0391, 'A'],
  [0x0392, 'B'],
  [0x0395, 'E'],
  [0x0396, 'Z'],
  [0x0397, 'H'],
  [0x0399, 'I'],
  [0x039a, 'K'],
  [0x039c, 'M'],
  [0x039d, 'N'],
  [0x039f, 'O'],
  [0x03a1, 'P'],
  [0x03a4, 'T'],
  [0x03a5, 'Y'],
  [0x03a7, 'X'],
];
const CONFUSABLES = new Map(
  CONFUSABLE_PAIRS.map(([cp, latin]) => [String.fromCharCode(cp), latin] as const),
);
const CONFUSABLE_RE = new RegExp(`[${[...CONFUSABLES.keys()].join('')}]`, 'gu');

/** Folds Cyrillic/Greek look-alikes to Latin letters (same length). */
export function foldConfusables(text: string): string {
  return text.replace(CONFUSABLE_RE, (ch) => CONFUSABLES.get(ch) ?? ch);
}

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '@': 'a',
  $: 's',
  '!': 'i',
  '|': 'i',
};

/**
 * Key used to decide whether two nicknames are "the same" inside a room, so
 * "Archit", "Archít", "ARCH1T" and "A r c h i t" cannot sit side by side.
 */
export function nicknameKey(nickname: string): string {
  const base = normalizeText(foldConfusables(nickname));
  let out = '';
  for (const ch of base) out += LEET[ch] ?? ch;
  return out.replace(/[^\p{L}\p{N}]/gu, '').replace(/(.)\1+/gu, '$1');
}
