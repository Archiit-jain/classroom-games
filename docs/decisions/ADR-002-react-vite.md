# ADR-002: React + Vite for the client

**Status:** Accepted (Phase 0 spec §2)

## Context

Five platform screens plus four state-driven game boards with heavy, event-driven
animation. Vanilla TypeScript would mean hand-building a component/state system.

## Decision

React 19 + TypeScript + Vite. State comes from one external store read with
`useSyncExternalStore`; no state-management library. Motion (for animations) is added with
the first animated game, not before.

## Consequences

- Game boards are lazy-loaded React components (`GameClientModule.Board`).
- React escapes text by default, which also helps security.
- Bundle size is watched: server-only code (zod schemas, fixture game) is kept out of the
  client build (production bundle ≈ 89 KB gzipped in Phase 1).
