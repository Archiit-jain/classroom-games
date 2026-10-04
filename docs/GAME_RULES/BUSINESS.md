# Business (working title) — rules as implemented

> **"Business" is a provisional working title.** The public name, and the names Chance,
> Community Chest and the corner/transport names, need a naming/legal review before launch.
> All money is **pretend** fictional Rupees (₹) — nothing is ever real money.

Code: `games/business` (board, economy and event tables `src/shared/board.ts`, engine and bot
`src/server/engine.ts`, simulation `src/server/simulate.ts`, board `src/client/Board.tsx`).
Design: [design/BUSINESS_REDESIGN.md](../design/BUSINESS_REDESIGN.md) (revision 2 plus the
correction pass, §24). Rules marked _frozen_ come from the product owner; every other
**number** is a play-test value tuned by the economy simulation until a human play-test.

## Players, rounds and the turn _(frozen)_

- **2–6 players**, humans and/or bots (0–4 bots added by the host).
- **Rounds:** the host types any number from **5 to 40** (default 15). A round is one turn
  each; the game ends after the last turn of the last round. About 12 minutes for 4 players
  at 15 rounds (simulated at human pace, including the space-by-space walk).
- Everyone starts on **START** with **₹65,000** _(frozen)_. First player drawn at random;
  then seat order.
- **Two dice, sum 2–12, no doubles rule.** **30 s** per decision (ring timer). Timeouts take the
  safe choice: roll for you · don't buy · don't build · free building on your least-developed
  city · Jail → lose next roll · decline a trade · let the bank handle a debt. Three automatic
  actions in a row hand the seat to the platform's idle bot ("I'm back" takes it back).

## The board — India Classic, 36 spaces _(orientation and structure frozen)_

Spaces are numbered in the order the pawn moves. **START (0) is the bottom-right corner and
play runs ANTI-CLOCKWISE**: up the right side to **CLUB (9, top-right)**, left across the top to
**RESORT (18, top-left)**, down the left side to **JAIL (27, bottom-left)**, right along the
bottom (35 is directly left of START) and back to START. The server's path and the board's
drawing use the same mapping (`cellOf` in `board.ts`).

| #   | Right side (going up)     | #   | Top (going left)                    | #   | Left side (going down)      | #   | Bottom (going right)       |
| --- | ------------------------- | --- | ----------------------------------- | --- | --------------------------- | --- | -------------------------- |
| 0   | **START**                 | 9   | **CLUB**                            | 18  | **RESORT**                  | 27  | **JAIL**                   |
| 1   | Patna · East · ₹1,500     | 10  | Guwahati · East · ₹2,800            | 19  | Lucknow · North · ₹5,000    | 28  | Pune · West · ₹7,200       |
| 2   | Dehradun · North · ₹1,700 | 11  | Jammu · North · ₹3,100              | 20  | Ahmedabad · West · ₹5,400   | 29  | Hyderabad · South · ₹7,700 |
| 3   | **Roadways** · ₹3,000     | 12  | Thiruvananthapuram · South · ₹3,400 | 21  | **Petroleum** · ₹7,500      | 30  | Jaipur · North · ₹8,200    |
| 4   | Kochi · South · ₹1,900    | 13  | Community Chest                     | 22  | Kolkata · East · ₹5,800     | 31  | Community Chest            |
| 5   | Chance                    | 14  | Goa · West · ₹3,800                 | 23  | Chance                      | 32  | Bengaluru · South · ₹8,700 |
| 6   | Ranchi · East · ₹2,200    | 15  | **Waterways** · ₹6,000              | 24  | Chandigarh · North · ₹6,200 | 33  | Mumbai · West · ₹9,300     |
| 7   | **Railways** · ₹4,500     | 16  | Bhubaneswar · East · ₹4,200         | 25  | **Satellite** · ₹9,000      | 34  | **Airways** · ₹10,500      |
| 8   | Surat · West · ₹2,500     | 17  | Visakhapatnam · South · ₹4,600      | 26  | Chennai · South · ₹6,700    | 35  | Delhi · North · ₹9,900     |

