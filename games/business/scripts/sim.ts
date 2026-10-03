/* eslint-disable no-console -- a report script */
// Economy report (BUSINESS_REDESIGN.md §20):
//   pnpm --filter @cg/game-business sim [games] ['{"rentShare":0.1,...}']
import { simulateEconomy } from '../src/server/simulate';

const games = Number(process.argv[2] ?? 5000);
const economy = process.argv[3] ? JSON.parse(process.argv[3]) : undefined;
const out: Record<string, unknown> = {};
const base = { seed: 42, ...(economy ? { economy } : {}) };
out.default15 = simulateEconomy({ games, ...base, rounds: [15] });
out.casual15 = simulateEconomy({ games, ...base, rounds: [15], casual: 0.5 });
for (const rounds of [10, 20, 25, 30]) {
  out[`rounds${rounds}`] = simulateEconomy({
    games: Math.round(games / 4),
    ...base,
    rounds: [rounds],
  });
}
for (const players of [2, 4, 6]) {
  out[`players${players}`] = simulateEconomy({
    games: Math.round(games / 3),
    ...base,
    players: [players],
    rounds: [15],
  });
}
out.noLockCasual15 = simulateEconomy({
  games: Math.round(games / 2),
  ...base,
  rounds: [15],
  casual: 0.5,
  economy: { ...economy, auctionLockRounds: 0 },
});
out.eventsOff15 = simulateEconomy({
  games: Math.round(games / 2),
  ...base,
  rounds: [15],
  eventsOff: true,
});
console.log(JSON.stringify(out, null, 1));
