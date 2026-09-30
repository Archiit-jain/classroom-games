import { randomInt } from 'node:crypto';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@cg/protocol';
import type { Room } from './types';

export function generateRoomCode(isTaken: (code: string) => boolean): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_ALPHABET[randomInt(0, ROOM_CODE_ALPHABET.length)];
    }
    if (!isTaken(code)) return code;
  }
  throw new Error('Could not generate a unique room code');
}

/** Obviously-bot names. Human nicknames may not start with "Bot", so these never collide. */
export const BOT_NAMES = [
  'Bot Tiku',
  'Bot Chintu',
  'Bot Golu',
  'Bot Pinky',
  'Bot Bablu',
  'Bot Guddu',
  'Bot Munni',
  'Bot Sonu',
  'Bot Pappu',
  'Bot Dolly',
];

/** A bot name not currently used in the room (members or takeover bots). */
export function nextBotName(room: Room): string {
  const used = new Set<string>();
  for (const m of room.members) if (m.kind === 'BOT') used.add(m.name);
  for (const s of room.match?.seats ?? []) if (s.takeover) used.add(s.takeover.botName);
  const free = BOT_NAMES.find((n) => !used.has(n));
  if (free) return free;
  let n = BOT_NAMES.length + 1;
  while (used.has(`Bot ${n}`)) n++;
  return `Bot ${n}`;
}
