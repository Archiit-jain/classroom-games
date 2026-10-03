# ADR-026: Business redesign — square board, cumulative-spending wealth, deterministic events

**Status:** Accepted (Phase 8 redesign). Supersedes [ADR-025](ADR-025-business-economy.md).
"Business" is a provisional working title.

## Context

The first Business (ADR-025: a 28-space ring road, coins, clearance sales, no trading) was
rejected by the product owner as a product: dull board, too few properties, not enough Indian
identity, weak animations, unclear player identity and confusing transitions. The owner
approved a redesign ([design/BUSINESS_REDESIGN.md](../design/BUSINESS_REDESIGN.md), revision 2)
with frozen rules: a 36-space square board, ₹10,500 start, two dice with no doubles rule,
House 1–3 → Hotel on landing, 3+ cities of a group double rent, trading and multiple loans,
no immediate elimination, deterministic events by dice sum and an exact final-wealth formula.

## Decision

- **Board:** 36 spaces on a 10 × 10 grid (corners at 0/9/18/27; 22 cities 6/6/5/5; 6
  transports; Chance / Community Chest alternating one per side). Data in `shared/board.ts`.
- **Final wealth = cash + cumulative spending on properties + on houses/hotels + on
  transport** — running totals that never decrease (auction wins and trade cash count). It is
  not market value or net worth, by owner decision; the results show each part.
- **Events by dice sum:** each deck is a fixed table of 11 outcomes (sums 2–12); parity decides
  good/bad (Chance even = good, Community Chest odd = good). The event roll is a separate
  player action so everyone sees the sum before the card.
- **Money:** one ledger (`fromBank` / `toBank`) records the bank's net flow, so Σcash =
  start × players + bankNet is checked after every transition, in bot matches and after
  failover. Loans add a flat 10 % fee; the limit is ₹3,000 + 50 % of list value; no new loans
  in the final round; debt is repaid from cash at the end.
- **Insolvency:** on your own turn a Raise-money phase (loan, sell back at 50 %, auction, or
  "let the bank handle it"); otherwise the bank settles automatically (loans → buildings →
  cheapest assets); the rest is written off and the player is marked INSOLVENT but keeps
  playing.
- **Guardrails (provisional, measured):** bank sell-back only while raising money; one auction
  per turn; a 3-round lock after an asset changes hands. The cumulative-spending formula makes
  player-to-player sales raise both players' totals; the guardrails limit churn.
- **Multi-level building (simulation-driven deviation):** landing on your own city may build
  one **or more** levels at once. One level per landing produced almost no hotels in 5,000
  simulated matches; the rule order (House 1 → 2 → 3 → Hotel, only when landing) is unchanged.
- **Economy tuned by simulation:** `simulate.ts` drives the real engine and bot (plus a
  "casual" profile) through ≥ 5,000 matches per candidate; a 300-game guard test keeps the
  tuned values inside the targets (early leader ≤ 55 %, runaways < 15 %, insolvency < 10 %,
  every system used).
- **Presentation:** a 2.5D square tabletop (CSS perspective tilt, flat 3D context so every
  control stays clickable), tokens walking the server's path, 3D dice, flipping event cards,
  money-chip flights, building drops, SOLD stamps, a final count-up; phones get a camera that
  follows the play with "See whole board". Full / Lite / Reduced effects are respected.
- **No Business-specific networking:** the same GameModule contract, snapshots, reconnect and
  failover as every other game.

## Consequences

- Rules are fixed data plus a pure engine: easy to test exhaustively (all 22 events, every
  rent level, every money path) and to re-tune (`pnpm --filter @cg/game-business sim`).
- Long matches (25–30 rounds) become more decisive and produce more insolvency; 15 rounds is
  the default.
- Two-player games stay less interactive than 4–6 players.
- Naming review (Business, Chance, Community Chest, corner and transport names) remains a
  launch task.
