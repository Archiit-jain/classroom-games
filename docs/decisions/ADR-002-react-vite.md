# ADR-002: React + Vite + Motion for the client

**Status:** Accepted (Phase 0 spec §2; Motion added in Phase 2)

## Context

Five platform screens plus four state-driven game boards with heavy, event-driven
animation. Vanilla TypeScript would mean hand-building a component/state system.

## Decision

- React 19 + TypeScript + Vite. State comes from one external store read with
  `useSyncExternalStore`; no state-management library.
- **Motion** (`motion/react`, MIT) for animations that communicate game state: flips,
  deals, stamps, rolling numbers, entrances, podium. Plain CSS for trivial effects.
  Motion is configured from the platform effects mode (`EffectsRoot`), so reduced motion is
  honoured everywhere.

## Consequences

- Game boards are lazy-loaded React components (`GameClientModule.Board`).
- React escapes text by default, which also helps security.
- Bundle size: Phase 1 ≈ 89 KB gzipped; Phase 2 ≈ 142 KB gzipped, mostly Motion. Trimming it
  (e.g. Motion's `LazyMotion`/`m` components, splitting the home screen) is a Phase 11 task.
