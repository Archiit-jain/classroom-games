# ADR-010: Lightweight typed i18n catalog

**Status:** Accepted (Phase 0 spec §1, product decision "English v1, localisation-ready")

## Context

v1 is English only, but Hindi and others should be addable later without hunting for
strings. A full i18n framework would be premature.

## Decision

- All client UI text lives in `apps/client/src/i18n/en.ts`; components call
  `t('section.key', params)`. Keys are a TypeScript union derived from the catalog, so a
  wrong key fails to compile.
- The `errors` section is checked (`satisfies`) to cover every server `ErrorCode`.
- Server messages are codes only; game text lives in each game's client `messages`.

## Consequences

- Adding a language = another catalog with the same shape + a locale switch (not built).
- No pluralisation/ICU features yet; add a library only when a real need appears.
