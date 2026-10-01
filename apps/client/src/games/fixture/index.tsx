import type { GameClientModule } from '@cg/game-sdk/client';
import type {
  FixtureAction,
  FixtureEvent,
  FixtureSettings,
  FixtureView,
} from '@cg/game-sdk/fixture';
import { lazy } from 'react';
import { fixtureMessages } from './messages';

function FixtureIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="5"
        fill="var(--cb-violet)"
        stroke="var(--cb-outline)"
        strokeWidth="1.6"
      />
      <path d="M12 7.5v9M7.5 12h9" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

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
  accent: 'violet',
  Icon: FixtureIcon,
  Board: /* @__PURE__ */ lazy(() => import('./FixtureBoard')),
  Settings: /* @__PURE__ */ lazy(() => import('./FixtureSettings')),
};
