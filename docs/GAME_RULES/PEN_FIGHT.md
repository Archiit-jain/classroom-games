# Pen Fight — rules as implemented

Code: `games/pen-fight` (engine `src/server/engine.ts`, physics `src/server/physics.ts`,
shared desk/ranking/replay helpers `src/shared/table.ts`, board `src/client/Board.tsx`, aiming
`src/client/aim.ts`). Approved rules: [spec §13](../specs/PHASE_0_SPEC.md). Design:
[design/PEN_FIGHT_DESIGN.md](../design/PEN_FIGHT_DESIGN.md). This page describes exactly what
the code does. Values marked _(play-test)_ are measured starting points, not frozen rules.

## Players and setup

- **2–4 players**, one pen each (humans and/or bots). No host settings.
- A top-down desk, 10 × 7 units. Pens _(play-test: 2.0 × 0.16 units)_ start on symmetric
  spots (2: left/right; 3: a triangle; 4: the corners), each facing a random direction.
- **Turn order:** a seeded shuffle, fixed for the match.

## A turn

| Phase       | Length                | What happens                                                                                                                               |
| ----------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `AIMING`    | 15 s                  | Only the active player may flick. Everyone else sees "_name_ is aiming…" and the timer — never the aim. Timeout → the turn is **skipped**. |
| `PLAYBACK`  | replay length + 0.5 s | The server already simulated the whole shot; everyone watches the same replay.                                                             |
| `SHRINKING` | 1.5 s _(play-test)_   | Sudden death only, at the start of a round: the desk shrinks to the previewed edge.                                                        |

**The flick** `{anchor, angle, power}`: `anchor` is where on the pen it is hit (−1 = cap end … 1 =
tip end; off-centre hits spin the pen), `angle` the direction, `power` 0–1. The server checks
it is the active player's turn and the phase, then **clamps** (`anchor` to −1…1, `power` to
0.05…1), normalises the angle and rounds all three to 1e-4.

**Controls:** touch/click your pen — where you touch sets the spin point — drag back like a
slingshot and let go; the flick goes opposite to the drag, as hard as the drag is long (full
strength at 35 % of the desk's short side _(play-test)_). Releasing back near the pen cancels.
A **Spin** slider sets the spin point precisely. Keyboard: ←/→ aim (2°, Shift 10°), ↑/↓
strength, A/D spin, Enter flick, Esc reset. There is no predicted path.

## Physics (server only)

- Planck.js, top-down, no gravity. The desk's friction works like a real pen on wood
  (Coulomb friction): a sliding pen slows down at a constant rate until it stops
  _(play-test: 8 units/s², spin 26 rad/s²)_ — a smooth glide, not a jump and a creep.
  Pen–pen restitution 0.45, friction 0.25. A pen is one rigid body: a thin box
  with a round cap at each end.
- A full-power flick through the centre glides a lone pen **10 units** in about 1.6 s
  _(play-test)_; distance grows in proportion to strength.
- Fixed **60 Hz** steps until every pen rests or **8 s** have passed (then pens stop where
  they are).
- Positions are stored rounded (1/1000 unit, 1/10000 rad) — exactly what players receive — so a
  match replays exactly from its seed and actions.

## Elimination

- A pen is **out** when its **centre of mass** is strictly outside the desk — during a shot at
  the physics step it crosses the edge (it is removed and tips off the desk), or when the desk
  shrinks. A pen whose centre is exactly on the edge, or that only overhangs, stays.
- Knocking yourself off counts.
- After each turn: one pen left → it wins; none left → the last ones out are ranked by the
  tie-breaks below.

## Rounds and sudden death

- A **full round** = every pen alive at its start has had a turn (a skipped turn counts; a pen
  knocked out before its turn leaves the round).
- After **10 full rounds in a row without an elimination**, sudden death **arms for good**. The
  next round shows the smaller desk as a glowing dashed line ("Sudden death! The desk shrinks
  next round."); from the round after, at the start of every round the desk shrinks to the
  preview and the next one is previewed. Each step removes **6 % of the original width and
  height**; pens whose centre is outside are out. After 17 steps no desk is left, so every match
  ends.

## Ranking

- Last pen standing is 1st; the rest by **reverse elimination order**.
- Same shot → the pen that left at the **later physics step** ranks higher; same step → shared
  place. Same shrink → the pen **closer to the centre** ranks higher; equal → shared place.
- Results also show each player's **knockouts** (opponents their flicks pushed off).

## Bots

One level ("Normal"), using only the public table and the same physics as the real game:

1. 24 candidate shots: six per opponent (at its centre and both ends, at different strengths,
   some with spin), the rest random.
2. Simulate each (p50 ≈ 13 ms, p95 ≈ 17 ms for all 24 on a laptop), score it: +100 per opponent out, −250 if
   its own pen goes out, plus its own distance from the edge, minus the opponents' (in sudden
   death, measured against the previewed desk).
3. Usually play the best (60 %), sometimes the 2nd (30 %) or 3rd (10 %), with human-like error
   (±2.5° aim, ±5 % strength) — but the error never turns a safe shot into flicking itself off.
4. Think 0.8–2.5 s, always before the timer runs out.

## Idle, leaving and reconnecting

- **3 skipped turns in a row** → a bot plays the seat until "I'm back" (any flick resets the
  count). Taking a seat back is **immediate** (mid-aim you get the remaining time).
- A disconnected player's turns time out; after the 30 s grace (or leaving) a bot takes over.
- The shot is simulated in one step on the server, so a disconnect never interrupts physics; a
  player who reconnects mid-replay sees the result straight away.
- Everything is public; there is no hidden information.

## Reduced motion

The pens' movement is the game, so every replay plays in every effects mode. Reduced motion
only removes the decorations (motion ghosts, sparks, shake, the squash on the flicked pen, the
shrinking/fading fall) and animated banners.
