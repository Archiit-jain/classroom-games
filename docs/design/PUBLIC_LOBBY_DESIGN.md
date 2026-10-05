# Public lobby, matchmaking & Quick Play — design (Phase 9)

**Status:** design for Phase 9, written after auditing the existing code and before
implementation. Source of truth for the product rules: the Phase 9 brief and
[specs/PHASE_0_SPEC.md](../specs/PHASE_0_SPEC.md) §4–§5 (with C8). Owner decisions taken while
writing this document are marked _(owner)_.

---

## 1. Audit of what exists

| Area                 | State today                                                                                                                                                                                                                                                                                                                                                          | Phase 9                                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Room model           | `Room { kind: PRIVATE \| PUBLIC, code, hostId, members, phase LOBBY → STARTING → IN_GAME → RESULTS → CLOSED, match }`; only PRIVATE is ever created                                                                                                                                                                                                                  | Reuse as is; add PUBLIC rooms (no code, no host)                                                                                                           |
| Room policy          | `RoomPolicy { canManage, isJoinable }`; `policyFor()` **throws for PUBLIC**                                                                                                                                                                                                                                                                                          | Add `publicRoomPolicy`                                                                                                                                     |
| Manifests            | `publicMatch: { targetPlayers, minHumans }`, validated by `GameRegistry`                                                                                                                                                                                                                                                                                             | Add `enabled`; set the brief's targets (NPAT 6 → 8, Business 4 → 6)                                                                                        |
| Matchmaking          | **None** (no Quick Play, Any Game, Browse, fill window, bot fill)                                                                                                                                                                                                                                                                                                    | New `Matchmaker`                                                                                                                                           |
| Bots                 | `BotManager` attaches bots to seats; bot members, takeover, reclaim, bot names and badges all work                                                                                                                                                                                                                                                                   | Reused unchanged for public bot fill                                                                                                                       |
| Sessions & reconnect | Anonymous sessions, one active socket per session, 30 s grace, bot takeover during a match, reclaim                                                                                                                                                                                                                                                                  | Reused; the fill rule counts only _connected_ humans                                                                                                       |
| Multi-instance       | **One global host lease** (ADR-023): the host instance runs `HostServices` (sessions, rooms, matches, timers, chat, reports) for every room; other instances are gateways that forward calls over Redis and deliver the host's messages to their sockets. Every change is snapshotted to Redis (fenced writes); a new host restores rooms, runtimes, timers and bots | Matchmaking runs **inside the host** — single-threaded, so seat assignment and room creation are atomic across instances with no new locking or networking |
| Timers               | `TimerService` on the host; deadlines live in room/runtime snapshots and are re-armed (overdue ones fire at once) on restore                                                                                                                                                                                                                                         | Fill window, lone-wait and results timers follow the same pattern                                                                                          |
| Rate limits          | Per-session token buckets on the gateway (`roomCreate`, `roomJoin`, …) and on the host (chat, reports, reactions)                                                                                                                                                                                                                                                    | Matchmaking buckets on the **host** (cross-instance by construction)                                                                                       |
| Client               | Home screen with game cards → private room create / join by code; room lobby with host controls; match and results views                                                                                                                                                                                                                                             | Public entry (Quick Play, Any Game, Browse, per-game Play), matchmaking screen, public room lobby without host controls                                    |
| Docs                 | `PUBLIC_LOBBY_SYSTEM.md` says "not implemented"                                                                                                                                                                                                                                                                                                                      | Rewritten at the end of the phase                                                                                                                          |

Nothing in the existing infrastructure needs a redesign. What is still single-instance in the
sense of "lives in one process" is everything on the host — by design (ADR-023); its state is
in Redis and moves to the next host.

## 2. Owner decisions for this phase

1. **A public match never starts with one human.** A lone player who has waited through the
   fill window may press **Play with Bots**, which moves them into a **private** bots-only
   match (not listed, not public) — C8 kept in that form _(owner)_.
2. **QUICK PLAY plays the last game played on this device** (stored in the browser, no server
   profile), falling back to Any Game when nothing is stored. **ANY GAME** is a separate button
   _(owner)_.
3. **Any Game with no joinable room** creates a room for the **next game in a rotation** _(owner)_.
4. **Disconnects before the start:** the seat is held for the reconnect grace period, but a
   disconnected human **does not count** towards the human minimum; the fill window is cancelled
   if fewer than `minHumans` humans are connected _(owner)_.
5. **One fill window** per room from the moment `minHumans` connected humans are present; later
   joiners do not restart it _(owner)_.
6. **Deployment:** the Vercel project is created from the GitHub repo through the connector; the
   owner adds the Redis (Upstash) database; the smoke test then runs against the real URL _(owner)_.
7. Business is not modified in this phase _(owner)_.

## 3. Per-game public values (from the manifests)

`GameManifest.publicMatch` becomes `{ enabled, targetPlayers, minHumans }`. "Bots can fill" is
the existing `manifest.bots.supported`. The matchmaker reads only the manifest; there are no
per-game constants in platform code.

