import { rmcsClient } from '@cg/game-rmcs/client';
import type { AnyGameClientModule } from '@cg/game-sdk/client';
import { sixteenParchiClient } from '@cg/game-sixteen-parchi/client';
import { fixtureClient } from './fixture';

/**
 * Client-side game modules by id, in menu order. A game is offered in the UI
 * only when the server also lists it in `session:ready.games`. The fixture
 * game is a development tool and is only bundled in dev builds.
 */
export const gameClients: ReadonlyMap<string, AnyGameClientModule> = new Map<
  string,
  AnyGameClientModule
>([
  [rmcsClient.id, rmcsClient],
  [sixteenParchiClient.id, sixteenParchiClient],
  ...(import.meta.env.DEV ? [[fixtureClient.id, fixtureClient] as const] : []),
]);

export function gameName(gameId: string): string {
  return gameClients.get(gameId)?.messages.name ?? gameId;
}
