# ADR-009: Static client + WebSocket server

**Status:** **Superseded by [ADR-023](ADR-023-multi-instance-cluster.md)** (Phase 6): Vercel
Functions now serve WebSockets, so the client and the realtime server deploy together on Vercel,
with shared state in Redis.

## Context

Serverless/static platforms cannot keep a Socket.IO server's WebSocket connections open.
A public product should load instantly even when the game server is cold.

## Decision

Deploy the client as static files (CDN/static host) and the server separately on a host
that supports long-lived WebSockets. The client reads the server URL from
`VITE_SERVER_URL`. Provider choice happens in Phase 12.

## Consequences

- CORS/origin allowlisting is required (`ALLOWED_ORIGINS`).
- The client shows its own "Waking up the game server…" state while connecting.
- Two deployables to operate instead of one.
