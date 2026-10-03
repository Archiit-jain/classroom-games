# Business (working title) — Phase 8 redesign

**Status:** **approved** (revision 2) and **implemented** (Phase 8 redesign). Supersedes
[BUSINESS_DESIGN.md](BUSINESS_DESIGN.md). Rules as implemented:
[GAME_RULES/BUSINESS.md](../GAME_RULES/BUSINESS.md); decision record:
[ADR-026](../decisions/ADR-026-business-redesign.md); results: §23 below.

> **Owner decisions in this brief that reverse earlier frozen decisions (spec C12 / C14):**
> player-to-player **trading is allowed**; money is shown as fictional **₹ (Rupees)**; the
> board is a **classic square** board. These are recorded as spec change C17 when the design
> is committed. Everything marked _(frozen)_ below comes from the owner's brief; everything
> marked _(proposed)_ is a developer proposal and every number is a play-test value until the
> economy simulation (§19) and human play-testing.
>
> **Reference image:** the brief mentions an attached image; none reached this session. The
> design follows the brief's description (traditional square board, four sides, four
> corners, properties round the edge, a central title/information area, transport and event
> spaces).

---

## 1. Audit of the current implementation (Phase 8, as shipped)

| Area            | Current                                                                                      | Verdict                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Board           | 28-space 6 × 10 "ring road", 15 cities / 5 regions, 3 industries, 3 News + 3 Mela, 4 corners | **Replace** — wrong shape and counts                                                        |
| Economy         | 1,200 coins, 25 % fees ×1/3/5/8, Stall → Mall, Start expansion, dividends                    | **Replace** — new money (₹10,500), new levels (houses/hotel), new rent                      |
| Cards           | Two shuffled 12-card decks                                                                   | **Replace** — deterministic dice-sum events                                                 |
| Insolvency      | Automatic clearance sales, write-off, "Broke"                                                | **Redesign** — keep "never eliminated", add loans and a visible insolvency state            |
| Trading/auction | None                                                                                         | **New** — trading and player-initiated auctions                                             |
| Turn flow       | Roll 10 s / decide 15 s, HOLD phase sized to the hop animation, idle after 3 timeouts        | **Keep the shape**, new 30 s timer                                                          |
| Client          | Flat CSS grid tiles, stage inside the ring, hop by re-rendering tokens in tiles              | **Replace** — square 2.5D tabletop, interpolated token travel, choreographed animations     |
| Player identity | Seat colours, "You" text in names, current-player ring on a chip                             | **Redesign** — permanent YOU marker, own-token halo, turn banner, colour-linked action tray |
| Server/infra    | `GameModule`, action ids, versions, Redis snapshots, failover, multi-instance tests, smoke   | **Keep unchanged**                                                                          |
| Tests/tools     | Engine/economy/socket/cluster tests, e2e, smoke, simulator, screenshot tool                  | **Keep the patterns**, rewrite the Business-specific ones                                   |

## 2. Retained

- The platform: sessions, rooms, host/gateway, Redis, failover, reconnect, action ids,
  versions, moderation, chat, reactions, bots via `BotModule`, results screen, effects modes.
- The game package layout (`games/business`: shared / server / client), the pure-engine +
  working-copy ledger pattern with **money conservation checks** (`bankNet`), the turn
  numbers on actions, the HOLD-for-animation pattern, the seeded simulator and its
  report/sweep scripts, the multi-instance/failover test, the smoke test structure, the
  screenshot tool, "postcard stays until you close it or your own turn starts".
- "Nobody is eliminated before the last round".

## 3. Removed

The ring-road board and its geometry; the 15-city / 5-region list and industries; Stall →
Shop → Showroom → Mall; the Start expansion rule; dividends and factory visits; News/Mela
decks and the Lucky Mela wheel; Chai Break / Traffic Jam / Lucky Mela corners; "coins" and
the coin icon; the 12/16/20 round options; the automatic write-off as the first response to
a shortfall; the current flat board client and its CSS.

## 4. Redesigned

Square 36-space board; 22 cities in 4 groups; 6 transports; 4 deterministic event spaces;
₹10,500 start; houses/hotel; 3-in-a-group double rent; Jail choice; Club/Resort; loans;
player auctions; trading; a visible insolvency process; custom rounds; spending-based final
wealth; 30 s turns; a 2.5D tabletop client with choreographed animation and strong player
identity.

## 5. Board map — 36 spaces _(frozen structure; order proposed)_

Played **clockwise**. Corners at 0, 9, 18, 27. Each side has 8 middle spaces: sides 1 and 3
have **5 cities + 2 transports + 1 event**; sides 2 and 4 have **6 cities + 1 transport + 1
event** (22 + 6 + 4 = 32). Events alternate Chance → Community Chest → Chance → Community
Chest, one per side, never adjacent.

