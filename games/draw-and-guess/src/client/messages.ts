import { formatMessage, type MessageCatalog } from '@cg/game-sdk/client';

/** English text for Draw & Guess (working name — the public name is a launch blocker, spec C9). */
export const drawMessages = {
  name: 'Draw & Guess',
  description:
    'Take turns sketching a secret word while everyone else races to guess it in the chat.',
  players: '3–6 players',

  rounds: 'Rounds',
  roundsHint: 'Everyone draws once per round.',
  round: 'Round {round} of {rounds}',
  score: 'Points',

  yourTurn: 'Your turn to draw!',
  pickWord: 'Pick a word to draw',
  choosing: '{name} is choosing a word…',
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  chooseWord: 'Draw “{word}” ({difficulty})',

  draw: 'Draw:',
  youGotIt: 'You got it!',
  theWordWas: 'The word was',
  letters: '{n} letters',
  patternLabel: 'Secret word, {n} letters: {pattern}',
  blank: 'blank',
  space: 'space',

  drawingBy: '{name}’s drawing',
  drawingByWith: '{name}’s drawing, {n} strokes so far',
  yourCanvas: 'Your canvas — draw with a mouse, finger or pen',
  drawing: '{name} is drawing',
  nothingYet: 'Waiting for the first line…',

  colour0: 'Ink',
  colour1: 'White',
  colour2: 'Grey',
  colour3: 'Red',
  colour4: 'Orange',
  colour5: 'Yellow',
  colour6: 'Green',
  colour7: 'Cyan',
  colour8: 'Blue',
  colour9: 'Violet',
  colour10: 'Pink',
  colour11: 'Brown',
  size0: 'Thin brush',
  size1: 'Medium brush',
  size2: 'Thick brush',
  size3: 'Huge brush',
  colours: 'Colours',
  sizes: 'Brush size',
  eraser: 'Eraser',
  undo: 'Undo',
  clear: 'Clear',
  tools: 'Drawing tools',

  guessPlaceholder: 'Type your guess…',
  solvedPlaceholder: 'Chat with players who got it…',
  chatPlaceholder: 'Say something…',
  drawerNoChat: 'You’re drawing — no hints in the chat!',
  guess: 'Guess',
  sendChat: 'Send',
  recentGuesses: 'Recent guesses',
  solvedLane: 'Solved',
  correct: 'Correct!',
  correctPoints: 'Correct! +{points}',
  close: '“{guess}” is close!',
  guessedIt: '{name} guessed it!',
  youGuessedIt: 'You guessed it!',

  hideDrawing: 'Hide drawing',
  showDrawing: 'Show drawing',
  hiddenDrawing: 'You hid {name}’s drawings.',
  reportDrawing: 'Report drawing',
  reportConfirm: 'Report {name}’s drawing? It will be hidden for you.',

  points: '+{n}',
  nobodyGuessed: 'Nobody guessed it this time.',
  matchOver: 'Match over!',
  bot: 'Bot',
  drawerBadge: 'Drawing',
  guessedBadge: 'Guessed it',
} satisfies MessageCatalog;

export type DrawMessageKey = keyof typeof drawMessages;

export const f = (key: DrawMessageKey, params?: Record<string, string | number>) =>
  formatMessage(drawMessages[key], params);
