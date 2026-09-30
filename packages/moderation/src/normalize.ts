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
  const base = normalizeText(nickname);
  let out = '';
  for (const ch of base) out += LEET[ch] ?? ch;
  return out.replace(/[^\p{L}\p{N}]/gu, '').replace(/(.)\1+/gu, '$1');
}
