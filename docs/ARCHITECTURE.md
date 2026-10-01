# Architecture

This document describes the system **as implemented** (Phase 1). The full approved design,
including parts not built yet, is in [specs/PHASE_0_SPEC.md](specs/PHASE_0_SPEC.md).

## Components

```mermaid
flowchart LR
  subgraph Browser["Browser (apps/client)"]
    UI["Screens<br/>Home · Lobby · Match · Results"]
    Conn["GameConnection<br/>socket · store · clock sync"]
    Boards["Game boards<br/>(lazy, per game)"]
    UI --- Conn
    UI --- Boards
  end

  subgraph Server["Node server (apps/server)"]
    T["Transport<br/>rate limit → schema → handler"]
    S["SessionManager"]
    R["RoomManager"]
    RT["GameRuntime<br/>(one per match)"]
    B["BotManager"]
    C["ChatService"]
    Rep["ReportService"]
    M["Moderator<br/>(@cg/moderation)"]
    Reg["GameRegistry"]
    Tim["TimerService"]
    Store[("InMemoryRoomStore")]
    T --> S & R & C & Rep
    R --> RT & Store & B
    RT --> Tim
    RT -. game modules .-> Reg
    B --> RT
    C --> M
    C --> R
  end

  Conn <-- "Socket.IO<br/>acked intents ↑ · filtered updates ↓" --> T
```

| Component       | Location                             | Responsibility                                                                                                                                                   |
| --------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transport       | `apps/server/src/transport/`         | Origin check, per-IP connection cap, handshake → session, per-socket flood guard, per-event rate limit, zod validation, acknowledgements, fan-out via `Notifier` |
| SessionManager  | `apps/server/src/session/`           | Anonymous identities, secret tokens (stored hashed), one active socket per session, nicknames                                                                    |
| RoomManager     | `apps/server/src/rooms/`             | Room lifecycle, membership, host, bots, reconnect grace, bot takeover/reclaim, match start/finish/abort                                                          |
| RoomStore       | `apps/server/src/rooms/RoomStore.ts` | Storage interface; v1 = in memory                                                                                                                                |
| GameRuntime     | `apps/server/src/runtime/`           | Hosts one match: runs the pure engine, schedules its timers, fans out per-seat views/events                                                                      |
| GameRegistry    | `apps/server/src/runtime/`           | `gameId → GameModule`, manifest sanity checks                                                                                                                    |
| BotManager      | `apps/server/src/bots/`              | Drives bot seats through the same action path as humans                                                                                                          |
| ChatService     | `apps/server/src/chat/`              | Room chat pipeline and quick reactions (validated, rate-limited, fanned out with the sender's seat)                                                              |
| ReportService   | `apps/server/src/reports/`           | Player reports → `ReportSink` (v1: bounded in-memory flags)                                                                                                      |
| Moderator       | `packages/moderation`                | Text normalisation, profanity censoring, contact-detail removal, nickname checks                                                                                 |
| Protocol        | `packages/protocol`                  | Event names/payload types, error codes, view types; zod schemas at `@cg/protocol/schemas` (server only)                                                          |
| Game SDK        | `packages/game-sdk`                  | Game contract, seeded RNG, audience helpers, test harness, fixture game, client module types                                                                     |
| Client platform | `apps/client/src/platform/`          | `GameConnection` (socket + store), clock offset, storage, action sender (ids, double-tap coalescing), animation director, effects controller                     |
| Design system   | `packages/ui`                        | Color Burst Arcade tokens/styles + animated primitives shared by screens and game boards ([ADR-015](decisions/ADR-015-shared-ui-package.md))                     |
| Games           | `games/<id>`                         | Each game's shared types, pure engine + bot (server) and board (client) — `games/rmcs`, `games/sixteen-parchi`                                                   |

## Request path (one game action)

```mermaid
sequenceDiagram
  participant P as Player's browser
  participant T as Transport
  participant R as RoomManager
  participant RT as GameRuntime
  participant E as Game engine (pure)
  participant O as Other players / bots

  P->>T: match:action {matchId, version, actionId, action} + ack
  T->>T: socket flood guard, rate limit, zod schema
  T->>R: submitAction(session, …)
  R->>R: is this player seated? is a bot playing for them?
  R->>RT: submitAction(seat, version, actionId, action)
  RT->>RT: version issued? actionId never seen before? (else STALE_VERSION / DUPLICATE_ACTION)
  RT->>E: actionSchema.parse · validateAction(state, seat, action)
  alt illegal
    RT-->>P: ack {ok:false, code}
  else legal
    RT->>E: applyAction(state, seat, action, ctx)
    E-->>RT: Transition {state, events (with audiences), timers, requests}
    RT->>RT: commit: version++, (re)schedule timers
    loop every seat
      RT->>O: match:update {version, events visible to that seat, view for that seat}
    end
    RT-->>P: ack {ok:true, version}
  end
```

## Key design rules

1. **Pure engines.** Engines never use `Date.now()`, `Math.random()`, I/O or in-place
   mutation. They get `ctx.now` and a seeded `ctx.rng`. The test harness deep-freezes
   state to catch mutation. → [ADR-004](decisions/ADR-004-pure-engines-seeded-rng.md)
2. **Views + events.** Every transition sends each seat a complete filtered **view** plus
   the **events** it may see (for animation). No diff protocol. →
   [ADR-003](decisions/ADR-003-socketio-view-event-sync.md)
3. **Visibility at emission.** Engines attach an audience (`ALL`, `SEATS`, `ALL_EXCEPT`) to
   each event; the runtime delivers only matching events.
4. **One transition at a time.** `GameRuntime` runs all inputs (actions, timers, seat
   changes, chat consumption) through a synchronous queue, so re-entrant calls from hooks
   (e.g. a bot takeover requested by the engine) never interleave.
5. **Engines only know seats.** Session ids, sockets and connection state stay in the
   platform; engines hear about them through `onSeatChange`.
6. **Errors are codes.** The server never sends user-facing English; the client maps codes
   to translated messages.
7. **Replaceable edges.** `RoomStore`, `Moderator`, `ReportSink` are interfaces with one
   v1 implementation each.

## Client architecture

- `GameConnection` owns the single Socket.IO connection and an external store
  (`useSyncExternalStore`). Components read state with `useAppState()` and send requests
  with `connection.request(event, payload)`, which resolves to the server's ack (or a
  client-side `TIMEOUT`/`OFFLINE` code).
