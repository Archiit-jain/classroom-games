# ADR-014: Lenient action versions

**Status:** **Proposed — implemented in Phase 1, needs product-owner approval** (deviates
from Phase 0 spec §15)

## Context

Spec §15 says every action carries `{matchId, version}` and a stale action is rejected with
`STALE_VERSION` "so double-taps are harmless". Implemented literally (reject unless
`version === current`), this breaks simultaneous play: in 16 Parchi, when player A selects a
chit the version increases, so player B's selection — sent a moment earlier from the
previous view — would be rejected and B would have to tap again. The claim race in 16 Parchi
would also turn the second valid claim into `STALE_VERSION` instead of giving it the next
placement.

## Decision

- The server rejects only versions it never issued (`version > current`) with
  `STALE_VERSION`.
- Older versions are accepted; **legality is always decided by the engine against the
  current state**. Double-taps stay harmless because the rules reject the repeat (e.g.
  `NOT_YOUR_TURN` once the turn passed) or treat it idempotently.
- A game that needs "only valid for this exact moment" semantics puts its own token in the
  action (e.g. a phase or claim-window id).
- On the client, a version gap does not trigger a resync request: every update already
  carries a complete view, so a gap only means skipped animations. `match:resync` exists for
  explicit refreshes.

## Consequences

- Simultaneous games and races behave naturally.
- Engines must validate against state, never trust that the client saw the latest view
  (they already must, for security).
