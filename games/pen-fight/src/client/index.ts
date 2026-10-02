import type { EffectsMode, GameClientModule } from '@cg/game-sdk/client';
import { durationFor } from '@cg/ui';
import { lazy } from 'react';
import type { FightAction, FightEvent, FightSettings, FightView } from '../shared';
import { PenFightIcon } from './icons';
import { penMessages } from './messages';

/**
 * How long the board animates each event. A shot's replay is as long as the
 * server simulated it (the server holds the turn for that + 0.5 s) — in every
 * effects mode, because the moving pens are the game, not decoration.
 */
function eventDuration(event: FightEvent, effects: EffectsMode): number {
  switch (event.type) {
    case 'SHOT_PLAYED':
      return effects === 'reduced'
        ? event.durationMs
        : durationFor(effects, event.durationMs + 400, event.durationMs + 200);
    case 'DESK_SHRUNK':
      return durationFor(effects, 900, 500);
    case 'SUDDEN_DEATH_ARMED':
      return durationFor(effects, 900, 400);
    case 'MATCH_OVER':
      return durationFor(effects, 1200, 600);
    default:
      return 0;
  }
}

export const penFightClient: GameClientModule<FightView, FightAction, FightEvent, FightSettings> = {
  id: 'pen-fight',
  messages: penMessages,
  accent: 'lime',
  Icon: PenFightIcon,
  Board: lazy(() => import('./Board')),
  eventDuration,
  resultStats: [{ key: 'knockouts', labelKey: 'knockouts' }],
  reactions: true,
};
