# ADR-004: Pure game engines with a seeded RNG

**Status:** Accepted (Phase 0 spec §2, §9)

## Context

Game rules are the most bug-prone and most important code. They must be testable in
isolation, replayable, and impossible to cheat.

## Decision

Engines are pure functions `(state, input, ctx) → Transition`. They receive the server time
and a seeded RNG (`ctx.rng`, mulberry32) and never use `Date.now()`, `Math.random()`, I/O,
sockets or in-place mutation. Engines only know seat numbers.

## Consequences

- The test harness can play thousands of matches quickly on a virtual clock and replay any
  failure from its seed.
- The harness deep-freezes state, so mutation is caught immediately.
- Anything impure (timers, bots, sessions) lives in the platform (`GameRuntime`,
  `BotManager`, `RoomManager`).