| #   | Space               | Kind      | #   | Space               | Kind      |
| --- | ------------------- | --------- | --- | ------------------- | --------- |
| 0   | **START**           | corner    | 18  | **CLUB**            | corner    |
| 1   | Patna               | C (East)  | 19  | Goa                 | D (West)  |
| 2   | Ranchi              | C (East)  | 20  | Surat               | D (West)  |
| 3   | **Railways**        | transport | 21  | **Airways**         | transport |
| 4   | Bhubaneswar         | C (East)  | 22  | Pune                | D (West)  |
| 5   | **Chance**          | event     | 23  | **Chance**          | event     |
| 6   | Guwahati            | C (East)  | 24  | Ahmedabad           | D (West)  |
| 7   | **Roadways**        | transport | 25  | **Petroleum**       | transport |
| 8   | Kolkata             | C (East)  | 26  | Mumbai              | D (West)  |
| 9   | **JAIL**            | corner    | 27  | **RESORT**          | corner    |
| 10  | Kochi               | B (South) | 28  | Jammu               | A (North) |
| 11  | Thiruvananthapuram  | B (South) | 29  | Dehradun            | A (North) |
| 12  | Visakhapatnam       | B (South) | 30  | Lucknow             | A (North) |
| 13  | **Community Chest** | event     | 31  | **Community Chest** | event     |
| 14  | Chennai             | B (South) | 32  | Jaipur              | A (North) |
| 15  | **Waterways**       | transport | 33  | **Satellite**       | transport |
| 16  | Hyderabad           | B (South) | 34  | Chandigarh          | A (North) |
| 17  | Bengaluru           | B (South) | 35  | Delhi               | A (North) |

Every side starts cheap and ends dear; the board as a whole gets dearer clockwise (East →
South → West → North), so Delhi (the capital) is the most expensive city and Mumbai the most
expensive of the West.

## 6. City groups _(frozen 6/6/5/5; cities and grouping proposed)_

| Group | Region | Count | Cities (board order)                                                         | Colour      |
| ----- | ------ | ----- | ---------------------------------------------------------------------------- | ----------- |
| **A** | North  | 6     | Jammu · Dehradun · Lucknow · Jaipur · Chandigarh · Delhi                     | saffron red |
| **B** | South  | 6     | Kochi · Thiruvananthapuram · Visakhapatnam · Chennai · Hyderabad · Bengaluru | teal        |
| **C** | East   | 5     | Patna · Ranchi · Bhubaneswar · Guwahati · Kolkata                            | leaf green  |
| **D** | West   | 5     | Goa · Surat · Pune · Ahmedabad · Mumbai                                      | indigo blue |

All required cities are included (Delhi, Mumbai, Bengaluru, Hyderabad, Chennai, Kolkata,
Jaipur, Lucknow, Goa, Patna, Jammu); the rest are state capitals or major economic centres.
Each city gets its own small original line icon (e.g. Delhi: a gateway arch silhouette;
Mumbai: a sea-link curve; Bengaluru: a circuit leaf; Kolkata: a tram; Chennai: a
lighthouse; Hyderabad: four-minaret silhouette kept non-religious and generic; Jaipur: a
latticed façade; Goa: palm and boat; Kochi: fishing nets…), no photographs, no logos.

**Prices and base rent** _(proposed, ₹, before simulation)_:

| Group | Cities and prices                                                                                                | Base rent (10 %) |
| ----- | ---------------------------------------------------------------------------------------------------------------- | ---------------- |
| C     | Patna 600 · Ranchi 600 · Bhubaneswar 700 · Guwahati 700 · Kolkata 900                                            | 60–90            |
| B     | Kochi 1,000 · Thiruvananthapuram 1,000 · Visakhapatnam 1,100 · Chennai 1,300 · Hyderabad 1,400 · Bengaluru 1,500 | 100–150          |
| D     | Goa 1,600 · Surat 1,600 · Pune 1,800 · Ahmedabad 1,900 · Mumbai 2,400                                            | 160–240          |
| A     | Jammu 2,000 · Dehradun 2,000 · Lucknow 2,100 · Jaipur 2,200 · Chandigarh 2,300 · Delhi 2,800                     | 200–280          |

## 7. Transport _(six assets frozen; every price and rent **proposed**, tuned by simulation and human play-testing)_

Railways (3), Roadways (7), Waterways (15), Airways (21), Petroleum (25), Satellite (33).
Transports are bought like cities, **cannot be developed**, and charge a visitor fee that
depends only on how many transports the owner holds — a simple combination model.

| Owner holds      | 1    | 2    | 3    | 4    | 5      | 6      |
| ---------------- | ---- | ---- | ---- | ---- | ------ | ------ |
| Fee _(proposed)_ | ₹150 | ₹350 | ₹600 | ₹900 | ₹1,250 | ₹1,600 |

