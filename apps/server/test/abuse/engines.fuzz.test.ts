import { fuzzMatch } from '@cg/game-sdk/testing';
import { describe, expect, it } from 'vitest';
import { defaultGames } from '../../src/app';
import { loadConfig } from '../../src/config';
import { seedsFor } from './seeds';

/**
 * Phase 10 §9–10: every product game, attacked at every step of real bot matches
 * (see packages/game-sdk/src/testing/fuzz.ts). An engine exception would abort the
 * match for everyone, so "never throws" is the security property here; legality is
 * covered by each game's own tests.
 */
const games = defaultGames(loadConfig({}, { enableFixtureGame: false }));

describe('engine fuzzing', () => {
  for (const game of games) {
    const { min, max } = game.manifest.players;
    for (const seats of [...new Set([min, max])]) {
      it(`${game.manifest.id} with ${seats} seats never throws on hostile actions`, () => {
        let attempts = 0;
        for (const seed of [11, 4242, 77, 9001]) {
          const report = fuzzMatch(game, {
            seats,
            seed,
            streams: true,
            maxSteps: 20_000,
            mutationsPerStep: 20,
            replaysPerStep: 10,
            ...(seedsFor(game.manifest.id) ? { seedActions: seedsFor(game.manifest.id) } : {}),
            // Some seats count as humans so human-only rules (NPAT voting) are reachable.
            humans: [0, 1, 2].filter((i) => i < seats),
          });
          attempts += report.attempts;
          // Most hostile attempts must be refused (accepted ones are legal moves in disguise).
          expect(report.rejectedBySchema + report.rejectedByEngine).toBeGreaterThan(
            report.accepted,
          );
        }
        expect(attempts).toBeGreaterThan(300);
      }, 120_000);
    }
  }
});
