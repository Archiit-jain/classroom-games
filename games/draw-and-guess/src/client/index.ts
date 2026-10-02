import type { EffectsMode, GameClientModule } from '@cg/game-sdk/client';
import { durationFor } from '@cg/ui';
import { lazy } from 'react';
import type { DrawAction, DrawEvent, DrawSettings, DrawView } from '../shared';
import { DrawIcon } from './icons';
import { drawMessages } from './messages';

/**
 * How long the board animates each event. Kept short: the drawing and the timer
 * run in real time, and strokes never wait for the animation director.
 */
function eventDuration(event: DrawEvent, effects: EffectsMode): number {
  switch (event.type) {
    case 'WORD_OPTIONS':
      return durationFor(effects, 600, 250);
    case 'HINT':
      return durationFor(effects, 400, 200);
    case 'GUESSED':
      return durationFor(effects, 300, 150);
    case 'YOU_GUESSED':
      return durationFor(effects, 700, 300);
    case 'REVEAL':
      return durationFor(effects, 1200, 600);
    case 'MATCH_OVER':
      return durationFor(effects, 800, 400);
    default:
      return 0;
  }
}

export const drawAndGuessClient: GameClientModule<DrawView, DrawAction, DrawEvent, DrawSettings> = {
  id: 'draw-and-guess',
  messages: drawMessages,
  accent: 'cyan',
  Icon: DrawIcon,
  Board: lazy(() => import('./Board')),
  Settings: lazy(() => import('./Settings')),
  eventDuration,
  resultStats: [{ key: 'score', labelKey: 'score' }],
  reactions: true,
};
