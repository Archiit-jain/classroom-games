import { toAll, type GameModule } from '@cg/game-sdk';
import { z } from 'zod';

/**
 * Test-only game where every seat acts at the same time: each round, every
 * seat picks once; the round ends when all have picked. Used to test action
 * versions and action ids in a simultaneous setting (like 16 Parchi).
 */
export interface PickState {
  seats: number[];
  round: number;
  rounds: number;
  picks: Record<number, number | null>;
  history: Array<Record<number, number | null>>;
}
export type PickAction = { type: 'PICK'; value: number };

const emptyPicks = (seats: number[]) =>
  Object.fromEntries(seats.map((s) => [s, null])) as Record<number, number | null>;

export const simultaneousGame: GameModule<
  PickState,
  PickAction,
  { round: number; myPick: number | null; picked: number[] },
  { type: 'PICKED'; seat: number } | { type: 'ROUND_DONE'; round: number },
  { rounds: number }
> = {
  manifest: {
    id: 'simultaneous',
    version: 1,
    players: { min: 2, max: 4 },
    sync: 'TURN_PHASE',
    bots: { supported: true, canTakeOverSeat: true },
    publicMatch: { enabled: false, targetPlayers: 4, minHumans: 2 },
    reclaim: 'IMMEDIATE',
    layout: { orientation: 'any' },
  },
  settingsSchema: z.strictObject({ rounds: z.number().int().min(1).max(10) }),
  defaultSettings: { rounds: 3 },
  actionSchema: z.strictObject({ type: z.literal('PICK'), value: z.number().int().min(1).max(9) }),
  setup: (seats, settings) => ({
    state: { seats, round: 1, rounds: settings.rounds, picks: emptyPicks(seats), history: [] },
    events: [],
  }),
  validateAction: (s, seat) => {
    if (s.round > s.rounds) return { ok: false, code: 'INVALID_PHASE' };
    if (s.picks[seat] !== null) return { ok: false, code: 'ILLEGAL_ACTION' };
    return { ok: true };
  },
  applyAction: (s, seat, a) => {
    const picks = { ...s.picks, [seat]: a.value };
    const done = s.seats.every((x) => picks[x] !== null);
    if (!done) return { state: { ...s, picks }, events: [toAll({ type: 'PICKED', seat })] };
    return {
      state: {
        ...s,
        round: s.round + 1,
        picks: emptyPicks(s.seats),
        history: [...s.history, picks],
      },
      events: [toAll({ type: 'PICKED', seat }), toAll({ type: 'ROUND_DONE', round: s.round })],
    };
  },
  onTimer: (s) => ({ state: s, events: [] }),
  onSeatChange: (s) => ({ state: s, events: [] }),
  getPlayerView: (s, seat) => ({
    round: s.round,
    myPick: s.picks[seat] ?? null,
    picked: s.seats.filter((x) => s.picks[x] !== null),
  }),
  isOver: (s) => s.round > s.rounds,
  getResults: (s) => ({ placements: s.seats.map((seat) => ({ seat, place: 1 })) }),
  bot: {
    createMemory: () => null,
    observe: (m) => m,
    decide: (view, _m, ctx) =>
      view.myPick === null
        ? { kind: 'ACTION', action: { type: 'PICK', value: ctx.rng.int(1, 9) }, thinkMs: 50 }
        : null,
  },
};