- Screens: `HomeScreen` → `RoomScreen` (`LobbyView` | `MatchView` | `ResultsView`) + `ChatPanel`.
- Game boards are lazy-loaded per game from `apps/client/src/games/registry.ts`. A game is
  offered only if both the server (`session:ready.games`) and the client registry know it.
- **Clock sync:** 5 `time:ping` round trips; the median offset converts server deadlines
  into local countdowns (`connection.msUntil(serverTs)`).
- **Game actions** go through `connection.sendAction`, which attaches a fresh `actionId`
  and coalesces an identical action still awaiting its ack (double taps).
- **Animation director:** match updates reach the director directly from the connection;
  it presents them one at a time, waiting for each update's event animations (declared by
  the game's `eventDuration`) and fast-forwarding when more than 1.5 s would pile up
  ([ADR-016](decisions/ADR-016-animation-director.md)).
- **Effects modes** `full` / `lite` / `reduced`: OS reduced motion → reduced; otherwise the
  player's Auto/Full/Lite choice (header toggle); Auto picks lite on low-end devices. The
  mode feeds Motion (`EffectsRoot`), CSS (`html[data-effects]`) and every board.

## Internationalisation

All UI text lives in `apps/client/src/i18n/en.ts`; components call `t('section.key', params)`.
Keys are type-checked (a typo is a compile error). Error codes map to `errors.<CODE>` and the
catalog is checked to cover every server error code. Game-specific text lives in each game's
client module (`messages`). Adding a language = adding a catalog with the same shape. →
[ADR-010](decisions/ADR-010-typed-i18n-catalog.md)

## Scaling (not built)

v1 is one Node process with in-memory state. Game state and timers live in the process that
hosts a room, so scaling out needs room affinity (each room pinned to one instance), sticky
sessions, the Socket.IO Redis adapter for cross-instance broadcast, and a shared
`RoomStore`. → [ADR-005](decisions/ADR-005-in-memory-room-store.md)
