import { toAll, type GameModule } from '@cg/game-sdk';
import { z } from 'zod';

/**
 * Test-only STREAMED game ("sketch"): one artist seat streams numbered chunks during
 * DRAW; everyone else receives them. Its chat hook exercises every decision kind.
 * Never registered outside tests.
 */
export interface SketchState {
  phase: 'DRAW' | 'OVER';
  seats: number[];
  artist: number;
  log: number[];
  /** Wrong guesses recorded through PASS-with-transition (public). */
  wrong: string[];
  solved: number[];
}

export type SketchChunk = { n: number };
export type SketchEvent = { type: 'GOT_IT'; seat: number };
export interface SketchView {
  phase: SketchState['phase'];
  artist: number;
  chunks: number;
  wrong: string[];
  solved: number[];
}

export function createSketchGame(
  options: { artist?: number; maxChunks?: number; botDelayMs?: number } = {},
): GameModule<SketchState, { type: 'END' }, SketchView, SketchEvent, Record<string, never>> {
  const maxChunks = options.maxChunks ?? 3;
  const botDelay = options.botDelayMs ?? 20;
  return {
    manifest: {
      id: 'sketch',
      version: 1,
      players: { min: 2, max: 3 },
      sync: 'STREAMED',
      bots: { supported: true, canTakeOverSeat: true },
      publicMatch: { enabled: false, targetPlayers: 3, minHumans: 2 },
      reclaim: 'IMMEDIATE',
      layout: { orientation: 'any' },
    },
    settingsSchema: z.strictObject({}) as unknown as z.ZodType<Record<string, never>>,
    defaultSettings: {},
    actionSchema: z.strictObject({ type: z.literal('END') }),
    setup: (seats) => ({
      state: {
        phase: 'DRAW',
        seats: [...seats],
        artist: options.artist ?? 0,
        log: [],
        wrong: [],
        solved: [],
      },
      events: [],
    }),
    validateAction: (s) =>
      s.phase === 'DRAW' ? { ok: true } : { ok: false, code: 'INVALID_PHASE' },
    applyAction: (s) => ({ state: { ...s, phase: 'OVER' }, events: [] }),
    onTimer: (s) => ({ state: s, events: [] }),
    onSeatChange: (s) => ({ state: s, events: [] }),
    getPlayerView: (s) => ({
      phase: s.phase,
      artist: s.artist,
      chunks: s.log.length,
      wrong: s.wrong,
      solved: s.solved,
    }),
    isOver: (s) => s.phase === 'OVER',
    getResults: (s) => ({ placements: s.seats.map((seat) => ({ seat, place: 1 })) }),
    stream: {
      chunkSchema: z.strictObject({ n: z.number().int().min(0).max(99) }),
      limits: {
        maxChunkBytes: 64,
        maxChunksPerSec: 20,
        maxPointsPerTurn: 99,
        maxStrokesPerTurn: 9,
      },
      accept(s, seat, raw) {
        const chunk = raw as SketchChunk;
        if (s.phase !== 'DRAW') return { ok: false, code: 'INVALID_PHASE' };
        if (seat !== s.artist) return { ok: false, code: 'NOT_YOUR_TURN' };
        if (s.log.length >= maxChunks) return { ok: false, code: 'ILLEGAL_ACTION' };
        return {
          state: { ...s, log: [...s.log, chunk.n] },
          relay: chunk,
          audience: { to: 'ALL_EXCEPT', seats: [s.artist] },
        };
      },
      replay: (s) => s.log.map((n) => ({ n })),
    },
    chat: {
      intercept(s, seat, normalized) {
        if (seat === s.artist) return { kind: 'BLOCK', code: 'CHAT_BLOCKED' };
        if (normalized === 'secret') {
          return {
            kind: 'CONSUME',
            transition: {
              state: { ...s, solved: [...s.solved, seat] },
              events: [toAll({ type: 'GOT_IT', seat })],
            },
          };
        }
        if (normalized.startsWith('shh')) {
          return {
            kind: 'RESTRICT',
            audience: { to: 'SEATS', seats: [s.artist] },
            channel: 'SOLVED',
          };
        }
        return {
          kind: 'PASS',
          transition: { state: { ...s, wrong: [...s.wrong, normalized] }, events: [] },
        };
      },
    },
    bot: {
      createMemory: () => null,
      observe: (memory) => memory,
      decide(view, _memory, ctx) {
        if (view.phase !== 'DRAW') return null;
        if (ctx.seat === view.artist) {
          if (view.chunks > 0) return null;
          return {
            kind: 'STREAM',
            thinkMs: botDelay,
            steps: [1, 2, 3].map((n) => ({ delayMs: botDelay, chunk: { n } })),
          };
        }
        if (view.wrong.includes('hello')) return null;
        return { kind: 'CHAT', text: 'hello', thinkMs: botDelay };
      },
    },
  };
}