Price _(proposed)_: **₹1,500** each. Shown on the board as a vehicle icon on a distinct
silver-gold "transport card", visually unlike city tiles.

## 8. Events — deterministic by dice sum _(frozen mechanic; outcomes proposed)_

Working names **Chance** and **Community Chest** are kept (a later naming/legal review may
change the player-facing names; that is a separate product decision and does not change any
rule). No random card drawing.

**Flow:** you land on the event space → an **event roll** prompt appears ("Roll for Chance",
30 s; the server rolls for you on timeout) → you tap **Roll** → the two dice animate and the
**sum** is shown → the matching card rises and flips to show the result → the effect animates
(money moves, a building appears…) and is applied. The dice are rolled on the server, like
every roll.

**Parity:** Chance — **even sum = GOOD, odd sum = BAD**. Community Chest — **odd sum = GOOD,
even sum = BAD**. Each deck has exactly one outcome per sum 2–12 (11 + 11 = 22). Rarer sums
carry bigger effects; 7 (the most likely) is mild. A "move to" result resolves the new space
once (it never triggers another event). Amounts are **proposed**.

**Chance**

| Sum | Good/bad | Outcome                                                                        |
| --- | -------- | ------------------------------------------------------------------------------ |
| 2   | good     | **Jackpot export order** — collect ₹1,500 from the bank                        |
| 3   | bad      | **Factory fire drill goes wrong** — pay ₹1,000 to the bank                     |
| 4   | good     | **Your launch party is the talk of the town** — collect ₹200 from every player |
| 5   | bad      | **Delivery trucks delayed** — pay ₹300 to every player                         |
| 6   | good     | **Festive-season sales** — collect ₹500 from the bank                          |
| 7   | bad      | **Parking fine** — pay ₹200 to the bank                                        |
| 8   | good     | **Free renovation** — your least-developed city gains a building (else ₹600)   |
| 9   | bad      | **Stuck at the toll plaza** — lose your next roll                              |
| 10  | good     | **Express highway** — move to START and collect ₹1,500                         |
| 11  | bad      | **Monsoon repairs** — pay ₹100 per house and ₹250 per hotel (max ₹1,500)       |
| 12  | good     | **Film rights sold** — collect ₹1,000 from the bank                            |

**Community Chest**

| Sum | Good/bad | Outcome                                                                      |
| --- | -------- | ---------------------------------------------------------------------------- |
| 2   | bad      | **Big inspection fee** — pay ₹1,500 to the bank                              |
| 3   | good     | **Your fixed deposit matures** — collect ₹1,000                              |
| 4   | bad      | **You host the neighbourhood feast** — pay ₹200 to every player              |
| 5   | good     | **Everyone chips in for your stall** — collect ₹150 from every player        |
| 6   | bad      | **Office rent goes up** — pay ₹400 to the bank                               |
| 7   | good     | **Cash-back on supplies** — collect ₹300 from the bank                       |
| 8   | bad      | **Licence paperwork pending** — you cannot buy on your next turn             |
| 9   | good     | **Rent holiday** — your next visitor fee (rent) is waived                    |
| 10  | bad      | **Missed the train** — lose your next roll                                   |
| 11  | good     | **Community grant** — your least-developed city gains a building (else ₹600) |
| 12  | bad      | **Equipment breakdown** — pay ₹800 to the bank                               |

Probability check: each deck is good on exactly 18 of 36 dice outcomes. Expected value per
event, before simulation: Chance ≈ +₹130, Community Chest ≈ −₹40 per draw for the drawer —
tuned by §19 so both decks are near-neutral on average.

**Event frequency setting.** A clean variant exists — _High_: a roll that totals **7** also
triggers a Chance event after the landing; _Low_: event spaces trigger only on their "good"
parity… — but each variant changes the expected value of a turn and needs its own balancing.
**Proposal: v1 ships with Normal only** (the four physical spaces); the setting exists in
the engine (`eventFrequency: 'normal'`) and is not shown in the lobby until a variant is
simulated and approved.

## 9. Buying, rent and development _(rules frozen; numbers proposed)_

- **Buy:** landing on an unowned city or transport shows **BUY ₹X / DON'T BUY** (30 s,
  timeout = don't buy). Not enough cash: Buy disabled (with a "Take a loan" shortcut).
- **Rent (visitor fee)** = base rent × development multiplier × group bonus:
  - development multipliers _(proposed)_: empty ×1 · 1 house ×3 · 2 houses ×6 · 3 houses ×10 ·
    hotel ×15;
  - **group bonus (frozen):** owning **3 or more** cities of the same group doubles the rent
    of that owner's cities in the group (×2, no further multiplier).
  - Example: Delhi (base ₹280) with a hotel and the bonus → 280 × 15 × 2 = ₹8,400.
  - Shown before every payment ("Rent: ₹X").
