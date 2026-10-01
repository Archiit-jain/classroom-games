# Deployment

> **Status:** production deployment is **Phase 9**; no hosting provider has been chosen and
> nothing is deployed. This page documents what the code already supports.

## Shape

```text
Browser ──HTTPS──▶ static host / CDN        apps/client/dist (plain static files)
   └─────WSS─────▶ Node server (1 instance)  apps/server/dist/index.js
```

The client and server deploy separately. The server needs a host that keeps **long-lived
WebSocket connections** open (a container/VM-style service). Serverless function platforms
cannot host it. See [ADR-009](decisions/ADR-009-static-client-websocket-server.md).

## Building

```bash
pnpm install --frozen-lockfile
pnpm build
```

- `apps/client/dist/` — static site. Build with `VITE_SERVER_URL=https://<server>` set.
- `apps/server/dist/index.js` — single ESM bundle (workspace packages and `obscenity`
  bundled; `socket.io` and `zod` stay external and must be installed next to it).
  Run with `node dist/index.js` (Node 24+).

## Server configuration

Environment variables are listed in [DEVELOPMENT_SETUP.md](DEVELOPMENT_SETUP.md#environment-variables).
For production:

```bash
NODE_ENV=production
ALLOWED_ORIGINS=https://your-client-domain
TRUST_PROXY=true          # only if behind the platform's reverse proxy
PORT=<platform port>
```

## Operational features already built

- **Health check:** `GET /healthz` → `200 {"status":"ok"}` (`503` while shutting down).
- **Graceful shutdown:** on `SIGTERM`/`SIGINT` the server broadcasts `SERVER_RESTARTING`,
  refuses new connections, waits 5 s, then closes. Clients show a banner and reconnect.
- **Structured logs** (JSON lines) on stdout/stderr.
- **Fixture game disabled** automatically in production.

## Known constraints

- All state is in memory: a restart or deploy ends every game (accepted for v1).
- One instance only; scaling requires room affinity + sticky sessions + Redis adapter
  ([ADR-005](decisions/ADR-005-in-memory-room-store.md)).
- Free hosting tiers that sleep will make the first visitor wait; the client shows
  "Waking up the game server…" after 3 s and, if the server still has not answered after a
  minute, "The game server isn't responding…". It keeps retrying throughout and connects
  without a reload as soon as the server is up.

## Still to do (Phase 9)

Choose providers after checking current pricing and sleep behaviour; set CSP and security
headers on the static host; production smoke test; staging environment.