| Game                    | Game min–max (`players`) | `minHumans` | `targetPlayers` | Bots fill | Public |
| ----------------------- | ------------------------ | ----------: | --------------: | --------- | ------ |
| RMCS                    | 4–4                      |           2 |               4 | yes       | yes    |
| 16 Parchi               | 4–4                      |           2 |               4 | yes       | yes    |
| Draw & Guess            | 3–6                      |           2 |               5 | yes       | yes    |
| Pen Fight               | 2–4                      |           2 |               4 | yes       | yes    |
| Dots & Boxes            | 2–4                      |           2 |               4 | yes       | yes    |
| Name Place Animal Thing | 2–8                      |           2 |   **8** (was 6) | yes       | yes    |
| Business                | 2–6                      |           2 |   **6** (was 4) | yes       | yes    |

`GameRegistry` validates: `2 ≤ minHumans ≤ targetPlayers ≤ players.max`, and `targetPlayers ≥
players.min`. Public rooms use the game's `defaultSettings` (Business: 15 rounds, India Classic,
normal events; NPAT: frozen rules; 16 Parchi: `RANDOM` category; Draw & Guess: 2 rounds;
Dots & Boxes: default grid) — no settings screen in public play.

## 4. Public room lifecycle

```text
                 humans ≥ target (connected)                       3 s
LOBBY:WAITING ─────────────────────────────────────▶ STARTING ─────────▶ IN_GAME
   │  ▲                                                ▲  (unlisted,         │
   │  │ connected humans < minHumans                   │   join closed)      │ match over
   │  │ (window cancelled)                             │                     ▼
   ▼  │            fill window ends (12 s):            │                  RESULTS (15 s)
LOBBY:FILLING ─────── bots fill up to target ──────────┘                     │
   (listed, joinable, countdown shown)                                       │
                                                                             ▼
   ◀──────────── bots removed, humans who chose "Play again" kept, relisted ─┤
                                                                             │
CLOSED ◀── no humans left / nobody chose "Play again" / idle 5 min ──────────┘
```

| State (client label)                      | Server state                            | Listed in Browse | Joinable                        |
| ----------------------------------------- | --------------------------------------- | ---------------- | ------------------------------- |
| **WAITING** "Waiting for another player…" | `LOBBY`, connected humans < `minHumans` | yes              | yes                             |
| **FILLING** "Starting soon… 8 s"          | `LOBBY`, `fillEndsAt` set               | yes              | yes (until full)                |
| **STARTING** "Starting…"                  | `STARTING` (existing 3 s countdown)     | no               | no                              |
| **MATCH**                                 | `IN_GAME`                               | no               | no (reconnect to own seat only) |
| **RESULTS** "Play again / Leave"          | `RESULTS`, `resultsEndsAt` set          | no               | no                              |
| **CLOSED**                                | removed                                 | no               | no                              |

Rules:

- **Start rule.** (1) Connected humans reach `targetPlayers` → STARTING at once. (2) Connected
  humans reach `minHumans` → `fillEndsAt = now + fillWindowMs` (default **12 s**, config
  `matchmaking.fillWindowMs`). (3) Connected humans drop below `minHumans` → window cancelled
  (`fillEndsAt = null`). (4) At `fillEndsAt`: bots are added until the room has `targetPlayers`
  members (never more than `players.max`), then STARTING. The STARTING → IN_GAME step is the
  existing `beginMatch` with the existing bot attachment — the same `BotManager`, `GameModule`
  bots and action pipeline as private rooms.
- **A lone player never starts a public match.** After `fillWindowMs` alone (`loneSince`), the
  client offers **Play with Bots**: the server takes the player out of the public room and
  creates a private room (that player as host) with bots up to `targetPlayers` and starts it.
  The public room, now without humans, closes.
- **Seat assignment:** members are seated in join order at `beginMatch` (existing). Joins are
  checked and applied synchronously on the host — two players can never take the last seat.
- **Disconnects** (owner decision 4): `connected = false`, grace starts (existing); the start rule
  is re-evaluated (may cancel the window). Grace expiry in LOBBY removes the player (existing).
  During STARTING/IN_GAME the existing grace → bot takeover → reclaim flow applies.
- **RESULTS:** 15 s (`matchmaking.resultsMs`) with **Play again** (stay) and **Leave**. When the
  window ends (or every human has answered): leavers and non-answerers are removed, bots are
  removed, and the room returns to `LOBBY` with the staying humans (start rule applies again;
  listed again). No staying human → CLOSED.
- **Cleanup:** existing idle sweep (5 min with no connected humans), plus: a public room closes
  immediately when its last human leaves or their grace expires in LOBBY.
- **No merging** of rooms in v1.

## 5. Matchmaking

All of it runs on the host in `Matchmaker`, called from `HostServices.event`.

**Quick Play / Play (game G)** — `public:play { gameId }`:

1. Reject if the session is in another room (`ALREADY_IN_ROOM`; the client offers to leave);
   if already in a public room of G, return that room.
