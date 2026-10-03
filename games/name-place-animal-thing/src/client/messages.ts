import { formatMessage, type MessageCatalog } from '@cg/game-sdk/client';

/** English text for Name Place Animal Thing. */
export const npatMessages = {
  name: 'Name Place Animal Thing',
  description:
    'One letter, four categories, everyone writes at once. Fill the sheet and shout STOP — unique answers score most.',
  players: '2–8 players',

  points: 'Points',
  uniqueAnswers: 'Unique answers',
  rounds: 'Rounds',
  roundsN: '{n} rounds',
  settingsHint: 'Name, Place, Animal and Thing — 90 seconds a round.',

  'cat.name': 'Name',
  'cat.place': 'Place',
  'cat.animal': 'Animal',
  'cat.thing': 'Thing',

  round: 'Round {round} of {rounds}',
  getReady: 'Get ready…',
  letterIs: 'Your letter is {letter}',
  letterLabel: 'Letter {letter}',
  startsWith: 'Starts with {letter}…',
  looksGood: 'Looks good',
  stop: 'STOP!',
  stopHintLocked: 'STOP opens in a moment',
  stopHintFill: 'Fill all four to call STOP',
  stopHintReady: 'Sheet full — call STOP!',
  stoppedBy: '{name} called STOP!',
  youStopped: 'You called STOP!',
  timeUp: 'Time’s up!',
  pencilsDown: 'Pencils down',
  saved: 'Saved',
  saving: 'Saving…',
  botWriting: 'A bot is filling in your sheet.',
  privateNote: 'Nobody sees your answers until the sheet is locked.',

  review: 'Check the answers',
  reviewHint: 'Tap ✗ on answers you think are wrong. A majority of the players decides.',
  reviewReadOnly: 'Here are everyone’s answers.',
  noVoting: 'Voting needs 3 or more players, so the automatic check decides.',
  done: 'Done',
  doneWaiting: 'Waiting for {n}…',
  youAreDone: 'Done — waiting for the others',
  voteOut: 'Vote out “{answer}”',
  undoVote: 'Take back your vote on “{answer}”',
  votes: '{votes} of {needed} ✗',
  yours: 'Yours',
  blank: '—',
  inList: 'In our list',
  notInList: 'Not in our list',
  shared: 'Same as {n} other(s)',
  'reason.LETTER': 'Wrong letter',
  'reason.SHORT': 'Too short',
  'reason.CHARACTERS': 'Letters only',
  'reason.NOT_ALLOWED': 'Not allowed',
  votedOut: 'Voted out',

  results: 'Round {round} scores',
  player: 'Player',
  roundCol: 'Round',
  total: 'Total',
  roundPoints: '+{n}',
  unique: 'Unique',
  same: 'Shared',
  zero: 'No points',
  wins: '{name} wins!',
  bot: 'Bot',
  you: 'You',
} satisfies MessageCatalog;

export type NpatMessageKey = keyof typeof npatMessages;

export const f = (key: NpatMessageKey, params?: Record<string, string | number>) =>
  formatMessage(npatMessages[key], params);
