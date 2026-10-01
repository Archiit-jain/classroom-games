import type { MessageCatalog } from '@cg/game-sdk/client';

/** English text for 16 Parchi (item and category labels live in content/en). */
export const parchiMessages = {
  name: '16 Parchi',
  description:
    'Pass folded slips round the circle, collect four of a kind and hit CLAIM before anyone else.',
  players: '4 players',

  category: 'Category',
  random: 'Random',
  randomHint: 'A surprise category every game.',
  pass: 'Pass {n}',
  you: 'You',
  bot: 'Bot',

  dealing: 'Shuffling the slips…',
  pickToPass: 'Pick a slip to pass to {name}',
  swapHint: 'Tap another slip to swap',
  passingTo: 'Passing to {name}…',
  waitingOthers: 'Waiting for the others…',
  othersPassing: 'The others are still passing',
  passing: 'Pass!',
  claimMine: 'Full set! Claim it!',
  claimOthers: 'Someone has a full set!',
  claim: 'CLAIM!',
  claimLabel: 'Claim your full set',
  finished: '{name} finished {place}!',
  youFinished: 'You finished {place}!',
  watching: 'You’re out of the circle — cheer the others on.',
  matchOver: 'Match over!',
  cappedOver: 'Time’s up! Ranked by the biggest set.',
  autoPicked: 'Time’s up — {item} was passed for you.',

  place1: '1st',
  place2: '2nd',
  place3: '3rd',
  place4: '4th',

  slipPass: 'Pass {item}',
  slipChosen: '{item}, ready to pass',
  foldedSlip: 'Folded slip',
  yourSlips: 'Your slips',
  groupCount: '×{n}',
  setOf: '{name}’s set: {item}',
  finishedSeat: '{name}: {place}',
} satisfies MessageCatalog;

export type ParchiMessageKey = keyof typeof parchiMessages;
