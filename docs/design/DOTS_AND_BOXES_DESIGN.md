# Dots & Boxes — Phase 6 design verification

**Status:** design pass, written **before** implementation (nothing of Dots & Boxes is built yet).
Game id: `dots-and-boxes`. Built on the existing `GameModule` / server-authoritative runtime
(`sync: 'TURN_PHASE'`); no new networking. Production deployment is designed separately in
[PRODUCTION_ARCHITECTURE.md](PRODUCTION_ARCHITECTURE.md).

> **Decision status.** **Binding (product owner, Phase 6 brief):** traditional rules — 2–4
> players, draw one available edge, completing a box claims it and grants another turn,
> otherwise the turn passes, the game ends when all boxes are claimed, most boxes wins, exact
> ties share placement; grids 4×4, **5×5 (default)** and 7×7; no artificial turn timer; no
> two-tap confirmation unless testing shows it is needed; one bot level. **Developer
> proposals** are marked _(proposed)_; every number is a play-test value. **Implementation
> blockers:** none.
>
> **Changes from the earlier roadmap draft:** the 20 s turn timer and the 7×7 two-tap confirm
> are dropped (owner brief); idle handling is a long inactivity timer only (§9).

## 1. Player experience

| #   | Moment            | What players see                                                                                                                                                                                                                                                             |
| --- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Room              | Dots & Boxes card (2–4 players). The host picks the grid (4×4 · **5×5** · 7×7) with a small preview of the dot grid; guests see it read-only. Add bots, Start.                                                                                                               |
| 2   | Seating           | A sheet of squared notebook paper on a whiteboard-white desk. Each player gets a marker colour (their seat accent) shown on their score chip. The dots pop in row by row; the first player (seeded) gets a "You start!" / "Priya starts" banner.                             |
| 3   | Turn              | The active chip glows and lifts; a marker cap icon sits on it. On your turn the paper's edge glows softly in your colour and the status line says "Your move". Others see "Priya's move".                                                                                    |
| 4   | Line selection    | Touch (or hover) near any free gap between two dots: the nearest free edge previews as a faint line in your colour. Lift (or click) to draw it. Drawn edges can't be selected; the preview simply skips them.                                                                |
| 5   | Line drawn        | A marker stroke draws from dot to dot with a slight hand-drawn wobble; the last edge stays highlighted for everyone so nobody misses a move.                                                                                                                                 |
| 6   | Box completion    | The box fills with the player's colour (ink spreading from the closing edge), their initial stamps in the middle, a "+1" floats to their chip and the score rolls up.                                                                                                        |
| 7   | Extra turn        | "Again!" badge on the chip; the turn indicator stays. In a chain the badge counts up: "Chain ×3!". Two boxes closed by one line → "Double!".                                                                                                                                 |
| 8   | Turn passes       | The indicator slides to the next chip.                                                                                                                                                                                                                                       |
| 9   | Round progression | No rounds: one board per match. A thin progress bar under the chips shows boxes claimed / total.                                                                                                                                                                             |
| 10  | Final box         | The last box fills, then a **final-board reveal**: the grid lines fade back, each player's territory brightens in turn with their count, and the winner's colour washes over their boxes. Then the platform podium (most boxes wins; ties share). Results column: **Boxes**. |

## 2. Exact rules and geometry

- **Players:** 2–4, humans and/or bots. Public target 4, minHumans 2 _(proposed, for Phase 9)_.
  Reclaim **IMMEDIATE**.
- **Grid setting** `{ grid: 4 | 5 | 7 }`, counted in **boxes per side**. For _n_:

  | Grid *n*×*n*  | Dots     | Horizontal edges | Vertical edges  | Edges `2n(n+1)` | Boxes `n²` |
  | ------------- | -------- | ---------------- | --------------- | --------------- | ---------- |
  | 4×4           | 5×5 = 25 | 5 rows × 4 = 20  | 4 rows × 5 = 20 | **40**          | **16**     |
  | 5×5 (default) | 6×6 = 36 | 6 × 5 = 30       | 5 × 6 = 30      | **60**          | **25**     |
  | 7×7           | 8×8 = 64 | 8 × 7 = 56       | 7 × 8 = 56      | **112**         | **49**     |

