# Business (working title) — Phase 8 design verification

**Status:** design pass, written **before** implementation (Phase 8). Internal game id:
`business`. **"Business" is a provisional working title** — the public name needs a
trademark / name-availability check before launch and nothing may suggest a link to any
existing product. Built on the existing `GameModule` / server-authoritative runtime and the
Phase 6 production architecture ([ADR-023](../decisions/ADR-023-multi-instance-cluster.md));
no new networking.

> **Decision status.**
>
> **Frozen (product owner; spec C12/C14 and the Phase 8 brief):** 2–6 players · a fixed number
> of rounds · the richest player wins · **no player-to-player trading** in v1 · **real Indian
> city names** with our own selection, prices, board, rules and art · **fictional currency
> only** (never real money, never the ₹ symbol) · an original Indian theme.
>
> **Baseline from the earlier design (kept):** a 28-space board · 15 cities in 5 regions ·
> 3 industries (Tea Garden, Textile Mill, Film Studio) · News and Mela cards · Start, Chai
> Break, Traffic Jam and Lucky Mela · development levels Stall → Shop → Showroom → Mall.
>
> **Everything else is a developer proposal** marked _(proposed)_; every number is a
> play-test value until the economy simulation (§10) and play-testing. **Clarifications of
> the baseline** are listed in §21. **Implementation blockers:** none. **Launch blocker:** the
> final public name.

---

## 0. Originality guardrails

Dice, a looping track and owning places are generic game mechanics; names, artwork, text and
distinctive presentation are protected. So:

- **We never use:** the Monopoly name or logo; its square 40-space board or any square ring
  with four equal sides; its corner set or corner names; Chance / Community Chest or their
  wording; railroads / utilities; houses / hotels; title-deed cards; mortgages; auctions;
  jail; "rent", "GO", "Free Parking", "bank error"-style card texts; its tokens, mascot,
  money designs or colours.
- **We never copy** the city line-up, prices or card texts of commercial Indian
  "Business"-style boards.
- **Ours:** a **tall "ring road" board** (6 × 10 tiles, §3) with uneven sides; our corners;
  regions; prices; **visitor fees**; Stall → Shop → Showroom → Mall; industries that pay a
  **dividend**; **News** and **Mela** cards with our own texts and effects; a
  **Lucky Mela wheel**; automatic **clearance sales** instead of mortgages; tokens (auto-
  rickshaw, scooter, bicycle, kite, cricket bat, chai cup) and art drawn for this project; a
  fictional currency, **Coins** (its own coin icon, written "120 coins").

## 1. Player journey

| #   | Step              | What happens                                                                                                                                                      |
| --- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Room              | Host creates a private room, picks Business, sets **rounds**; friends join by code; host may add bots (2–6 seats).                                                |
| 2   | Seating           | Seats in join order; each seat gets its token and colour.                                                                                                         |
| 3   | Start             | The usual 3-2-1 countdown. Board set up: everyone on **Start** with the starting coins; all cities and industries with the bank; decks shuffled (server).         |
| 4   | First player      | Drawn by the match's seeded RNG and announced ("Asha goes first"); play goes round in seat order.                                                                 |
| 5   | Turn              | The current player taps **Roll**. The server rolls two dice and moves the token; the board animates the hops.                                                     |
| 6   | Landing           | The space resolves: buy a free city/industry (decision), develop your own city (decision), pay a visitor fee, draw a card, spin the Lucky Mela wheel, or nothing. |
| 7   | Decision          | Buy / Develop / Skip with a countdown. Cash, price, fees and level are shown on a postcard of the space.                                                          |
| 8   | End of turn       | Automatically after the decision (or immediately when there is none) and after the animation hold. Next seat.                                                     |
| 9   | Round progression | A round = every player has had one turn. The round counter is always visible ("Round 7 of 12").                                                                   |
| 10  | Final settlement  | After the last round: every player's **wealth** = coins + the value of what they own (§8), revealed with a counting animation.                                    |
| 11  | Results           | The platform podium and results table (Wealth, Cities).                                                                                                           |

## 2. Turn system _(timers proposed)_

