# Public lobby system

Public play (Phase 9): **Home → Quick Play / a game / Any Game / Browse → matchmaking → room
→ game**, with no codes, no host and no settings screen. Design and audit:
[design/PUBLIC_LOBBY_DESIGN.md](design/PUBLIC_LOBBY_DESIGN.md); decision record:
[ADR-027](decisions/ADR-027-public-matchmaking.md).

Code: `apps/server/src/rooms/Matchmaker.ts` (selection, Browse feed),
`apps/server/src/rooms/RoomManager.ts` (public lifecycle: fill window, bot fill, results),
`apps/server/src/rooms/policies.ts` (`publicRoomPolicy`), `MatchmakingMetrics.ts`; client
`apps/client/src/screens/HomeScreen.tsx`, `BrowsePanel.tsx`, `PublicLobbyView.tsx`.

## Ways in

| Button                                  | What happens                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Quick Play**                          | The last game played on this device (`localStorage cg.lastGame`); Any Game if none            |
| **Play** (a game card)                  | That game: join its best open public room, or a new one                                       |
| **Any Game**                            | The best open public room of any game; none open → a new room for the next game in a rotation |
| **Browse games**                        | A live list of open public rooms; tap **Join**                                                |
| **Private room** / **Join with a code** | Unchanged private flow (host, code, settings, bots)                                           |

"Best" room: the most humans; for one game, then the fill window that ends soonest; for Any
Game, then the fewest free seats (closest to starting); then the oldest. Rooms are never
merged.

## Per-game values (from each manifest)

`GameManifest.publicMatch = { enabled, targetPlayers, minHumans }`; bots fill only where
`bots.supported`. Public rooms use the game's `defaultSettings`.

| Game                        | Players | Min humans | Target |
| --------------------------- | ------- | ---------: | -----: |
| Raja Mantri Chor Sipahi     | 4       |          2 |      4 |
| 16 Parchi (random category) | 4       |          2 |      4 |
| Draw & Guess                | 3–6     |          2 |      5 |
| Pen Fight                   | 2–4     |          2 |      4 |
| Dots & Boxes (5 × 5)        | 2–4     |          2 |      4 |
| Name Place Animal Thing     | 2–8     |          2 |      8 |
| Business (15 rounds)        | 2–6     |          2 |      6 |

## Lifecycle

| State (what the player sees)              | Room                                      | Listed / joinable      |
| ----------------------------------------- | ----------------------------------------- | ---------------------- |
| **WAITING** "Waiting for another player…" | `LOBBY`, fewer than `minHumans` connected | yes / yes              |
| **FILLING** "Starting soon… 8s"           | `LOBBY`, fill window running              | yes / until the target |
| **STARTING** "Starting…" (3 s)            | `STARTING`                                | no / no                |
| **MATCH**                                 | `IN_GAME`                                 | no / reconnect only    |
| **RESULTS** Play again / Leave (15 s)     | `RESULTS`                                 | no / no                |
| **CLOSED**                                | removed                                   | —                      |

- **Start rule:** connected humans reach the target → start at once. `minHumans` connected →
  one fill window (`matchmaking.fillWindowMs`, default **12 s**, env `PUBLIC_FILL_WINDOW_MS`;
  later joiners don't restart it). Window ends → bots fill up to the target with the normal
  `BotManager`, then STARTING. Fewer than `minHumans` connected → the window is cancelled.
- **Never one human:** a lone player keeps waiting. After waiting alone for the fill window,
  **Play with bots** takes them out of the public room into a private room with bots (they are
  its host) — the public match itself never starts with one human.
- **Cancel:** `room:leave` while WAITING/FILLING; refused while STARTING; in a match it is the
  normal Leave (a bot takes the seat).
- **Results:** Play again keeps the player for another match; Leave or no answer within 15 s
  leaves. Bots are removed and the stayers go back to WAITING/FILLING; nobody staying closes
  the room.
- **Cleanup:** a public room closes when its last human is gone (left, or grace expired in the
  lobby), or after 5 min without a connected human.

## Reconnect

The usual anonymous-session reconnect. In the lobby a disconnected player keeps their seat for
the 30 s grace period but does not count towards `minHumans` (the window pauses); reconnecting
reopens it. In STARTING and IN_GAME the normal grace → bot takeover → "I'm back" flow applies.
After a reconnect the client resubscribes to Browse if it was browsing.

## Browse feed

`public:browse { on }` subscribes; the subscription is stored on the session (so a new room
host continues it after a failover). The host pushes `public:rooms` — up to 50 open rooms,
best first — on subscribe and whenever a listed room changes, coalesced to one push per
250 ms. Each entry: an opaque room handle (never shown), game, humans, target, max,
WAITING/FILLING, fill deadline. Joining re-checks everything; a room that just filled or
started answers `ROOM_FULL` / `ROOM_IN_PROGRESS` and the feed refreshes.

## Multi-instance

Everything above runs on the single room host (ADR-023): players on other instances reach it
through the existing call forwarding, so seat assignment, room creation, the start and the
bot fill each happen once, in one synchronous step. Fill and results deadlines are part of the
room snapshot in Redis; after a host failover the new host restores the same room and
deadline (tested with a host crash mid-fill: one start, two bots).

## Security and limits

Strict schemas on every `public:*` event (unknown fields rejected); counts, seats, states,
timers and bot flags are computed on the host only; public rooms refuse host commands
(`NOT_HOST`). Host-side buckets per player (shared by all instances): `matchmaking`
(play / join / play with bots: burst 5, one per 2 s) and `browse` (burst 5, one per second),
plus the gateway's coarse per-socket guards.

## Metrics

Per hosting term: requests, rooms created, joins, failed joins by code, cancelled searches,
fill windows completed, bot seats filled, matches started, play-with-bots, Browse pushes,
host takeovers, and wait time (join → start: average, p90). Logged once a minute when
something changed; readable at `GET /api/socket/metrics` with `Authorization: Bearer
$METRICS_TOKEN` (disabled when `METRICS_TOKEN` is unset). No personal data.

Measured (two instances, in-process store, 40 players, `PERF=1 pnpm vitest run
public.perf`): create a room 0.7–1.4 ms average (slowest 1.9–8.3 ms, the first rooms while the code warms up), join 0.6–0.7 ms (p90 0.8–1.2 ms) over two runs, end to end through a gateway to the
host; about 11 cross-instance messages per player including connecting and naming; 2 store
commits for 40 joins (batched); 2 Browse pushes for 40 joins (coalesced). Real Redis adds its
network round trip to each forwarded call.
