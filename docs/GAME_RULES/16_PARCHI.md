# 16 Parchi — rules as implemented

Code: `games/sixteen-parchi` (engine `src/server/engine.ts`, board `src/client/Board.tsx`,
content `src/shared/categories.ts` + `content/en`). Approved rules:
[spec §11](../specs/PHASE_0_SPEC.md#11-16-parchi-rules-flagship). Design notes:
[design/16_PARCHI_DESIGN.md](../design/16_PARCHI_DESIGN.md). This page describes exactly
what the code does.

## Players, slips and categories

- **Exactly 4 players** (humans and/or bots).
- **16 slips:** a category has 4 items × 4 copies. Each player is dealt 4 slips.
- **Category:** a host setting in private rooms — one of the ten categories or **Random**
  (default; picked by the match's seeded random generator). Rematch ("Play again") deals a
  fresh match with the same setting.
- **Goal:** collect four slips of the same item and claim before anyone else. Placements
  1st–4th; there is no score.

| Category       | Items                                  |
| -------------- | -------------------------------------- |
| Fruits         | Mango · Banana · Apple · Grapes        |
| Animals        | Lion · Elephant · Monkey · Peacock     |
| Sports         | Cricket · Football · Badminton · Chess |
| Street Food    | Samosa · Pani Puri · Jalebi · Vada Pav |
| Vehicles       | Auto-rickshaw · Bus · Train · Bicycle  |
| Stationery     | Pencil · Eraser · Sharpener · Ruler    |
| Sky            | Sun · Moon · Star · Rainbow            |
| Music          | Tabla · Guitar · Flute · Trumpet       |
| Childhood Toys | Kite · Spinning Top · Marbles · Yo-yo  |
| Ocean          | Fish · Crab · Octopus · Whale          |

## Flow

| Phase          | Length | What happens                                                                                                                                                                                                                                      |
| -------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEALING`      | 2 s    | Seeded shuffle; 4 slips to each player. Then the **check**.                                                                                                                                                                                       |
| _check_        | —      | Anyone in the circle holding four of a kind → `CLAIM_WINDOW`. Otherwise `SELECTING` (or the safety cap ends the match, below).                                                                                                                    |
| `SELECTING`    | 10 s   | Every active player chooses one slip to pass (changeable). Ends 300 ms after the last missing choice, or at the timeout — then anyone who has not chosen gets the **safe auto-pick**.                                                             |
| `PASSING`      | 1.2 s  | All chosen slips move **clockwise at the same time** to the next active player (the seat after yours is on your screen-left). Then the check.                                                                                                     |
| `CLAIM_WINDOW` | 6 s    | Passing is paused. Players holding a full set may **CLAIM**; claims are ranked by arrival at the server. When every eligible player has claimed (or time runs out — then the rest are claimed for them in a seeded random order), → `CLAIM_HOLD`. |
| `CLAIM_HOLD`   | 1.5 s  | A pause for the claim animation, then the check again.                                                                                                                                                                                            |
| `OVER`         | —      | Everyone is placed.                                                                                                                                                                                                                               |

**Claiming:** the first valid claim takes the best free place. The claimer's set is
revealed to everyone and they **leave the circle** with their four slips, so the circle
shrinks 4 → 3 → 2 and passing re-routes around finished players. When only one player is
left they take the **last place** automatically. A lucky opening hand goes straight to a
claim window. With two players left, both always hold a full set at the same time — the
first to claim takes the better place.

**Safe auto-pick** (timeouts, and the bot's strategy): keep the item you hold most of,
pass one you hold fewest of; ties are broken by the seeded random generator.

**Safety cap:** after 100 passing cycles the match ends; remaining players are ranked by
their largest same-item group (seeded tie-break; every player gets a distinct place).

## What each player can see

| Information                | You                 | Everyone else                                  |
| -------------------------- | ------------------- | ---------------------------------------------- |
| Your slips' items          | always              | never — only four folded slips                 |
| Which slip you chose       | yes                 | only _that_ you chose (not which, not changes) |
| The item in a passing slip | sender, receiver    | never — a folded slip moving A → B             |
| Claim eligibility          | the eligible player | only "Someone has a full set!"                 |
| A finished player's set    | after the claim     | after the claim                                |

Slip **handles** are re-keyed every time a slip enters a hand, so nobody can follow a slip
around the table, and an action sent against an old hand fails (`ILLEGAL_ACTION`) instead of
choosing a different slip. Tests: a view-leak check on every step of 300 simulated matches
(other hands shuffled → your view must not change), an event-leak check, and an
over-the-wire check that no foreign handle ever reaches a player.

## Actions

- `{ type: 'SELECT', handle }` — only in `SELECTING`, only by an active player, only a slip
  in their own hand (`INVALID_PHASE`, `NOT_ELIGIBLE`, `ILLEGAL_ACTION`).
- `{ type: 'CLAIM' }` — only in `CLAIM_WINDOW` by an eligible player who has not claimed
  (`NOT_ELIGIBLE` otherwise; the button is never shown to anyone else).

Like every game action, each carries a unique `actionId`: a double tap or replay can never
claim twice (`DUPLICATE_ACTION`).

## Events (for animation)

`DEALT` (private) · `SEAT_SELECTED` (public, first choice only) · `MY_SELECTION` (private,
incl. `auto`) · `PASS_RESOLVED` (public: seats only) · `CHIT_SENT` (sender) ·
`CHIT_RECEIVED` (receiver: new handle + item) · `CLAIM_WINDOW_OPENED` (public) ·
`YOU_CAN_CLAIM` (private) · `CLAIM_ACCEPTED` (public: seat, place, set, reason) ·
`CIRCLE_CHANGED` · `MATCH_OVER`.

## Idle players and bots

- **3 consecutive auto-picks** → the seat is handed to a bot; the player sees "A bot is
  playing for you" and can tap "I'm back" (reclaim is immediate).
- Disconnected players keep their seat for 30 s, then a bot plays until they return.
- **The bot** ("Normal") chooses with the safe auto-pick after 0.8–2.5 s and claims a full
  set after 0.8–2.5 s (so humans can win claim races). It sees only its own hand — exactly
  the view a human in its seat gets — and never chats or reacts.

## Quick reactions

During the match every player (finished ones too) can send one of eight emotes
(😂 😱 😤 🙏 👏 🔥 😭 🤫); it pops over their seat on every screen. One per 1.5 s, only
ever sent by a person, hidden for players who muted or reported the sender. See
[CHAT_AND_MODERATION.md](../CHAT_AND_MODERATION.md#quick-reactions).

## On screen

- A wooden school desk; you sit at the bottom; a faint clockwise ring shows who passes to
  whom and re-routes as players finish.
- Your hand: four open paper slips, grouped by item with a ×N badge. Tap one: it folds and
  slides into the pass spot (inside the countdown ring); tap another to swap.
- Passing: folded slips fly to the next seat together; yours arrives folded and unfolds
  (glowing if it joins your biggest group).
- Claim: a big pulsing **CLAIM!** button and a short buzz on phones that support it (not in
  reduced motion); the set is revealed at the seat with a medal; the seat dims.
- Effects modes: **full** (curved, fluttering flights, springs, podium confetti), **lite**
  (straight, shorter, no confetti), **reduced** (instant, no flights).
- Results: the platform podium, placements 1st–4th.