| Topic            | Rule                                                                                                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First player     | Seeded server RNG at setup.                                                                                                                                                                        |
| Order            | Seat order from the first player, wrapping round.                                                                                                                                                  |
| Movement         | **Two six-sided dice**, rolled on the server (seeded match RNG); move forward that many spaces. No extra roll for doubles.                                                                         |
| Roll timer       | **10 s**. On timeout the server rolls for the player (counts as an automatic action).                                                                                                              |
| Decision timer   | **15 s** after the move animation. Timeout = Skip (counts as an automatic action).                                                                                                                 |
| Animation hold   | The server waits for the move/card animation (≈ 160 ms per hop + 1.2 s card/landing, scaled) before the next turn or before starting the decision timer, so the board stays readable for everyone. |
| What ends a turn | The decision (or its timeout), or the end of the hold when there is no decision.                                                                                                                   |
| Disconnected     | The platform's 30 s reconnect grace; meanwhile the timers act for the player (auto-roll, skip). After the grace a bot takes the seat; the player can **reclaim immediately** ("I'm back").         |
| Idle             | 3 automatic actions in a row (while connected) → `MARK_IDLE` → bot takes over, reclaimable.                                                                                                        |
| Server authority | Dice, movement, landing effects, fees, card effects, liquidation, wealth and the winner are computed only by the engine. Clients send only `ROLL`, `BUY`, `DEVELOP`, `SKIP`.                       |

## 3. Board — 28 spaces, "ring road" geometry

The board is a **tall rectangle of 6 × 10 tiles** (corners shared): top and bottom edges
have 6 tiles, the long sides 10. Perimeter = 2·6 + 2·10 − 4 = **28**. It is played
**clockwise** from the top-left corner. Portrait phones show it upright (6 tiles across);
landscape screens show it turned 90° (10 across). The corners are therefore **not evenly
spaced** (5 and 9 steps apart) — unlike any square board.

| #   | Space                     | #   | Space                       |
| --- | ------------------------- | --- | --------------------------- |
| 0   | **Start** (corner)        | 14  | **Traffic Jam** (corner)    |
| 1   | Indore — Central          | 15  | Delhi — North               |
| 2   | News                      | 16  | **Textile Mill** (industry) |
| 3   | Bhopal — Central          | 17  | Mela                        |
| 4   | Nagpur — Central          | 18  | Kochi — South               |
| 5   | **Chai Break** (corner)   | 19  | **Lucky Mela** (corner)     |
| 6   | Bhubaneswar — East        | 20  | Chennai — South             |
| 7   | Mela                      | 21  | News                        |
| 8   | Guwahati — East           | 22  | Bengaluru — South           |
| 9   | **Tea Garden** (industry) | 23  | **Film Studio** (industry)  |
| 10  | Kolkata — East            | 24  | Jaipur — West               |
| 11  | News                      | 25  | Mela                        |
| 12  | Lucknow — North           | 26  | Ahmedabad — West            |
| 13  | Chandigarh — North        | 27  | Mumbai — West               |

Edges: top 0–5, right 5–14, bottom 14–19, left 19–27 → 0. Counts: 15 cities, 3 industries,
3 News, 3 Mela, 4 corners = 28.

## 4. Cities, regions and industries _(all values proposed, tuned by §10)_

Regions follow a loose journey around India: **Central → East → North → South → West**,
cheapest to dearest around the loop. Order and prices are gameplay tiers, not a ranking of
real cities.

| Region  | Cities (board order)             | Price           | Visitor fee at Stall / Shop / Showroom / Mall |
| ------- | -------------------------------- | --------------- | --------------------------------------------- |
| Central | Indore · Bhopal · Nagpur         | 100 · 110 · 120 | 10% · ×3 · ×6 · ×10 of price (§5)             |
| East    | Bhubaneswar · Guwahati · Kolkata | 140 · 150 · 170 |                                               |
| North   | Lucknow · Chandigarh · Delhi     | 190 · 200 · 230 |                                               |
| South   | Kochi · Chennai · Bengaluru      | 240 · 250 · 270 |                                               |
| West    | Jaipur · Ahmedabad · Mumbai      | 290 · 300 · 340 |                                               |