- **Edge ids:** horizontal `h:r:c` joins dots (r, c)–(r, c+1), 0 ≤ r ≤ n, 0 ≤ c < n; vertical
  `v:r:c` joins (r, c)–(r+1, c), 0 ≤ r < n, 0 ≤ c ≤ n. Box (r, c) (0 ≤ r, c < n) has sides
  `h:r:c`, `h:r+1:c`, `v:r:c`, `v:r:c+1`. Each edge borders one box (outer) or two (inner).
- **First player:** chosen by the match's seeded RNG; play continues in seat order (skipping no
  one — seats never leave; a bot plays for a departed human).
- **A move:** the current player draws exactly one undrawn edge.
- **Completion:** every box whose four sides are now drawn — one or two, since an edge borders at
  most two boxes — is claimed by the mover. Claiming at least one box ⇒ the **same player moves
  again**; otherwise the turn passes to the next seat.
- **End:** when every box is claimed (equivalently every edge is drawn); the last move always
  completes a box.
- **Result:** placements by boxes, standard competition ranking (equal counts share a place:
  1, 1, 3). Results stats: `boxes`.
- **No hidden information:** everyone sees the whole board, every view is identical.

## 3. Engine and server authority

- **State:** `n`, `edges: Record<edgeId, seat | null>` (stored as two flat arrays), `boxes: (seat |
null)[]`, `seats`, `turn` (seat), `moves` (count), `chain` (boxes claimed in the current
  uninterrupted streak), `lastMove`, `scores`, `phase: 'PLAYING' | 'OVER'`, `idleAt`.
- **Action:** `{ type: 'DRAW', edge: 'h:r:c' | 'v:r:c' }` (zod: strict, pattern + bounds). The
  server decides **everything** else: `NOT_YOUR_TURN` unless the sender is `turn`;
  `ILLEGAL_ACTION` for out-of-range or already-drawn edges; `INVALID_PHASE` after the end. The
  client never sends box claims or scores — there is no field for it, and any extra field is
  rejected by the strict schema.
- **Transition:** set the edge; compute completed boxes from the four-sides rule; award them;
  keep or pass the turn; end when all boxes are owned.
- **Events (public):** `EDGE_DRAWN {edge, seat}` · `BOXES_CLAIMED {seat, boxes, chain}` ·
  `TURN {seat, again}` · `MATCH_OVER {scores}`.
- **Existing protections unchanged:** unique `actionId` per intent (`DUPLICATE_ACTION`),
  never-issued versions rejected (`STALE_VERSION`), legality always checked against the current
  state (two taps on the same edge: the second is `ILLEGAL_ACTION` or `DUPLICATE_ACTION`).

## 4. Phone interaction (critical)

**Problem:** a drawn line is a few pixels; a 7×7 board on a 360 px phone has ~42 px between
dots.

**Interaction: "touch to preview, lift to draw"** _(proposed)_ — one gesture, no double tap:

1. **Nearest free edge.** On touch, the board converts the point to grid units and picks the
   **closest undrawn edge** (distance from the point to the edge segment). Every free edge
   therefore owns a generous invisible area — the whole triangle between it and the two
   neighbouring box centres (≈ half a cell deep on each side, ~21 px on 7×7, ~32 px on 5×5).
   Drawn edges are simply not candidates, so a touch near a drawn line selects the nearest
   _free_ one or nothing.
2. **Preview while touching.** The chosen edge shows immediately as a thick line in your colour
   (with both end dots enlarged). Sliding the finger moves the preview to whichever free edge is
   now nearest — you can correct before lifting.
3. **Lift to draw.** Releasing draws the previewed edge (one `DRAW` action).
4. **Ambiguity guard.** When the two nearest free edges are almost equally close (within 15 % of
   a cell — e.g. a touch right at a box centre or a dot), there is **no preview**, and lifting
   does nothing; the hint says "Touch nearer a line". This is what prevents accidental
   adjacent-edge selection, without a confirmation step.
5. **Cancel.** Sliding off the paper, or lifting with no preview, draws nothing.
6. **Not your turn:** touching previews nothing; the status line already says whose move it is.
7. **Feedback after drawing:** the stroke animates (§6); a light haptic tick (not in reduced
   motion); while the server confirms, the line shows at once (optimistic, in a pending style)
   and turns solid on the update — if the server rejects it (someone else's turn after a
   reconnect, already drawn), the pending line disappears and a toast explains.

**Why no two-tap confirm:** the preview already shows exactly what will be drawn before the
finger lifts, and the ambiguity guard removes the risky middle zone. Two taps would double the
taps of a 112-edge game. If the Playwright/visual review or the owner's phone test shows
mis-draws on 7×7, a confirm can be added for 7×7 only.