- **Development (frozen):** House 1 → House 2 → House 3 → Hotel, one step **when you land on
  your own city** (30 s decision). House cost = **50 % of the city's price**; the hotel costs
  **100 %** _(proposed)_. Transports cannot be developed.
- **Formula, in one line:** `rent = base rent (10 % of price) × level multiplier × (2 if the
owner holds ≥ 3 cities of that group, else 1)`, rounded to ₹10. Base-rent share, level
  multipliers and building costs are **proposed**; the ×2 group rule is **frozen**.
- Every building visibly appears on the tile (§17).

## 10. Auctions _(optional, owner-initiated; numbers proposed)_

- **Only assets the seller already owns** (a city — **with its houses/hotel**, which go with it —
  or a transport). Unowned properties are **never** auctioned, and nothing is auctioned
  automatically when someone declines to buy.
- **When:** on your own turn, **before rolling**; at most **one auction per turn**. Optional —
  normal play never needs it.
- **Opening bid** _(proposed)_: 50 % of what the asset cost (price + buildings); the seller sees
  it before confirming.
- **Open ascending bids**, visible to everyone: every other player (bots too) may bid in steps
  of **+₹100 / +₹500 / +₹1,000** _(proposed)_; a bid must beat the current one and be covered by
  the bidder's **cash** (no borrowing mid-auction). **The seller cannot bid.**
- **Timing** _(proposed)_: 15 s; a bid in the last 5 s resets the clock to 5 s; hard stop 30 s.
- **Result:** the highest bidder **pays the winning bid to the seller**; ownership (with
  buildings) transfers **after** the payment succeeds, at once. No bids → the seller keeps
  it. The seller's turn then continues with the roll.
- **Server-authoritative:** bids are actions with action ids; simultaneous bids are ordered by
  the runtime queue; stale/low bids are rejected; the auction timer is an engine timer
  (snapshotted, restored on failover).
- **Spending:** the winning bid counts as the buyer's property (or transport) spending (§14).

## 11. Trading _(allowed; optional)_

- On your turn **before rolling**, you may propose **one** trade to one player: what you give
  (cash and/or assets) and what you get (cash and/or assets). Buildings travel with their city.
- The other player has **20 s** _(proposed)_ to **Accept** or **Decline**. Nothing changes
  until **both** have confirmed (sending the offer = your confirmation; accepting = theirs).
  Timeout = declined. No hidden or automatic trades.
- At acceptance the server **re-validates everything** (assets still owned by the right player,
  cash still there); cash can never go negative and debt cannot be traded.
- **Spending:** cash paid in a trade counts as spending on the assets received, split across
  them in proportion to their list prices (property vs transport, §14). An asset-for-asset swap
  spends no money and adds no spending.
- Never needed for normal play; bots answer offers and rarely propose one (§16).

## 12. Loans and debt _(multiple loans allowed; numbers proposed)_

One **debt** number per player, always visible on their card ("Debt ₹3,300").

- **Take a loan** on your turn (or in the Raise-money panel): in steps of **₹1,000**. Each loan
  adds its amount **plus a flat 10 % fee** to your debt (borrow ₹1,000 → owe ₹1,100). You may
  take **several** loans; no interest over time.
- **Two sources, one limit** (bank + property-backed): total debt ≤ **₹3,000** (bank credit)
  **+ 50 % of the list price of the cities, buildings and transports you own** (property-backed).
  The panel shows "You can borrow up to ₹X".
- **Repay** any amount, any time on your turn; early repayment allowed, no penalty.
- **No new loans in the final round** _(proposed)_ — a loan is a liquidity tool, not a way to
  finish with extra cash.
- **Debt never counts as wealth, and loans cannot create free wealth:** at the end of the match
  every player's outstanding debt is **repaid from their cash** before wealth is counted
  (§14 settlement). The 10 % fee is a real cost.
- Bots borrow only to avoid insolvency or to complete a group (§16).

## 13. Insolvency _(players are never eliminated)_

1. **A payment you can't cover** (rent, event, Club/Resort, Jail fee, end-of-match debt)
   opens a **Raise money** panel for **30 s**: take a loan (up to the limit; not in the final
   round), sell buildings back to the bank (50 % of their cost _(proposed)_), sell a city or
   transport back to the bank (50 % of its price), or auction an asset. The amount still
   needed is shown live. Selling back to the bank is **only** possible here (§14 explains why).
2. **Timeout or "Let the bank handle it":** the bank does it automatically, in this order —
   borrow up to the limit (not in the final round), then sell buildings (most-developed city
   first), then transports and cities (cheapest first), at 50 %.
