import { formatMessage, type MessageCatalog } from '@cg/game-sdk/client';

/** English text for Pen Fight. */
export const penMessages = {
  name: 'Pen Fight',
  description: 'Flick your pen to knock the others off the desk. Last pen standing wins.',
  players: '2–4 players',

  knockouts: 'Knockouts',
  round: 'Round {n}',
  yourFlick: 'Your flick!',
  howTo: 'Touch your pen, drag back and let go.',
  howToKeys: 'Keys: ←/→ aim · ↑/↓ strength · A/D spin · Enter flick',
  aiming: '{name} is aiming…',
  flicked: '{name} flicked!',
  skipped: '{name} ran out of time.',
  out: 'OUT!',
  outNames: '{names} — out!',
  suddenDeath: 'Sudden death!',
  shrinkSoon: 'The desk shrinks next round.',
  shrinking: 'Desk shrinking!',
  winner: 'WINNER!',
  wins: '{name} wins!',
  draw: 'It’s a tie!',

  desk: 'The desk: {pens}',
  penAt: '{name}',
  penOut: '{name} (out)',
  aimControl: 'Aim your pen',
  aimState: 'Aim {angle}°, strength {power}%, spin {spin}',
  spinLeft: 'left',
  spinRight: 'right',
  spinNone: 'none',
  spin: 'Spin',
  spinHint: 'Where you touch the pen sets the spin — or slide here.',
  spinStrip: 'Spin point',
  cancelHint: 'Drag back to your pen to cancel.',
  you: 'You',
  bot: 'Bot',
  place: '{place}',
  place1: '1st',
  place2: '2nd',
  place3: '3rd',
  place4: '4th',
  order: 'Turn order',
  shotBy: '{name} flicked — {result}',
  nobodyOut: 'everyone stayed on.',
} satisfies MessageCatalog;

export type PenMessageKey = keyof typeof penMessages;

export const f = (key: PenMessageKey, params?: Record<string, string | number>) =>
  formatMessage(penMessages[key], params);

export const placeLabel = (place: number) =>
  f(`place${Math.min(4, Math.max(1, place))}` as PenMessageKey);
