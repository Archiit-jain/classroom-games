import { createRng } from '@cg/game-sdk';
import { createModerator } from '@cg/moderation';
import { describe, expect, it } from 'vitest';
import { WORD_PACK } from '../content/en';
import { TEMPLATES, planDrawing } from '../src/server';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  MAX_POINTS_PER_CHUNK,
  letterPositions,
  normalizeGuess,
  type Op,
} from '../src/shared';

describe('word pack (en)', () => {
  const moderator = createModerator();

  it('has at least 300 unique words of 3+ letters with difficulty tags', () => {
    expect(WORD_PACK.length).toBeGreaterThanOrEqual(300);
    const all = WORD_PACK.flatMap((e) => [e.word, ...e.aliases]).map(normalizeGuess);
    expect(new Set(all).size).toBe(all.length);
    for (const e of WORD_PACK) {
      expect(letterPositions(e.word).length, e.word).toBeGreaterThanOrEqual(3);
      expect(['easy', 'medium', 'hard']).toContain(e.difficulty);
    }
    for (const d of ['easy', 'medium', 'hard']) {
      expect(WORD_PACK.filter((e) => e.difficulty === d).length).toBeGreaterThanOrEqual(50);
    }
  });

  it('only contains words and aliases that pass the chat moderator', () => {
    for (const text of WORD_PACK.flatMap((e) => [e.word, ...e.aliases])) {
      expect(moderator.moderate(text), text).toMatchObject({ display: text, flags: [] });
    }
  });
});

describe('bot drawing templates', () => {
  const words = new Set(WORD_PACK.map((e) => e.word));

  it('has 30–40 templates, each for a word in the pack, inside the canvas', () => {
    const keys = Object.keys(TEMPLATES);
    expect(keys.length).toBeGreaterThanOrEqual(30);
    expect(keys.length).toBeLessThanOrEqual(40);
    for (const word of keys) {
      expect(words.has(word), word).toBe(true);
      for (const stroke of TEMPLATES[word] ?? []) {
        expect(stroke.colour).toBeGreaterThanOrEqual(0);
        expect(stroke.colour).toBeLessThanOrEqual(11);
        expect(stroke.size).toBeGreaterThanOrEqual(0);
        expect(stroke.size).toBeLessThanOrEqual(3);
        for (const [x, y] of stroke.points) {
          expect(
            x >= 0 && x < CANVAS_WIDTH && y >= 0 && y < CANVAS_HEIGHT,
            `${word} ${x},${y}`,
          ).toBe(true);
        }
      }
    }
  });

  it('plans valid chunks spread over the requested time', () => {
    for (const [word, template] of Object.entries(TEMPLATES)) {
      const steps = planDrawing(template, createRng(word.length), 30_000);
      const total = steps.reduce((t, s) => t + s.delayMs, 0);
      expect(total, word).toBeGreaterThan(25_000);
      expect(total, word).toBeLessThan(45_000);
      for (const { chunk } of steps) {
        const op = chunk as Extract<Op, { op: 'stroke' }>;
        expect(op.points.length).toBeLessThanOrEqual(MAX_POINTS_PER_CHUNK * 2);
        expect(op.points.length % 2).toBe(0);
        op.points.forEach((v, i) => expect(v).toBeLessThan(i % 2 ? CANVAS_HEIGHT : CANVAS_WIDTH));
      }
    }
  });
});
