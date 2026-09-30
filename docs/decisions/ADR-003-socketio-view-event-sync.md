# ADR-003: Socket.IO with acked intents; full per-player view + filtered events

**Status:** Accepted (Phase 0 spec §2, §15)

## Context

Games need real-time delivery, reconnection, hidden information and animation of
"what just happened", on phones and school networks (where WebSockets are sometimes blocked).

## Decision

- Socket.IO 4 (WebSocket with long-polling fallback, automatic reconnect).
- Every client → server message is an **intent** with an acknowledgement
  `{ok: true, …} | {ok: false, code}`.
- After every transition the server sends each player a **complete filtered view** plus the
  **events** that player may see. No diff/patch protocol: views are small.

## Consequences

- A client can always rebuild its screen from the latest update; a missed update only means
  a missed animation.
- Visibility bugs are contained to two functions per game (`getPlayerView` and event
  audiences), both covered by tests.
- High-frequency data (drawing strokes) will use a separate stream channel (Phase 4).