- **Region bonus:** owning all three cities of a region multiplies their visitor fees by
  **1.5** (rounded to 5).
- **Industries** (Tea Garden, Textile Mill, Film Studio): price **200**. They pay their owner
  a **dividend of 40 per industry** every time the owner passes or lands on Start, **+40**
  extra when they own all three. A visitor landing on someone's industry pays a **factory
  visit** of 25 per industry the owner has.
- **Balancing intent:** cheaper regions recover their price faster (fees are a fixed share
  of price) but earn less per visit; dearer regions dominate late. The simulation checks
  that no region is strictly best or worst (§10).

All amounts are whole coins; percentages round to the nearest 5.

## 5. Development

| Level        | How you get it                    | Cost (proposed)  | Visitor fee (× Stall fee) |
| ------------ | --------------------------------- | ---------------- | ------------------------- |
| **Stall**    | Buy the city                      | the city's price | ×1                        |
| **Shop**     | Develop when you land on it again | 50 % of price    | ×3                        |
| **Showroom** | Develop when you land on it again | 50 % of price    | ×6                        |
| **Mall**     | Develop when you land on it again | 50 % of price    | ×10                       |

- **One level per landing**, only on **your own city**, only if you can pay the cost.
  (A Mela card can also give a free level, §9.) No region requirement, no build-anywhere
  phase, no limits beyond Mall — deliberately simple.
- Not enough coins: the Develop button is disabled; you can only Skip.

## 6. No trading

No trades, deals, loans, player auctions or mortgages in v1. Money management needs none of
them: see §7.

## 7. Short of coins — clearance sales, never elimination

Players are **never eliminated** (the game always lasts the chosen rounds, and nobody sits out
in a classroom). The rule is one sentence: **if you must pay more than you have, the bank
automatically sells your assets at half value until you can pay; whatever still can't be
covered is written off.**

| Situation                                | What happens                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Land on a free city you can't afford     | You can't buy it (Buy disabled); it stays with the bank.                                                                                                                                                                                                                                                                                              |
| Can't afford a development               | Develop disabled.                                                                                                                                                                                                                                                                                                                                     |
| Owe a fee / card payment you can't cover | **Clearance sale** (automatic, deterministic): first sell development levels back at **50 % of their cost**, one level at a time from your most developed city (ties: cheapest city first); then sell whole cities/industries at **50 % of price**, cheapest first. Stops as soon as you can pay. Sold places return to the bank (free to buy again). |
| Still short with nothing left            | You pay **everything you have**; the rest is **written off** (the receiver gets less). You are **"Broke"**: 0 coins, nothing owned — you keep playing, collecting the Start salary, and can rebuild.                                                                                                                                                  |
| Reach exactly zero                       | Nothing special.                                                                                                                                                                                                                                                                                                                                      |

