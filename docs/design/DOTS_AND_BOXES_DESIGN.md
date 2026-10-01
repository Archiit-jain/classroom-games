# Dots & Boxes — design verification

**Status:** design only (not implemented). Proposed phase: 6. Game id: `dots-and-boxes`.
Built on the existing `GameModule` / server-authoritative runtime (`sync: 'TURN_PHASE'`); no
new networking.

> **Decision status.** **Binding** (product-owner brief, 2026-10-01): 2–4 players;
> server-authoritative turns; draw one edge at a time; completing a box claims it and gives
> another turn; the game ends when all boxes are claimed; most boxes wins; configurable grid
> sizes such as 4×4, 5×5 and 7×7. **Everything else** — exact numbers, timers, defaults,
> public-match settings, bot behaviour, UI and animation choices — is a **developer proposal**
> (marked _(proposed)_ or listed in §10) awaiting owner sign-off, not a frozen decision.
> **Implementation blockers:** none. **Launch blockers:** none for this game.

## 1. Proposed rules

| Topic      | Rule                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Players    | 2–4 (humans and/or bots). Public target 4, minHumans 2 _(proposed)_. Reclaim IMMEDIATE.                                                          |
| Grid       | Host setting, counted in **boxes** _(proposed)_: 4×4, **5×5 (default, proposed)**, 7×7 → (n+1)×(n+1) dots, 2n(n+1) edges (40 / 60 / 112).        |
| Start      | Seat order; the first player is picked by the seeded RNG.                                                                                        |
| Move       | The current player draws **one** undrawn edge between two adjacent dots.                                                                         |
| Box        | An edge that completes one box (or two at once) gives those boxes to the mover, who **moves again**. Otherwise the turn passes to the next seat. |
| End        | When every box is claimed (= every edge is drawn).                                                                                               |
| Result     | Most boxes wins; equal counts share a place (1, 1, 3) _(proposed, as in RMCS)_. Results column: **Boxes**.                                       |
| Turn timer | 20 s per move _(proposed)_; extra moves get a fresh timer. Timeout → the server makes the bot's choice for the player.                           |
| Idle       | 3 consecutive timed-out moves → `MARK_IDLE` → bot takes the seat _(proposed, same as 16 Parchi / Pen Fight)_.                                    |

No hidden information: every player sees the whole board.

## 2. State machine

```text
TURN(seat, deadline) ──DRAW edge──▶ completes box(es)? ─yes─▶ TURN(same seat)
       │                                         └─no──▶ TURN(next seat)
       └─timeout──▶ server draws the bot's edge (same as above)
all boxes claimed ─▶ OVER
```

One engine timer (`turn`). The next turn's deadline includes a short animation allowance
(400 ms _(proposed)_) so the line/box animation is not eaten by the timer (spec §15).

## 3. Engine contract

- **State:** `n`, `edges` (`h[r][c]`, `v[r][c]` → drawing seat or null), `boxes[r][c]` → owner
  or null, `turn`, `deadline`, `timeouts`, `lastEdge`.
- **Action:** `{ type: 'DRAW', o: 'h' | 'v', r, c }` — rejected unless it is your turn
  (`NOT_YOUR_TURN`), in bounds and undrawn (`ILLEGAL_ACTION`). Unique `actionId` as always.
- **Events:** `EDGE_DRAWN {o, r, c, seat, auto}` · `BOXES_CLAIMED {seat, boxes}` ·
  `TURN_STARTED {seat, deadline, again}` · `MATCH_OVER {boxes}` (all public).
- **Settings:** `{ grid: 4 | 5 | 7 }`.
- **Results:** placements by boxes + `stats.boxes`.

## 4. Bot ("Normal") _(proposed)_

1. Take any edge that completes a box (keep going while it can).
2. Otherwise draw a **safe** edge — one that does not give any box its third side — at random.
3. Otherwise give away the **smallest** chain (fewest boxes the next player can take).

No "double-dealing" (that would be a Hard bot; difficulty levels are excluded from v1).
Delays: 0.8–2.5 s for a fresh turn, 0.4–0.9 s for an extra move inside a chain _(proposed)_,
so long chains don't drag. The same function is the timeout move.

## 5. Phone and desktop UI _(proposed)_

- A sheet of **graph paper** on the desk; dots as pencil dots. The grid scales to the width
  (7×7 on a 360 px phone ≈ 41 px between dots).
- Each edge has an invisible hit area the full edge length × 28 px. On touch screens with
  the 7×7 grid, a **two-tap confirm** (tap highlights the edge, tap again draws) prevents
  mis-taps; 4×4/5×5 draw on the first tap.
- Score chips (avatar, colour, box count) across the top; the active player's chip has a
  countdown ring; an **"Again!"** badge on extra turns.
- Desktop: same sheet larger; hover previews the edge in your colour.

## 6. Animation (Color Burst Arcade) _(proposed timings)_

| Moment      | Full                                                         | Lite             | Reduced |
| ----------- | ------------------------------------------------------------ | ---------------- | ------- |
| Line drawn  | Pencil stroke draws from dot to dot (250 ms), slight wobble  | 120 ms, straight | instant |
| Box claimed | Ink fills the box in the player's colour + initial stamp pop | fade fill        | instant |
| Chain       | Boxes fill in sequence (80 ms stagger), score chip bounces   | no stagger       | instant |
| Score       | Rolling number; leader chip gets a crown                     | same, no bounce  | instant |
| Match end   | Platform podium (+ confetti in full)                         | podium           | podium  |

## 7. Content and licensing

Dots & Boxes is a traditional public-domain pencil game (described by Édouard Lucas, 1889);
the name is generic. All visuals are original. Nothing to license.

## 8. Testing

Engine: edge validation, single/double box completion and extra turns, turn passing, end
and ties, timeout move = bot move, idle after 3, invariants (a box is owned iff its four
edges are drawn; owned boxes ≤ n²; drawn edges ≤ 2n(n+1)). Fuzz: 300 seeded bot matches per
grid × player count. Real sockets: full 2-human + bot match, out-of-turn and duplicate
draws. Playwright: desktop + Pixel 7 match on 5×5, two-tap confirm on 7×7.

## 9. Risks

Tap precision on 7×7 phones (mitigated by hit areas + two-tap confirm); a 2-player 7×7
match is ~112 moves (≈ 5–6 min, acceptable); long bot chains (short in-chain delays).

## 10. Decisions and open points

**Implementation blockers:** none. **Launch blockers:** none. **Proposed — awaiting owner
sign-off (non-blocking):** grid sizes are counted in boxes;
default 5×5; 20 s turn timer; idle after 3 timeouts; two-tap confirm only on 7×7 touch.
