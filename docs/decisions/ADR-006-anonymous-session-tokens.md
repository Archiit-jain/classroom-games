# ADR-006: Anonymous session tokens

**Status:** Accepted (Phase 0 spec §6)

## Context

No login, but players must be able to reconnect to their seat and must not be able to act
as someone else.

## Decision

- On first connection the server creates a session and returns a 256-bit random token
  (base64url) once; the browser keeps it in `localStorage` and sends it in the Socket.IO
  handshake (`auth.token`).
- The server stores only the token's SHA-256. Other players only ever see the public
  `playerId`.
- One active socket per session: a newer tab displaces the older one.
- Sessions expire after 24 h idle (10 min if no nickname was ever set).

## Consequences

- Clearing browser storage = a new anonymous player (acceptable, no accounts).
- Two tabs on the same origin are the same player; for local multi-player testing use
  separate origins (`p2.localhost`) or private windows.
- The token is the only credential; protecting the page from script injection matters
  (React escaping now, CSP at deployment).
