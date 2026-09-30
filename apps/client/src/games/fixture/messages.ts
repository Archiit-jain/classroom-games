import type { MessageCatalog } from '@cg/game-sdk/client';

export const fixtureMessages = {
  name: 'Count Up (dev fixture)',
  description: 'Platform test game. Add 1–3 to the counter; reach the target to win.',
  counter: 'Counter',
  target: 'Target {target}',
  yourSecret: 'Your secret number',
  yourTurn: 'Your turn!',
  waitingFor: 'Waiting for {name}…',
  secondsLeft: '{seconds}s left',
  add: '+{amount}',
  lastMove: '{name} added {amount}',
  lastMoveAuto: '{name} ran out of time (+{amount})',
  winner: '{name} wins!',
  secrets: 'Secret numbers',
  settingTarget: 'Target number',
  settingTurn: 'Seconds per turn',
} satisfies MessageCatalog;
