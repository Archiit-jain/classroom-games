# ADR-012: Pin TypeScript 6.0 (not 7)

**Status:** Accepted (Phase 1)

## Context

At setup time (2026-09-30) the latest TypeScript is 7.0 (the native compiler). The latest
typescript-eslint (8.71) declares support for TypeScript `>=4.8.4 <6.1.0`.

## Decision

Pin `typescript@6.0.3` so linting is supported and stable.

## Consequences

- Revisit when typescript-eslint supports TypeScript 7 (faster type-checking).
- TypeScript 6 defaults (`types: []`, strict) are set explicitly in `tsconfig.base.json`.
