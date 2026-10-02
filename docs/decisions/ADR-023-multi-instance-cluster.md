# ADR-023: Multi-instance production — one host lease, gateways, shared state in Redis

**Status:** Accepted (Phase 6). Supersedes the production parts of
[ADR-005](ADR-005-in-memory-room-store.md) (in-memory rooms) and
[ADR-009](ADR-009-static-client-websocket-server.md) (separate WebSocket host). Owner decision:
Vercel for the web application and realtime server + Redis for shared state.

## Context

On Vercel Functions (WebSockets in public beta since June 2026, Fluid compute) each WebSocket
is pinned to one instance, but new connections and reconnects can reach any instance; Hobby
closes every connection after 300 s; there is no cross-instance broadcast; an instance with no
open requests is paused. The server kept sessions, rooms, live matches, bots and every timer in
one process's memory and delivered messages only to its own sockets — correct only for a single
long-running process. Audit: [design/PRODUCTION_ARCHITECTURE.md](../design/PRODUCTION_ARCHITECTURE.md).

## Decision

- **Every instance is a gateway** for the sockets it holds: origin check, connections per IP,
  flood guard, per-event rate buckets and payload schemas stay local; clock pings are answered
  locally; everything else is forwarded to the host.
- **Exactly one instance at a time is the host** of all rooms (`cg:host` lease in Redis, with a
  monotonic epoch). It runs the existing authoritative services — sessions, rooms, matches,
  chat, reports, bots, timers — unchanged in behaviour (`HostServices`, one per hosting term).
  The design document proposed a lease per room; one lease for all rooms gives the same
  guarantees with far fewer moving parts. Sharding the lease by room remains possible later if
  one instance's CPU ever becomes the limit.
- **Messaging:** gateway → host requests and host → gateway replies/deliveries travel on
  per-instance Redis pub/sub channels (`cg:to:<instance>`); a host's messages to its own sockets
  never touch Redis. Requests still waiting on a former host are retried at once when a new host
  announces itself.
- **State:** the host writes every changed session and room (`cg:s:*`, `cg:r:*`) to Redis in
  100 ms batches; each write is a Lua compare-and-set **fenced by the lease**, so a host that
  lost its lease can never overwrite. A room snapshot includes the match runtime's state,
  version, RNG position, processed action ids and timer deadlines, the reconnect-grace deadlines
  and the start countdown.
- **Hand-over:** a host with no sockets left (Vercel would pause it) flushes, releases the lease
  and announces it; an instance with players takes over. A crashed or paused host's lease
  expires (15 s) and the watchdog on an instance with players takes over. The new host restores
  every room: runtimes, timers (overdue ones fire at once, in order), bots re-attached, players
  of vanished instances (heartbeat expired) marked disconnected — so their 30 s grace and bot
  takeover work as before — and every connected player is resent the authoritative state.
- **Local development and tests** use the same code with `MemorySharedStore` and one process
  (always host). Production (`NODE_ENV=production`) refuses to start without `REDIS_URL`.
- **Vercel specifics:** `api/socket.mjs` re-exports a self-contained bundle of the server
  (`apps/server/dist/vercel.mjs`); request URLs for the Function route are normalised to the
  Socket.IO path; the client uses the WebSocket transport only (polling cannot work across
  instances) and its own origin by default.

## Consequences

- Multiplayer stays correct with any number of instances, forced reconnects and deploys.
- One Redis is the only added service (Upstash from the Vercel Marketplace; any Redis 6+ works).
- Redis traffic: about one state write per 100 ms of activity plus one message per remote
  recipient; players on the host's own instance cost nothing extra.
- A host failure loses at most ~100 ms of changes; players may see a short pause (≤ lease TTL
  for a crash, a few ms for a hand-over).
- Per-socket rate buckets and chat cooldowns reset when an instance changes (minor; edge rate
  limits on Vercel cover abuse).
- A bot's in-progress drawing plan (Draw & Guess) does not survive a hand-over; the bot simply
  stops drawing that turn.
