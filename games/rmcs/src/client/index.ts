import type { EffectsMode, GameClientModule } from '@cg/game-sdk/client';
import { durationFor } from '@cg/ui';
import { lazy } from 'react';
import type { RmcsAction, RmcsEvent, RmcsSettings, RmcsView } from '../shared/types';
import { CrownIcon } from './icons';
import { rmcsMessages } from './messages';

/**
 * How long the board animates each event. The server holds every phase for
 * longer (deal 2 s, reveals 2 s, result 4 s), so at normal speed the animation
 * director never has to skip anything.
 */
function eventDuration(event: RmcsEvent, effects: EffectsMode): number {
  switch (event.type) {
    case 'ROUND_STARTED':
      return durationFor(effects, 700, 300);
    case 'RAJA_REVEALED':
    case 'MANTRI_REVEALED':
      return durationFor(effects, 800, 350);
    case 'GUESS_MADE':
      return durationFor(effects, 700, 300);
    case 'ROUND_RESOLVED':
      return durationFor(effects, 1400, 600);
    default:
      return 0;
  }
}

export const rmcsClient: GameClientModule<RmcsView, RmcsAction, RmcsEvent, RmcsSettings> = {
  id: 'rmcs',
  messages: rmcsMessages,
  accent: 'yellow',
  Icon: CrownIcon,
  Board: lazy(() => import('./Board')),
  eventDuration,
  resultStats: [{ key: 'score', labelKey: 'score' }],
};
