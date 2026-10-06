import { createRng } from '@cg/game-sdk';
import { simulateMatch } from '@cg/game-sdk/testing';
import { describe, expect, it } from 'vitest';
import { defaultGames } from '../../src/app';
import { loadConfig } from '../../src/config';
import { seedsFor } from './seeds';

/**
 * Phase 10 §10: server authority. Whatever a client sends, it can only *ask* for a
 * move — never state an outcome. Every legal action the bots make in a real match,
 * with a forged outcome field added (dice, cash, ownership, score, the hidden word…),
 * must be refused by the game's strict action schema.
 */
const FORGED_FIELDS: Record<string, unknown> = {
  dice: [6, 6],
  roll: 12,
  cash: 1_000_000,
  money: 1_000_000,
  amount: 99_999,
  owner: 0,
  ownership: { 1: 0 },
  rent: 0,
  price: 1,
  level: 4,
  building: 'HOTEL',
  debt: 0,
  wealth: 1e9,
  spent: 1e9,
  score: 999,
  points: 999,
  winner: 0,
  place: 1,
  seat: 1,
  turn: 0,
  role: 'RAJA',
  word: 'kite',
  answer: 'x',
  correct: true,
  votes: 99,
  box: 'b:0:0',
  claimed: true,
  power: 50,
  physics: { friction: 0 },
  version: 1,
  state: {},
};

const games = defaultGames(loadConfig({}, { enableFixtureGame: false }));

describe('clients cannot state outcomes', () => {
  for (const game of games) {
    it(`${game.manifest.id}: every legal action with a forged outcome field is refused`, () => {
      const legal: Record<string, unknown>[] = [];
      simulateMatch(game, {
        seats: game.manifest.players.max,
        seed: 31,
        streams: true,
        probe: (_state, { action }) => {
          if (legal.length < 300) legal.push(action as Record<string, unknown>);
        },
        // Moves bots never make (NPAT votes, Business loans, bids…), as legal shapes.
        probeStream: (state) => {
          if (legal.length < 300) {
            for (const seed of seedsFor(game.manifest.id)?.(state as never) ?? []) {
              legal.push(seed as Record<string, unknown>);
            }
          }
        },
      });
      for (const seed of seedsFor(game.manifest.id)?.(
        game.setup([0, 1], game.defaultSettings, { now: 0, rng: createRng(1) }, { bots: [0, 1] })
          .state as never,
      ) ?? []) {
        legal.push(seed as Record<string, unknown>);
      }
      expect(legal.length).toBeGreaterThan(0);
      let checked = 0;
      for (const action of legal) {
        for (const [field, value] of Object.entries(FORGED_FIELDS)) {
          if (field in action) continue; // a real input of this action (e.g. Pen Fight's power)
          const forged = { ...action, [field]: value };
          expect(
            game.actionSchema.safeParse(forged).success,
            `${game.manifest.id} accepted ${JSON.stringify(forged)}`,
          ).toBe(false);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(legal.length);
    });
  }
});

describe('declared stream limits fit the largest legal chunk', () => {
  // The runtime refuses chunks over a game's maxChunkBytes, so the largest chunk a real
  // player can produce must fit (Hindi answers are 3 bytes per letter).
  const devanagari = String.fromCodePoint(0x0915).repeat(30);
  const largest: Record<string, unknown> = {
    'draw-and-guess': {
      op: 'stroke',
      id: 65_535,
      tool: 'eraser',
      colour: 11,
      size: 3,
      points: Array.from({ length: 128 }, () => 4095),
    },
    'name-place-animal-thing': {
      round: 1000,
      seq: 1_000_000,
      answers: { name: devanagari, place: devanagari, animal: devanagari, thing: devanagari },
    },
  };
  for (const game of games.filter((g) => g.stream)) {
    it(game.manifest.id, () => {
      const stream = game.stream as NonNullable<typeof game.stream>;
      const chunk = largest[game.manifest.id];
      expect(chunk, 'add the largest legal chunk for this game').toBeDefined();
      expect(stream.chunkSchema.safeParse(chunk).success).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(chunk))).toBeLessThanOrEqual(
        stream.limits.maxChunkBytes,
      );
    });
  }
});
