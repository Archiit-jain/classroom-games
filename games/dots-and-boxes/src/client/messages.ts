import { formatMessage, type MessageCatalog } from '@cg/game-sdk/client';

/** English text for Dots & Boxes. */
export const dotsMessages = {
  name: 'Dots & Boxes',
  description:
    'Take turns joining two dots. Close a box to claim it and go again — most boxes wins.',
  players: '2–4 players',

  boxes: 'Boxes',
  grid: 'Grid',
  gridSize: '{n} × {n} boxes',
  gridHint: 'Bigger grids make longer games.',

  yourMove: 'Your move',
  move: '{name}’s move',
  again: 'Again!',
  double: 'Double!',
  chain: 'Chain ×{n}!',
  youStart: 'You start!',
  starts: '{name} starts',
  howTo: 'Touch near a line, slide to adjust, lift to draw.',
  howToMouse: 'Click a gap between two dots.',
  stillThere: 'Still there? It’s your move.',
  claimed: '{claimed} of {total} boxes claimed',
  wins: '{name} wins!',
  tie: 'It’s a tie!',
  boxCount: '{n} boxes',

  paper: 'The board: {claimed} of {total} boxes claimed',
  cursor: '{side} side of the box in row {row}, column {col}',
  top: 'Top',
  bottom: 'Bottom',
  left: 'Left',
  right: 'Right',
  bot: 'Bot',
  you: 'You',
} satisfies MessageCatalog;

export type DotsMessageKey = keyof typeof dotsMessages;

export const f = (key: DotsMessageKey, params?: Record<string, string | number>) =>
  formatMessage(dotsMessages[key], params);
