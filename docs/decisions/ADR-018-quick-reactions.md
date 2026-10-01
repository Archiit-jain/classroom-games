# ADR-018: Quick reactions as a platform feature

**Status:** Accepted (Phase 3, implements spec §8 and interpretation I1)

## Context

Spec §8 defines quick reactions: a fixed set of 8 emotes, a bubble over the sender's seat for
everyone, at most 1 per 1.5 s, only ever player-initiated, never from bots. 16 Parchi requires
them; seat positions are game-specific.

## Decision

- **Protocol:** `chat:react {reactionId}` (acked) → `chat:reaction {fromId, seat, reactionId,
sentAt}` to every human in the room. `reactionId` is one of `REACTION_IDS` (`LOL`, `SHOCK`,
  `ANGRY`, `PLEASE`, `CLAP`, `FIRE`, `CRY`, `SHH`); anything else is `INVALID_PAYLOAD`.
- **Server:** accepted only from a seated human while the room's match is running
  (`NOT_IN_ROOM` / `INVALID_PHASE` otherwise); token bucket `reaction` (burst 1, refill one per
  1.5 s) → `RATE_LIMITED` with `retryAfterMs`. No text, so no moderation step; nothing is
  stored. Bots have no way to react.
- **Client:** the connection keeps reactions in the store for 2.4 s, dropping those from
  muted/reported players (same rule as chat). The platform shows the picker (a tray on phones,
  a row on wider screens, resting 1.5 s after each send) for games whose client module sets
  `reactions: true`; such boards receive `BoardProps.reactions` and draw `ReactionBubble`
  (`@cg/ui`) over their seats. Glyphs are system emoji, written as code points in source.
- Enabled for 16 Parchi. Raja Mantri Chor Sipahi keeps `reactions` off for now (its spec does
  not mention them); turning them on is a one-line opt-in plus bubbles on its seats.

## Consequences

- Reactions can never reveal hidden information: they are only sent by a person's tap.
- Tested over real sockets: fan-out with the sender's seat, the 1.5 s limit, validation, and
  that bots never react; end-to-end: a reaction from a phone appears over the seat on desktop.
