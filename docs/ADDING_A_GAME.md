# Adding a game

This is the checklist a developer follows to add a game. The platform (rooms, sessions,
reconnect, chat, bots, transport) does not need to change.

**Reference implementation: `games/rmcs`** (Raja Mantri Chor Sipahi) — shared types,
pure engine + bot, board, rules doc and tests. The smaller fixture game lives in
`packages/game-sdk/src/fixture/` with its board in `apps/client/src/games/fixture/`.

## 1. Agree the rules

Write down the exact rules first (players, phases, timers, scoring, what each player can
see, timeouts, idle behaviour, bot behaviour). Product games' rules are in
[specs/PHASE_0_SPEC.md](specs/PHASE_0_SPEC.md); anything not specified is a question for the
product owner, not a guess.

## 2. Create the package

```text
games/<id>/
  package.json        name "@cg/game-<id>", exports ./shared, ./server, ./client
  tsconfig.json       extends ../../tsconfig.base.json
  src/shared/         state, view, action, event and settings types; action/settings schemas
  src/server/         engine (GameModule) and bot
  src/client/         Board, optional Settings, messages
  content/en/         content packs, if any
  test/               *.test.ts (picked up by the root Vitest config)
```

Keep React out of `shared`/`server` and heavy server-only libraries out of `client`.

## 3. Define state, view, actions and events

- **State:** everything the server needs (including hidden information).
- **View:** what one seat may know. Write `getPlayerView(state, seat)` so it _cannot_
  include other seats' secrets.
- **Actions:** small intents (`{type: 'GUESS', target: 2}`), validated by `actionSchema`.
- **Events:** what happened, for animation, each with an audience (`toAll`, `toSeats`,
  `toAllExcept`). Private details go in a separate event to the private audience.

## 4. Implement the engine

Implement `setup`, `validateAction`, `applyAction`, `onTimer`, `onSeatChange`,
`getPlayerView`, `isOver`, `getResults` — as pure functions (see
[GAME_SYSTEM.md](GAME_SYSTEM.md#rules-for-engines)). Every timeout must make progress; ask
for `MARK_IDLE` after the agreed number of consecutive timeouts.

## 5. Implement the bot

`createMemory(seat)`, `observe(memory, events)` (receives only events that seat can see),
`decide(view, memory, ctx)` → `{kind: 'ACTION', action, thinkMs}` or `null`. The bot must
use only information a human in that seat would have. Use `ctx.rng` for randomness.

## 6. Write the manifest

```ts
manifest: {
  id: 'my-game', version: 1,
  players: { min: 2, max: 4 },
  sync: 'TURN_PHASE',
  bots: { supported: true, canTakeOverSeat: true },
  publicMatch: { targetPlayers: 4, minHumans: 2 },
  reclaim: 'IMMEDIATE',
  layout: { orientation: 'any' },
}
```

The registry rejects inconsistent manifests at startup.

## 7. Test it

Required:

- **Rule unit tests** for every rule, score, timeout and illegal action.
- **Fuzzing with the harness** (`@cg/game-sdk/testing`):

  ```ts
  simulateMatch(myGame, {
    seats: 4, seed,
    invariant: (s) => { /* e.g. cards are conserved */ },
    perturbHidden: (s, viewer, rng) => /* copy of s with every secret hidden from viewer changed */,
  });
  ```

  It plays a whole match with bots on a virtual clock and fails on: illegal bot actions,
  non-termination, mutation (state is deep-frozen), unserialisable state/events, broken
  invariants, results that don't place every seat once, and **view leaks** (a view that
  changes when information hidden from that viewer changes).

- **Determinism:** the same seed produces the same match.

## 8. Build the client module

Create the `GameClientModule` (see `games/rmcs/src/client/index.ts`):

- `messages` (`name`, `description`, …) — all game text, no hard-coded strings;
- `accent` (a Color Burst Arcade accent) and `Icon` (small inline SVG) for the game card;
- a lazy `Board` and, optionally, a lazy `Settings` form;
- `eventDuration(event, effects)` — how long each event animates (use `durationFor` from
  `@cg/ui`, so lite/reduced modes shorten or skip it); the animation director uses it to pace
  updates, so keep it shorter than the server's phase holds;
- `resultStats` — columns for the results screen, read from `getResults(s).stats`.

The board receives `view`, `events`, `version`, `me`, `seats`, `send`, `effects`, `msUntil`.
Build it from `@cg/ui` primitives (`Avatar`, `PaperChit`, `CountdownRing`, `RollingNumber`,
`Stamp`, `ConfettiBurst`) and Motion; check it on a 360 px phone and in reduced motion.

## 9. Register the game

- Server: add it to `defaultGames()` (the registry wiring in
  `apps/server/src/app.ts`).
- Client: add it to `apps/client/src/games/registry.ts`.

## 10. Document it

- `docs/GAME_RULES/<GAME>.md` — the rules as implemented.
- Update [SOCKET_EVENTS.md](SOCKET_EVENTS.md) only if the platform protocol changed (game
  actions/events travel inside `match:action` / `match:update` and need no protocol change).
- Add an ADR for any non-obvious decision.