3. **Still short:** you pay everything you have; the unpaid rest is written off, your loans are
   cleared, and you are marked **INSOLVENT** (₹0 cash, nothing owned, a clear badge on your
   card and token). You **stay in the match**: you keep rolling, collect ₹1,500 at START and
   can buy again.
4. Your cumulative spending (§14) is a record of what you spent and is not reduced by sales or
   insolvency.

Cash never drops below ₹0, debt never exceeds the limit, and every rupee is accounted for
(ledger checks in every test).

## 14. Final wealth _(frozen formula — exactly as specified)_

**Final wealth = cash currently held + cumulative money spent on properties (cities) +
cumulative money spent on houses/hotels + cumulative money spent on transport.**

- The engine keeps three running totals per player from the first turn: **property spending**
  (city purchase prices paid to the bank, winning auction bids for cities, cash paid in trades
  for cities), **development spending** (every house and hotel paid for), **transport spending**
  (transport purchase prices, winning bids, trade cash for transports). They only ever grow.
- Buildings received for free (events) cost nothing and add nothing. Selling an asset never
  reduces a total.
- **Debt is handled separately (§12):** at the end, outstanding debt is paid from cash first
  (Raise money if needed); written-off debt is the insolvency rule. Debt itself is not part of
  the formula.
- **Results screen:** per player **Cash · Property · Houses & hotels · Transport · = Final
  wealth**, revealed category by category with counting animation, then the podium. Highest
  final wealth wins; ties share a place.