**Layouts:**

- **Portrait phone:** chips row (wrapping 2×2 for four players) and progress bar on top; the
  square paper fills the width (16 px gutters → 7×7 ≈ 46 px/cell on a 412 px Pixel 7, ≈ 41 px on
  360 px); status line under it; quick reactions below.
- **Landscape phone:** the paper sizes to the height (square), chips in a column beside it.
- **7×7 on small phones:** dots 6 px, lines 4 px drawn / 8 px preview; hit areas as above; no zoom
  needed (verified on a 360 px viewport in e2e).

## 5. Desktop interaction

- **Mouse:** hovering shows the same nearest-free-edge preview (with the ambiguity guard);
  click draws. The cursor is a pointer only over the paper on your turn.
- **Keyboard** _(proposed, light)_: the paper is focusable on your turn; arrow keys move an
  **edge cursor** to the next free edge in that direction (starting near the last move), Enter
  or Space draws it, the cursor edge is shown as the preview and announced ("Top side of box
  row 2, column 3"). Nothing else.

## 6. Visual identity and animation (Color Burst Arcade)

**Look:** a whiteboard-white desk with a sheet of squared notebook paper (faint blue grid,
the red margin line); pencil-grey dots; each player's lines in their **marker colour** (seat
accent, deepened for contrast on white); claimed boxes filled with a translucent wash of that
colour plus the player's initial in a rounded "stamp". Chips match the existing sticker style.
Grown-up, clean; no cartoon characters.

| Moment             | Full                                                                                                           | Lite                         | Reduced                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------ |
| Dots appear        | Pop in row by row (20 ms stagger)                                                                              | Fade in                      | Shown                                      |
| Line drawn         | Marker stroke draws dot→dot in 220 ms with a 1–2 px wobble; end dots pulse                                     | 120 ms straight stroke       | Appears at once (solid)                    |
| Last move          | Stays highlighted (thicker, soft glow) until the next move                                                     | Thicker                      | Thicker + small marker dot                 |
| Box claimed        | Ink spreads from the closing edge (300 ms), initial stamps in with a spring; "+1" floats to the chip           | Fill fades in, stamp appears | Fill + stamp appear at once                |
| Chain              | Boxes fill in sequence (90 ms stagger); "Chain ×N!" badge bumps                                                | No stagger; badge            | Badge text only                            |
| Score              | Rolling number; chip bounce; leader gets a small crown                                                         | Rolling number               | Number changes                             |
| Turn change        | Indicator slides between chips; your-turn paper glow                                                           | Indicator moves              | Indicator jumps; "Your move" text          |
| Final-board reveal | Grid fades back, each territory brightens in turn with its count, winner's colour wash, then podium + confetti | Territories shown, podium    | Final board + counts, podium (no confetti) |

**Reduced motion** removes only decoration; the board state (every line, box, owner, score,
whose turn) is always fully visible and instant. Animation durations are short so the
animation director never makes a real-time wait: the next player can move as soon as the
update arrives (their own line animates locally).

## 7. Bot ("Normal", one level)

Uses only the public view, through the same validation path as humans (`submitAction`).

1. **Capture:** if any edge completes a box, draw it (prefer the one completing two). Keep going
   on the extra turn — the bot always takes available boxes.
2. **Safe move:** otherwise, among edges that do **not** give any box its third side, pick one at
   random (preferring edges that touch fewer drawn sides).
3. **Chains (no safe move left):** split the remaining boxes into **chains and loops** (boxes with
   two or more sides drawn, connected through undrawn shared sides). Give the opponent the
   **smallest** chain/loop by drawing an edge inside it — a chain of 1–2 before longer ones.
4. **Mistakes (beatable):** when safe moves are scarce (≤ 4 left), with 15 % probability it plays a
   random unsafe edge instead (misjudging the board); in the chain phase, with 20 % probability it
   gives a random chain instead of the smallest. It never skips an available capture.
5. **No double-dealing** (the expert sacrifice of the last two boxes of a chain) — that belongs to
   a harder level, out of scope for v1.
6. **Timing:** 0.7–1.6 s to think on a fresh turn; 0.35–0.7 s per extra move inside a chain, so
   long chains feel quick but readable _(proposed)_.

## 8. Settings

Host setting: `grid` 4 | **5** | 7. Nothing else in v1.

## 9. Timing — only what is needed

