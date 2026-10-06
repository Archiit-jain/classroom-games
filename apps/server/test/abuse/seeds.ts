/**
 * Legal-shaped actions the bots never make, built from the live state so they reach
 * the engines' deeper checks (fuzzMatch `seedActions`). Found with a coverage check:
 * NPAT bots only stream drafts (no STOP/VOTE/DONE), and Business bots never take a
 * loan, repay, sell, start an auction, bid or wait in jail.
 */
interface NpatLike {
  round: number;
  letter: string | null;
}
interface BusinessLike {
  turn: number;
  owner: (number | null)[];
  players?: { cash: number }[];
}

const AMOUNTS = [0, 1, 4_999, 5_000, 20_000, 65_000, 10_000_000];

function npatSeeds(s: NpatLike): unknown[] {
  const l = (s.letter ?? 'A').toUpperCase();
  const answers = { name: `${l}sha`, place: `${l}gra`, animal: `${l}nt`, thing: `${l}xe` };
  const key = (w: string) => w.toLowerCase();
  return [
    { type: 'STOP', round: s.round, answers },
    { type: 'STOP', round: s.round, answers: {} },
    { type: 'STOP', round: s.round + 1, answers },
    { type: 'DONE', round: s.round },
    { type: 'DONE', round: s.round - 1 },
    { type: 'VOTE', round: s.round, group: `name:${key(answers.name)}`, out: true },
    { type: 'VOTE', round: s.round, group: `place:${key(answers.place)}`, out: false },
    { type: 'VOTE', round: s.round, group: 'animal:zzz', out: true },
  ];
}

function businessSeeds(s: BusinessLike): unknown[] {
  const turn = s.turn;
  const owned = s.owner.map((o, i) => (o === null ? -1 : i)).filter((i) => i >= 0);
  const free = s.owner.map((o, i) => (o === null ? i : -1)).filter((i) => i >= 0);
  const spaces = [...owned.slice(0, 3), ...free.slice(0, 2), 0, 9, 18, 27];
  const out: unknown[] = [
    { type: 'JAIL_WAIT', turn },
    { type: 'JAIL_PAY', turn },
  ];
  for (const amount of AMOUNTS) {
    out.push({ type: 'LOAN', turn, amount }, { type: 'REPAY', turn, amount });
    out.push({ type: 'BID', turn, amount });
  }
  for (const space of spaces) {
    out.push(
      { type: 'SELL_BUILDING', turn, space },
      { type: 'SELL_ASSET', turn, space },
      { type: 'AUCTION_START', turn, space },
      { type: 'BUILD', turn, space },
      { type: 'BUY', turn, space },
    );
  }
  // Trades offering things nobody owns, more cash than exists, or with oneself.
  for (const to of [0, 1, 5]) {
    out.push({
      type: 'TRADE_PROPOSE',
      turn,
      to,
      give: { cash: 10_000_000, assets: owned.slice(0, 2) },
      get: { cash: 0, assets: free.slice(0, 2) },
    });
  }
  out.push({ type: 'TRADE_ANSWER', turn, accept: true });
  return out;
}

export function seedsFor(gameId: string): ((state: never) => unknown[]) | undefined {
  if (gameId === 'name-place-animal-thing') return npatSeeds as (state: never) => unknown[];
  if (gameId === 'business') return businessSeeds as (state: never) => unknown[];
  return undefined;
}
