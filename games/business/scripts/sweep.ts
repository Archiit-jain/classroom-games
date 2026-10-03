/* eslint-disable no-console -- a report script */
// Parameter sweep: one line per candidate economy.
import { simulateEconomy } from '../src/server/simulate';

const candidates: Record<string, unknown>[] = JSON.parse(process.argv[2] ?? '[{}]');
const games = Number(process.argv[3] ?? 600);
for (const economy of candidates) {
  const r = simulateEconomy({ games, seed: 7, rounds: [15], economy, casual: 0.5 });
  console.log(
    JSON.stringify(economy),
    `spread=${r.meanSpread} early=${r.earlyLeaderWinRate} runaway=${r.runawayRate} insolvent=${r.insolventRate}`,
    `loans=${r.loansPerGame} debt=${r.meanDebtBeforeSettle} trades=${r.tradesPerGame} auctions=${r.auctionsPerGame} sold=${r.auctionSoldRate} transfer=${r.transferShare}`,
    `owned=${r.ownedAtEnd} transport=${r.transportOwnedAtEnd} houses=${r.housesPerGame} hotels=${r.hotelsPerGame} jailPay=${r.jailPayRate}`,
    `groups=${JSON.stringify(r.groupOwned)} lv=${JSON.stringify(r.groupLevel)} wealth=${r.meanWealth} turns=${r.meanTurns} min=${r.estimatedMinutes}`,
  );
}
