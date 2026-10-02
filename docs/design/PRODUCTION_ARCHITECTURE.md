# Production architecture — deployment audit and design

**Status:** Phase 6 design pass, written before implementation; **built in Phase 6** — see
[ADR-023](../decisions/ADR-023-multi-instance-cluster.md) and [DEPLOYMENT.md](../DEPLOYMENT.md).

> **Implementation notes.** One cluster-wide host lease replaced the per-room leases proposed
> in §4 (same guarantees, far fewer moving parts; sharding by room stays possible). Proven by
> 11 multi-instance tests (in memory locally, real Redis in CI: cross-instance play, reconnect
> on another instance, hand-over, crash failover with timers and bots resuming, fencing) and a
> production smoke test against the bundled Vercel Function. Not yet run on a live Vercel
> deployment (needs the owner's Vercel project and Redis).
> **Goal:** Classroom Games runs as a real public website — HTTPS/WSS on a normal domain, many
> players on different devices and networks, Vercel as the primary deployment target — while
> local development keeps the simple in-memory setup.

> **Decision status.** **Facts** below come from Vercel's documentation as of October 2026
> (sources in §8) and from the code. **Decided by the product owner (Phase 6):** option A —
> Vercel for the web application and realtime server + Redis for shared multiplayer state and
> cross-instance messaging; no separate always-on server unless evidence later shows Vercel
> cannot support it. Vercel Hobby is for personal/non-commercial use and is **not** unlimited
> free hosting; Upstash's free tier is for initial development and testing. Other proposals
> are marked _(proposed)_.

## 1. What Vercel actually provides (verified, not assumed)

| Fact                                                                                                                                                                                              | Consequence for us                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| WebSockets on Vercel Functions are in **public beta** (since 22 June 2026), on all plans, with **Fluid compute**. Socket.IO works if the client uses the `websocket` transport.                   | A Socket.IO game server _can_ run as a Vercel Function. Our client currently allows HTTP long-polling — must be websocket-only. |
| A connection is **pinned** to the instance that accepted it; **new connections and reconnects can land on any instance**; after a deploy, old connections stay on the old deployment.             | Two players in one room can be on **different instances**. A reconnect can land on an instance that has never seen the room.    |
| Connections **close at the function's maximum duration**: Hobby **300 s**; Pro 300 s default, up to 800 s (1,800 s in beta).                                                                      | Every player is disconnected at least every 5 min (Hobby) / ~13 min (Pro) and must resume on whichever instance they reach.     |
| **No cross-instance broadcast.** Vercel's guidance: keep rooms, presence and pub/sub in an external store, e.g. Redis from the Vercel Marketplace.                                                | `io.to(socketIds)` (our notifier) only reaches sockets on the same instance.                                                    |
| Billing: Active CPU only while code runs, but **Provisioned Memory for the whole instance lifetime**, including idle open sockets. Hobby includes 4 CPU-h, **360 GB-h**, 1 M invocations a month. | One 1 GB instance kept alive 24/7 is ~720 GB-h → twice the Hobby allowance. Long-lived sockets cost memory-hours, not CPU.      |
| Hobby: **personal, non-commercial use only**; exceeding included usage means waiting **30 days** to use the feature again. Pro: $20/user/month + usage, spend management.                         | A popular public site on Hobby could lose its game server for a month. Hobby is fine for development and the smoke test.        |
| Upgrade requests pass through Vercel's routing, Firewall rules and rate limits.                                                                                                                   | Per-IP limits can be enforced at the edge, not only in our process.                                                             |

## 2. Audit: every piece of server state

| State (file)                                                                                                 | Today                        | Must be shared across instances?          | Why                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Sessions: token hash → session (`SessionManager`)                                                            | Process memory               | **Yes**                                   | A reconnect (forced every ≤ 5 min) lands anywhere; the token must resolve there.                                                |
| Rooms + room-code index (`InMemoryRoomStore`, `Room`)                                                        | Process memory               | **Yes**                                   | Joining by code, reconnecting and players on other instances all need the room.                                                 |
| Live match: `GameRuntime` (state, version, seen action ids), seats, takeovers                                | Process memory (live object) | **Yes** (as a snapshot)                   | Must survive the hosting instance going away; action-id/version protection must hold.                                           |
| Timers: phase timers, bot think/plan timers, reconnect grace, starting countdown, room idle (`TimerService`) | Process `setTimeout`         | **Yes** (as deadlines)                    | An instance with no sockets is paused; its timers stop.                                                                         |
| Bot seats (`BotManager`)                                                                                     | Process memory               | Rebuildable                               | Derived from seats + view; recreated wherever the room is hosted.                                                               |
| Outgoing messages (`socketNotifier`: `io.to(socketIds)`)                                                     | Local sockets only           | **Needs cross-instance delivery**         | Recipients may be connected to other instances.                                                                                 |
| Session displacement (second tab → `session:displaced`)                                                      | Local socket id              | **Needs cross-instance delivery**         | The old tab may be on another instance.                                                                                         |
| Chat buffer (last 50 room messages)                                                                          | In `Room`                    | Yes (with the room)                       | History for reconnecting players.                                                                                               |
| Rate-limit buckets, chat cooldowns (`RateLimiter`, `ChatService`)                                            | Process memory               | Per-connection is acceptable _(proposed)_ | A session has one socket at a time; resetting on reconnect is a minor loss. Upgrade requests are rate-limited at Vercel's edge. |
| Per-IP connection count, new-session-per-IP limit (`attachTransport`, `SessionManager`)                      | Process memory               | Partly                                    | New-session-per-IP must be shared (cheap counter); concurrent connections per IP → Vercel Firewall.                             |
| Report flags (`InMemoryFlagStore`)                                                                           | Process memory, 24 h         | Yes (small)                               | Otherwise lost when an instance recycles.                                                                                       |
| Game registry, moderator, config                                                                             | Built at start-up            | No                                        | Identical on every instance.                                                                                                    |
| Filesystem                                                                                                   | **Not used**                 | —                                         | ✔ No change needed.                                                                                                             |

**Conclusion:** on Vercel Functions, shared state and cross-instance messaging are **required for
correctness**, not a convenience. Without them, players in the same room on different instances
cannot see each other, and every forced reconnect (≤ 5 min on Hobby) loses the room.

## 3. Options

| Option                                                                                         | What changes                                                                                                                             | Cost (rough)                                                                                                                                                 | Verdict                                                                                          |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| **A. All on Vercel: static client + Socket.IO Function + one Redis** _(proposed, recommended)_ | A cluster layer (§4): sessions, room snapshots and deadlines in Redis; one "host" instance per room; messages relayed between instances. | Hobby: free for development/smoke tests. Public launch: Vercel Pro ($20/month + usage) + Redis (Upstash free tier 500 K commands/month, then pay-as-you-go). | Meets the brief: Vercel-only, real multi-instance correctness, no database. Largest code change. |
| B. Vercel for the website + one always-on Node server elsewhere (container host)               | Almost nothing (websocket-only client, same-origin defaults, CSP).                                                                       | A small always-on container (free tiers usually sleep → "Waking up…" delays).                                                                                | Simplest and robust, but the realtime server is not on Vercel and is a single instance.          |
| C. Vercel Functions without shared state                                                       | —                                                                                                                                        | —                                                                                                                                                            | **Rejected:** breaks rooms whenever players land on different instances (§2).                    |
| D. Fully stateless (every action reloads/locks/saves the room in Redis, no host instance)      | Every engine call made async around Redis; timers become a distributed scheduler.                                                        | More Redis commands per action.                                                                                                                              | Rejected for now: much larger rewrite than A for no player-visible gain.                         |

A managed realtime service (Ably, Pusher…) is not proposed: it would replace Socket.IO, the
transport, acks and our action-id/version protections — a second networking model.

## 4. Proposed design for option A: "room host" cluster layer

The idea: keep today's correct single-process engine, but make **one instance at a time the host
of each room**, with Redis as the shared memory and the message bus.

```text
            Browser A ──WSS──▶ instance 1 (host of room R: live Room + GameRuntime + timers + bots)
            Browser B ──WSS──▶ instance 2 ──forward command──▶ Redis channel inst:1 ──▶ instance 1
instance 1 ──per-player update──▶ local socket (A)  |  Redis channel inst:2 ──▶ instance 2 ──▶ B
instance 1 ──after every change──▶ Redis: room:R snapshot (state, version, seen ids, deadlines)
```

- **Shared store (one Redis):** `session:<tokenHash>` (TTL = session expiry), `room:<id>` snapshot
  (JSON, written after every change), `code:<code>` → room id (SET NX), `room:<id>:host` →
  `{instanceId, epoch}` lease (TTL 15 s, renewed every 5 s), `player:<id>:inst` → instance holding
  their socket, small counters (new sessions per IP per minute), report flags (TTL 24 h).
- **Host instance** runs the existing synchronous `RoomManager`/`GameRuntime`/`BotManager` code for
  the room, unchanged in spirit. It writes the snapshot after each transition and keeps its timers.
- **Commands** (`match:action`, `chat:send`, `room:*`…) arriving at a non-host instance are forwarded
  to the host's channel and the ack is relayed back. Action ids and versions are checked by the host
  exactly as today (the seen-id set travels in the snapshot).
- **Delivery:** the host sends each player's update to their socket locally if it has it, otherwise
  to the instance in `player:<id>:inst`. Local-first means a room whose players share an instance
  (the common case with Fluid compute's packing) costs almost no Redis traffic.
- **Handoff:** a host keeps a room only while it holds at least one of the room's sockets (that is
  what keeps a Fluid instance alive). When it holds none, or its lease lapses (instance paused or
  recycled), the next instance that receives a command or reconnect for the room takes the lease
  (atomic SET NX with a higher epoch), restores the snapshot, re-arms timers from stored deadlines
  (overdue ones fire at once — e.g. an expired reconnect grace hands the seat to a bot) and
  re-attaches bots. Snapshot writes are fenced by epoch, so a stale host can never overwrite.
- **Nobody connected:** no timers run (nobody is waiting); the room resumes when someone returns,
  and rooms idle past the close time expire by TTL.
- **Local development and tests:** the in-memory implementations behind the same interfaces — one
  process is always the host, no forwarding, no Redis. `REDIS_URL` unset ⇒ in-memory (and in
  production the server **refuses to start** without it, so a misconfigured deploy fails loudly).

**Interfaces** (existing ones kept): `RoomStore` (+ snapshot save/restore), a new `SessionStore`,
`HostLease`, `ClusterBus` (forward / deliver / displace), `SharedCounters`. Engines, the game SDK,
the protocol and the client stay as they are, apart from the client settings in §5.

**Cost estimate (to be measured in the spike, §6):** per action ≈ 1 snapshot write + 1 lease
renewal per 5 s + one publish per remote recipient. Draw & Guess strokes relayed to remote
guessers are the heaviest traffic (≈ 16 publishes/s per remote guesser while drawing); local-first
delivery avoids them when players share an instance.

## 5. Platform readiness checklist (whole platform)

| Item                                  | Today                                                                                       | Needed                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Production client build               | ✔ `vite build` → static `dist/`                                                             | Vercel static output config.                                                                               |
| Production server entry               | `node dist/index.js` (long-running `listen()`)                                              | A Vercel Function entry exporting the HTTP server (no `listen`), plus the existing Node entry for local/B. |
| Production WebSocket URL              | ✘ falls back to `http(s)://<hostname>:3001` when `VITE_SERVER_URL` is unset                 | Same origin by default in production (`wss://<site>/api/socket…`); env var only to override.               |
| WSS / HTTPS                           | ✔ via the platform's TLS                                                                    | Websocket-only transport (no polling); `path` for the function route.                                      |
| CORS / origins                        | Dev localhost list is the default; unset `ALLOWED_ORIGINS` in production refuses real sites | Same-origin needs no CORS; in production default to the deployment's own domain, never localhost.          |
| Environment variables                 | ✔ zod-validated config                                                                      | Add `REDIS_URL`; production refuses to start without it (option A); document all variables.                |
| Anonymous sessions                    | In memory                                                                                   | Shared `SessionStore` (§4).                                                                                |
| Reconnect                             | ✔ grace, resync, stream replay (single process)                                             | Works across instances via snapshot + handoff; forced reconnect every ≤ 5 min must be invisible in play.   |
| Room state across instances           | ✘ single process                                                                            | Cluster layer (§4).                                                                                        |
| No localhost assumptions              | ✘ client fallback (above); dev origins default                                              | Fix both.                                                                                                  |
| No filesystem dependency              | ✔ none                                                                                      | —                                                                                                          |
| No dev fixtures in production         | ✔ fixture game off when `NODE_ENV=production` (server) and excluded from the client build   | Add a test that the production catalogue is exactly the seven product games (currently four + D&B).        |
| Dev-only shortcuts in production code | ✔ `GAME_TIME_SCALE` ignored in production                                                   | Keep; test it.                                                                                             |
| Health check / shutdown               | `GET /healthz`, SIGTERM drain                                                               | `/api/health` on Vercel; with state in Redis an instance stopping loses nothing.                           |
| Security headers / CSP                | Not set                                                                                     | `vercel.json` headers: CSP (self + `wss:` same origin), HSTS, `X-Content-Type-Options`, frame-ancestors.   |
| Rate limits                           | In-process                                                                                  | Per-socket buckets stay; new-session-per-IP shared; Vercel Firewall rule on the upgrade path.              |
| Logs                                  | ✔ JSON lines to stdout                                                                      | Vercel runtime logs (1 h on Hobby).                                                                        |
| Public matchmaking                    | Not built (Phase 9)                                                                         | Out of scope; the design must not block it (lobby index in Redis later).                                   |

## 6. Measure before building

The first implementation step is a **deployment spike** (a throwaway branch, deployed as a Vercel
preview): the current server as a Function with websocket-only Socket.IO, instrumented to log the
instance id per connection. It measures, on the real platform: how often two browsers land on
different instances, the forced-disconnect interval, reconnect time, cold-start time, memory per
instance, and Redis command counts for a scripted match of each game. The cluster layer is then
built to what the spike shows — no further.

## 7. Decision (product owner, Phase 6)

**Option A** — all on Vercel + one Redis. Development and the smoke test use free tiers (Vercel
Hobby, Upstash free); a public launch should revisit the Vercel plan (Hobby is non-commercial,
cuts connections at 300 s and pauses for 30 days when usage is exceeded). Connecting the Vercel
project and adding Redis from the Vercel Marketplace are the owner's external setup steps.

## 8. Sources

- [Vercel — WebSockets (Functions)](https://vercel.com/docs/functions/websockets)
- [Vercel KB — Do Vercel Functions support WebSocket connections?](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections)
- [Vercel KB — Publish and subscribe to realtime data on Vercel](https://vercel.com/kb/guide/publish-and-subscribe-to-realtime-data-on-vercel)
- [Vercel — Fluid compute pricing](https://vercel.com/docs/functions/usage-and-pricing)
- [Vercel — Hobby plan](https://vercel.com/docs/plans/hobby)
- [Upstash vs Redis Cloud (2026)](https://upstash.com/blog/upstash-vs-redis-cloud-a-2026-comparison) — Upstash free tier: 500 K commands/month, 256 MB; TCP Redis protocol (pub/sub capable) and REST.
