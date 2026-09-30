# ADR-001: pnpm monorepo, packages consumed as TypeScript source

**Status:** Accepted (Phase 0 spec §3)

## Context

Client, server, shared protocol, game SDK, moderation and (later) four games must share
types without copy-paste, stay independently understandable, and not require a heavy build
orchestrator.

## Decision

One repository with pnpm workspaces: `apps/*`, `packages/*`, `games/*`. Internal packages
export their TypeScript source directly (`"exports": {".": "./src/index.ts"}`); Vite
compiles them for the client, `tsx` runs them in development, and esbuild bundles them into
the server build. No Turborepo/Nx.

## Consequences

- One install, one lockfile, no per-package build step to forget.
- Packages can expose subpaths (e.g. `@cg/protocol/schemas`, `@cg/game-sdk/fixture`) to
  keep server-only code out of the client bundle.
- The server production build must bundle workspace code (see `apps/server/build.mjs`).
