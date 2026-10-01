# ADR-007: Moderation pipeline on obscenity + our own datasets

**Status:** Accepted (Phase 0 spec §7)

## Context

Public, anonymous chat with a young audience; Indian users will type Hinglish abuse in
Latin script; naive substring filters censor innocent words ("Classroom").

## Decision

- `packages/moderation` exposes a `Moderator` interface; the server depends only on it.
- Detection uses `obscenity` (MIT; maps matches back to original text positions; handles
  confusables, leetspeak, repeated letters) with its English dataset **plus** our Hinglish,
  insult and allow-lists.
- Additional handling we wrote: zero-width stripping, spaced-letter runs, contact-detail
  detection, "!" treated as punctuation (obscenity would read it as leetspeak "i" and let
  "stupid!" through — found in manual testing, now covered by tests).
- Order: rate limit → normalise → game hook → censor → broadcast. Profanity is censored,
  never punished.

## Consequences

- Word lists need ongoing curation; every change needs a test case.
- `bc`/`mc` stay whole-word only, with no blanket abbreviation block (product owner,
  Phase 2 review). Accepted trade-off: a standalone "BC"/"MC" is censored too.
- Nicknames starting with "Bot" stay reserved (product owner, Phase 2 review).
- A stronger moderator can replace this one without touching the server.
