import { describe, expect, it } from 'vitest';
import { createRng } from '../src/rng';

describe('createRng', () => {
  it('is deterministic for a given seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('differs between seeds', () => {
    expect(createRng(1).next()).not.toEqual(createRng(2).next());
  });

  it('int() stays within inclusive bounds and hits both ends', () => {
    const rng = createRng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = rng.int(1, 6);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('rejects invalid ranges', () => {
    expect(() => createRng(1).int(5, 1)).toThrow(RangeError);
    expect(() => createRng(1).int(0.5, 2)).toThrow(RangeError);
  });

  it('shuffle() returns a permutation without mutating the input', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const copy = [...input];
    const out = createRng(3).shuffle(input);
    expect(input).toEqual(copy);
    expect([...out].sort((x, y) => x - y)).toEqual(copy);
  });

  it('pick() throws on an empty list', () => {
    expect(() => createRng(1).pick([])).toThrow(RangeError);
  });
});
