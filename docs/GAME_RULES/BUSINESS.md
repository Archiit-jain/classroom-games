# Business (working title) — rules as implemented

> **"Business" is a provisional working title.** The public name, and the names Chance,
> Community Chest and the corner/transport names, need a naming/legal review before launch.
> All money is **pretend** fictional Rupees (₹) — nothing is ever real money.

Code: `games/business` (board, economy and event tables `src/shared/board.ts`, engine and bot
`src/server/engine.ts`, simulation `src/server/simulate.ts`, board `src/client/Board.tsx`).
Approved design: [design/BUSINESS_REDESIGN.md](../design/BUSINESS_REDESIGN.md) (revision 2).
Rules marked _frozen_ come from the product owner; every **number** is a play-test value tuned
by the economy simulation (§ "Economy" below) until a human play-test.

## Players, rounds and the turn _(frozen)_

- **2–6 players**, humans and/or bots (0–4 bots added by the host).
- **Rounds:** the host types any number from **5 to 40** (default 15). A round is one turn
  each; the game ends after the last turn of the last round. About 11 minutes for 4 players
  at 15 rounds (simulated at human pace).
- Everyone starts on **START** with **₹10,500**. First player drawn at random; then seat order.
- **Two dice, sum 2–12, no doubles rule.** **30 s** per decision (ring timer). Timeouts take the
  safe choice: roll for you · don't buy · don't build · Jail → lose next roll · decline a trade
  · let the bank handle a debt. Three automatic actions in a row hand the seat to the
  platform's idle bot ("I'm back" takes it back).

## The board — India Classic, 36 spaces _(structure frozen)_

A square board, played clockwise. Corners at 0 / 9 / 18 / 27; one event space per side,
alternating Chance → Community Chest.

| #   | Space                  | #   | Space                           | #   | Space                  | #   | Space                   |
| --- | ---------------------- | --- | ------------------------------- | --- | ---------------------- | --- | ----------------------- |
| 0   | **START**              | 9   | **JAIL**                        | 18  | **CLUB**               | 27  | **RESORT**              |
| 1   | Patna · C · ₹600       | 10  | Kochi · B · ₹1,000              | 19  | Goa · D · ₹1,600       | 28  | Jammu · A · ₹2,000      |
| 2   | Ranchi · C · ₹600      | 11  | Thiruvananthapuram · B · ₹1,000 | 20  | Surat · D · ₹1,600     | 29  | Dehradun · A · ₹2,000   |
| 3   | Railways · ₹1,500      | 12  | Visakhapatnam · B · ₹1,100      | 21  | Airways · ₹1,500       | 30  | Lucknow · A · ₹2,100    |
| 4   | Bhubaneswar · C · ₹700 | 13  | Community Chest                 | 22  | Pune · D · ₹1,800      | 31  | Community Chest         |
| 5   | Chance                 | 14  | Chennai · B · ₹1,300            | 23  | Chance                 | 32  | Jaipur · A · ₹2,200     |
| 6   | Guwahati · C · ₹700    | 15  | Waterways · ₹1,500              | 24  | Ahmedabad · D · ₹1,900 | 33  | Satellite · ₹1,500      |
| 7   | Roadways · ₹1,500      | 16  | Hyderabad · B · ₹1,400          | 25  | Petroleum · ₹1,500     | 34  | Chandigarh · A · ₹2,300 |
| 8   | Kolkata · C · ₹900     | 17  | Bengaluru · B · ₹1,500          | 26  | Mumbai · D · ₹2,400    | 35  | Delhi · A · ₹2,800      |

**22 cities in four groups** — A North (6), B South (6), C East (5), D West (5) — **6
transports** and **4 event spaces**. Prices are gameplay tiers, not a ranking of real cities.

### Corners _(frozen)_

- **START:** collect **₹1,500** every time you pass or land.
- **JAIL:** pay **₹500** (and roll normally next turn) **or** lose your next roll.
- **CLUB:** collect **₹200** from every other player.
- **RESORT:** pay **₹200** to every other player.

## Cities, rent and development _(rules frozen)_

