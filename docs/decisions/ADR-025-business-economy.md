# ADR-025: Business — ring-road board, clearance sales and a simulated economy

**Status:** Accepted (Phase 8). "Business" is a provisional working title.

## Context

Business is the largest game in the line-up: an original Indian business board game with a
fixed number of rounds where the richest player wins (frozen), no trading (frozen), real
Indian city names and fictional coins. It must not resemble Monopoly or commercial Indian
"Business" boards, must work on phones, and its economy must be fair without endless
mechanics. Prices chosen by eye were the main risk.

## Decision

- **Board:** a 28-space **6 × 10 "ring road"** with uneven sides (corners 5 and 9 steps
  apart), drawn upright on phones and turned a quarter clockwise on wide screens — original
  geometry that also gives ~54 px tiles on a 360 px phone. The inside of the ring is the
  **stage** (dice, postcard, cards, actions).
- **No elimination:** shortfalls trigger an automatic, deterministic **clearance sale** at
  half value (levels first, then the cheapest places); anything still unpaid is written off.
  No debt, no menus, no player leaves before the last round.
- **Development:** one level per landing on your own city **and** one city of your choice
  each time you pass Start. The second rule came from the simulation: landing-only
  development left cities at an average level of ~1.25.
- **Economy chosen by simulation:** a pure simulator plays thousands of bot matches through
  the real engine and bot (`simulate.ts`; report and sweep scripts; a 400-game guard test).
  Values were swept until regions return within 1.3× of each other, the early leader wins
  ~45 % of games, runaways stay under 5 % and fewer than 2 % of player-games end with nothing
  at the default 16 rounds.
- **Ledger:** every coin movement goes through one `pay` / `gain` pair that records the
  bank's net flow, so coins are provably conserved (tested after every transition and after a
  host failover).
- **Server authority:** clients send only `ROLL`, `BUY`, `DEVELOP`, `SKIP` with the turn number
  (and a space); dice, movement, fees, cards, sales and wealth are engine-only. The only hidden
  data is deck order.

## Consequences

- Same networking, Redis snapshots and failover as every other game; the engine is pure and
  portable to any host.
- Economy changes are cheap to evaluate (`pnpm --filter @cg/game-business sim`).
- Two-player games stay less interactive (the early leader wins ~60 %); 20 rounds helps.
- The public name and a trademark check remain launch tasks.