All of it is shown as one event ("Clearance sale: Ravi sold a Shop in Bhopal and Indore for
120 coins") — no menus, no accounting decisions.

## 8. Rounds, wealth and the winner _(round counts proposed)_

- Host setting: **8 / 12 / 16 rounds**, default **12** (to be confirmed by §10 for game
  length).
- Start: **1,500 coins** each _(proposed)_; **Start salary 150** when passing or landing on
  Start.
- After the final player's turn in the final round the match ends (no extra turns).
- **Wealth = coins + Σ price of owned cities and industries + Σ development cost spent on
  them.** Upgrades count at full cost (so developing never lowers your wealth score, only
  your cash). Computed by the engine; identical for every client.
- **Ranking:** highest wealth first; equal wealth shares a place (1, 1, 3). No secondary
  tie-break (deterministic and explainable).

## 9. Cards and the Lucky Mela wheel _(texts ours; values proposed)_

Two decks of **12 cards**, shuffled by the server at setup; drawn from the top; a drawn card
goes to its deck's discard pile; when a deck runs out its discards are reshuffled (seeded).
The deck order is the only hidden information in the game. Every effect is bounded: **no
single card moves more than 150 coins from or to any one player**.

**News** — business events (some affect everyone or a region):

| #   | Card                                               | Effect                                          |
| --- | -------------------------------------------------- | ----------------------------------------------- |
| N1  | Monsoon comes early and tea prices climb.          | Tea Garden owner +100 (if owned)                |
| N2  | Your little shop trends online overnight.          | You +80                                         |
| N3  | Fuel prices go up.                                 | You −40                                         |
| N4  | Power cuts across town: generators for every shop. | You −15 per development level you own (max 120) |
| N5  | Wedding season — malls are packed.                 | Every Mall owner +50 per Mall                   |
| N6  | Big export order for local industry.               | You +40 per industry you own (at least +40)     |
| N7  | Tech fair in the South.                            | South city owners +30 per South city            |
| N8  | Road works slow business in the West.              | West city owners −20 per West city              |
| N9  | Markets dip for a day.                             | Everyone −25                                    |
| N10 | You catch the express train.                       | Move forward 4 spaces (resolve the new space)   |
| N11 | A film shoots in your city — crowds everywhere.    | Film Studio owner +100 (if owned)               |
| N12 | Cotton harvest is excellent.                       | Textile Mill owner +100 (if owned)              |

**Mela** — fair and festival fun (mostly good, a few small treats to pay for):

| #   | Card                                            | Effect                                                                         |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------ |
| M1  | You win the ring-toss!                          | +50                                                                            |
| M2  | Giant-wheel ride — your treat for everyone.     | Pay 10 to each other player                                                    |
| M3  | Your sweets stall sells out.                    | +70                                                                            |
| M4  | You win the kite-flying contest.                | Collect 15 from each other player                                              |
| M5  | Lost in the crowd!                              | Move back 3 spaces (resolve the new space)                                     |
| M6  | Puppet-show tickets.                            | −30                                                                            |
| M7  | Lucky-draw winner: free makeover for your shop. | Your least-developed city (cheapest first) goes up a level free; no city → +60 |
| M8  | Folk-dance prize.                               | +60                                                                            |
| M9  | A balloon for every child in the queue.         | −20                                                                            |
| M10 | The magic show leaves everyone smiling.         | Everyone +30                                                                   |
| M11 | Food-court feast.                               | −40                                                                            |
| M12 | The mela train takes you home.                  | Move to Start (collect the salary)                                             |

**Mela spaces** draw a Mela card; **News spaces** draw a News card.

**Lucky Mela (corner):** spin the wheel — 6 equal slices: +50, +75, +100, +100, +150, or a
free level on your least-developed city (no city → +75). Always good.

**Other corners:** **Start** — salary (also when passing); **Chai Break** — a safe stop,
nothing happens; **Traffic Jam** — your **next roll uses one die** (stuck in slow traffic).

No content about religion, politics, caste, brands or real people; festivals are generic
fairs. Movement cards resolve the new space once (no chains beyond one card).

## 10. Economy simulation (before freezing prices)

Built with the engine: a seeded simulator plays **≥ 5,000 complete bot matches** (2–6
players, every round setting) through the same engine and bot, and reports: average and
spread of final wealth; Gini-style spread; city purchase and development frequencies per
city and region; clearance-sale and Broke frequency; game length (turns, estimated minutes);
**runaway leader** (leader at round ⌈rounds/3⌉ still wins by > 2× second place); share of
turns spent under 100 coins; card effects (wealth with vs without each card, by swapping it
for a no-op); regional return on investment. Values in §4–§9 are adjusted until:

- no region's return per coin invested is more than ~1.5× another's;
- runaway wins (as defined) in < 20 % of games; Broke in < 5 % of player-games;
- the leader at one third of the game wins well under 60 % of games (comebacks happen);
- a 4-player default game lasts ≈ 15–20 minutes at human pace.

The final numbers and the measured statistics are recorded in this document and the rules.

## 11. Bot ("Normal", one level)

- **Buy** when, after paying, it keeps a **reserve** (≈ 150 + 25 per opponent) — always for a
  city that completes a region; industries when the reserve allows; otherwise it buys when
  the price is at most ~45 % of its coins. Late in the game (last 2 rounds) it buys only
  if the purchase cannot lower its wealth (it never does — buying converts coins to equal
  wealth) **and** keeps the reserve.
- **Develop** when the reserve remains after paying; prefers cities in a complete region.
- **Mistakes** _(play-test)_: 10 % of buy decisions are flipped when the call is close
  (within 20 % of the threshold); never buys below zero (impossible anyway).
- **Pace:** thinks 0.8–2.0 s; rolls after 0.6–1.4 s.
- Uses the **same actions** (`ROLL`, `BUY`, `DEVELOP`, `SKIP`) through the same validation as
  humans; sees only the public view.

## 12. Phone UX (designed first)

- **Portrait:** the 6 × 10 board fills the width (≈ 54 px tiles at 360 px — not shrunk to
  unreadable). Each tile: region colour band, a bold short label (city names wrap to two
  lines at ≥ 9 px; icons for industries, News, Mela, corners), owner colour edge and level
  pips (1–4 dots). Tokens are small coloured discs with the token icon; several on one tile
  fan out.
- **The board's inside** (4 × 8 tiles of space) is the **stage**: dice, the current space as a
  big **postcard** (name, region, price, fees by level, owner, level), the card reveal, and
  the **action buttons** (Roll / Buy / Develop / Skip, 48 px) with the countdown — so the
  player's eyes never leave the board.
- **Tapping any tile** shows its postcard in the stage (tap again or after the next event to
  return to the current space).
- **Players strip** above the board: token, name, coins (rolling), current player ring.
  "Wealth" appears on the results; a small "Round 7/12" chip.
- **Landscape phone:** the board turns (10 across, 6 tall) and fills the height; the players
  strip moves to a column on the right.

## 13. Desktop UX

The board dominates (landscape orientation, ~70 % of the width); the right column holds the
players (coins, cities owned, wealth so far), a short **event log** ("Priya paid 45 to Ravi
in Kolkata") and the room chat. Color Burst Arcade: a warm paper-map board with the ring road,
regional colours and small hand-drawn landmarks drawn for this project (no photographs), a
festive Lucky Mela corner, chunky dice, tokens that hop tile by tile, a "SOLD" stamp on
purchases, buildings growing on upgrades (stall → shop → showroom → mall icons), cards that
flip out of the centre, coins streaming between players, and a final wealth count-up into
the podium. Not childish, not a finance dashboard: no charts, few numbers at once.

## 14. Animation modes

| Moment         | Full                                        | Lite       | Reduced                    |
| -------------- | ------------------------------------------- | ---------- | -------------------------- |
| Dice           | dice tumble and land                        | quick spin | the numbers                |
| Move           | token hops tile by tile                     | slides     | appears on the tile        |
| Buy            | "SOLD" stamp + coin flight                  | stamp      | owner edge + log line      |
| Fee / payment  | coin stream payer → receiver, counters roll | one coin   | counters change + log line |
| Develop        | building grows                              | icon swaps | pips change + log line     |
| Card           | card flips out of the deck                  | fade       | card shown                 |
| Clearance sale | places fade back to the bank                | fade       | log line                   |
| Final          | wealth bars race to the podium              | bars       | table                      |

Every state change also appears as text (event log, postcard, counters), so Reduced mode
loses nothing but movement.

## 15. Server authority and protocol

Actions (strict schemas, with the platform's action ids and versions):

| Action    | Payload                 | Rejected when                                                                                             |
| --------- | ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `ROLL`    | `{ type, turn }`        | not your turn (`NOT_YOUR_TURN`), not the roll phase / wrong turn number (`INVALID_PHASE`)                 |
| `BUY`     | `{ type, turn, space }` | not your turn; no buy decision; `space` ≠ where you stand; already owned; can't afford (`ILLEGAL_ACTION`) |
| `DEVELOP` | `{ type, turn, space }` | not your turn; not your city; already a Mall; can't afford; no develop decision                           |
| `SKIP`    | `{ type, turn }`        | not your turn; nothing to skip                                                                            |

The `turn` number (and `space`) make stale or replayed intents harmless. No payload carries a
dice value, an amount, a position or an owner — extra fields are rejected (`INVALID_PAYLOAD`).
Platform protections unchanged: duplicate action ids, versions never issued, wrong seat,
anything after the match ends.

## 16. Information flow

Positions, coins, ownership, levels, dice and card effects are **public**; the event log
records them. The only hidden data is the **deck order** (never in views or events until a
card is drawn — leak-checked). No client-side authoritative state.

## 17. Production architecture

An ordinary `GameModule` (`sync: 'TURN_PHASE'`): actions go gateway → host; the host owns
state and timers; snapshots (coins, ownership, levels, decks, RNG) go to Redis fenced by the
lease; failover restores everything and overdue timers fire once. The engine is pure and
provider-agnostic (no I/O), so moving to another host or Redis provider never touches it.
Traffic per turn: 1–2 small actions and one update per player — cheap on free tiers.

Tested (§18): players on two instances in one room; actions stay in sync; a host crash
mid-decision keeps coins and ownership exact (money-conservation invariant checked after
restore); reconnect restores the exact board.

## 18. Testing plan

- **Engine:** board construction (28 spaces, counts, geometry indices), movement and wrap,
  Start salary, turn order and first player, purchases, ownership, development (one level,
  costs, Mall cap), visitor fees (levels, region bonus), industries (dividend, visit fee),
  every card and the wheel, Traffic Jam, clearance sales and write-offs, final round end,
  wealth, ties, victory; **invariants**: coins never negative, ledger balanced (every
  transfer has a source and a destination; bank flows recorded), ownership consistent;
  view-leak check on deck order; seeded full matches.
- **Security/protocol:** wrong turn, wrong phase, stale turn numbers, buying owned / far-away
  spaces, developing others' or Mall cities, forged fields, duplicate ids, stale versions,
  post-game actions.
- **Bots:** buy and develop decisions, reserve kept, complete matches.
- **Economy:** the simulator (§10) as a test with guard thresholds plus a report script.
- **Production:** real sockets, multi-instance (two instances, one room), host crash
  mid-decision, reconnect.
- **E2E:** desktop, Pixel 7, 360 px phone, landscape phone, reduced motion; repeated runs.
- **Smoke:** a Business match on the production build (Redis in CI).

## 19. Production smoke test

Two or three browsers on the production build: create, join, start Business (fewest rounds),
several turns each, a purchase on one screen appears owned on the others, a development
appears on the others, a card effect changes coins everywhere, a reload restores the exact
board, the match ends with the results podium.

## 20. Documentation

Rules, catalogue, game system, bots, UI/UX, architecture, deployment, testing, README,
overview, credits, an ADR (economy & clearance-sale model, ring-road board), with the working
title marked provisional everywhere.

## 21. Clarifications of the baseline (not silent changes)

1. **Board spaces:** the earlier draft also had an "Electricity Bill" and a "Repair Bill"
   space. The baseline list has none, so they are **removed**; their role (occasional costs)
   lives in News cards (N3, N4). The six non-city, non-industry, non-corner spaces are
   **3 News + 3 Mela**.
2. **Mela vs Lucky Mela:** Mela **spaces** draw a Mela **card**; the **Lucky Mela** corner
   spins a wheel that is always good — two different things with one theme.
3. **Geometry:** the earlier draft's square ring (8 per side) is replaced by the 6 × 10
   "ring road", for originality and because it fits phones far better.
4. **Bankruptcy:** the earlier draft eliminated bankrupt players; replaced by automatic
   clearance sales and "Broke but still playing" (§7), so fixed-round games never leave
   anyone out and nobody manages debts.
5. **Traffic Jam:** "miss a turn" (jail-like) is replaced by "next roll uses one die".
6. **Industries:** dividend at Start + a small factory-visit fee (numbers proposed).
7. **Starting coins 1,500, salary 150, rounds 8/12/16 (default 12), timers 10 s / 15 s** —
   proposals, final values set by §10.

Open for the owner (non-blocking): the city list and region assignment; all numbers after
simulation; the token set; the provisional title.