- **22 cities in four groups** _(frozen)_: **North** (6) Jammu, Dehradun, Lucknow, Jaipur,
  Chandigarh, Delhi · **South** (6) Kochi, Thiruvananthapuram, Visakhapatnam, Chennai,
  Hyderabad, Bengaluru · **East** (5) Patna, Ranchi, Bhubaneswar, Guwahati, Kolkata ·
  **West** (5) Goa, Surat, Pune, Ahmedabad, Mumbai.
- **The groups are mixed round the board** — every side holds three or four groups; a group's
  colour belongs to its cities, never to a side. The arrangement is fixed for every match.
- **Prices rise round the board** from ₹1,500 (Patna) to ₹9,900 (Delhi): cheap ₹1,500–2,500 ·
  low-mid ₹2,800–3,800 · mid ₹4,200–5,400 · high ₹5,800–7,200 · premium ₹7,700–9,900. Prices
  are gameplay tiers, not a ranking of real cities.
- **6 transports**, each with its own price: Roadways ₹3,000, Railways ₹4,500, Waterways
  ₹6,000, Petroleum ₹7,500, Satellite ₹9,000, **Airways ₹10,500** _(frozen; the dearest asset)_.
- **4 event spaces**, one per side, alternating Chance → Community Chest.

### Corners _(frozen)_

- **START:** collect **₹1,500** every time you pass or land.
- **CLUB:** collect **₹200** from every other player.
- **RESORT:** pay **₹200** to every other player.
- **JAIL:** pay **₹500** (and roll normally next turn) **or** lose your next roll.

## Moving

You roll; the dice tumble and settle; then your pawn walks **every space in order**
(`current → +1 → +2 → …`), a hop per space, flashing the START salary if it passes START, and
lands with a small bounce. Only then does the landing decision appear. This happens in every
effects mode (Reduced only drops the hop bounce). The server decides the path and position;
the board animates exactly that path.

## Cities, rent and development _(rules frozen)_

- **Land on a free city or transport:** buy it at its price, or skip (it stays unowned).
- **Land on your own city:** build — **House 1 → House 2 → House 3 → Hotel**, **one level per
  BUILD click**. After each level the offer stays open for the next one until you press Done,
  can't afford the next level, or reach the hotel. House = 30 % of the city price; hotel = 60 %.
- **Land on someone else's city:** pay rent. Base rent = 50 % of the price, × **1 / 3 / 6 / 10
  / 15** for empty / 1 / 2 / 3 houses / hotel. **Owning 3 or more cities of a group doubles
  that group's rent** (2 owned: ×1; 3–6 owned: ×2).
- **Transports** have their **own fixed rent**, the same however many transports the owner
  has: Roadways ₹1,000 · Railways ₹1,500 · Waterways ₹2,100 · Petroleum ₹2,600 · Satellite
  ₹3,100 · Airways ₹3,700. **Transports are never developed** (no houses, no hotels) and the
  group rule doesn't apply to them.

Example — Delhi (₹9,900): rent ₹4,950 empty, ₹14,850 / ₹29,700 / ₹49,500 with houses,
₹74,250 with the hotel; double those with 3+ North cities. Houses ₹2,970 each, hotel ₹5,940.

## Events — deterministic by dice sum _(mechanic and outcomes frozen; amounts scaled)_

Landing on Chance or Community Chest: **you roll two dice for the event**; everyone sees the
sum, then the card for that sum flips over. **Chance: even sum = good, odd = bad. Community
Chest: odd = good, even = bad.** Each sum has exactly one outcome per deck — no shuffled cards.
The owner's base amounts are **scaled ×5** for the ₹65,000 economy (owner decision: corners
unscaled, events scaled; the factor keeps events at about the share of a game's money they had
before).

| Sum | Chance                                                     | Community Chest                      |
| --- | ---------------------------------------------------------- | ------------------------------------ |
| 2   | Good: collect ₹7,500                                       | Bad: pay ₹7,500                      |
| 3   | Bad: pay ₹5,000                                            | Good: collect ₹5,000                 |
| 4   | Good: collect ₹1,000 from every player                     | Bad: pay ₹1,000 to every player      |
| 5   | Bad: pay ₹1,500 to every player                            | Good: collect ₹750 from every player |
| 6   | Good: collect ₹2,500                                       | Bad: pay ₹2,000                      |
| 7   | Bad: pay ₹1,000                                            | Good: collect ₹1,500                 |
| 8   | Good: **free building** (or ₹3,000)                        | Bad: you can't buy on your next turn |
| 9   | Bad: lose your next roll                                   | Good: your next rent is waived       |
| 10  | Good: go to START and collect ₹1,500                       | Bad: lose your next roll             |
| 11  | Bad: repairs ₹500 per house, ₹1,250 per hotel (max ₹7,500) | Good: **free building** (or ₹3,000)  |
| 12  | Good: collect ₹5,000                                       | Bad: pay ₹4,000                      |