- **Land on a free city or transport:** buy it at its price, or don't (it stays unowned).
- **Land on your own city:** build — **House 1 → House 2 → House 3 → Hotel**. You may build
  **one or more levels at once** on that landing, paying each level's cost.
  _(Simulation-driven: with one level per landing hotels never appeared — see the design
  document's implementation results.)_ House = 40 % of the city price; hotel = 80 %.
- **Land on someone else's city:** pay rent. Base rent = 40 % of the price, × **1 / 3 / 6 / 10
  / 15** for empty / 1 / 2 / 3 houses / hotel. **Owning 3 or more cities of a group doubles
  that group's rent** (2 owned: ×1; 3–6 owned: ×2).
- **Transport rent** by how many transports the owner has: **₹300 / 700 / 1,200 / 1,800 /
  2,500 / 3,200** for 1–6. Transports can't be built on.

Example — Delhi (₹2,800): rent ₹1,120 empty, ₹3,360 / ₹6,720 / ₹11,200 with houses, ₹16,800
with the hotel; double those with 3+ North cities. Houses ₹1,120 each, hotel ₹2,240.

## Events — deterministic by dice sum _(mechanic frozen; amounts tuned)_

Landing on Chance or Community Chest: **you roll two dice for the event**; everyone sees the
sum, then the card for that sum flips over. **Chance: even sum = good, odd = bad. Community
Chest: odd = good, even = bad.** Each sum has exactly one outcome per deck — no shuffled cards.

| Sum | Chance                                                       | Community Chest                      |
| --- | ------------------------------------------------------------ | ------------------------------------ |
| 2   | Good: collect ₹1,500                                         | Bad: pay ₹1,500                      |
| 3   | Bad: pay ₹1,000                                              | Good: collect ₹1,000                 |
| 4   | Good: collect ₹200 from every player                         | Bad: pay ₹200 to every player        |
| 5   | Bad: pay ₹300 to every player                                | Good: collect ₹150 from every player |
| 6   | Good: collect ₹500                                           | Bad: pay ₹400                        |
| 7   | Bad: pay ₹200                                                | Good: collect ₹300                   |
| 8   | Good: a free building on your least-developed city (or ₹600) | Bad: you can't buy on your next turn |
| 9   | Bad: lose your next roll                                     | Good: your next rent is waived       |
| 10  | Good: go to START and collect ₹1,500                         | Bad: lose your next roll             |
| 11  | Bad: repairs ₹100 per house, ₹250 per hotel (max ₹1,500)     | Good: a free building (or ₹600)      |
| 12  | Good: collect ₹1,000                                         | Bad: pay ₹800                        |

## Optional actions on your turn (before you roll)

- **Loans:** borrow in steps of ₹1,000; each step adds **₹1,100** to your debt (10 % fee).
  Limit: debt ≤ ₹3,000 + 50 % of the list value of what you own. Several loans are allowed;
  repay any amount at any time on your turn. **No new loans in the final round.** At the end
  of the match, debt is repaid from cash first.
- **Auction** one of your cities or transports (with its buildings): opening bid 50 % of its
  value (rounded to ₹100), bids in ₹100 steps, 15 s, +5 s after a late bid (30 s at most).
  You can't bid on your own auction. No bids: you keep it. **At most one auction per turn.**
- **Trade** with one player: cash and/or assets each way; the other player confirms (20 s).
  One trade offer per turn.
- An asset that changed hands by auction or trade **can't be auctioned or traded again for 3
  rounds** (provisional guardrail).

## Can't pay? — Raise money and insolvency _(players are never eliminated)_

If you owe more than you have on your turn, the **Raise money** panel opens: take a loan, sell
buildings or whole assets **back to the bank at 50 %** (only possible here — provisional
guardrail), auction an asset, or **Let the bank handle it**. Debts that happen on other
players' turns (Club, events) are settled by the bank automatically.

The bank's order: borrow up to the limit (not in the final round) → sell buildings (most
developed first) → sell assets (cheapest first). Anything still unpaid is **written off**: you
pay everything you have, your loans are cleared, and you are marked **INSOLVENT** (₹0 badge on
your card and token). You **keep playing**: you roll, collect at START and can buy again.

## Final wealth _(frozen formula)_

**Final wealth = cash currently held + cumulative money spent on properties + cumulative money
spent on houses/hotels + cumulative money spent on transport.**

- Running totals from the first turn; they never go down (selling or insolvency doesn't reduce
  them). Auction wins and the cash part of trades count toward the buyer's totals. Free
  buildings from events cost nothing and add nothing.
- At the end the board counts up each part for every player, then the total; the results show
  **Final wealth · Cash · Properties · Houses & hotels · Transport**. Highest final wealth wins;
  equal wealth shares a place.

## Fair play

- The server rolls every die, moves every token, computes every price, rent, loan and total.
  Clients send intents only (`ROLL`, `EVENT_ROLL`, `BUY`, `BUILD {levels}`, `SKIP`,
  `JAIL_PAY` / `JAIL_WAIT`, `LOAN`, `REPAY`, `SELL_BUILDING`, `SELL_ASSET`, `BANK_HANDLES_IT`,
  `AUCTION_START`, `BID`, `TRADE_PROPOSE`, `TRADE_ANSWER`, each with the turn number).
- Rejected: acting out of turn, stale turns or versions, repeated action ids, any extra field
  (dice, prices, cash, owners, positions), bids below the minimum or above your cash, buying an
  owned or far-away space, building on someone else's city or past a hotel, trading locked or
  unowned assets, anything after the end.
- No hidden information: every player sees the same board.

## Bots

One level. They roll after 0.6–1.4 s and decide after 0.8–2 s; keep a reserve (₹1,500 + ₹250
per opponent); buy when they keep it (always to complete a group), build as many levels as the
reserve allows, pay Jail when cash ≥ 3× the fee, bid up to 0.8–1.1× an asset's value while
keeping half the reserve, accept trades worth ≥ 1.1× what they give (with a 10 % whim),
sometimes propose a trade that completes a group, let the bank handle debts, and misjudge 10 %
of close calls. Bots never spam reactions.
