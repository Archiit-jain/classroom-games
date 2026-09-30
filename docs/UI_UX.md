# UI / UX

> **Status:** Phase 1 ships a **foundation UI** only — functional, responsive and
> translation-ready, but deliberately plain. Per spec change C10, the final visual
> direction (colourful, energetic, premium, playful, nostalgic, visually catchy, not
> childish; strong game-specific animation) must be established and approved **before**
> the polished game UI is built.

## What exists

- Screens: Home (nickname, create room, join by code), Room (lobby, match, results) with a
  chat panel, connection banner, toasts, "starting in…" overlay, "a bot is playing for you
  / I'm back" banner.
- **Design tokens** in `apps/client/src/ui/tokens.css` (colours, type scale, spacing,
  radii, shadows, touch-target size, motion durations). Components use tokens only, so
  the future visual direction is mostly a token + component-style change.
- **Phone first:** single column below 900 px (chat under the game), two columns above;
  no horizontal scrolling at 360 px (covered by an end-to-end test); touch targets ≥ 44 px.
- **Reduced motion:** CSS durations drop to 0 under `prefers-reduced-motion`; boards receive
  an `effects` prop (`full` / `reduced`; `lite` arrives with the first animated game).
- **Accessibility basics:** real buttons and labels, visible focus outlines, `aria-live`
  regions for chat, toasts and turn changes, alerts for errors.

## Text and translation

No user-facing string is hard-coded in components: everything goes through `t()` and
`apps/client/src/i18n/en.ts` (typed keys). Game text lives in each game's `messages`.

## Not built yet

Final visual identity, Motion-based animations, the event-driven animation director, the
automatic lite-effects mode, quick reactions, sound (excluded from v1), per-game layouts.
