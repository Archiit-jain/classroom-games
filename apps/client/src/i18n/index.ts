import { formatMessage } from '@cg/game-sdk/client';
import type { MessageCatalog } from '@cg/game-sdk/client';
import type { ErrorCode } from '@cg/protocol';
import { en, type ClientErrorCode, type MessageKey } from './en';

export type { MessageKey } from './en';
type Params = Record<string, string | number>;

/** Replaces {name} placeholders. Unknown placeholders are left visible so they get noticed. */
export const format = formatMessage;

/** Text from a game's own catalog (falls back to the key, so gaps are visible). */
export function gameText(messages: MessageCatalog, key: string, params?: Params): string {
  return format(messages[key] ?? key, params);
}

function lookup(key: string): string | undefined {
  let node: unknown = en;
  for (const part of key.split('.')) {
    if (node && typeof node === 'object' && part in node)
      node = (node as Record<string, unknown>)[part];
    else return undefined;
  }
  return typeof node === 'string' ? node : undefined;
}

/** Translate a UI string. v1 ships English only; the catalog shape is ready for more locales. */
export function t(key: MessageKey, params?: Params): string {
  return format(lookup(key) ?? key, params);
}

export function errorMessage(code: ErrorCode | ClientErrorCode, retryAfterMs?: number): string {
  return format(en.errors[code] ?? en.errors.INTERNAL_ERROR, {
    seconds: Math.max(1, Math.ceil((retryAfterMs ?? 0) / 1000)),
  });
}
