/* eslint-disable no-console -- a report script */
// Economy report (design §10):
//   pnpm --filter @cg/game-business sim [games]
import { simulateEconomy } from '../src/server/simulate';

const games = Number(process.argv[2] ?? 5000);
const out: Record<string, unknown> = {};
for (const rounds of [12, 16, 20] as const) {
  out[`rounds${rounds}`] = simulateEconomy({ games, seed: 42, rounds: [rounds] });
}
for (const players of [2, 4, 6]) {
  out[`players${players}`] = simulateEconomy({
    games: Math.round(games / 3),
    seed: 9,
    players: [players],
  });
}
out.rounds16NoCards = simulateEconomy({ games, seed: 42, noCards: true });
console.log(JSON.stringify(out, null, 1));
