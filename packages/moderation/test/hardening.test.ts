import { describe, expect, it } from 'vitest';
import { REMOVED_MARKER, createModerator, nicknameKey } from '../src';

/**
 * Phase 10 §6: evasion attempts. Each case is text a player might type to get abuse
 * or contact details past the filter; the display must not carry it. Look-alike
 * characters are built from code points so none sit in the source.
 */
const mod = createModerator();
const cp = (...points: number[]) => String.fromCodePoint(...points);
const CYR_A = cp(0x0430);
const CYR_C = cp(0x0441);
const CYR_O = cp(0x043e);
const CYR_CAP_A = cp(0x0410);
const GREEK_O = cp(0x03bf);
const ZWSP = cp(0x200b);
const SOFT_HYPHEN = cp(0x00ad);

const censored = (text: string) => mod.moderate(text).flags.includes('PROFANITY');
const contact = (text: string) => mod.moderate(text).flags.includes('CONTACT');

describe('profanity evasion is still censored', () => {
  const evasions: Array<[label: string, text: string]> = [
    ['plain', 'fuck off'],
    ['upper case', 'FUCK OFF'],
    ['spaced letters', 'f u c k off'],
    ['dotted letters', 'f.u.c.k off'],
    ['dashed letters', 's-h-i-t'],
    ['leetspeak', 'sh1t happens'],
    ['symbol leetspeak', '$h!t'],
    ['stretched letters', 'fuuuuuck'],
    ['repeated punctuation after', 'stupid!!!!!'],
    ['zero-width space inside', `fu${ZWSP}ck`],
    ['soft hyphen inside', `fu${SOFT_HYPHEN}ck`],
    ['Cyrillic look-alike', `fu${CYR_C}k`],
    ['Greek look-alike', `bl${GREEK_O}wjob`],
    ['fullwidth letters', 'ｆｕｃｋ'],
    ['Hinglish', 'tu chutiya hai'],
    ['Hinglish abbreviation', 'bc kya kar raha'],
    ['Hinglish stretched', 'chuuutiya'],
    ['Hinglish in caps', 'BEHENCHOD'],
  ];
  for (const [label, text] of evasions) {
    it(label, () => {
      expect(censored(text), `${label}: ${mod.moderate(text).display}`).toBe(true);
    });
  }

  it('known limitation: a spaced two-letter abbreviation ("m c") passes', () => {
    // Owner rule (Phase 2): bc/mc are blocked as whole words only. Spaced runs need
    // 3+ letters, otherwise any "a b" style pair would be joined and checked.
    expect(censored('m c')).toBe(false);
    expect(censored('mc')).toBe(true);
  });

  it('censoring keeps the message length and the clean words', () => {
    const { display } = mod.moderate(`you are fu${CYR_C}king great`);
    expect([...display].length).toBe([...`you are fu${CYR_C}king great`].length);
    expect(display.startsWith('you are ')).toBe(true);
    expect(display.endsWith(' great')).toBe(true);
  });
});

describe('ordinary chat is left alone', () => {
  const clean = [
    'good game everyone',
    'chod do yaar, next round',
    'what a six! chakka',
    'class assessment tomorrow',
    'scunthorpe',
    'grape and cocktail',
    `${CYR_O}k ${CYR_A} privet`, // Russian-looking text without abuse
    'room 1234 please',
    'it costs 50000 rupees',
  ];
  for (const text of clean) {
    it(text, () => {
      expect(mod.moderate(text).display).toBe(text);
    });
  }
});

describe('contact details are removed', () => {
  const cases: Array<[label: string, text: string]> = [
    ['phone', 'call 9876543210'],
    ['phone with spaces', 'call 98765 43210'],
    ['phone with country code', '+91 98765-43210'],
    [
      'phone in Devanagari digits',
      `call ${cp(0x096f, 0x096e, 0x096d, 0x096c, 0x096b, 0x096a, 0x0969, 0x0968, 0x0967, 0x0966)}`,
    ],
    ['phone in fullwidth digits', 'call ９８７６５４３２１０'],
    ['email', 'mail me at kid@example.com'],
    ['url', 'go to https://evil.example/x'],
    ['www', 'www.example.com'],
    ['bare domain', 'visit example.in'],
    ['dot obfuscation', 'example dot com'],
    ['handle', 'add @rahul_07'],
    ['platform handle', 'insta: rahul_07'],
    ['whatsapp number', 'whatsapp pe 9876543210'],
  ];
  for (const [label, text] of cases) {
    it(label, () => {
      const result = mod.moderate(text);
      expect(result.flags, `${label}: ${result.display}`).toContain('CONTACT');
      expect(result.display).toContain(REMOVED_MARKER);
    });
  }

  it('short numbers in normal chat stay', () => {
    expect(contact('I have 3 cards and 12 points')).toBe(false);
  });
});

describe('nicknames', () => {
  it('a Cyrillic look-alike name counts as the same name (no impersonation)', () => {
    expect(nicknameKey(`${CYR_CAP_A}rchit`)).toBe(nicknameKey('Archit'));
    expect(nicknameKey(`Pri${cp(0x0443)}a`)).toBe(nicknameKey('Priya'));
  });

  it('profane nicknames are refused, including look-alikes and spacing', () => {
    for (const name of ['fuck', 'f u c k', `fu${CYR_C}k`, 'Chutiya', 'b.c']) {
      expect(mod.validateNickname(name).ok, name).toBe(false);
    }
  });

  it('invisible characters cannot make a different-looking duplicate', () => {
    expect(nicknameKey(`Arc${ZWSP}hit`)).toBe(nicknameKey('Archit'));
  });
});
