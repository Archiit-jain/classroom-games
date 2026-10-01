import type { EffectsMode, GameClientModule } from '@cg/game-sdk/client';
import { durationFor } from '@cg/ui';
import { lazy } from 'react';
import type { ParchiAction, ParchiEvent, ParchiSettings, ParchiView } from '../shared/types';
import { ParchiIcon } from './icons/game';
import { parchiMessages } from './messages';

/**
 * How long the board animates each event. Server holds (deal 2 s, pass 1.2 s,
 * claim hold 1.5 s) are longer, so at normal speed nothing has to be skipped.
 */
function eventDuration(event: ParchiEvent, effects: EffectsMode): number {
  switch (event.type) {
    case 'DEALT':
      return durationFor(effects, 1300, 560);
    case 'MY_SELECTION':
      return event.auto ? 0 : durationFor(effects, 340, 180);
    case 'PASS_RESOLVED':
      return durationFor(effects, 800, 480);
    case 'CHIT_RECEIVED':
      return durationFor(effects, 300, 160);
    case 'CLAIM_WINDOW_OPENED':
      return durationFor(effects, 380, 200);
    case 'CLAIM_ACCEPTED':
      return event.reason === 'CLAIM'
        ? durationFor(effects, 1200, 600)
        : event.reason === 'CAP'
          ? durationFor(effects, 350, 200)
          : durationFor(effects, 700, 350);
    case 'MATCH_OVER':
      return durationFor(effects, 800, 400);
    default:
      return 0;
  }
}

export const sixteenParchiClient: GameClientModule<
  ParchiView,
  ParchiAction,
  ParchiEvent,
  ParchiSettings
> = {
  id: 'sixteen-parchi',
  messages: parchiMessages,
  accent: 'pink',
  Icon: ParchiIcon,
  Board: lazy(() => import('./Board')),
  Settings: lazy(() => import('./Settings')),
  eventDuration,
  reactions: true,
  // Spec §11: podium confetti in full effects only.
  liteConfetti: false,
};
