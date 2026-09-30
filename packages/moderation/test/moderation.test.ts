import { describe, expect, it } from 'vitest';
import { REMOVED_MARKER, createModerator, nicknameKey, normalizeText } from '../src';

const mod = createModerator();

describe('profanity is censored with same-length asterisks', () => {
  const cases: Array<[input: string, expected: string]> = [
    ['you are stupid', 'you are ******'],
    ['fuck', '****'],
    ['FUCK this', '**** this'],
    ['fuuuuck', '*******'],
    ['sh1t happens', '**** happens'],
    ['what a b1tch', 'what a *****'],
    ['f u c k off', '* * * * off'],
    ['s.t.u.p.i.d', '***********'],
    ['you retard', 'you ******'],
    // "!" as punctuation must not be read as leetspeak "i" (found in manual testing).
    ['you are stupid!', 'you are ******!'],
    ['stupid!! idiot!', '******!! *****!'],
    ['sh!t', '****'],
  ];
  it.each(cases)('%s', (input, expected) => {
    const r = mod.moderate(input);
    expect(r.display).toBe(expected);
    expect(r.flags).toContain('PROFANITY');
  });
});

describe('romanised Hindi / Hinglish abuse is censored', () => {
  const words = [
    'madarchod',
    'bhenchod',
    'behenchod',
    'chutiya',
    'Chutiye',
    'bhosdike',
    'gaandu',
    'gaaaand',
    'bsdk',
    'harami',
    'kamina',
  ];
  it.each(words)('%s', (word) => {
    const r = mod.moderate(`tu ${word} hai`);
    expect(r.flags).toContain('PROFANITY');
    expect(r.display.toLowerCase()).not.toContain(word.toLowerCase());
  });

  it('censors the common abbreviations as whole words only', () => {
    expect(mod.moderate('bc kya kar raha').display).toBe('** kya kar raha');
    expect(mod.moderate('kya bc!').display).toBe('kya **!');
    expect(mod.moderate('abc def').flags).toEqual([]);
  });
});

describe('legitimate text is left untouched (false-positive guard)', () => {
  const safe = [
    'Welcome to the Classroom Games',
    'pass the chit to the left',
    'I passed my class test',
    'assassin creed is fun',
    'Scunthorpe United won',
    'the grass is green',
    'cocktail party tonight',
    'Gandhi ji was great',
    'chod do yaar, next round',
    'chutney is tasty',
    'cricket mein chakka maara',
    'saala bahut funny tha',
    'analysis of the canal',
    'hello from the shell',
    'bass guitar and a glass of water',
    'my title is champion',
    'brb, ok, gg, wp',
    'score is 10 20 30',
    'I am in class 10',
    'insta pe aaja kabhi',
    'ek do teen char',
  ];
  it.each(safe)('%s', (text) => {
    const r = mod.moderate(text);
    expect(r.display).toBe(text);
    expect(r.flags).toEqual([]);
  });
});

describe('contact details are removed', () => {
  const cases: Array<[string, string]> = [
    ['visit https://evil.example/x now', `visit ${REMOVED_MARKER} now`],
    ['go to www.abc.com now', `go to ${REMOVED_MARKER} now`],
    ['check abc.in/page', `check ${REMOVED_MARKER}`],
    ['mail me at kid@gmail.com', `mail me at ${REMOVED_MARKER}`],
    ['call 98765 43210', `call ${REMOVED_MARKER}`],
    ['my no +91-98765-43210', `my no ${REMOVED_MARKER}`],
    ['follow @rahul_07', `follow ${REMOVED_MARKER}`],
    ['insta: rahul', `insta: ${REMOVED_MARKER}`],
    ['add me on snap rahul_07', `add me on snap ${REMOVED_MARKER}`],
    ['discord id gamerboy', `discord id ${REMOVED_MARKER}`],
    ['abc dot com', REMOVED_MARKER],
  ];
  it.each(cases)('%s', (input, expected) => {
    const r = mod.moderate(input);
    expect(r.display).toBe(expected);
    expect(r.flags).toContain('CONTACT');
  });

  it('reports both flags when both apply', () => {
    const r = mod.moderate('stupid, mail kid@gmail.com');
    expect(r.flags.sort()).toEqual(['CONTACT', 'PROFANITY']);
  });
});

const ZWSP = String.fromCodePoint(0x200b);

describe('invisible-character evasion', () => {
  it('strips zero-width characters before matching', () => {
    const r = mod.moderate(`f${ZWSP}uck`);
    expect(r.flags).toContain('PROFANITY');
    expect(r.display).not.toMatch(/fuck/i);
  });
});

describe('nicknames', () => {
  it.each(['Archit', 'Priya S', 'Rahul_07', 'Ana 🔥', 'अर्जुन', "D'Souza"])(
    'accepts %s',
    (name) => {
      expect(mod.validateNickname(name)).toMatchObject({ ok: true, nickname: name });
    },
  );

  it.each(['a', 'x'.repeat(17), '!!!', 'a<b>', '   ', 'insta @abc'])(
    'rejects %s as invalid',
    (name) => {
      expect(mod.validateNickname(name)).toEqual({ ok: false, reason: 'INVALID' });
    },
  );

  it.each(['Bot Tiku', 'bot', 'stupid', 'F u c k', 'Chutiya99', 'www.abc.com'])(
    'rejects %s as not allowed',
    (name) => {
      expect(mod.validateNickname(name)).toEqual({ ok: false, reason: 'REJECTED' });
    },
  );

  it('trims and collapses whitespace', () => {
    expect(mod.validateNickname('  Priya   S  ')).toMatchObject({ ok: true, nickname: 'Priya S' });
  });

  it('treats look-alike names as the same key', () => {
    const key = nicknameKey('Archit');
    for (const variant of ['Archít', 'ARCH1T', 'A r c h i t', 'Archiit', `Arc${ZWSP}hit`]) {
      expect(nicknameKey(variant)).toBe(key);
    }
    expect(nicknameKey('Priya')).not.toBe(key);
  });
});

describe('normalizeText', () => {
  it('lowercases, removes accents and collapses spaces', () => {
    expect(normalizeText('  Héllo   WORLD ')).toBe('hello world');
    expect(mod.normalize('ＦＵＬＬ width')).toBe('full width');
  });
});
