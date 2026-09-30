import type { GameClientModule } from '@cg/game-sdk/client';
import type {
  FixtureAction,
  FixtureEvent,
  FixtureSettings,
  FixtureView,
} from '@cg/game-sdk/fixture';
import { lazy } from 'react';
import { fixtureMessages } from './messages';

// The PURE annotations let production builds drop this module entirely: the
// registry only references it in development.
export const fixtureClient: GameClientModule<
  FixtureView,
  FixtureAction,
  FixtureEvent,
  FixtureSettings
> = {
  id: 'fixture',
  messages: fixtureMessages,
  Board: /* @__PURE__ */ lazy(() => import('./FixtureBoard')),
  Settings: /* @__PURE__ */ lazy(() => import('./FixtureSettings')),
};
