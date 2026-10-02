# Pen Fight — Phase 5 design verification

**Status:** design pass, written **before** implementation (nothing of Pen Fight is built yet).
Game id: `pen-fight`. Rules: [spec §13](../specs/PHASE_0_SPEC.md) (with §14 bots, §15
`SIMULATED` sync, §16 testing, §20.6–7 library and feel tuning, Appendix A tunables). This
document records how the spec is built on the existing platform and the choices it leaves
open.

> **Decision status.** **Binding (spec):** 2–4 players, one pen each; last pen standing wins,
> the others ranked by reverse elimination order; seeded turn order; 15 s aiming, timeout →
> turn skipped; `flick {anchor, angle, power}` validated and clamped; Planck.js on the server
> only, fixed 60 Hz steps until everything sleeps (cap 8 s); elimination when a pen's centre
> of mass leaves the desk; keyframes inside one `shotPlayed` event; sudden death after 10
> full rounds without an elimination, the desk shrinking 6 % of its original size per round
> with a one-round preview; tie-breaks; idle after 3 skipped turns; everything public; bot
> with up to 24 candidate shots in a 20 ms budget; reclaim `IMMEDIATE`; public target 4 /
> minHumans 2. **Developer proposals** are marked _(proposed)_ — physics constants in
> particular need the owner's play-test on a real phone (spec §20.7).
> **Implementation blockers:** none (§14).

## 0. Feasibility spike (done before writing this)

A throwaway benchmark (scratchpad only, not in the repo) with `planck` 1.5.0 — MIT, no
dependencies, maintained (last release April 2026), satisfying the spec §20.6 library check:

| Measurement (dev laptop, Node 24)                                             | Result                        |
| ----------------------------------------------------------------------------- | ----------------------------- |
| Same shot simulated twice from the same state                                 | **bit-identical** final state |
| One full shot (4 pens, 60 Hz, until asleep)                                   | ≈ 0.65 ms, 3–4 s simulated    |
| Bot: 24 candidate shots at full fidelity (60 Hz, 8 s cap)                     | ≈ 10 ms (budget 20 ms)        |
| Keyframes for one shot, 30 Hz, only pens that moved, quantised integers, JSON | ≈ 2.6 KB                      |

So: the bot can evaluate candidates with the **exact** same simulation as the real shot (no
cheaper approximation needed), and keyframes fit easily in one event.

## 1. Player journey

| #   | Moment          | What players see                                                                                                                                                                                                                   |
| --- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Lobby / room    | Pen Fight card (2–4 players). Host adds bots or waits for friends; no game settings in v1 _(proposed)_. "Start".                                                                                                                   |
| 2   | Seating         | A wooden desk seen from above. Each pen (in the seat's accent colour, with its owner's name tag) slides onto its spot, spinning to a random facing. A turn-order strip shows who goes first (seeded shuffle).                      |
| 3   | Aiming (you)    | "Your flick!" banner, 15 s ring. Touch your pen: the touch point sets the **spin point** (anchor); drag back like a slingshot to set **direction** and **strength**; release to flick. Drag back to the pen (dead zone) to cancel. |
| 3b  | Aiming (others) | "Priya is aiming…" with her ring; her pen glows. Others do not see her aim (no live aim stream — §3.6).                                                                                                                            |
| 4   | Flick           | The pen recoils and shoots; the flicker's controls disappear.                                                                                                                                                                      |
| 5   | Physics result  | Everyone watches the same replay: pens slide, spin and knock each other (sparks, a small shake on hard hits in full effects); a pen whose centre crosses the edge tips over and drops off ("OUT!").                                |
| 6   | Elimination     | The eliminated pen's tag turns grey with its place ("4th"); it leaves the turn order. Self-eliminations count.                                                                                                                     |
| 7   | Next turn       | Next alive player in the order. After every alive pen has had a turn, a new round starts (round counter).                                                                                                                          |
| 8   | Sudden death    | After 10 rounds in a row with no elimination: "Sudden death!" banner; the next, smaller desk edge glows as a dashed line for a whole round, then the desk shrinks to it at the start of the next round, dropping any pen outside.  |
| 9   | Final winner    | The last pen standing gets a crown and "WINNER!" stamp; then the platform results screen (podium, places, "Play again").                                                                                                           |

