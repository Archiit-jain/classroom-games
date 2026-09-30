# Contributing

## Workflow

1. Read [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) and [ARCHITECTURE.md](ARCHITECTURE.md).
2. Product and rules decisions come from the product owner / spec
   ([specs/PHASE_0_SPEC.md](specs/PHASE_0_SPEC.md)). Don't invent rules — ask.
3. Work on a branch; keep commits logical (one coherent change each).
4. Before pushing: `pnpm check` (lint + typecheck + tests) and, for UI changes, `pnpm e2e`.
5. Update the docs that describe what you changed, in the same commit.
6. Record non-obvious decisions as an ADR in [decisions/](decisions/).

## Code conventions

- TypeScript strict mode everywhere (`noUncheckedIndexedAccess` on).
- Prettier formatting (`pnpm format`); ESLint must pass.
- **Engines are pure** (see [GAME_SYSTEM.md](GAME_SYSTEM.md#rules-for-engines)).
- **No user-facing strings in code** — use `t()` / game `messages`.
- **Server errors are codes**, added to `packages/protocol/src/errors.ts` and translated in
  `apps/client/src/i18n/en.ts` (the compiler enforces completeness).
- Services never touch sockets directly; they talk through `Notifier`.
- Don't put invisible Unicode characters in source files; use numeric code points or
  `String.fromCodePoint`.
- New dependencies need a reason (and an entry in [../CREDITS.md](../CREDITS.md) if they
  ship to users).

## Tests

Every behaviour change comes with tests at the right level (engine unit, harness fuzz,
server integration, e2e). See [TESTING.md](TESTING.md).

## Commit messages

Imperative summary line ("Add room chat moderation"), blank line, then why/what if useful.
