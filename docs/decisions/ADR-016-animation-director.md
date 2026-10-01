# ADR-016: Animation director and effects modes

**Status:** Accepted (Phase 2, implements spec §15 client pacing and the lite/reduced modes)

## Context

Animations must communicate server-confirmed events (deals, reveals, verdicts) without the
screen falling behind the game, on mid/low-range Android phones, and must respect reduced
motion.

## Decision

- **Animation director** (`apps/client/src/platform/director.ts`): updates are presented one
  at a time. An update arriving while idle is shown at once; while an update's events are
  animating (their total duration, declared per event by the game's `eventDuration`), newer
  updates queue. If queued animation would exceed **1.5 s** of lag, the director
  fast-forwards to the newest update (views are complete; only animation is skipped). A new
  match resets it.
- The director receives updates **directly from the connection** (`subscribeUpdates`), not
  via React state, so two updates arriving within one render frame are never coalesced.
- **Effects modes** (`apps/client/src/platform/effects.ts`): `full`, `lite`, `reduced`.
  OS reduced-motion always wins → `reduced`. Otherwise the player's choice (Auto / Full /
  Lite, header toggle, remembered locally). Auto picks `lite` on obviously low-end hardware
  (≤ 2 GB memory or ≤ 2 cores) or if a one-second frame sample after load stays under 40 fps.
- Every primitive and board takes its timing from `durationFor(mode, full, lite)`: lite is
  shorter and simpler (no confetti flurries, crossfades instead of 3D flips where noted),
  reduced is instant.

## Consequences

- Games declare animation lengths next to their events; server phase holds are longer than
  the animations at normal speed (RMCS: deal 2 s vs 0.7 s animation), so nothing is skipped
  in normal play.
- Tested: director pacing, backlog fast-forward, ordering, match reset (6 tests); effects
  resolution (4 tests).
