# ADR-013: Plain `node:http`, no Express

**Status:** Accepted (Phase 1)

## Context

The original brief suggested Express. The frozen spec lists Node + Socket.IO. The server's
only HTTP responsibility is a health check; everything else is Socket.IO.

## Decision

Use Node's built-in `http` server with a tiny request handler (`/healthz`, else 404) and
attach Socket.IO to it.

## Consequences

- One fewer dependency and attack surface.
- If REST endpoints are ever needed, adding a router (or Express) is straightforward.
