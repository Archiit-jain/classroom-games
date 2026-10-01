# Business (working title) — design verification

**Status:** design only (not implemented). Proposed phase: 8. Internal game id: `business`.
Built on the existing `GameModule` / server-authoritative runtime (`sync: 'TURN_PHASE'`); no
new networking.

> **Decision status.** **Binding** — product-owner brief (2026-10-01): 2–6 players; an
> original Indian-style property game that copies nothing from Monopoly; original board,
> places, currency, cards, pieces, icons and rules; fictional money only; "Business" is a
> working title; properties, purchases, upgrades, rent/income, events and turns are
> server-authoritative. Product-owner decisions (2026-10-01): see below. **Everything else** —
> the board layout and city list, every number (cash, prices, rents, salaries, fees),
> corners, industries, cards, development levels, timers, bankruptcy handling, bot behaviour,
> UI and animation — is a **developer proposal** awaiting owner sign-off and bot-simulation
> tuning, not a frozen decision. **Implementation blockers:** none. **Launch blocker:** the
> final public name (trademark / name-availability check).

**Working title.** "Business" is a working title. Several commercial Indian board games use
the same word, so the public name must pass a **trademark / name-availability check before
launch**, and nothing may suggest a link to any existing product.

**Product-owner decisions (2026-10-01):** **fixed number of rounds, richest player wins** ·
**no player-to-player trading in v1** · **real Indian city names** as the properties, with our
own city selection, grouping, prices, board layout, rules and artwork (this supersedes the
brief's "fictional locations" for the properties).

## 1. Originality guardrails

Game mechanics like dice, a looping track and owning places are generic and free to use;
what is protected is names, artwork, text and distinctive presentation. We therefore:

- **Never use:** the Monopoly name, its 40-space board, its corner set or their names (GO,
  Jail, Free Parking, Go To Jail), Chance / Community Chest, railroads / utilities, houses /
  hotels, mortgages, auctions, title-deed card design, the mascot, money designs or colours,
  or any card text.
- **Never copy** the city line-up, prices, card texts or artwork of commercial Indian
  "Business"-style boards.
- **Use our own:** 28-space board, corner ideas, region groups, prices, development levels
  (Stall → Shop → Showroom → Mall), industries, News/Mela cards, tokens and art, plus a
  fictional currency, **Coins**, with its own coin icon. The ₹ symbol and real notes are
  never used, and there is no real money anywhere (no purchases, no stakes).

## 2. Board (28 spaces) _(proposed)_

| #   | Space            | #   | Space             | #   | Space               | #   | Space              |
| --- | ---------------- | --- | ----------------- | --- | ------------------- | --- | ------------------ |
| 0   | **Start**        | 7   | **Chai Break**    | 14  | **Traffic Jam**     | 21  | **Lucky Mela**     |
| 1   | Indore           | 8   | Guwahati          | 15  | Delhi               | 22  | Jaipur             |
| 2   | News             | 9   | Tea Garden (ind.) | 16  | Textile Mill (ind.) | 23  | Film Studio (ind.) |
| 3   | Bhopal           | 10  | Kolkata           | 17  | Kochi               | 24  | Ahmedabad          |
| 4   | Nagpur           | 11  | News              | 18  | News                | 25  | News               |
| 5   | Electricity Bill | 12  | Amritsar          | 19  | Chennai             | 26  | Mumbai             |
| 6   | Bhubaneswar      | 13  | Chandigarh        | 20  | Bengaluru           | 27  | Repair Bill        |

- **Regions** (3 cities each, one colour each): Central (Indore 100, Bhopal 110, Nagpur 120) ·
  East (Bhubaneswar 150, Guwahati 160, Kolkata 180) · North (Amritsar 210, Chandigarh 220,
  Delhi 250) · South (Kochi 270, Chennai 290, Bengaluru 310) · West (Jaipur 330, Ahmedabad
  350, Mumbai 400). Order and prices are gameplay tiers, not a ranking of cities; the owner
  may edit the list.
- **Industries** (Tea Garden, Textile Mill, Film Studio): 200 each.

## 3. Proposed rules

| Topic         | Rule                                                                                                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Players       | 2–6. Public target 4, minHumans 2. Start: 1,800 Coins each; seat order from a seeded random first player.                                                                                                                       |
| Turn          | Roll two dice (server RNG) → move clockwise → resolve the space. No extra rolls for doubles.                                                                                                                                    |
| Start         | Passing or landing: **+150** salary.                                                                                                                                                                                            |
| Free city     | Buy it at its price, or skip (it stays with the bank — no auction).                                                                                                                                                             |
| Your city     | You may develop it **one level**: Stall → Shop → Showroom → Mall; each level costs 50 % of the city price.                                                                                                                      |
| Others' city  | Pay rent: 10 % of price × level multiplier (Stall ×1, Shop ×3, Showroom ×6, Mall ×10); **×1.5** if the owner holds the whole region.                                                                                            |
| Industry      | Owner gets a **dividend of 50** per industry each time they pass or land on Start. Anyone else landing there pays 40 × the number of industries the owner has.                                                                  |
| News          | Draw from a shuffled 16-card News deck (original texts: festival bonus, road repairs, collect from / pay each player, move to a space…).                                                                                        |
| Lucky Mela    | Draw a Mela card — always good (+50 to +150, a free development, or move to Start).                                                                                                                                             |
| Chai Break    | Nothing happens.                                                                                                                                                                                                                |
| Traffic Jam   | Miss your next turn.                                                                                                                                                                                                            |
| Bills         | Electricity Bill: pay 60. Repair Bill: pay 20 per development level you own (at least 40).                                                                                                                                      |
| Short of cash | **Raise money:** sell cities/industries back to the bank for 50 % of price + development spent. If you still can't pay, you are **bankrupt**: pay what you have, all your property returns to the bank, and you leave the game. |
| Trading       | None in v1 (owner decision).                                                                                                                                                                                                    |
| End           | After the set number of **rounds** (host setting 10 / **15** / 20), or when only one player is not bankrupt.                                                                                                                    |
| Winner        | Highest **net worth** = cash + price of owned property + development spent. Ties share a place. Bankrupt players rank below everyone else, earliest bankruptcy last.                                                            |

**Timers:** roll 10 s (auto-roll), buy / develop decision 15 s (default: don't), raise money
20 s (default: sell the lowest-value property first). **Idle:** 3 consecutive automatic
decisions → `MARK_IDLE` → bot. Bankrupt players stay in the room as spectators (chat and
reactions still work).

## 4. Turn flow (state machine) _(proposed)_

```text
TURN_START(seat) → [Traffic Jam? skip] → ROLL (10 s) → MOVING (hold ≈ 200 ms per step)
→ LANDED: BUY_DECISION | DEVELOP_DECISION (15 s) | auto rent / bill / dividend | CARD reveal (2 s)
→ [RAISE_MONEY (20 s) if a payment can't be covered] → TURN_END → next seat (round + 1 after the last seat)
→ … → GAME_END (round limit or one solvent player)
```

One engine timer per decision; every amount moves through a single pure ledger function so
money is conserved and testable.

## 5. Bot ("Normal") _(proposed)_

- **Buy** if, after paying, cash stays above a reserve (300) and the price is at most 40 % of
  its cash — or the city completes / extends a region it is collecting. Always buy an
  industry if the reserve allows.
- **Develop** on landing if cash ≥ cost + reserve, preferring cities in a complete region.
- **Raise money** by selling the property that loses the least rent, keeping complete
  regions as long as possible.
- Delays 0.8–2.5 s. Bots see only the public view; they never chat or react.

## 6. Hidden information

Almost everything is public (positions, cash, ownership). The only hidden thing is the order
of the shuffled card decks; views and events never include it (leak test: perturb deck order
→ views unchanged). Dice are rolled on the server.

## 7. Phone and desktop UI _(proposed)_

- **Board:** a square ring of 28 tiles (8 per side incl. corners — ≈ 41 px tiles on a 360 px
  phone). Tiles show the region colour band and a small icon; tapping a tile opens a
  postcard-style detail sheet (city name, price, rent by level, owner).
- **Centre of the board:** dice, the current space as a large postcard, news cards.
- **Bottom sheet:** the current decision (Buy / Skip with price and rent; Develop / Skip;
  Raise money list), big buttons, countdown ring.
- **Players strip:** token, name, cash (rolling number), net worth on desktop.
- Desktop: board left, players/log panel right. Tokens (original): auto-rickshaw, scooter,
  bicycle, kite, cricket bat, chai cup.

## 8. Animation (Color Burst Arcade) _(proposed)_

| Moment     | Full                                                     | Lite        | Reduced |
| ---------- | -------------------------------------------------------- | ----------- | ------- |
| Dice       | Two dice tumble and bounce on the table                  | flat spin   | instant |
| Move       | Token hops tile by tile with a squash                    | slide       | jump    |
| Buy        | "SOLD" stamp on the postcard; coins fly to the bank      | stamp only  | instant |
| Rent / pay | A coin stream from payer to receiver; cash counters roll | single coin | numbers |
| Develop    | The building grows (stall → shop → showroom → mall)      | swap        | instant |
| Cards      | News / Mela card flips and slides out                    | fade        | instant |
| Bankrupt   | Avatar greys out; property flies back to the bank        | fade        | instant |
| End        | Net-worth bars race up into the podium                   | bars        | podium  |

## 9. Content and licensing

City names are real geography (owner decision); illustrations are our own simple
silhouettes. Board, tokens, cards (texts written by us), coin and all art are original. No
religious, political or caste content in cards; no real brands. Fictional money only.
**Before launch:** trademark / name-availability check for the final public name.

## 10. Major technical risks

1. **Length and pacing:** 6 players × 15 rounds × ~10 s per turn ≈ 15–25 min; idle players
   handled by timers and bot takeover. Tune rounds via bot simulation.
2. **Phone board legibility** (41 px tiles): tap-to-inspect sheet, large centre postcard.
3. **Economy balance:** run thousands of seeded bot games to tune prices, salary and rents
   (target: few bankruptcies, a clear winner, no runaway leader by round 5).
4. **Multi-step turns and edge cases** (raise money, bankruptcy mid-card, payments to several
   players): one ledger function + money-conservation invariant + fuzzing.
5. **Animation pacing vs timers:** server holds include move/coin animation time (spec §15).

## 11. Testing

Engine: every space type, rent table, region bonus, development, dividends, cards, Traffic
Jam, raise money, bankruptcy, end conditions, net worth, ties. Invariants: money is
conserved (all Coins accounted for between players and bank), ownership consistent,
positions valid. Fuzz: 1,000+ seeded bot games with economy statistics. Real sockets:
decision timeouts, simultaneous buy race impossible (turn-based), reconnect mid-decision.
Playwright: desktop + phone match vs bots.

## 12. Decisions and open points

**Implementation blockers:** none. **Launch blocker:** the final public name (trademark /
name-availability check). **Proposed — awaiting owner sign-off (non-blocking):** the 28-space layout and city list;
starting cash 1,800, salary 150, prices, rent multipliers, development cost, region ×1.5,
industry dividend/fee, bills; rounds default 15; timers 10 / 15 / 20 s; idle after 3; no
auctions; sell-back at 50 %; bankrupt players spectate.
