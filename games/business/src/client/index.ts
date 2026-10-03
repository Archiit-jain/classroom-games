import type { EffectsMode, GameClientModule } from '@cg/game-sdk/client';
import { durationFor } from '@cg/ui';
import { lazy } from 'react';
import type { BusinessAction, BusinessEvent, BusinessSettings, BusinessView } from '../shared';
import { BusinessIcon } from './icons';
import { businessMessages } from './messages';
import { HOP_MS } from './timing';

/** Dice, token walks, card reveals, SOLD stamps, buildings and insolvency get their time. */
function eventDuration(event: BusinessEvent, effects: EffectsMode): number {
  switch (event.type) {
    case 'ROLLED':
      return effects === 'reduced'
        ? 300
        : durationFor(effects, 700, 300) + event.path.length * HOP_MS[effects];
    case 'LOG':
      switch (event.entry.type) {
        case 'EVENT':
          return effects === 'reduced' ? 1200 : durationFor(effects, 2200, 1300);
        case 'BOUGHT':
        case 'AUCTION_WON':
          return durationFor(effects, 700, 350);
        case 'BUILT':
          return durationFor(effects, 600, 300);
        case 'PAID':
          return event.entry.amount >= 1000 ? durationFor(effects, 600, 300) : 0;
        case 'INSOLVENT':
          return effects === 'reduced' ? 800 : durationFor(effects, 1400, 900);
        default:
          return 0;
      }
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
  // Final wealth decides the podium; its four parts are shown beside it (BUSINESS_REDESIGN.md §15).
  resultStats: [
    { key: 'wealth', labelKey: 'wealth' },
    { key: 'cash', labelKey: 'cash' },
    { key: 'property', labelKey: 'property' },
    { key: 'development', labelKey: 'development' },
    { key: 'transport', labelKey: 'transportSpend' },
  ],
  reactions: true,
  // The final count-up plays on the board before the podium.
  revealMs: (effects) => (effects === 'reduced' ? 2500 : durationFor(effects, 4200, 3000)),
};
