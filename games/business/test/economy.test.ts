import { describe, expect, it } from 'vitest';
import { simulateEconomy } from '../src/server';

/**
 * Guards the tuned economy (design §10) with a smaller simulation than the full
 * report (`pnpm --filter @cg/game-business sim`): a regression in prices, fees or
 * the bot shows up here.
 */
describe('economy (400 seeded bot matches, 16 rounds, 2–6 players)', () => {
  const r = simulateEconomy({ games: 400, seed: 11, rounds: [16] });

  it('keeps games open: the early leader often loses and runaway wins are rare', () => {
    expect(r.earlyLeaderWinRate).toBeLessThan(0.6);
    expect(r.runawayRate).toBeLessThan(0.2);
  });

  it('rarely leaves anyone with nothing, yet money pressure exists', () => {
    expect(r.brokeRate).toBeLessThan(0.05);
    expect(r.clearancePerGame).toBeGreaterThan(0);
    expect(r.meanSpread).toBeGreaterThan(0.15);
  });

  it('balances the regions (return per coin invested within 1.6×) and keeps industries in line', () => {
    const roi = Object.values(r.regionReturn);
    expect(Math.max(...roi) / Math.min(...roi)).toBeLessThan(1.6);
    expect(r.industryReturn).toBeLessThan(1.6 * Math.max(...roi));
  });

  it('develops cities and buys most places', () => {
    const levels = Object.values(r.meanLevel);
    expect(levels.reduce((a, b) => a + b, 0) / levels.length).toBeGreaterThan(1.6);
    const owned = Object.values(r.ownedAtEnd);
    expect(owned.reduce((a, b) => a + b, 0) / owned.length).toBeGreaterThan(0.6);
  });
});
