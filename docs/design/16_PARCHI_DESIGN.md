# 16 Parchi — Phase 3 design verification

Written before implementation (Phase 3) to check that the frozen rules (spec §11), the
platform (spec §8 reactions, §14 bots, §15 sync, §16 testing) and the Color Burst Arcade
design fit together. The rules themselves live in
[GAME_RULES/16_PARCHI.md](../GAME_RULES/16_PARCHI.md); this document records how the
experience is built and the few derived decisions the spec leaves open.

## 1. Player storyboard

| #   | Moment             | What the player sees (phone first)                                                                                                                                                                                                                                                                                                  |
| --- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Category           | Host picks a category in the room lobby (default **Random**); a preview row shows the four item icons (or four "?" slips for Random). Guests see the choice read-only.                                                                                                                                                              |
| 2   | Start              | Platform countdown (3 s) → the board fades in: green felt desk, you at the bottom, the three others around, a faint clockwise ring in the middle.                                                                                                                                                                                   |
| 3   | Deal (2 s)         | Sixteen slips leave the centre in four waves of four (one per seat per wave). Yours land open in a fan and auto-group by item; opponents' land folded.                                                                                                                                                                              |
| 4   | Lucky hand?        | If anyone was dealt four of a kind, the claim window opens at once (step 8).                                                                                                                                                                                                                                                        |
| 5   | Select (10 s)      | "Pick a slip to pass →". Tap a slip: it lifts, folds shut and slides to the pass spot on your left; a countdown ring circles the pass spot (pulses in the last 3 s). Tap another slip to swap. Opponents' "selected" slip lifts slightly — nothing else is shown.                                                                   |
| 6   | Pass (1.2 s hold)  | Everyone's folded slip flies simultaneously along a curved path to the next player clockwise (to your screen-left). One slip arrives at your hand from the right, lands folded, then unfolds; a private glow if it matches your biggest group.                                                                                      |
| 7   | Repeat             | Steps 5–6 repeat. A slim pass counter shows "Pass 7". If you never choose, the server passes your fewest-held item for you (and after 3 such auto-picks in a row a bot takes over — the platform's "I'm back" banner lets you reclaim).                                                                                             |
| 8   | Claim window (6 s) | Passing pauses. **Eligible:** your four slips glow, a big pulsing **CLAIM!** button appears above the hand (+ a short haptic buzz on phones that support it, not in reduced motion). **Everyone else:** "Someone has a full set!" — no hint who.                                                                                    |
| 9   | Claim              | First valid claim takes the next place. The claimer's four slips snap together and slam onto the desk; a medal (1st/2nd/3rd) pops at the seat; others see the set flip face up at that seat; the seat dims and the pass arrows re-route around it. Unclaimed eligible players are auto-claimed (seeded order) when the window ends. |
| 10  | Shrink             | The circle shrinks 4 → 3 → 2. Finished players keep watching (and reacting) from their dimmed seat with their medal.                                                                                                                                                                                                                |
| 11  | Last place         | When one player remains they take the last place automatically.                                                                                                                                                                                                                                                                     |
| 12  | Podium             | The platform results screen: podium 1st–4th; confetti in **full** effects only (none in lite or reduced, spec §11).                                                                                                                                                                                                                 |
| —   | React              | Any time during the match: tap 😊 → a tray of 8 emotes; the bubble pops over your seat on every screen. 1 per 1.5 s; bots never react.                                                                                                                                                                                              |

## 2. Interaction model (server-authoritative)

| Interaction | Client                                                                                                        | Server (engine)                                                                                                                                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Select      | Tap a slip → immediate "pressed" lift (local only) → `SELECT {handle}` with a unique `actionId`.              | Valid only in SELECTING, for an active seat, for a handle in that seat's hand. Re-selecting swaps. `MY_SELECTION` (private); `SEAT_SELECTED` (public) only on the **first** selection, so changing your mind is invisible to others. |
| Fold        | Played on the confirmed `MY_SELECTION` event (never before the server agrees).                                | —                                                                                                                                                                                                                                    |
| Settle      | —                                                                                                             | When every active player has selected, the phase ends 300 ms later (changes still allowed during those 300 ms).                                                                                                                      |
| Timeout     | —                                                                                                             | Missing players get the safe auto-pick; `MY_SELECTION {auto, item}` tells them which of their own slips went.                                                                                                                        |
| Pass        | `PASS_RESOLVED` drives the flights; `CHIT_SENT` / `CHIT_RECEIVED` drive your own slip out and the new one in. | All selected slips move one step clockwise among **active** seats at once. The receiver gets a **new handle**.                                                                                                                       |
| Unfold      | The received slip lands folded, then unfolds.                                                                 | —                                                                                                                                                                                                                                    |
| Claim       | CLAIM button only when `view.canClaim`. Tap → `CLAIM` (actionId protects double taps).                        | Valid only in CLAIM_WINDOW for an eligible, unclaimed seat; anything else → `NOT_ELIGIBLE`. Claims are ranked by arrival in the match's single transition queue.                                                                     |
| Shrink      | `CIRCLE_CHANGED` re-routes the arrows; the finished seat dims.                                                | The claimer leaves the circle with their four slips; passing skips them.                                                                                                                                                             |

Handles: every time a slip enters a hand it gets a fresh random handle (from the match's
seeded RNG), so nobody can follow a slip around the table, and an action sent against an
old hand fails cleanly (`ILLEGAL_ACTION`) instead of selecting a different slip.

## 3. Categories (initial content pack)

Ten categories × four items. Every item has an id, an English label, a colour and an
**original inline SVG icon drawn for this project** (no emoji fonts, no clip-art packs,
no brands or logos — spec §11).

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

Content rules (enforced by tests): exactly four items per category; unique ids; four
**distinct colours and silhouettes** inside a category (an item is never identified by
colour alone — icon and label always shown); every label passes the chat moderator; no
religious, political, national or brand symbols; vegetarian food only. Language-neutral
ids/colours live in `src/shared/categories.ts`; English labels in `content/en/` (ready for
translation, spec §3). Licensing: icons are original work under the project licence — no
third-party assets, nothing to add to CREDITS.

## 4. Layout

**Phone (portrait, 360–430 px):** compact status strip (category chip + "Pass N"); the
table (three opponent seats on top/left/right as compact badges with four mini folded
slips; the desk in the middle with the clockwise ring, pass spot and countdown); your
hand below the table: four open slips in a loose fan, each ≥ 56 × 76 px; the CLAIM button
is sticky above the hand; a **React** toggle below the hand opens the eight-emote tray.
Chat stays below the board (platform).

**Desktop (≥ 700 px):** the same structure scaled up (slips ~96 × 128 px, larger seats);
the eight reactions are always visible as a row under the hand (no toggle).

Directions are identical on every screen: you are at the bottom, **pass to your
screen-left, receive from your screen-right** (seat + 1 is drawn left, + 2 top, + 3 right).

## 5. Animation choreography (Color Burst Arcade)

| Event / moment           | Full                                                    | Lite                     | Reduced            |
| ------------------------ | ------------------------------------------------------- | ------------------------ | ------------------ |
| Deal (`DEALT`)           | 4 waves × 4 slips from the centre, 1.2 s, springy       | 4 waves, straight, 0.5 s | instant            |
| Select (`MY_SELECTION`)  | lift → fold (rotateX) → slide to pass spot, 0.35 s      | 0.2 s, no fold flip      | instant swap       |
| Others select            | their slip lifts 6 px, 0.2 s                            | same, 0.12 s             | instant            |
| Pass (`PASS_RESOLVED`)   | curved flights + flutter/rotation, 0.8 s, ≤ 4 slips     | straight slides, 0.5 s   | crossfade          |
| Receive                  | lands folded, unfolds 0.35 s; match glow                | 0.2 s                    | instant            |
| Claim window             | CLAIM button pops + pulses; hand glow; haptic           | pop, no pulse            | appears; no haptic |
| Claim (`CLAIM_ACCEPTED`) | snap + slam, medal spring-pop, set flips face up, 1.4 s | 0.7 s                    | instant            |
| Circle shrink            | seat dims, arrows re-route, 0.4 s                       | 0.25 s                   | instant            |
| Podium                   | platform podium + confetti                              | podium, no confetti      | podium, no motion  |

Server holds (deal 2 s, pass 1.2 s, claim hold 1.5 s) are longer than the full-mode
animations, so the animation director (ADR-016) never has to skip at normal speed. Only
transform/opacity are animated. Shared primitives used: `Avatar`, `CountdownRing`,
`Stamp`, `ConfettiBurst` (platform), `durationFor`/`useEffects`; new shared primitive
`ReactionBubble` in `@cg/ui`.

## 6. Bot behaviour and hidden information

- **Select:** the spec's safe auto-pick — keep the item you hold most of, pass from the
  item you hold fewest of, ties by RNG — after 0.8–2.5 s.
- **Claim:** when `canClaim`, after 0.8–2.5 s (so humans can win claim races).
- Bots decide from their own seat's filtered view only (no memory); they never chat or react.
- **Visibility (spec §11):** your hand items — only you; your selection — others only see
  _that_ you selected; a passing slip's item — only sender (who already knew it) and
  receiver; claim eligibility — only the eligible player (others: "Someone has a full
  set!"); a finished set — public after the claim. Public events (`PASS_RESOLVED`,
  `CLAIM_WINDOW_OPENED`, `SEAT_SELECTED`, `CIRCLE_CHANGED`) carry no items.

## 7. Testing strategy

| Level            | What                                                                                                                                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine unit      | deal (16 chits, 4 × 4, 4 each), lucky opening hand, select/swap, settle, auto-pick rule and ties, clockwise passing skipping finished seats, claim race order, false claims, timeout auto-claims, last place, idle after 3 auto-picks (+ resets), 100-cycle cap ranking, results.   |
| Invariants       | on every transition: each active hand has 4; items in play = 4 copies each of the remaining items; finished sets are four of a kind; placements unique and contiguous.                                                                                                              |
| Fuzz + leak      | 300 seeded bot-only matches through the SDK harness with the invariant and the **view leak checker** (other players' items shuffled → your view must not change); termination.                                                                                                      |
| Event leak       | every event each seat receives is checked against what that seat may know; handles never repeat across seats.                                                                                                                                                                       |
| Real Socket.IO   | full match 2 humans + 2 bots; over-the-wire leak scan; **simultaneous claims** from two sockets on a rigged deal (one gets 1st, the other 2nd, everyone sees the same order); duplicate/false claims; idle takeover; reactions (fan-out, rate limit, validation, bots never react). |
| E2E (Playwright) | 2 humans + 2 bots play a full match by tapping slips and claiming, see the podium, and exchange a quick reaction — desktop and Pixel 7 (`@mobile`); plus a reduced-motion run.                                                                                                      |

## 8. Ambiguities

**None blocking.** Derived decisions (consistent with the spec, recorded in ADR-017/018):

1. **Claim window closes early** once every eligible player has claimed (otherwise it
   waits the full 6 s). Passing is paused during the window, so this reveals nothing
   anyone can act on.
2. **Claim hold:** 1.5 s after the window closes before selecting resumes, so the claim
   animation is not eaten by the next selection timer (spec §15: phase holds account for
   animations).
3. **`SEAT_SELECTED` only on the first selection** of a cycle (changing your mind is private).
4. **Safety cap** is checked when the next selection would start; a claim window that is
   already due still runs first. Remaining players are ranked by their largest same-item
   group, seeded tie-break, distinct places.
5. **Quick reactions** are a platform feature (protocol + server + client) available while
   a match is running; boards that render seat bubbles opt in (16 Parchi now). A muted or
   reported player's reactions are hidden like their chat.
6. **Results** show placements only (spec: "no cumulative score").
