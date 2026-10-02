# ADR-022: Pen Fight physics — Planck.js on the server, keyframes in one event

**Status:** Accepted (Phase 5; implements spec §13 and §15 `SIMULATED`, the spec §20.6 library
evaluation for `planck`)

## Context

Pen Fight needs real 2D rigid-body physics (sliding, spinning, collisions) that every player
sees identically and nobody can cheat. The platform already has one networking model:
actions → transitions → per-player `match:update` (plus `match:stream` for drawings).

## Decision

- **Planck.js 1.5** (MIT, no dependencies, maintained), a dependency of the game package used
  only by `src/server` — the client bundle never includes it (checked after build).
- **Pure, per-shot simulation:** `simulateShot(pens, desk, shooter, shot, params)` builds a fresh
  world from the integer state, applies the flick impulse at the anchor point, steps at a fixed
  60 Hz until all pens rest (or 8 s), removes pens whose centre leaves the desk, and returns
  keyframes, collisions, eliminations and the final integer state. No physics object outlives a
  call; the engine stays a pure `(state, action) → transition` function.
- **Determinism:** same input → same output on the same Node build (golden test). State stores
  quantised positions (1e-3 units / 1e-4 rad) and flicks are quantised, so views, the replay's
  last frame and the next shot agree, and matches replay from seed + action log. Cross-platform
  determinism is not needed: only the server simulates.
- **Transport:** the whole replay travels in **one public `SHOT_PLAYED` event** (30 Hz keyframes
  listing only pens that moved, integer `[seat, x, y, angle]`, plus collisions and elimination
  ticks) inside the normal `match:update`. Measured ≈ 2–3 KB per shot (max seen ≈ 3.2 KB). The server holds the
  turn for the replay length + 0.5 s; the client's animation director waits the same time, the
  board interpolates and then shows the authoritative final view. **No second networking model,
  no client physics, no live aim broadcast.**
- **Bots** evaluate 24 candidate shots with the same function (without recording keyframes):
  measured p50 ≈ 13–15 ms, p95 ≈ 16–18 ms across runs on a laptop (budget 20 ms). Worker threads are **not** used;
  the design keeps them as a fallback if measurements on the production host ever require it.

## Consequences

- One small server-only dependency (≈ 0.3 MB minified in the server bundle), in CREDITS.
- Physics constants live in game options and are play-test values; changing them changes the
  golden test on purpose.
- A Node/V8 upgrade could change floating-point results: only golden tests and saved replays
  are affected, and they are regenerated deliberately.
