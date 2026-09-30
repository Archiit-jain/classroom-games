import { RegExpMatcher, englishRecommendedTransformers, type MatchPayload } from 'obscenity';
import { removeContactInfo } from './contact';
import { EXTRA_ALLOWED_TERMS, buildDataset } from './datasets';
import { nicknameKey, normalizeText, stripInvisible } from './normalize';

export type ModerationFlag = 'PROFANITY' | 'CONTACT';

export interface ModerationResult {
  /** Text safe to display to other players. */
  display: string;
  flags: ModerationFlag[];
}

export type NicknameCheck =
  { ok: true; nickname: string; key: string } | { ok: false; reason: 'INVALID' | 'REJECTED' };

export interface NicknameRules {
  minLength: number;
  maxLength: number;
}

/**
 * The moderation boundary used by the server. Replaceable: a stronger
 * implementation (e.g. an external service) only needs to satisfy this.
 */
export interface Moderator {
  /** Canonical text for game logic (guess matching etc.). Never shown to users. */
  normalize(text: string): string;
  /** Censors profanity (same-length asterisks) and removes contact details. */
  moderate(text: string): ModerationResult;
  validateNickname(raw: string): NicknameCheck;
  nicknameKey(nickname: string): string;
}

export interface ModeratorOptions {
  extraBlockedPatterns?: readonly string[];
  extraAllowedTerms?: readonly string[];
  nickname?: NicknameRules;
}

/** Runs of single characters separated by spaces/dots: "f u c k", "s.t.u.p.i.d". */
const SPACED_RUN =
  /(?<![\p{L}\p{N}])(?:[\p{L}\p{N}@$!*](?:[\s._\-*]{1,2})){2,}[\p{L}\p{N}@$!*](?![\p{L}\p{N}])/gu;

const NICKNAME_ALLOWED = /^[\p{L}\p{M}\p{N} _.\-'\p{Extended_Pictographic}\u{FE0F}]+$/u;

/**
 * Obscenity's leetspeak step reads "!" as "i", so "stupid!" would become
 * "stupidi" and slip past whole-word patterns. A "!" that is not followed by a
 * letter is punctuation, not leetspeak ("sh!t" still resolves). Same length, so
 * match indices still point into the original text.
 */
function forMatching(text: string): string {
  return text.replace(/!(?!\p{L})/gu, ' ');
}

export function createModerator(options: ModeratorOptions = {}): Moderator {
  const dataset = buildDataset(options.extraBlockedPatterns);
  const built = dataset.build();
  const matcher = new RegExpMatcher({
    blacklistedTerms: built.blacklistedTerms,
    whitelistedTerms: [
      ...(built.whitelistedTerms ?? []),
      ...EXTRA_ALLOWED_TERMS,
      ...(options.extraAllowedTerms ?? []),
    ],
    ...englishRecommendedTransformers,
  });
  const nicknameRules = options.nickname ?? { minLength: 2, maxLength: 16 };

  const censorSpans = (text: string, spans: Array<[number, number]>): string => {
    if (spans.length === 0) return text;
    const chars = [...text];
    // Map UTF-16 indices to code-point positions.
    const cpIndexOf: number[] = [];
    let cp = 0;
    for (const ch of chars) {
      for (let k = 0; k < ch.length; k++) cpIndexOf.push(cp);
      cp++;
    }
    for (const [start, end] of spans) {
      const from = cpIndexOf[start] ?? 0;
      const to = cpIndexOf[end] ?? chars.length - 1;
      for (let i = from; i <= to; i++) {
        if (chars[i] !== undefined && !/\s/u.test(chars[i] as string)) chars[i] = '*';
      }
    }
    return chars.join('');
  };

  const profaneSpans = (text: string): Array<[number, number]> => {
    const spans: Array<[number, number]> = matcher
      .getAllMatches(forMatching(text))
      .map((m: MatchPayload) => [m.startIndex, m.endIndex]);
    for (const run of text.matchAll(SPACED_RUN)) {
      const joined = run[0].replace(/[\s._\-*]/gu, '');
      if (matcher.hasMatch(joined)) spans.push([run.index, run.index + run[0].length - 1]);
    }
    return spans;
  };

  const moderate = (input: string): ModerationResult => {
    const clean = stripInvisible(input.normalize('NFKC'));
    const flags: ModerationFlag[] = [];
    const spans = profaneSpans(clean);
    const censored = censorSpans(clean, spans);
    if (spans.length > 0) flags.push('PROFANITY');
    const contact = removeContactInfo(censored);
    if (contact.found) flags.push('CONTACT');
    return { display: contact.text, flags };
  };

  const validateNickname = (raw: string): NicknameCheck => {
    const nickname = stripInvisible(raw.normalize('NFKC')).replace(/\s+/gu, ' ').trim();
    const length = [...nickname].length;
    if (length < nicknameRules.minLength || length > nicknameRules.maxLength) {
      return { ok: false, reason: 'INVALID' };
    }
    if (!NICKNAME_ALLOWED.test(nickname) || !/[\p{L}\p{N}]/u.test(nickname)) {
      return { ok: false, reason: 'INVALID' };
    }
    // "Bot …" names are reserved so a human can never pass as a bot (or vice versa).
    if (/^bot\b/iu.test(normalizeText(nickname))) return { ok: false, reason: 'REJECTED' };
    const result = moderate(nickname);
    if (result.flags.length > 0) return { ok: false, reason: 'REJECTED' };
    const compact = nickname.replace(/[\s._\-']/gu, '');
    if (matcher.hasMatch(forMatching(compact))) return { ok: false, reason: 'REJECTED' };
    return { ok: true, nickname, key: nicknameKey(nickname) };
  };

  return { normalize: normalizeText, moderate, validateNickname, nicknameKey };
}
