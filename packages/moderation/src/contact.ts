/**
 * Detection of contact details (links, emails, phone numbers, social handles).
 * Anything found is replaced with a fixed marker; the rest of the text stays.
 */

export const REMOVED_MARKER = '[removed]';

const TLDS =
  'com|net|org|in|io|gg|co|me|xyz|app|dev|info|biz|tv|ly|be|to|link|site|online|store|live|chat|club|us|uk|ai|fun|games';

interface Detector {
  re: RegExp;
  /** Returns the replacement for a match, or null to keep the match unchanged. */
  replace?: (match: string, groups: Record<string, string | undefined>) => string | null;
}

const PLATFORMS =
  'instagram|insta|snapchat|snap|whatsapp|telegram|discord|facebook|tiktok|twitter|youtube';

const DETECTORS: Detector[] = [
  // Explicit links.
  { re: /\b(?:https?:\/\/|www\.)\S+/giu },
  // Email addresses (before handles, which would otherwise eat "@domain").
  { re: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.[a-z]{2,}\b/giu },
  // "example dot com" style obfuscation.
  { re: new RegExp(String.raw`\b[a-z0-9-]+\s*[([]?\s*dot\s*[)\]]?\s*(?:${TLDS})\b`, 'giu') },
  // Bare domains: example.com, abc.in/xyz
  {
    re: new RegExp(
      String.raw`\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:${TLDS})\b(?:\/\S*)?`,
      'giu',
    ),
  },
  // Phone numbers: 9+ digits in any script (0–9, Devanagari ०–९, Bengali, Arabic-Indic…),
  // optionally separated by single spaces/dashes/dots/brackets.
  { re: /(?<![\p{L}\p{N}])\+?\p{Nd}(?:[\s\-.()]?\p{Nd}){8,}(?![\p{L}\p{N}])/gu },
  // "insta: rahul_07", "add me on snap id xyz", "whatsapp pe 98…" (numbers caught above).
  {
    re: new RegExp(
      String.raw`\b(?<platform>${PLATFORMS})\b(?<sep>[\s:@=\-]*(?:(?:id|handle|username|user|account|acc)\b[\s:@=\-]*)?(?:(?:is|its|it's|pe|par|on)\b[\s:@=\-]*)?)(?<handle>[\p{L}\p{N}_.]{3,30})`,
      'giu',
    ),
    replace: (_match, g) => {
      const sep = g.sep ?? '';
      const handle = g.handle ?? '';
      const explicit = /[:@]|\b(?:id|handle|username|user|account|acc)\b/iu.test(sep);
      const handleLike = /[\d_.]/u.test(handle);
      if (!explicit && !handleLike) return null;
      return `${g.platform}${sep}${REMOVED_MARKER}`;
    },
  },
  // @handles.
  { re: /(?<![\p{L}\p{N}_])@[\p{L}\p{N}_.]{3,30}/gu },
];

export interface ContactScan {
  text: string;
  found: boolean;
}

export function removeContactInfo(input: string): ContactScan {
  let text = input;
  let found = false;
  for (const detector of DETECTORS) {
    text = text.replace(detector.re, (...args: unknown[]) => {
      const match = args[0] as string;
      const last = args[args.length - 1];
      const groups = (typeof last === 'object' && last !== null ? last : {}) as Record<
        string,
        string | undefined
      >;
      if (match === REMOVED_MARKER) return match;
      const replacement = detector.replace ? detector.replace(match, groups) : REMOVED_MARKER;
      if (replacement === null) return match;
      found = true;
      return replacement;
    });
  }
  return { text, found };
}
