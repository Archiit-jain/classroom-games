import type { EffectsMode, GameClientModule } from '@cg/game-sdk/client';
import { durationFor } from '@cg/ui';
import { lazy } from 'react';
import type { NpatAction, NpatEvent, NpatSettings, NpatView } from '../shared';
import { NpatIcon } from './icons';
import { npatMessages } from './messages';

/** Short animations; writing must never wait for one. */
function eventDuration(event: NpatEvent, effects: EffectsMode): number {
  switch (event.type) {
    case 'STOPPED':
    case 'TIME_UP':
      return durationFor(effects, 800, 350);
    case 'REVEALED':
      return durationFor(effects, 700, 250);
    case 'ROUND_SCORED':
      return durationFor(effects, 1100, 400);
    default:
      return 0;
  }
}

export const npatClient: GameClientModule<NpatView, NpatAction, NpatEvent, NpatSettings> = {
  id: 'name-place-animal-thing',
  messages: npatMessages,
  accent: 'orange',
  Icon: NpatIcon,
  Board: lazy(() => import('./Board')),
  Settings: lazy(() => import('./Settings')),
  eventDuration,
  // Points decide the podium; unique answers are the extra stat.
  resultStats: [
    { key: 'score', labelKey: 'points' },
    { key: 'unique', labelKey: 'uniqueAnswers' },
  ],
  reactions: true,
  // The last round's score table stays on screen before the podium.
  revealMs: (effects) => (effects === 'reduced' ? 2500 : durationFor(effects, 4000, 3000)),
};
