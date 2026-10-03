import type { EffectsMode, GameClientModule } from '@cg/game-sdk/client';
import { durationFor } from '@cg/ui';
import { lazy } from 'react';
import type { BusinessAction, BusinessEvent, BusinessSettings, BusinessView } from '../shared';
import { HOP_MS } from './timing';
import { BusinessIcon } from './icons';
import { businessMessages } from './messages';

/** Token hops, card reveals and the SOLD stamp get their time; everything else is instant. */
function eventDuration(event: BusinessEvent, effects: EffectsMode): number {
  switch (event.type) {
    case 'ROLLED':
      return effects === 'reduced' ? 0 : event.path.length * HOP_MS[effects] + 250;
    case 'LOG':
      if (event.entry.type === 'CARD')
        return effects === 'reduced' ? 900 : durationFor(effects, 1600, 1000);
      if (event.entry.type === 'BOUGHT') return durationFor(effects, 500, 250);
      return 0;
    case 'MATCH_OVER':
      return durationFor(effects, 1200, 600);
    default:
      return 0;
  }
}

export const businessClient: GameClientModule<
  BusinessView,
  BusinessAction,
  BusinessEvent,
  BusinessSettings
> = {
  id: 'business',
  messages: businessMessages,
  accent: 'yellow',
  Icon: BusinessIcon,
  Board: lazy(() => import('./Board')),
  Settings: lazy(() => import('./Settings')),
  eventDuration,
  // Wealth decides the podium; cities owned is the extra stat.
  resultStats: [
    { key: 'wealth', labelKey: 'wealth' },
    { key: 'cities', labelKey: 'cities' },
  ],
  reactions: true,
  // The final board stays on screen for a moment before the podium.
  revealMs: (effects) => (effects === 'reduced' ? 2000 : durationFor(effects, 3000, 2200)),
};
