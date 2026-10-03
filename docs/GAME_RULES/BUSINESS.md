# Business (working title) — rules as implemented

> **"Business" is a provisional working title.** The public name needs a trademark /
> name-availability check before launch. This is an original game: our own board, rules,
> cards, art and pretend currency (**coins** — never real money, never the ₹ sign).

Code: `games/business` (board, economy and cards `src/shared/board.ts`, engine and bot
`src/server/engine.ts`, simulation `src/server/simulate.ts`, board `src/client/Board.tsx`).
Design and simulation results: [design/BUSINESS_DESIGN.md](../design/BUSINESS_DESIGN.md).
Every number is a play-test value (tuned by the simulation).

## Players and rounds

- **2–6 players**, humans and/or bots. The host picks **12, 16 (default) or 20 rounds**; a
  round is one turn each. About 10 minutes for 4 players at 16 rounds.
- The first player is drawn at random; play goes round in seat order.
- Everyone starts on **Start** with **1,200 coins**.

## The board — a 28-space "ring road"

A tall 6 × 10 ring (turned sideways on wide screens), played clockwise:

| #   | Space                    | #   | Space                   |
| --- | ------------------------ | --- | ----------------------- |
| 0   | **Start**                | 14  | **Traffic Jam**         |
| 1   | Indore — Central · 100   | 15  | Delhi — North · 230     |
| 2   | News                     | 16  | **Textile Mill** · 200  |
| 3   | Bhopal — Central · 110   | 17  | Mela                    |
| 4   | Nagpur — Central · 120   | 18  | Kochi — South · 240     |
| 5   | **Chai Break**           | 19  | **Lucky Mela**          |
| 6   | Bhubaneswar — East · 140 | 20  | Chennai — South · 250   |
| 7   | Mela                     | 21  | News                    |
| 8   | Guwahati — East · 150    | 22  | Bengaluru — South · 270 |
| 9   | **Tea Garden** · 200     | 23  | **Film Studio** · 200   |
| 10  | Kolkata — East · 170     | 24  | Jaipur — West · 290     |
| 11  | News                     | 25  | Mela                    |
| 12  | Lucknow — North · 190    | 26  | Ahmedabad — West · 300  |
| 13  | Chandigarh — North · 200 | 27  | Mumbai — West · 340     |

15 cities in 5 regions (Central, East, North, South, West), 3 industries, 3 News and 3 Mela
spaces, 4 corners. Prices are gameplay tiers, not a ranking of real cities.

## A turn

1. **Roll** two dice (on the server; 10 s, or it rolls for you). Move forward that many
   spaces. Passing or landing on **Start** pays **150** coins, plus industry dividends.
2. **Land** and resolve the space:
   - **Free city or industry:** buy it at its price (Buy / Skip, 15 s; skip on timeout). Not
     enough coins: no offer; it stays unowned.
   - **Your own city:** develop it one level (Build / Skip).
   - **Someone else's city:** pay them the **visitor fee**. **Someone's industry:** pay a
     **factory visit** of 20 per industry they own.
   - **News / Mela:** draw a card and follow it (below).
   - **Lucky Mela:** spin the wheel — +50, +75, +100, +100, +150 or a free level (+75 if you
     own no city). Always good.
   - **Traffic Jam:** your next roll uses **one die**. **Chai Break:** a safe stop.
3. **Start expansion:** if you passed or landed on Start this turn, you may also develop
   **any one** of your cities by one level (after the landing decision).
4. The turn ends; the next player rolls.

## Cities and development

| Level        | How                                     | Cost           | Visitor fee       |
| ------------ | --------------------------------------- | -------------- | ----------------- |
| **Stall**    | buy the city                            | its price      | 25 % of the price |
| **Shop**     | land on it again, or choose it at Start | half its price | × 3               |
| **Showroom** | as above                                | half its price | × 5               |
| **Mall**     | as above                                | half its price | × 8               |

One level at a time. Owning **all three cities of a region** multiplies their fees by
**1.5**. Fees round to 5. Example — Mumbai (340): Stall 85, Shop 255, Showroom 425, Mall 680.

**Industries** (Tea Garden, Textile Mill, Film Studio — 200 each) can't be developed; they pay
their owner **25 per industry** every time the owner passes Start (**+40** for all three).

## Cards

Two decks of 12 (News: business news; Mela: fair-ground fun), shuffled by the server; a used
card goes under; an empty deck is reshuffled. No card moves more than 150 coins to or from one
player. Moving cards resolve the new space once (never a second card).

**News:** tea prices climb (Tea Garden owner +100) · your shop trends online (+80) · fuel
prices up (−40) · power cuts (−15 per level you own, max 120) · wedding season (+50 per Mall,
every owner) · export order (+40 per industry you own, at least 40) · tech fair in the South
(+30 per South city, every owner) · road works in the West (−20 per West city, every owner) ·
markets dip (everyone −25) · express train (forward 4) · film shoot (Film Studio owner +100) ·
cotton harvest (Textile Mill owner +100).

**Mela:** ring-toss win (+50) · giant-wheel treat (pay 10 to each other player) · sweets
stall sells out (+70) · kite-flying contest (collect 15 from each other player) · lost in the
crowd (back 3) · puppet show (−30) · lucky draw (a free level on your least-developed city, or
+60) · folk-dance prize (+60) · balloons (−20) · magic show (everyone +30) · food-court feast
(−40) · the mela train home (move to Start).

## Short of coins — clearance sales

Nobody is ever eliminated. If you must pay more than you have, the bank **automatically**
sells your assets at **half value** until you can pay: development levels first (one at a
time, from your most developed city, cheapest first on ties), then whole places, cheapest
first. Sold places go back to the bank. If you still can't pay everything, you pay what you
have and the rest is **written off**; you carry on with 0 coins ("Broke"), collecting the
Start salary as usual.

## The end

After the last turn of the last round: **wealth = coins + price of every place you own +
everything spent on development.** Highest wealth wins; equal wealth shares a place
(1, 1, 3). The results show **Wealth** and **Cities**.

## Fair play and timing

- No trading, loans, auctions or mortgages.
- Rejected: acting out of turn, a stale turn number, buying an owned or far-away place,
  developing someone else's city or a Mall, any dice, price, coins or position sent by a
  client, repeated action ids, versions the server never issued, anything after the end.
- Three automatic actions in a row (timeouts while connected) hand your seat to a bot; "I'm
  back" takes it back at once. Disconnected players have the usual 30 s grace.
- **Bots** buy when they keep a reserve (150 + 25 per opponent) — always to complete a
  region — develop when they keep the reserve, choose their best city at Start (a complete
  region first, then the dearest), sometimes misjudge a close call, and think 0.8–2 s.