- **No turn timer** and no visible countdown.
- **Disconnected player:** the platform's reconnect grace (30 s) → a bot plays the seat;
  reconnecting reclaims it at once (IMMEDIATE).
- **Connected but idle (AFK):** one engine timer, reset on every move: if the player whose turn it
  is does nothing for **90 s** _(proposed)_, the engine asks the platform to `MARK_IDLE` → a bot
  plays for them with the "I'm back" banner. At 60 s their screen shows a gentle "Still there? It's
  your move" nudge. This only exists so a match cannot stall forever.
- **Bots:** their think delays above.
- No round/phase timers: a match is just the board.

## 10. Security and protocol checks (each with a test)

| Case                                      | Expected                                                            |
| ----------------------------------------- | ------------------------------------------------------------------- |
| Edge out of range / malformed id          | `INVALID_PAYLOAD` (schema) or `ILLEGAL_ACTION` (bounds)             |
| Already-drawn edge                        | `ILLEGAL_ACTION`, state unchanged                                   |
| Same action id twice (double tap, replay) | `DUPLICATE_ACTION`; executed once                                   |
| Never-issued version                      | `STALE_VERSION`; id not consumed                                    |
| Old (issued) version, still legal         | Accepted (ADR-014)                                                  |
| Wrong player                              | `NOT_YOUR_TURN`                                                     |
| Seat controlled by a bot                  | `SEAT_CONTROLLED_BY_BOT`                                            |
| Action after the end                      | `INVALID_PHASE` / `MATCH_NOT_FOUND`                                 |
| Forged box claim / score / extra fields   | Rejected by the strict schema (`INVALID_PAYLOAD`); nothing to forge |
| Flood                                     | `matchAction` rate bucket (`RATE_LIMITED`)                          |

## 11. Production compatibility

Nothing in Dots & Boxes is instance-specific: its whole state is a small JSON object (≤ ~1 KB
for 7×7), well suited to the room snapshots of the production design. Phase 6 delivers the game
plus the deployment path in [PRODUCTION_ARCHITECTURE.md](PRODUCTION_ARCHITECTURE.md), including
a smoke test: build → deploy → open the URL → two browsers create/join a room → play Dots &
Boxes.

## 12. Testing

- **Engine:** edge-id generation and counts per grid (40/60/112 edges, 16/25/49 boxes), box sides,
  single and double completion, extra turn vs passing, chain counter, end detection, scores,
  placements and ties, strict schema, every case in §10, idle timer and `MARK_IDLE`, invariants (a
  box is owned iff its four sides are drawn; owned boxes ≤ n²; score sum = owned boxes).
- **Bot:** always captures, never leaves an available box, prefers safe edges, gives the smallest
  chain most of the time, mistake rates within tolerance over seeds; seeded bot-vs-bot matches on
  every grid and player count with the harness (termination, invariants, leak checker).
- **Client:** nearest-edge picking and the ambiguity guard (pure function), edge cursor.
- **Sockets:** full match with humans and bots; duplicate/stale/wrong-turn/after-end/forged
  payloads over the wire; reconnect mid-match; idle → bot → reclaim.
- **Playwright:** desktop (mouse) and Pixel 7 (touch) matches on 5×5 to the results; 7×7 on a
  360 px viewport; reduced motion; repeated runs for flakiness.
- **Production smoke test:** the same two-browser match against the deployed preview URL.

## 13. Risks

- 7×7 touch precision → hit-area geometry + preview + ambiguity guard, measured in e2e on a
  360 px viewport; fallback: confirm on 7×7 only.
- A 4-player 7×7 match is ~112 moves (~5–8 min) — fine for the classroom format.
- Chain explanation for beginners → the "Chain ×N!" feedback teaches it by example.

## 14. Decisions and open points

**Genuinely blocking ambiguities:** none for the game.

**Decided independently** (for sign-off): touch-to-preview / lift-to-draw with an ambiguity
guard instead of two taps; optimistic pending line; 90 s AFK timer with a 60 s nudge and no turn
timer; seeded first player; bot rules and mistake rates (§7); keyboard edge cursor; the whiteboard

- squared-paper look; results stat "Boxes".

**Proposed tunables:** AFK 90 s / nudge 60 s; ambiguity margin 15 % of a cell; bot think 0.7–1.6 s
(chain 0.35–0.7 s); bot mistake rates 15 % / 20 %; animation timings in §6; public target 4 /
minHumans 2 (Phase 9).