## 2. Turn / state machine

```text
setup ─▶ AIMING(active) ──flick──▶ PLAYBACK(hold) ──▶ resolve ─┬─▶ AIMING(next alive)
            │  timeout (15 s) → skip ─────────────────▶ resolve ┤
            │                                                    ├─▶ SHRINKING(hold) ─▶ AIMING
            └─ (active pen's seat changes: see §10)              └─▶ OVER
```

| Phase       | Length                       | Notes                                                                                                                                                          |
| ----------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AIMING`    | 15 s                         | Only the active seat may `FLICK`. Timeout → the turn is **skipped** (counts as that pen's turn in the round; +1 to its consecutive-skip counter).              |
| `PLAYBACK`  | replay length + 0.5 s (spec) | The whole simulation already ran inside the `FLICK` transition; this phase only holds while clients play the keyframes. No actions accepted (`INVALID_PHASE`). |
| `SHRINKING` | 1.5 s _(proposed)_           | Only at a round boundary once sudden death is armed: the previewed edge is applied; pens outside are eliminated.                                               |
| `OVER`      | —                            | Results.                                                                                                                                                       |

**Resolve** (synchronous, inside the transition that ends a turn):

1. Eliminations from the shot are already applied (§4); record them for ranking.
2. One pen left (or none) → `OVER`.
3. Remove eliminated seats from this round's remaining queue; pop the active seat.
4. Queue empty → **round boundary**: quiet-round bookkeeping and sudden death (§5); the new
   round's queue = alive seats in turn order.
5. Next active = head of the queue → `AIMING` with `turnStarted {seat, deadline}`.

**Turn order:** a seeded shuffle of seats at setup, fixed for the match; eliminated seats are
skipped. **Full round** (spec): every pen alive at the round's start has had one turn (a
skipped turn counts; a pen knocked out before its turn simply leaves the queue).

**Action** `{type: 'FLICK', anchor, angle, power}`: finite numbers (zod); the server clamps
`anchor` to [-1, 1] and `power` to [0.05, 1] _(minimum proposed: a zero flick is pointless)_,
normalises `angle` to (-π, π], and quantises all three (1e-4) so that a replay from the
action log reproduces the shot exactly. Not the active seat → `NOT_YOUR_TURN`; not `AIMING` →
`INVALID_PHASE`.

**Idle:** 3 consecutive skipped turns → `MARK_IDLE` (a bot plays the seat until "I'm back");
any flick resets the counter.

**Match end:** one pen left → it is 1st; or no pens left (the last pens left together) →
tie-break (§4). Results: placements + stats `{eliminations: pens you knocked out}`
_(proposed: a fun number for the results table; no scoring)_.

**Termination bound:** before arming, every reset of the quiet-round counter needs an
elimination (at most 3), so arming happens within 40 rounds; after arming the desk is gone
after 17 shrinks (17 × 6 % > 100 %). Hard upper bound ≈ 58 rounds; typical matches are far
shorter. Tested (§12).

## 3. Server-authoritative physics

### 3.1 Integration

- New `games/pen-fight/src/server/physics.ts`: `simulateShot(table, shot, params) →
{frames, collisions, eliminations, final, steps}` (spec's `PhysicsEngine`). Planck is a
  **server-only** dependency of the game package; the client module never imports it (bundle
  test), and clients never run physics — they only play keyframes.
- Each shot builds a **fresh `World`** from the state (positions, angles; all pens at rest),
  applies the flick impulse, steps, and discards the world. No physics object lives in game
  state; the engine stays pure (`(state, action) → transition`) and serialisable.
- **Pen body** _(proposed)_: Planck has no capsule shape, so a pen is a thin box with a circle
  at each end (one rigid body; capsule collision behaviour). Units: the desk is 10 × 7 world
  units, a pen 1.4 × 0.12. No gravity (top-down); table friction = linear + angular damping;
  moderate restitution; `bullet: true` so fast pens never tunnel through each other.
- **Flick:** linear impulse `power × J_max` in direction `angle`, applied at the point
  `anchor × halfLength` along the pen's axis — off-centre hits add spin (that is the spin
  control; spec "anchor").

### 3.2 Determinism strategy

- Same input → same output on the same Node/V8 build (verified in the spike). We do **not**
  need cross-platform determinism: only the server simulates.
- State stores **quantised** positions/angles (1e-3 units, 1e-4 rad) — exactly what clients
  receive — and every shot starts from that quantised state. So views, keyframes' last frame
  and the next simulation all agree, and a match replays bit-for-bit from seed + action log
  (golden tests pin this to the CI Node version).
- No randomness inside physics; setup positions/facing and the bot use the match's seeded RNG.

### 3.3 Tick rate and limits

Fixed **60 Hz** steps (8 velocity / 3 position iterations) until every pen sleeps or is out,
**capped at 8 s** (480 steps). At the cap, pens stop where they are (velocities discarded).
Worst-case cost per shot ≈ 1 ms.

### 3.4 Keyframes and broadcast

`shotPlayed` (public, one event) carries:

- `frames`: one per 2 steps (**30 Hz**) _(proposed; spec allows 30–60)_, each listing only pens
  that moved: `[pen, x, y, angle]` as integers (1e-3 units, 1e-4 rad); always includes the
  final frame. ≈ 2.6 KB per typical shot, worst case (8 s, 4 pens moving) ≈ 12 KB.
- `collisions`: `{tick, a, b, impulse}` (pen–pen hits above a threshold; capped at 40) → sparks
  and shake.
- `eliminations`: `{seat, tick}` (the "falls off" moment).
- `durationMs`: replay length (= steps / 60 s).

The view always holds the **authoritative final state**; the event is only for animation.

### 3.5 Client playback

The animation director already waits per event: `eventDuration(shotPlayed) = durationMs`
(+ the fall animation). The board interpolates between keyframes every animation frame
(linear position, shortest-arc angle), plays sparks/shake at collision ticks and the fall at
elimination ticks, then **snaps to the view's final state**. Lite: no sparks/shake. Reduced:
no replay — pens move straight to their final places (short cross-fade), eliminated pens
disappear with their "OUT" label. A backlog (slow device) is fast-forwarded by the director
as today.

### 3.6 No second networking model

Everything goes through `match:action` → transition → `match:update` (`SIMULATED` sync). No
stream, no client prediction, no live aim broadcast (others see "aiming…" and the timer).
Live aim sharing could later use `match:stream`, but it is not needed and would leak nothing
useful — out of scope for v1.

## 4. When a pen is eliminated

- **During a shot:** after each 60 Hz step, a pen whose **centre of mass** (Planck world
  centre) is **strictly outside** the current desk rectangle (`|x − cx| > w/2` or
  `|y − cy| > h/2`) is eliminated at that tick and removed from the world (it no longer
  collides). A pen exactly on the edge, or overhanging with its centre inside, stays.
- **At a shrink:** the same test against the new rectangle, at the moment it applies.
- Self-eliminations count like any other.
- **Ranking:** reverse elimination order. Same shot → the pen that left at the **later tick**
  ranks higher; same tick → shared place. Same shrink → **closer to the desk centre** ranks
  higher; equal distance (1e-3) → shared place. If the last pens all leave together, the
  first place is decided (or shared) the same way.

## 5. Sudden death

- `quietRounds` counts consecutive **full rounds** with no elimination (any cause). An
  elimination resets it — until it reaches **10**: then sudden death **arms permanently**
  (`suddenDeathArmed {nextBoundary}`).
- Because the spec requires the next boundary to be **previewed for a whole round before it
  applies**, the first shrink happens at the start of the round **after** the arming
  boundary: round 11 shows the preview (dashed glowing line + "Desk shrinking!"), round 12
  starts with the shrink to that edge and the preview of the next one, and so on.
- Step _k_ boundary: width `W₀·(1 − 0.06k)`, height `H₀·(1 − 0.06k)`, same centre (6 % of the
  **original** size each time, spec). At the start of a round (`SHRINKING` phase, 1.5 s
  _(proposed)_): `deskShrunk {boundary, eliminated}`; pens outside are out (ranked by
  distance to centre); if ≤ 1 pen remains → `OVER`. Step 17 has no area: everyone remaining
  is out and ranked by distance — termination is guaranteed.
- The current boundary and the preview are in every view, so a reconnecting player sees both.

## 6. Bot

One difficulty ("Normal"), honest by construction (everything is public anyway), deciding
with the same `simulateShot` as the real game:

1. **Candidates (≤ 24)** from the seeded RNG _(proposed mix)_: for each opponent, aim at its
   centre, at its nearer end and with ±6° jitter, at powers ~0.55 / 0.75 / 0.95 and anchors 0
   / ±0.3 (≈ 4 per opponent), plus random angles/powers to fill 24.
2. **Simulate** each (full fidelity; spike: ≈ 10 ms for 24).
3. **Score:** +100 per opponent eliminated; −250 if its own pen goes out; + its own distance to
   the nearest edge; − the opponents' distances to the nearest edge (pressure); in sudden
   death, distances use the **previewed** boundary.
4. **Pick** among the top three (60 % / 30 % / 10 %), then add human-like error (±2.5° aim,
   ±5 % power) — beatable, never perfect.
5. Think time 0.8–2.5 s (scaled), always ending before the deadline.

**Budget safeguards:** the candidate count and step cap make the worst case fixed and
measurable; a benchmark test fails if 24 candidates exceed the budget on the CI machine by a
wide margin (local < 20 ms; CI threshold with headroom), and the BotManager logs any decision
over 20 ms. The spec's `worker_threads` fallback is designed for (bot `decide` is pure and
serialisable) but **not built** unless a measurement shows it is needed _(proposed)_.

## 7. Mobile UX (phone first)

- **Desk orientation:** the desk is landscape (10 : 7). On a portrait phone the board draws it
  **rotated 90°** (client-side coordinate transform only) so it fills the width and is as big as
  possible; all input is transformed back. _(proposed)_
- **Touch target:** a pen is ~5 px thick on a phone, so its hit area is a 48 px-wide capsule
  around it. The touch point is projected onto the pen's axis → **anchor** (clamped to the
  pen). A **spin strip** (a magnified pen under the desk) shows and fine-tunes the anchor while
  aiming.
- **Aiming:** drag away from the pen (slingshot): direction = opposite of the drag; strength =
  drag length / (35 % of the desk's short side on screen), clamped. Feedback: a rubber-band
  line from the pen to the finger, a direction arrow ahead of the pen whose length and
  yellow→pink colour show strength, a curled arrow at the anchor showing spin direction, and
  the pen tilting slightly. **No predicted path** (spec).
- **Release** flicks (a short vibration in full/lite). Releasing inside the dead zone (back
  near the pen) **cancels**. Pointer capture keeps the drag working outside the desk.
- **Others' turns:** controls hidden; "Priya is aiming…" with her ring; your pen and name tag
  stay highlighted so you can find yourself.
- Turn-order strip and round counter above the desk; quick reactions as in 16 Parchi.

## 8. Desktop UX

- Same drag-to-flick with the mouse; desk landscape, centred; turn order and players on the
  left, chat on the right (existing room layout).
- **Keyboard / accessibility:** the active player's pen is a focusable control: ←/→ rotate the
  aim (2°, Shift = 10°), ↑/↓ strength (5 %), A/D move the spin point (0.25), Enter/Space
  flick, Esc reset. The aim state is announced (`aria-live`: "Aim 45°, strength 70 %, spin
  left"). Hover shows the spin point under the cursor.

## 9. Color Burst Arcade choreography _(proposed timings)_

| Moment       | Full                                                                    | Lite                         | Reduced               |
| ------------ | ----------------------------------------------------------------------- | ---------------------------- | --------------------- |
| Seating      | Pens slide in and spin to their facing (staggered 120 ms)               | Fade + slide                 | Appear                |
| Your turn    | "Your flick!" banner pops; your pen pulses                              | Banner fades in              | Banner                |
| Aim          | Rubber band, power arrow, spin curl (live, 60 fps)                      | Same                         | Same (static drawing) |
| Flick        | Pen squash/recoil 120 ms                                                | —                            | —                     |
| Collision    | Spark burst sized by impulse; desk shake on hard hits (≤ 6 px, 150 ms)  | Small spark, no shake        | —                     |
| Elimination  | Pen tips over the edge, shrinks with a drop shadow, "OUT!" stamp        | Fades out + stamp            | Removed + "OUT" label |
| Sudden death | Edge turns into a glowing dashed line, "Desk shrinking!" banner wobbles | Dashed line, banner          | Dashed line, banner   |
| Shrink       | Desk edge slides inward with crumbs; outside pens fall                  | Edge slides                  | Snaps                 |
| Winner       | Crown drops on the last pen, "WINNER!" stamp, confetti                  | Crown + stamp, lite confetti | Crown + stamp         |

Look: a top-down wooden school desk (as 16 Parchi's), compass scratches and ink spots,
ballpoint pens with seat-accent caps and name-tag flags. Pens are DOM/SVG elements moved with
transforms (4 pens — no canvas needed).

## 10. Reconnection and idle during an active turn

- **The shot itself is atomic:** the whole simulation runs inside the `FLICK` transition, so a
  disconnect can never interrupt physics. Someone who reconnects during `PLAYBACK` gets the
  view (final positions, eliminations, `phaseEndsAt`) without the replay — the board shows a
  brief "Priya flicked — Kabir is out!" toast instead.
- **Active player disconnects while aiming:** the 15 s timer keeps running; at the timeout
  the turn is skipped (the 30 s reconnect grace is longer than one aim). When the grace
  expires, or the player leaves, a bot takes the seat (existing platform rule); if that
  happens during the seat's own aim, the bot decides at once within the remaining time.
- **Reclaim IMMEDIATE** (spec): a returning human gets the seat back at once; mid-aim they get
  the remaining time; a bot's pending decision is cancelled (existing BotManager behaviour). If
  the bot already flicked, they see the result.
- **Idle:** 3 consecutive skips → `MARK_IDLE` → bot + "I'm back" banner (existing).

## 11. Hidden information and security

- **No hidden information** (spec: everything public). The leak checker still runs (with a
  no-op perturbation) to keep the harness uniform.
- **Server authority:** clients send only `{anchor, angle, power}`; values are schema-checked,
  clamped and quantised; the server decides everything else. A cheater can at most send a
  perfect aim (which a human can also do) — there is no physics trust.
- **Cost bounds:** one simulation per accepted action, ≤ 480 steps; `matchAction` rate limit
  applies; bots cost ≈ 10 ms per decision. No unbounded loops (tests assert the cap).

## 12. Testing strategy

| Level                | What                                                                                                                                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Physics unit         | Pen body shape/mass; impulse direction and anchor spin sign; at-rest stays at rest; cap at 8 s; elimination exactly by centre of mass (edge, overhang, corner cases); collision events; quantisation round-trip.                                |
| Golden / determinism | Fixed shots from fixed tables → fixed final states and frame counts (pinned Node version); same shot twice → identical; replay from seed + action log.                                                                                          |
| Engine               | Setup (2/3/4 symmetric spots, seeded facing/order); flick validation, clamping, quantisation; timeout skip; turn order with eliminations; full-round definition; idle after 3 skips; reclaim; results and tie-breaks.                           |
| Elimination edges    | Self-elimination; two pens out in one shot (later tick ranks higher, same tick shares); last two out together; the active pen knocked out; all out in one shrink (distance ranking).                                                            |
| Sudden death         | Arms exactly after 10 quiet rounds; resets on elimination before arming; never disarms; preview a full round before the first shrink; 6 % of the original size per step; shrink eliminations; termination bound.                                |
| Seeded simulations   | Hundreds of all-bot matches with `simulateMatch` (invariants: alive pens inside the desk, placements valid, round counter monotonic) — every match terminates.                                                                                  |
| Bot                  | Candidate count ≤ 24; never chooses a self-elimination when a safe shot exists in its candidate set; benchmark within budget.                                                                                                                   |
| Socket               | A full 2-human + 2-bot match over real sockets; actions only from the active seat; `INVALID_PHASE` during playback; payload size of `shotPlayed`; timeout/skip with short timers; reconnect during playback; idle takeover and reclaim mid-aim. |
| E2E (Playwright)     | Desktop + Pixel 7: a human aims by dragging and flicks; the replay plays; turns pass; play to results with bots; no sideways scroll. Reduced motion: no replay animation, final positions shown, playable to results.                           |
| Client               | Keyframe interpolation (pure function, unit-tested); portrait rotation transform round-trip; planck not in the client bundle.                                                                                                                   |

## 13. Performance risks and safeguards

| Risk                                            | Safeguard                                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Bot CPU blocks the event loop                   | Fixed worst case (24 × ≤ 480 steps ≈ 10 ms measured); benchmark test; log over-budget decisions; worker fallback designed, not built. |
| Long or jittery replays on slow phones          | 30 Hz keyframes + interpolation; DOM transforms only (4 elements); director fast-forward; lite/reduced modes.                         |
| Payload size                                    | Only moved pens per frame, integers, 30 Hz; worst case ≈ 12 KB, asserted in a test.                                                   |
| Determinism drift (Node upgrade changes floats) | Only matters for golden tests/replays; goldens pinned to the CI Node version and regenerated deliberately.                            |
| Tunneling at high speed                         | `bullet: true` + 60 Hz; test with full-power head-on hits.                                                                            |
| Physics "feel" wrong on real phones             | All constants in game options; owner play-test before launch (spec §20.7).                                                            |
| Server bundle size                              | Planck ≈ 0.3 MB minified, server only; client bundle test.                                                                            |

## 14. Decisions and open points

**Genuinely blocking ambiguities: none.** The spec defines the rules, controls, physics
architecture, elimination, sudden death and tie-breaks; the remaining choices are tuning or
presentation.

**Decided independently** (non-blocking, listed for sign-off):

1. First shrink happens one round **after** arming (the preview round), as the spec's
   "previewed for the whole round before it applies" requires.
2. A skipped turn counts as that pen's turn in the round.
3. Minimum flick power 5 %; action values quantised to 1e-4.
4. Positions stored quantised (1e-3 units / 1e-4 rad) so views, keyframes and replays agree.
5. Pen = box + two end circles (Planck has no capsule).
6. Keyframes at 30 Hz with only moved pens; `SHRINKING` hold 1.5 s.
7. Portrait phones draw the desk rotated 90°; a magnified spin strip for precise anchors;
   keyboard controls on desktop.
8. No live aim broadcast to other players in v1.
9. No host settings in v1; results show "pens knocked out" as a stat.
10. Bot candidate mix, scoring weights and error noise as in §6; no worker thread unless
    measured necessary.

**Proposed tunables** (game options, to be tuned in the owner's play-test). Everything not
marked "binding" is a **play-test value, not a frozen rule**: the physics, bot and mobile
numbers below are starting points that will be measured during implementation and adjusted
after real phone play-testing.

| Tunable                         | Proposed                                                | Spec                    |
| ------------------------------- | ------------------------------------------------------- | ----------------------- |
| Aim timer                       | 15 s                                                    | 15 s (binding)          |
| Simulation rate / cap           | 60 Hz / 8 s                                             | binding                 |
| Playback hold                   | replay + 0.5 s                                          | binding                 |
| Desk / pen size                 | 10 × 7 / 1.4 × 0.12                                     | —                       |
| Linear / angular damping        | 1.6 / 2.5                                               | —                       |
| Restitution / friction          | 0.45 / 0.25                                             | "moderate"              |
| Max flick impulse `J_max`       | tuned so full power slides ≈ 1.2 × the desk width alone | —                       |
| Minimum power                   | 0.05                                                    | —                       |
| Keyframe rate                   | 30 Hz                                                   | 30–60 Hz                |
| Collision event threshold / cap | impulse ≥ 0.15 / 40                                     | —                       |
| Sudden death                    | after 10 quiet rounds, −6 % of original per round       | binding                 |
| `SHRINKING` hold                | 1.5 s                                                   | —                       |
| Idle                            | 3 skipped turns                                         | binding                 |
| Bot candidates / budget / think | 24 / 20 ms / 0.8–2.5 s                                  | binding / binding / §14 |
| Bot pick / noise                | top-3 60/30/10 %, ±2.5°, ±5 %                           | —                       |
| Drag for full power (phone)     | 35 % of the desk's short side                           | —                       |

**Launch blocker:** none specific to Pen Fight (the physics feel needs the owner's phone
play-test, which is a tuning step, not a blocker).

## 15. Implementation notes (Phase 5 — measured, still play-test values)

The proposed numbers were measured during implementation (seeded bot-vs-bot matches and the
bot benchmark) rather than assumed. What changed, and why:

| Value                    | Proposed (§14)    | Implemented                    | Measurement that drove it                                                                                                                                                                                   |
| ------------------------ | ----------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full-power slide         | ≈ 1.2 × desk (12) | **7 units**                    | At 12, almost every hit was a knockout: bot matches lasted a median of 1 round and 23 % of exits were self-eliminations. At 7: median 4 rounds, ≈ 0 self-eliminations, sudden death in ~8 % of bot matches. |
| Linear / angular damping | 1.6 / 2.5         | **5 / 7**                      | Replays took 3–4 s and felt like sliding on ice; at 5 / 7 a shot settles in ≈ 1.4 s (p95 ≈ 1.5 s), closer to a real pen on a desk.                                                                          |
| Pen size                 | 1.4 × 0.12        | **2.0 × 0.16**                 | Visual review: at 14 % of the desk width pens read as small objects, not pens. Drawn 1.5× thicker than the physics body so they read on a phone.                                                            |
| Bot search               | ≈ 10 ms (spike)   | p50 ≈ 13–15 ms, p95 ≈ 16–18 ms | Bot what-ifs skip keyframe/collision recording; the error-noise check adds one simulation. No worker thread needed.                                                                                         |
| Keyframe payload         | ≈ 2.6 KB          | ≈ 2–3 KB, max seen ≈ 3.2 KB    | Bot matches; tests assert < 16 KB.                                                                                                                                                                          |

Other implementation choices: the bot's human-like error is re-checked so it never turns a safe
shot into flicking itself off; places are shown only once a pen has visibly fallen in the
replay; the sudden-death banner shows for 1.8 s (the round pill keeps "Sudden death");
replays add motion ghosts and a squash on the flicked pen in full effects.