**Consequences of cumulative spending (for the owner's awareness — no rule change):**
because money paid between players counts for the payer _and_ becomes cash for the
receiver, every player-to-player sale (auction or trade with cash) **raises the two players'
combined final wealth by the price paid**, and selling back to the bank at 50 % would turn
spent money into extra cash. Proposed guardrails that keep the formula intact:
(a) selling back to the bank only inside Raise money (§13); (b) at most one auction per turn;
(c) an asset that changed hands by auction or trade can't be auctioned or traded again for
**3 rounds** _(proposed)_. The simulation reports auction/trade volume and its effect on final
wealth so the owner can judge with numbers.

## 15. Rounds and turns

- **Rounds: custom number** (host types it), **5–40**, default **15** _(proposed; simulation
  checks length)_. A round = one turn each. The game ends after the last turn of the last
  round.
- **Turn timer: 30 s (frozen)**, visible as a ring around the current player's card and in the
  action tray. Timeouts: **roll** for you · event roll for you · **don't buy** · **don't build** · Jail → **lose the
  next roll** (spends nothing) · auction/trade → **decline** · raise money → **bank handles it**.
  Three automatic actions in a row → the platform's idle bot takeover (reclaim with "I'm back").
- **Dice:** two dice, sum 2–12, **no doubles rule**.
- **Corners (frozen):** START +₹1,500 when passing or landing; CLUB: collect ₹200 from every
  other player; RESORT: pay ₹200 to every other player; JAIL: **pay ₹500** or **lose your next
  roll** (big two-button choice).
- "Cannot buy next turn" and "rent holiday" are one-shot flags shown on the player card.

## 16. Bots (one level)

Simple and imperfect: buy when cash after buying ≥ a reserve (₹1,500 + ₹250 per opponent),
always when it makes 3-in-a-group; build when the reserve remains; Jail: pay if cash ≥ 3× the
fee, else wait; bid in auctions up to 80–110 % of book value (random per auction) while
keeping the reserve; accept a trade if what it gets is worth ≥ 110 % of what it gives
(book value), with 10 % random refusals; propose a trade only to complete a group (≤ once
per 5 rounds); borrow only to avoid insolvency or to complete a group; 10 % of close calls go
the other way; think 0.8–2 s; no reactions. Same actions and validation as humans.

## 17. Visual direction — "Color Burst Arcade × premium boxed board game × modern India"

- **The board:** a square tabletop board in a **2.5D tilt** (CSS `perspective` + `rotateX`,
  about 20° on desktop, flatter on phones), on a warm wooden table surface with a soft drop
  shadow; board face in cream card stock with a printed border; tiles as slightly raised card
  pieces (bevel highlight + shadow); **corners** as large illustrated squares (START arrow
  and ₹1,500 seal, CLUB with a lounge chair, RESORT with a pool umbrella, JAIL with bars and the
  ₹500 / skip choice printed).
- **Centre:** the game's wordmark (working title) on a patterned medallion, two **3D dice**
  (CSS cube faces, glossy), the Chance and Community Chest card stacks with depth, and the
  active card when drawn. Never empty.
- **Tiles:** group colour band, city icon, name, price; ownership as a coloured corner flag
  in the owner's colour; transports with a vehicle icon on a silver-gold card.
- **Buildings:** small isometric SVG houses (up to three in a row) and a hotel block that sit on
  the tile's band, casting shadows.
- **Tokens:** classic pawn/disc-and-stem tokens in six colours with highlight and shadow, a
  gentle idle bob, and a glow ring around **your** token.
- **Cards:** event cards with rounded corners, layered shadow, deck colour and the dice sum.
- **Money:** ₹ notes/chips that fly between player cards and the bank, counters that roll.
- **India, tastefully:** regional colour palette, line icons per city, a subtle jaali/block-
  print border pattern, transport styling (rail tracks, highway markings); no religious or
  political imagery, no real logos, no photographs.

**Animation choreography** (full / lite / reduced):

| Moment        | Full                                                                                     | Lite                    | Reduced              |
| ------------- | ---------------------------------------------------------------------------------------- | ----------------------- | -------------------- |
| Dice          | shake → tumble (3D cubes) → settle → sum badge (~700 ms)                                 | spin → settle (~350 ms) | the numbers and sum  |
| Movement      | token glides tile by tile with a small arc (~140 ms/tile), lands with a squash           | slide along the path    | jumps; landing text  |
| Purchase      | tile lifts → ₹ chips fly to the bank → owner flag drops in                               | flag fades in           | flag + log line      |
| Rent          | ₹ chips stream payer → owner; both counters roll; receipt toast                          | one chip                | counters + log line  |
| House / hotel | building drops onto the tile with a bounce; hotel replaces houses with a "grow"          | fade in                 | icon + log line      |
| Event         | event dice roll in the centre → card rises, flips, shows sum and effect → money moves    | fade                    | card shown with text |
| Auction       | asset card enlarges to the centre → live bids tick up → gavel → card flies to the winner | no flight               | panel + log          |
| Loan          | ₹ chips enter the wallet; debt badge pops                                                | badge appears           | badge + log          |
| Insolvency    | assets fade back to the bank; INSOLVENT stamp                                            | stamp                   | badge + log          |
| Final         | board settles flat → wealth counters per category → podium                               | counters                | table, then podium   |

All of it is CSS transforms / Motion springs / SVG — no WebGL. The server's HOLD after a roll
covers the token's travel time so nobody acts before the board has caught up.

## 18. Phone and desktop UX

- **Player identity:** a persistent **YOU** tag on your player card and over your token; your
  colour on the action tray; a soft halo under your token; a large **YOUR TURN** /
  **ARCHIT'S TURN** banner with the player's colour and token; the current player's card is
  raised and ringed with the 30 s timer.
- **Player strip:** token, name, cash (rolling), small "3 🏠 · 1 🏨 · 2 ✈" counts, debt badge
  if any; nothing else.
- **Desktop (≥ 900 px of board width):** the tilted board centred and dominant (it takes the
  room's main column; the chat docks below or collapses into a drawer instead of squeezing the
  board — container queries decide), player cards across the top, the action tray under the
  board.
- **Phone portrait (360–430 px):** the board is **not** shrunk to fit: it renders at a readable
  scale (~1.7× the fit size) inside a **camera** that follows the active token and the landing
  tile, with a **"See whole board"** button and pinch/zoom; tiles show colour band, short name
  and price; tapping a tile opens a **bottom-sheet property card** (name, group, price, rent at
  every level, owner, buildings) that stays until closed, replaced by an important action, or
  your own next turn. The **action tray** is a bottom sheet with large buttons (Roll, Buy,
  Build, Pay ₹500 / Skip a roll, Loan, Auction, Trade).
- **Phone landscape:** the board fills the height on the left; player strip and action tray on
  the right.
- No horizontal page overflow at any size.

## 19. Production architecture impact

None to the platform. Business stays an ordinary `GameModule` (`sync: 'TURN_PHASE'`): all
dice, movement, rent, events, auctions, trades, loans, insolvency and wealth are engine-only;
clients send intents with action ids, versions and the turn number. New actions: `ROLL`,
`BUY`, `SKIP`, `BUILD`, `JAIL_PAY`, `JAIL_WAIT`, `LOAN`, `REPAY`, `SELL_BUILDING`, `SELL_ASSET`,
`AUCTION_START`, `BID`, `TRADE_PROPOSE`, `TRADE_ANSWER`, `BANK_HANDLES_IT`, `EVENT_ROLL`
(selling to the bank only in the Raise-money phase). Auctions and trades
use engine timers (snapshotted, restored on failover). Snapshot size stays small (36 spaces,
≤ 6 players). The engine stays pure and provider-portable.

**One small shared change (proposed):** Business-moment quick reactions (huge rent 😱, lucky
roll 🍀, hotel 🏨, big buy 🤑, insolvent 😵). Today the reaction set is platform-wide; the
proposal is an optional per-game extra set declared in the game manifest and validated by
the server, with regression tests for the other games. If not approved, Business uses the
existing eight reactions.

## 20. Economy simulation plan

Rewrite `simulate.ts` for the new rules; **≥ 5,000 bot matches** for the final candidate,
across 2–6 players and 10 / 15 / 20 / 25 / 30 rounds. Measure: final wealth (mean, spread),
property and transport ownership, development frequency (houses/hotels), loans (frequency,
size, outstanding at end), trades, auctions (count, price vs book value), insolvency
frequency, event impact (each outcome's contribution; with vs without events), runaway
leaders, rounds completed, game length at human pace, effect of player count. **Targets
(luck-heavy):** the early leader (after a third of the game) wins **≤ 50 %**; runaway wins
< 15 %; insolvency in < 10 % of player-games; every group bought and developed; Jail, Club and
Resort felt but not decisive. Bot-only numbers are a sanity check, not the goal: a
"casual human" bot profile (more random buying, slower building) is simulated separately, and
the final values get a human play-test before freezing.

## 21. Testing plan

Rewritten Business tests (the platform tests stay):

- **Board:** 36 spaces, 4 corners at 0/9/18/27, 22 cities (6/6/5/5), 6 transports, 4 events
  alternating C/CC one per side and never adjacent, tile geometry.
- **Dice/turns:** 2–12 only, no doubles rule, movement and wrap, START ₹1,500, rounds (custom),
  the 30 s timeouts and their safe actions, idle takeover.
- **Corners:** Club +₹200 from each, Resort −₹200 to each, Jail pay ₹500 / lose next roll.
- **Property/transport:** buy/decline, rent by level, the 3-in-group ×2 rule (2 owned: ×1;
  3: ×2; 6: ×2), houses → hotel and costs, transport fees for 1–6 owned.
- **Events:** every sum 2–12 for both decks: the right outcome and parity.
- **Auctions/trades/loans/insolvency:** owned assets only, bid validity and ordering, timers
  and extensions, transfers; two-sided trade confirmation and re-validation; multiple loans,
  fee, limit, repayment; the raise-money panel, the automatic order, write-off and the
  INSOLVENT state; money conservation after every transition.
- **Security/protocol:** wrong player, duplicate ids, stale versions/turns, forged dice /
  money / ownership / bids / trade contents, actions after the end.
- **Bots:** purchases, building, Jail, auctions, trades, loans, full seeded matches with leak
  and conservation checks.
- **Production:** real sockets, reconnect mid-auction and mid-trade, two instances + host
  crash during an auction, Redis in CI.
- **E2E:** desktop, Pixel 7, 360 px, landscape, reduced motion, 2 players, 4–6 players with
  bots, an auction, events, insolvency (scripted dice in a test-only server option), final
  results; repeated runs.
- **Smoke:** create → join → start → dice/movement → purchase → rent → building → event →
  auction → loan → reconnect → host failover (in the multi-instance CI job) → results, on the
  production build with Redis.
- **Visual review** of the 20 moments listed in the brief, on desktop, Pixel 7 portrait and a
  landscape phone, before anything is called done.

## 22. Risks and open points for the owner

1. **Names:** working names Chance and Community Chest are kept as instructed. A separate
   naming/legal review before launch should look at them and at the corner and transport names
   (close to classic commercial boards); the mechanics are unaffected.
2. **Cumulative spending** consequences and the proposed guardrails (§14) — the simulation will
   quantify them.
3. **Event frequency:** Normal only in v1 (§8) unless a variant is approved after simulation.
4. **Per-game reactions** (§19): a small optional platform extension.
5. **Numbers:** all prices, rents, multipliers, building costs, transport values, loan values,
   auction steps/timings and event amounts are proposals until the simulation and a human
   play-test.

## 23. Implementation results

### Deviations from this document

1. **Building several levels per landing** (simulation-driven): landing on your own city may
   build **one or more** levels at once (House 1 → 2 → 3 → Hotel order unchanged, still only on
   landing). With one level per landing, 5,000 simulated matches produced almost no hotels.
   **Please confirm or reject** — it is a single-line rule switch (`BUILD.levels` max 1).
2. Bots never _start_ auctions (they bid in them); auctions in the numbers below come from the
   "casual" profile, which starts one about every 40 rolls.

### Tuned values (`DEFAULT_ECONOMY`)

Start ₹10,500 · START ₹1,500 · Club/Resort ₹200 each · Jail ₹500 · base rent 40 % of price ·
levels ×1 / 3 / 6 / 10 / 15 · group bonus ×2 at 3+ cities · house 40 % / hotel 80 % of price ·
transport ₹1,500, rent ₹300 / 700 / 1,200 / 1,800 / 2,500 / 3,200 · loans ₹1,000 steps, 10 %
fee, limit ₹3,000 + 50 % of list value · sell-back 50 % · auction opening 50 %, ₹100 steps,
15 s (+5 s, max 30 s) · lock 3 rounds. Event amounts as in §8 (unchanged).

### Simulation (`pnpm --filter @cg/game-business sim`, seed 42, 25,000 matches in total)

| Scenario (bots unless noted)     | Games | Early leader wins | Runaway | Insolvent (player-games) | Loans / game | Trades / game |  Auctions / game | Houses / hotels per game | Minutes\* |
| -------------------------------- | ----: | ----------------: | ------: | -----------------------: | -----------: | ------------: | ---------------: | -----------------------: | --------: |
| **15 rounds, 2–6 players**       | 5,000 |              45 % |   7.1 % |                    8.5 % |         2.32 |           2.0 |                0 |                2.2 / 1.6 |        11 |
| 15 rounds, half "casual" players | 5,000 |              44 % |   4.7 % |                    4.7 % |         1.23 |           1.9 | 0.65 (99 % sold) |                2.0 / 0.9 |        11 |
| 10 rounds                        | 1,250 |              49 % |   1.8 % |                    2.2 % |         0.36 |          0.95 |                0 |                1.1 / 0.7 |       7.3 |
| 20 rounds                        | 1,250 |              46 % |  12.9 % |                   17.4 % |         5.74 |          2.85 |                0 |                2.9 / 2.3 |      14.5 |
| 25 rounds                        | 1,250 |              51 % |  21.0 % |                   25.7 % |         10.4 |          3.64 |                0 |                3.1 / 3.1 |      18.1 |
| 30 rounds                        | 1,250 |              51 % |  24.0 % |                   33.6 % |         15.9 |          4.33 |                0 |                3.1 / 3.9 |      21.8 |
| 2 players (15 rounds)            | 1,667 |              63 % |   6.4 % |                    2.3 % |         0.47 |          0.75 |                0 |                1.7 / 0.8 |       5.5 |
| 4 players                        | 1,667 |              43 % |   6.5 % |                    7.7 % |         2.30 |           2.2 |                0 |                2.4 / 1.6 |        11 |
| 6 players                        | 1,667 |              33 % |   7.0 % |                   11.0 % |         4.21 |          2.96 |                0 |                2.6 / 2.3 |      16.5 |
| casual, **no 3-round lock**      | 2,500 |              45 % |   5.0 % |                    4.8 % |         1.24 |           1.9 |             0.63 |                2.0 / 0.9 |        11 |
| **events off**                   | 2,500 |              42 % |   6.9 % |                    8.6 % |         2.42 |          2.13 |                0 |                2.0 / 1.5 |        11 |

\* At ~11 s per turn (human pace). "Early leader" = richest after a third of the game;
"runaway" = winner more than twice the runner-up's final wealth.

**Other measurements (15 rounds):** final wealth ₹15,346 on average, relative spread 0.34;
two thirds of cities and transports owned at the end; group ownership A 59 %, B 72 %,
C 70 %, D 66 % — **North (A, the most expensive) develops least** (mean level 0.34 vs
0.49–0.78); events move ₹2,553 per game; bots pay to leave Jail 99.5 % of the time;
player-to-player transfers are ~5–6 % of final wealth.

**Reading:** at the default 15 rounds the game is luck-heavy with some strategy — the early
leader wins under half the time, runaways and insolvency stay under 10 %, every system is
used. Longer games (25–30 rounds) become decisive and harsh (a quarter to a third of players
insolvent); 2-player games favour the early leader (63 %). **Events barely change outcomes**
(flavour and swings, not decisive), and the 3-round lock shows **no measurable effect** in
these profiles — both are owner decisions to revisit after a human play-test.

### Visual review (§17 problems → what changed)

| Problem in v1              | Now                                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Dull board                 | Teak-framed 2.5D board, regional colour bands, sunburst event tiles, peacock-felt centre with a rotating rangoli |
| Insufficient properties    | 22 cities + 6 transports on 36 spaces                                                                            |
| Not enough Indian identity | Indian cities with original line icons, tricolour START, rangoli medallion, ₹ with Indian digit grouping         |
| Weak animations            | 3D dice, path walks, SOLD stamps, building drops, money-chip flights, flipping event cards, final count-up       |
| Unclear player identity    | Turn banner in the player's colour, YOU pills on card and token, token halo, lifted current card, coloured tray  |
| Confusing transitions      | The director waits for each animation; event roll → sum → card → effect; postcard stays until closed             |

Review fixes found while capturing (desktop, Pixel 7, 360 px, landscape): board sized to the
viewport height, phone camera padding, token positions nudged off tile names, truncated names
on player cards, a landscape-phone camera, a stacked final table on phones, and — the
important one — the desktop tilt's 3D context made controls in the centre unclickable
(fixed with a flat transform; covered by the e2e auction and tile-tap tests).