**Free building:** you choose one of your cities that can take another level; it gets the next
level (House 1 → 2 → 3 → Hotel) for ₹0. It adds nothing to your spending but raises rent
normally. Never on a transport. If none of your cities can take a level, you get ₹3,000
instead. Timeout: your least-developed eligible city gets it.

## Optional actions on your turn (before you roll)

- **Loans:** borrow in steps of ₹5,000; each step adds **₹5,500** to your debt (10 % fee).
  Limit: debt ≤ ₹20,000 + 50 % of the list value of what you own. Several loans are allowed;
  repay any amount at any time on your turn. **No new loans in the final round.** At the end of
  the match, debt is repaid from cash first.
- **Auction** one of your cities or transports (with its buildings): opening bid 50 % of its
  value (rounded to ₹100), bids in ₹100 steps, 15 s, +5 s after a late bid (30 s at most).
  You can't bid on your own auction. No bids: you keep it. **At most one auction per turn.**
- **Trade** with one player: cash and/or assets each way; the other player confirms (20 s);
  the server re-checks everything at acceptance. One trade offer per turn.
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

## My properties

**MY PROPERTIES** shows everything you own, as cards grouped **North · South · East · West ·
Transport**, each group with its progress (e.g. `WEST 3 / 5 — RENT ×2`, or `2 more for RENT
×2`). A card shows the name, group colour, icon, price, current rent and buildings. It is a
side panel on wide layouts, a panel opened from the turn banner on desktop, and a bottom sheet
opened from the board on phones — the game keeps running underneath. On the board every owned
square shows its owner's colour; your own squares get the strongest ring and a YOU flag.

## Final wealth _(frozen formula)_

**Final wealth = cash currently held + cumulative money spent on properties + cumulative money
spent on houses/hotels + cumulative money spent on transport.**

- Running totals from the first turn; they never go down (selling or insolvency doesn't reduce
  them). Auction wins and the cash part of trades count toward the buyer's totals. Free
  buildings cost nothing and add nothing.
- At the end the board counts up each part for every player, then the total; the results show
  **Final wealth · Cash · Properties · Houses & hotels · Transport**. Highest final wealth wins;
  equal wealth shares a place.

## Fair play

- The server rolls every die, moves every token, computes every price, rent, loan and total.
  Clients send intents only (`ROLL`, `EVENT_ROLL`, `BUY`, `BUILD`, `FREE_BUILD`, `SKIP`,
  `JAIL_PAY` / `JAIL_WAIT`, `LOAN`, `REPAY`, `SELL_BUILDING`, `SELL_ASSET`, `BANK_HANDLES_IT`,
  `AUCTION_START`, `BID`, `TRADE_PROPOSE`, `TRADE_ANSWER`, each with the turn number).
- Rejected: acting out of turn, stale turns or versions, repeated action ids, any extra field
  (dice, positions, prices, cash, owners, levels), bids below the minimum or above your cash,
  buying an owned or far-away space, building on a transport, someone else's city or past a
  hotel, a free building on an ineligible space, trading locked or unowned assets, anything
  after the end.
- No hidden information: every player sees the same board.

## Bots

One level. They roll after 0.6–1.4 s and decide after 0.8–2 s; keep a reserve (14 % of the
start cash + 2.4 % per opponent — ₹13,780 with four players); buy when they keep it (and to
complete a group while keeping a third of it), build one level at a time while the reserve
allows, put a free building on their dearest eligible city, pay Jail when cash ≥ 3× the fee,
bid up to 0.8–1.1× an asset's value while keeping half the reserve, accept trades worth ≥ 1.1×
what they give (with a 10 % whim), sometimes propose a trade that completes a group, let the
bank handle debts, and misjudge 10 % of close calls. Bots never start auctions and never spam
reactions.
