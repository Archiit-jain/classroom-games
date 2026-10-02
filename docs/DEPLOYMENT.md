# Deployment

> **Status (Phase 6):** the platform is built for production on **Vercel + Redis**
> ([ADR-023](decisions/ADR-023-multi-instance-cluster.md)). The production build, the Vercel
> configuration and a production smoke test exist and pass locally and in CI; a live
> deployment needs the external setup below (a Vercel project and a Redis database).
> Public matchmaking is Phase 9.

## Shape

```text
Browser ──HTTPS──▶ Vercel CDN                 apps/client/dist (static)
   └─────WSS─────▶ Vercel Function            api/socket.mjs → apps/server/dist/vercel.mjs
                    (any number of instances)       │
                                                    ▼
                                          Redis (shared state + messages)
```

One site, one origin: the browser loads the client from the CDN and opens its WebSocket to
`wss://<site>/api/socket/socket.io/` on the same domain, so no CORS setup is needed.

## Local development vs production

|                          | Local development (`pnpm dev`)                 | Production (Vercel)                                                           |
| ------------------------ | ---------------------------------------------- | ----------------------------------------------------------------------------- |
| Server process           | One long-running Node process (`src/index.ts`) | Vercel Function instances (`api/socket.mjs`), started and paused on demand    |
| Shared state             | **In memory** (`MemorySharedStore`)            | **Redis** (`RedisSharedStore`, `REDIS_URL`) — required                        |
| Room host                | This process, always                           | Whichever instance holds the host lease; others forward to it                 |
| Client → server          | `http://<host>:3001` (dev fallback)            | Same origin, `wss://`, path `/api/socket/socket.io`, WebSocket only           |
| Allowed origins          | `localhost:5173` and `*.localhost:5173`        | `ALLOWED_ORIGINS` and/or the deployment's own Vercel domains; never localhost |
| Fixture game, time scale | On / configurable                              | Off / always 1                                                                |

## Environment variables (production)

| Variable                              | Where  | Required       | Meaning                                                                                                                                                                                                |
| ------------------------------------- | ------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `REDIS_URL`                           | Vercel | **yes**        | Redis connection URL (`rediss://…`). Added automatically when Redis is connected from the Vercel Marketplace.                                                                                          |
| `ALLOWED_ORIGINS`                     | Vercel | custom domains | Comma-separated origins, e.g. `https://games.example.com`. The deployment's own `*.vercel.app` domains are allowed automatically (`VERCEL_URL`, `VERCEL_BRANCH_URL`, `VERCEL_PROJECT_PRODUCTION_URL`). |
| `NODE_ENV`                            | Vercel | set by Vercel  | `production`: no development defaults; the server refuses to start without `REDIS_URL` or with localhost origins.                                                                                      |
| `LOG_LEVEL`                           | Vercel | no             | `info` by default.                                                                                                                                                                                     |
| `VITE_SERVER_URL`, `VITE_SOCKET_PATH` | build  | no             | Only to point the client at a different server; leave unset on Vercel.                                                                                                                                 |

Nothing reads or writes the local filesystem at runtime.

## External setup (one time, by the project owner)

1. **Create the Vercel project** from the GitHub repository (Import Project → `classroom-games`).
   Framework preset "Other"; `vercel.json` sets the install/build commands and the output
   directory. Fluid compute must be on (the default for new projects).
2. **Add Redis** from the Vercel Marketplace (e.g. Upstash Redis) and connect it to the project —
   this adds `REDIS_URL`. Upstash's free tier is fine for development and testing.
3. Optional: a custom domain → add it to `ALLOWED_ORIGINS`.
4. Deploy (push to `main`, or a preview deployment of a branch).

Plan note: Vercel Hobby is for personal, non-commercial use; it closes connections after 300 s
(the game reconnects seamlessly) and pauses a feature for 30 days if included usage is exceeded.
Review the plan before a public launch ([audit](design/PRODUCTION_ARCHITECTURE.md)).

## Smoke test

```bash
# Against a deployment:
SMOKE_URL=https://<your-deployment>.vercel.app pnpm smoke

# Locally, a production-style build on one origin (in-memory state unless REDIS_URL is set):
pnpm build
ALLOWED_ORIGINS=http://localhost:4300 pnpm serve:production 4300
pnpm smoke
```

Two separate browsers open the site, create and join a private room, play Dots & Boxes and
exchange moves, then one reloads (a new WebSocket, possibly on another instance): the room,
board and seat must survive. Against `https://` it also checks HTTPS and that the socket is
`wss://` and WebSocket-only. CI runs the same test on every push against the production build
with a real Redis.

## Readiness checklist

| Item                                   | Status                                                                                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Production client build                | ✔ `pnpm build` → `apps/client/dist`                                                                               |
| Production server entry                | ✔ `api/socket.mjs` (Vercel Function); `apps/server/dist/index.js` for a plain Node host                           |
| Environment variables validated        | ✔ zod; production refuses missing Redis / missing or localhost origins                                            |
| WebSocket URL                          | ✔ same origin, `/api/socket/socket.io`, WebSocket transport only                                                  |
| HTTPS / WSS                            | ✔ Vercel TLS; HSTS header; `upgrade-insecure-requests`                                                            |
| Origins / CORS                         | ✔ same origin; allow-list from env / Vercel domains                                                               |
| Security headers                       | ✔ CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` (`vercel.json`) |
| Anonymous sessions across instances    | ✔ in Redis                                                                                                        |
| Reconnect across instances             | ✔ tested (multi-instance tests, smoke test)                                                                       |
| Room state across instances            | ✔ host lease + snapshots + forwarding (ADR-023)                                                                   |
| Instance replacement                   | ✔ hand-over and crash failover tested; timers and bots resume                                                     |
| No localhost assumptions in production | ✔ client and server                                                                                               |
| No filesystem dependency               | ✔                                                                                                                 |
| No dev fixtures in production          | ✔ fixture game off in production (server) and not bundled (client)                                                |
| Health check                           | ✔ `GET /api/socket/healthz`                                                                                       |
| Live deployment                        | ⏳ needs the external setup above, then `SMOKE_URL=… pnpm smoke`                                                  |
| Public matchmaking                     | Phase 9                                                                                                           |

## Other hosts

`apps/server/dist/index.js` still runs as a plain Node server (`node dist/index.js`) behind any
TLS proxy; production mode requires `REDIS_URL` there too, so several instances can share state.
