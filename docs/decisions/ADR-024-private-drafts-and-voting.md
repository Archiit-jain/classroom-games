# ADR-024: Private autosaved drafts on the stream path, and server-side answer voting

**Status:** Accepted (Phase 7, Name Place Animal Thing). Voting rule frozen by the owner.

## Context

Name Place Animal Thing needs every player's sheet saved continuously while they type (so a
time-up or a disconnect never loses work), yet nothing of it may reach anyone else before the
round is locked. As ordinary versioned actions, autosaves would bump the match version and
broadcast a new view to every seat several times a second per player, and fill the snapshot's
remembered action ids. Answers are also partly subjective, so the owner chose an automatic
check followed by a player vote, with a voting rule that must be deterministic and fair.

## Decision

- **Drafts use the existing `match:stream` path** (ADR-020), which needs no version and no
  broadcast: the game's `stream.accept` validates a draft and stores it in the authoritative
  state, then relays it to **nobody** (an empty audience). Each player's saved sheet appears
  only in **their own** view (`getPlayerView`), so reconnects restore it. Drafts never leave the
  host except in the server-only snapshot (Redis in production).
- **Ordering:** each draft carries a per-seat, per-round sequence number; the engine keeps the
  highest accepted one, so the latest accepted draft always wins over delayed, reordered or
  replayed ones — across reconnects and host hand-over (the sequence is in the snapshot).
- **Roster:** `GameModule.setup` receives an optional `{ bots }` roster so a game can tell
  human players from bots (engines already hear about takeovers via `onSeatChange`). Existing
  games ignore it.
- **Voting is a server rule on answer groups:** with H human players (H ≥ 3) a group is
  rejected when ⌊H/2⌋ + 1 humans who did not write it vote it out; with H ≤ 2 there is no
  vote. Only automatically accepted answers can be voted on. Counts are anonymous.
- The platform moderator is injected into the engine (pure text processing) so answers are
  moderated by the same rules as chat; a censored answer is invalid.

## Consequences

- No new networking; works unchanged through the Phase 6 gateways, Redis and failover.
- Autosaves are cheap (one small message to the host, no fan-out) and rate-limited per socket.
- Leak resistance is testable: view-leak checks in the engine harness, socket scans, and a
  browser-level WebSocket frame scan.
- With 3 players an answer written by two of them cannot be rejected (one possible voter, two
  votes needed) — an accepted consequence of the frozen rule.
