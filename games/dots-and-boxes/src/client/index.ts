import type { EffectsMode, GameClientModule } from '@cg/game-sdk/client';
import { durationFor } from '@cg/ui';
import { lazy } from 'react';
import type { DotsAction, DotsEvent, DotsSettings, DotsView } from '../shared';
import { DotsIcon } from './icons';
import { dotsMessages } from './messages';

/** Short animations: a line draws in ~0.2 s, boxes fill in a quick sequence. */
function eventDuration(event: DotsEvent, effects: EffectsMode): number {
  switch (event.type) {
    case 'EDGE_DRAWN':
      return durationFor(effects, 220, 120);
    case 'BOXES_CLAIMED':
      return durationFor(effects, 320 + 90 * event.boxes.length, 180);
    case 'MATCH_OVER':
      return durationFor(effects, 1400, 700);
    default:
      return 0;
  }
}

export const dotsAndBoxesClient: GameClientModule<DotsView, DotsAction, DotsEvent, DotsSettings> = {
  id: 'dots-and-boxes',
  messages: dotsMessages,
  accent: 'violet',
  Icon: DotsIcon,
  Board: lazy(() => import('./Board')),
  Settings: lazy(() => import('./Settings')),
  eventDuration,
  resultStats: [{ key: 'boxes', labelKey: 'boxes' }],
  reactions: true,
  // The last line, the last box and the final-board reveal play before the podium.
  revealMs: (effects) => (effects === 'reduced' ? 1000 : durationFor(effects, 2600, 1600)),
};
