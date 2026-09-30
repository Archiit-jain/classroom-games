import { createHash, randomBytes, randomInt } from 'node:crypto';

/** Short, unguessable identifier with a readable prefix (p_ player, r_ room, m_ match, b_ bot). */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString('base64url')}`;
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function randomSeed(): number {
  return randomInt(0, 2 ** 32 - 1);
}
