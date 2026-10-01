# Game system

How games plug into the platform. Contract source: `packages/game-sdk/src/contract.ts`
(server) and `packages/game-sdk/src/client.ts` (client).

## The server-side contract: `GameModule`

A game is an object implementing:

| Member                               | Purpose                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `manifest`                           | id, player range, sync style, bot support, public-match sizes, reclaim policy, layout hint |
| `settingsSchema`, `defaultSettings`  | Host-editable settings, validated by zod                                                   |
| `actionSchema`                       | Shape of a player action (validated before `validateAction`)                               |
| `setup(seats, settings, ctx)`        | Initial state + opening events + timers                                                    |
| `validateAction(s, seat, a)`         | Is this action legal _now_? Returns `{ok}` or a `GameErrorCode`                            |
| `applyAction(s, seat, a, ctx)`       | Returns the next `Transition`                                                              |
| `onTimer(s, timerId, ctx)`           | Engine-owned timers (turn clocks, reveals…)                                                |
| `onSeatChange(s, seat, change, ctx)` | `DISCONNECTED` · `RECONNECTED` · `BOT_TOOK_OVER` · `RECLAIMED` · `LEFT`                    |
| `getPlayerView(s, seat)`             | Everything this seat may know — and nothing more                                           |
| `isOver(s)`, `getResults(s)`         | End detection and placements (ties share a place)                                          |
| `bot`                                | `createMemory` / `observe` / `decide`                                                      |
| `chat?`                              | Optional chat interceptor (e.g. guess checking)                                            |
| `stream?`                            | Required for `STREAMED` games (runtime wiring arrives with the first streamed game)        |
| `canReclaimSeat?`                    | For `NEXT_PHASE_BOUNDARY` games: may the human take the seat back now?                     |

### Transitions

```ts
interface Transition<S, E> {
  state: S; // the new state (never mutate the old one)
  events: Scoped<E>[]; // each event with its audience
  timers?: TimerCommand[]; // { set: 'turn', ms: 10000 } | { clear: 'turn' }
  requests?: RuntimeRequest[]; // { type: 'MARK_IDLE', seat } → platform puts a bot in
}
```

Audience helpers: `toAll(e)`, `toSeats([1], e)`, `toAllExcept([1], e)`.

### Rules for engines

- **Pure:** no `Date.now()`, no `Math.random()`, no I/O, no mutation. Use `ctx.now` and
  `ctx.rng` (seeded; `int`, `pick`, `shuffle`).
- **Serialisable** state and events (plain JSON-like data).
- **Deadlines in views** are server timestamps (`ctx.now + ms`); the client converts them.
- **Timeouts must make progress** (auto-move, skip turn…) so a silent player never stalls
  a match. Ask for `MARK_IDLE` after repeated timeouts; the platform then puts a bot in the
  seat (if `manifest.bots.canTakeOverSeat`).
- **Hidden information:** never put another seat's secret into a view or into an event
  whose audience includes that seat.

## Runtime behaviour

`GameRuntime` (`apps/server/src/runtime/GameRuntime.ts`):

1. Validates actions (`actionSchema` → `validateAction`) and rejects illegal ones with an
   error code. The engine decides legality against the **current** state.
2. **Action versions and ids** ([ADR-014](decisions/ADR-014-lenient-action-versions.md)):
   clients send the `version` of the view they acted on plus a unique `actionId`. Versions
   the server never issued are rejected with `STALE_VERSION`; older versions are accepted
   because legality is re-checked against the current state (simultaneous games and claim
   races keep working). Each `actionId` executes at most once per match — repeats get
   `DUPLICATE_ACTION`, so double taps and replays can never count twice.
3. Commits transitions one at a time (queue), bumps `version`, schedules timers under
   `match:<matchId>:<timerId>`, and delivers to **every seat** a `MatchUpdate`:
   `{matchId, gameId, version, you, events, view, serverNow}`.
4. Forwards `requests` to the room, detects the end (`isOver` → `getResults`), clears
   timers.
5. If the engine throws, the match is aborted and the room returns to its lobby
   (`MATCH_ABORTED`); the server keeps running.

## Sync styles

| Style        | Meaning                                                  | Status                                   |
| ------------ | -------------------------------------------------------- | ---------------------------------------- |
| `TURN_PHASE` | Phases/turns; every change is a transition               | Implemented                              |
| `STREAMED`   | Also has a high-frequency stream (drawing strokes)       | Contract only; runtime wiring in Phase 4 |
| `SIMULATED`  | Server simulates physics and sends keyframes in an event | Uses the normal path; physics in Phase 5 |

## The client-side contract: `GameClientModule`

```ts
interface GameClientModule<V, A, E, Settings> {
  id: string;
  messages: MessageCatalog; // game UI strings ("name", "description" required)
  accent: Accent; // pink | yellow | cyan | lime | orange | violet (game card, header)
  Icon: ComponentType<{ size?: number }>; // small inline-SVG game icon
  Board: LazyComponent<BoardProps>; // renders view, animates events
  Settings?: LazyComponent<SettingsProps>; // host settings form in the lobby
  eventDuration?(event: E, effects: EffectsMode): number; // ms, paces the animation director
  resultStats?: { key: string; labelKey: string }[]; // results-screen columns from GameResults.stats
}
```

`BoardProps`: `view` and `events` of the **presented** update (the animation director may
hold the newest one back while the current one animates), `version`, `me` (seat), `seats`
(names/controllers), `send(action) → Promise<boolean>` (the platform attaches an
`actionId`, coalesces double taps and shows any error), `effects` (`full` / `lite` /
`reduced`), `msUntil(serverTs)`.

Boards build their UI from the shared design system (`@cg/ui`: `Avatar`, `PaperChit`,
`CountdownRing`, `RollingNumber`, `Stamp`, `ConfettiBurst`, `durationFor`) and Motion.

**Results screen:** the platform shows a podium and a ranking table; each entry in
`resultStats` adds a column read from `getResults(s).stats[seat][key]` (RMCS: `score`).

## The fixture game ("Count Up")

`packages/game-sdk/src/fixture/` — a tiny game that exercises every platform feature: a
private secret per seat, turns, a turn timer with auto-move, idle requests, a bot, shared
placements. It is used by tests and registered in development so the platform can be tried
in a browser. **It is never registered when `NODE_ENV=production` and is tree-shaken out
of production client builds.**
