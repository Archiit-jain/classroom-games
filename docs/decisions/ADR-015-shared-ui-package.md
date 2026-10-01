# ADR-015: Shared design system package (`@cg/ui`)

**Status:** Accepted (Phase 2). Refines the spec §3 tree, which placed `ui/` inside the client.

## Context

The approved visual direction — **Color Burst Arcade** (nostalgic classroom games ×
modern multiplayer arcade) — must look the same on platform screens and on every game
board. Game packages (`games/*`) cannot import from `apps/client` (dependencies only point
from apps to packages), yet they need the same tokens and primitives (avatars, paper chits,
countdown rings, stamps, rolling numbers, confetti, the effects mode).

## Decision

Create `packages/ui` (`@cg/ui`):

- `styles.css`: design tokens, base styles, component classes (arcade-key buttons, sticker
  panels, notebook paper, name tag, ticket, badges, banners, toasts) and primitive styles,
  plus the Baloo 2 variable font (OFL, self-hosted via `@fontsource-variable`, no third-party
  font requests).
- React primitives: `Avatar`, `PaperChit`, `CountdownRing`, `RollingNumber`, `Stamp`,
  `ConfettiBurst`, `Wordmark`, and `EffectsRoot` / `useEffects` / `durationFor`.
- The client app imports `@cg/ui/styles.css` once; boards import primitives directly.

## Consequences

- One source of truth for the look; restyling is a token change.
- `PaperChit` is ready for 16 Parchi.
- Vite dedupes `react`, `react-dom` and `motion` so packages share one copy.
