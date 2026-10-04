import { describe, expect, it } from 'vitest';
import { simulateEconomy } from '../src/server';

/**
 * Guards the tuned economy (BUSINESS_REDESIGN.md §20) with a small simulation; the full
 * report is `pnpm --filter @cg/game-business sim`. Luck-heavy targets, not optimisation.
 */
describe('economy (300 seeded matches, 15 rounds, 2–6 players, half casual)', () => {
  const r = simulateEconomy({ games: 300, seed: 11, rounds: [15], casual: 0.5 });

  it('keeps games open: the early leader often loses, runaways are rare', () => {
    expect(r.earlyLeaderWinRate).toBeLessThanOrEqual(0.55);
    expect(r.runawayRate).toBeLessThan(0.15);
  });

  it('has money pressure without wrecking players', () => {
    expect(r.insolventRate).toBeLessThan(0.1);
    expect(r.meanSpread).toBeGreaterThan(0.15);
  });

  it('uses every system: buying, transport, building (incl. hotels), loans, trades, auctions', () => {
    expect(r.ownedAtEnd).toBeGreaterThan(0.5);
    expect(r.transportOwnedAtEnd).toBeGreaterThan(0.5);
    expect(r.housesPerGame + r.hotelsPerGame).toBeGreaterThan(1.5);
    expect(r.hotelsPerGame).toBeGreaterThan(0.3);
    expect(r.loansPerGame).toBeGreaterThan(0);
    expect(r.tradesPerGame).toBeGreaterThan(0);
    expect(r.auctionsPerGame).toBeGreaterThan(0);
    for (const g of ['A', 'B', 'C', 'D'] as const) expect(r.groupOwned[g]).toBeGreaterThan(0.4);
  });

  it('every price tier is bought — premium cities and Airways are reachable with ₹65,000', () => {
    for (const t of ['cheap', 'lowMid', 'mid', 'high', 'premium'] as const) {
      expect(r.tierBought[t], t).toBeGreaterThan(0.5);
    }
    expect(r.transportOwned.airways).toBeGreaterThan(0.4);
  });
});