2. Candidates: PUBLIC rooms of G in `LOBBY` with `members < targetPlayers`.
3. Pick the one with the **most humans**, then the earliest `fillEndsAt`, then the oldest.
4. None → create a public room for G (subject to `limits.maxRooms`), join it.
5. Re-evaluate the start rule.

**Any Game** — `public:play { gameId: null }`: candidates across every public-enabled game;
pick **most humans**, then **fewest free seats** (closer to starting), then oldest. None → create
for the next game in the rotation (catalogue order; the cursor lives on the host).

**Quick Play button** (client): sends the game last played on this device
(`localStorage cg.lastGame`, set when a match starts), else Any Game.

**Browse** — `public:browse { on: boolean }` subscribes/unsubscribes. The flag is kept on the
session (persisted with it), so a new host knows the subscribers after a failover. The host
pushes `public:rooms` — the joinable public rooms (max 50, best first) — on subscribe and
whenever a listed room changes, **coalesced to at most one push per 250 ms**. No polling.
Each entry: opaque room handle (never rendered), `gameId`, humans, `targetPlayers`,
`players.max`, state `WAITING | FILLING`, `fillEndsAt`. Never: instance, Redis, codes.
**Join from Browse** — `public:join { roomId }` re-validates everything; a room that filled or
started returns `ROOM_FULL` / `ROOM_IN_PROGRESS`, and the client refreshes from the feed.

**Cancel** — the existing `room:leave` (works in WAITING/FILLING; rejected after STARTING with
`INVALID_PHASE` for public rooms — leaving a started match is the normal in-match Leave).

## 6. Concurrency, multi-instance and failover

- **Atomicity:** every matchmaking call is a synchronous method on the single host (Node's single
  thread; no `await` between choosing a seat/room and taking it). Players on different instances
  reach the same host via the existing call forwarding, so "two players take the last seat",
  "two players both create a room", "the room starts twice" and "bots fill twice" cannot happen.
- **Persistence:** `fillEndsAt`, `loneSince`, `resultsEndsAt`, the RESULTS answers and the
  session's `browsing` flag are part of the snapshots; restore re-arms the timers from the
  stored deadlines (overdue → fire once).
- **Failover:** a new host restores public rooms like private ones. Writes are fenced, so a
  fenced-off old host cannot write a second bot fill; if the old host filled bots but its last
  write (≤ 100 ms batch) was lost, the new host restores the pre-fill state and fills once.
- Redis carries only what it already carries: snapshots, the host lease, per-instance message
  channels. No new Redis data structures are needed.

## 7. Security and rate limits

- New C2S events (`public:play`, `public:join`, `public:browse`, `public:playWithBots`,
  `public:resultsChoice`) use strict zod schemas; unknown fields are rejected. Game ids must be
  registered and public-enabled; room handles must be existing, joinable public rooms.
- The client never supplies counts, seats, states, bot flags or timers; everything is computed
  on the host. Public rooms reject every host-only command (`NOT_HOST`).
- Host-side buckets (shared by all instances): `matchmaking` (play / join / play with bots,
  burst 5, one per 2 s) and `browse` (burst 5, one per second). Room creation by matchmaking is
  additionally bounded by "only when nothing is joinable" and `limits.maxRooms`.

## 8. Observability

Host counters per hosting term, logged as one structured line every minute when non-zero, and
returned by an operator-only `GET /api/socket/metrics` (enabled only when `METRICS_TOKEN` is set):
matchmaking requests, rooms created, joins, failed joins (by code), cancelled searches, fill
windows completed, bot seats filled, play-with-bots, average and p90 wait (join → STARTING),
browse pushes, host hand-overs. No personal data, no persistent player analytics.

## 9. Client

- **Home:** QUICK PLAY (shows the remembered game), ANY GAME, BROWSE, and the arcade game cards
  with **Play** (public) and **Private room** (existing flow); Join-with-code stays.
- **Matchmaking screen:** SEARCHING → WAITING → FILLING (countdown) → STARTING → match;
  player chips with BOT badges; Cancel; Play with Bots after a lone wait. No room code, no
  host controls, chat and reactions as in any room.
- **Browse:** live room cards (game, humans / target, state, short description, Join).
- 360 px / Pixel 7 / landscape: no sideways scroll, 48 px touch targets, one-handed Quick Play.

## 10. Testing and measurement

Unit/integration on the room manager and matchmaker (selection, creation, atomic seats,
fill window, bot fill, lifecycle, lone wait, results, stale/forged handles, rate limits),
real-socket tests, two-instance tests on Redis (join across instances, browse across
instances, host crash during FILLING with no duplicate fill), reconnect in each state, e2e on
desktop and Pixel 7 (Quick Play, Business, NPAT, Any Game, Browse, bot fill, reconnect, full
room), and the production smoke (two browsers Quick Play into one room, bots fill, play,
disconnect/reconnect). Latency and message counts are measured in the cluster tests and
reported.
