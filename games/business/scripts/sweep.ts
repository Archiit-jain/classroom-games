/* eslint-disable no-console -- a report script */
// Parameter sweep for the economy (design §10). Prints one line per candidate.
import { simulateEconomy } from '../src/server/simulate';

const candidates: Record<string, object>[] = JSON.parse(process.argv[2] ?? '[{}]');
const games = Number(process.argv[3] ?? 600);
const rounds = Number(process.argv[4] ?? 16) as 12 | 16 | 20;
for (const economy of candidates) {
  const r = simulateEconomy({ games, seed: 7, rounds: [rounds], economy });
  const roi = Object.values(r.regionReturn);
  console.log(
    JSON.stringify(economy),
    `spread=${r.meanSpread} margin=${r.meanWinMargin} early=${r.earlyLeaderWinRate} runaway=${r.runawayRate}`,
    `broke=${r.brokeRate} clear/g=${r.clearancePerGame} low=${r.lowCashTurnRate} roi=[${roi.join(',')}] ind=${r.industryReturn}`,
    `lvl=${(Object.values(r.meanLevel).reduce((a, b) => a + b, 0) / 15).toFixed(2)} owned=${(Object.values(r.ownedAtEnd).reduce((a, b) => a + b, 0) / 18).toFixed(2)} wealth=${r.meanWealth} turns=${r.meanTurns}`,
  );
}
