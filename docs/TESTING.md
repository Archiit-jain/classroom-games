# Testing

## Running tests

| Command                                                     | What                                                                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `pnpm test`                                                 | All Vitest suites (unit + Socket.IO integration)                                                                         |
| `pnpm test:watch`                                           | Watch mode                                                                                                               |
| `pnpm vitest run games/rmcs`                                | One area                                                                                                                 |
| `pnpm e2e`                                                  | Playwright end-to-end, desktop + mobile projects (starts its own servers on ports 3101/5174 with `GAME_TIME_SCALE=0.25`) |
| `PW_CHANNEL=msedge pnpm e2e`                                | Use an installed browser instead of Playwright's Chromium                                                                |
| `pnpm check`                                                | lint + typecheck + test (CI's first job also runs format check and build)                                                |
| `node tools/screenshots.mjs <clientUrl> <outDir> [channel]` | Captures every main screen and RMCS phase on desktop and phone sizes (visual review)                                     |

Vitest picks up `{apps,packages,games}/*/test/**/*.test.ts` (root `vitest.config.ts`).
Playwright specs live in `e2e/*.spec.ts`; tests tagged `@mobile` also run in the `mobile`
project (Pixel 7 emulation, touch).

## Current suite (Phase 2)

| File                                             |   Tests | Covers                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------ | ------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/game-sdk/test/rng.test.ts`             |       6 | Seeded RNG determinism, bounds, shuffle, errors                                                                                                                                                                                                                                                                                      |
| `packages/game-sdk/test/audience.test.ts`        |       2 | Event audience routing                                                                                                                                                                                                                                                                                                               |
| `packages/game-sdk/test/fixture.test.ts`         |      12 | Fixture rules, idle requests, view-leak checker, 300 seeded bot matches, reproducibility                                                                                                                                                                                                                                             |
| `packages/moderation/test/moderation.test.ts`    |      79 | Must-censor / must-NOT-censor corpora, Hinglish, leetspeak, spacing, zero-width, contact details, nicknames                                                                                                                                                                                                                          |
| `games/rmcs/test/engine.test.ts`                 |      23 | Dealing, phase flow, guessing rules, scoring table, 2300-per-round invariant, random timeout guess, idle requests, visibility per phase, perturbation leak check, ranking with ties, results stats, bot, **200 seeded full matches**, timer-only matches, reproducibility, time scale                                                |
| `apps/server/test/unit.test.ts`                  |      29 | Rate limiter, config, origins, flag store, registry, GameRuntime (filtering, validation, timers, idle, end, crash, re-entrancy, chat CONSUME) and **action versions / action ids**: duplicate id, two players on the same old version, stale-but-valid, future version (id not consumed), replayed id, id used by an illegal attempt |
| `apps/server/test/session-and-transport.test.ts` |      13 | Sessions/tokens, displacement, nicknames, malformed payloads, missing acks, oversized messages, origins, rate limits, health                                                                                                                                                                                                         |
| `apps/server/test/rooms.test.ts`                 |      18 | Rooms, host powers, bots, removal, host transfer, reconnect, cleanup                                                                                                                                                                                                                                                                 |
| `apps/server/test/match.test.ts`                 |      10 | Match lifecycle, hidden info over the wire, illegal/stale actions, malformed action ids, **double tap and replay over real sockets**, resync, takeover/reclaim, idle, leaving, only-bots close                                                                                                                                       |
| `apps/server/test/rmcs.test.ts`                  |       3 | RMCS needs exactly 4; a full 10-round match with 2 humans + 2 bots over sockets (scores, ranking, no hidden role ever sent early); server guesses for a timed-out Mantri                                                                                                                                                             |
| `apps/server/test/chat.test.ts`                  |       6 | Chat moderation end-to-end, cooldowns, history, reports, game chat interception                                                                                                                                                                                                                                                      |
| `apps/client/test/actions.test.ts`               |       3 | Action ids are valid and unique; double taps coalesce into one send; a new intent gets a new id                                                                                                                                                                                                                                      |
| `apps/client/test/director.test.ts`              |       6 | Animation director: immediate present, pacing, backlog fast-forward, duplicates, instant updates, match reset                                                                                                                                                                                                                        |
| `apps/client/test/effects.test.ts`               |       4 | Effects mode resolution (OS reduced motion, player choice, auto) and low-end detection                                                                                                                                                                                                                                               |
| `apps/client/test/connectionNotice.test.ts`      |       5 | Connection banner: waking up → not responding (production), "server not running" (development), priorities                                                                                                                                                                                                                           |
| **Total**                                        | **219** |                                                                                                                                                                                                                                                                                                                                      |

| End-to-end                                            | Projects            | Covers                                                                                                                                                                                              |
| ----------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| two players and a bot play a full private match       | desktop             | fixture game end to end, censored chat, back to lobby                                                                                                                                               |
| a guest who reloads the page returns to the same room | desktop             | reconnect with stored token                                                                                                                                                                         |
| friendly errors                                       | desktop             | wrong code, disallowed nickname                                                                                                                                                                     |
| home fits a 360 px phone                              | desktop, mobile     | no horizontal scrolling                                                                                                                                                                             |
| **RMCS: two humans and two bots play all 10 rounds**  | desktop, **mobile** | create RMCS room, needs-4 message, fill with bots, start, own chit visible, two-step accuse as Mantri, results with 4 rows and a Score column, scores total 23,000, no sideways scroll on the phone |

## Techniques

- **Pure engines + harness:** `simulateMatch` (`@cg/game-sdk/testing`) plays whole matches
  with bots on a virtual clock, deep-freezes state (catches mutation), checks invariants,
  serialisability, termination, results and **view leaks** (`perturbHidden`: change every
  secret hidden from a viewer; that viewer's view must not change).
- **Integration tests use real sockets:** `apps/server/test/helpers.ts` starts a real server
  on a random port with short timers; `client.act(update, action)` sends game actions with a
  fresh action id. `apps/server/test/simultaneousGame.ts` is a test-only game where every
  seat acts at once (for version/id tests).
- **Fake timers** (`vi.useFakeTimers`) for runtime timer tests; the director is tested with a
  manual clock.
- `waitFor` in the helpers resolves with already-received messages too — clear old messages
  (`client.clear('room:snapshot')`) before waiting for a _new_ state.

## Manual checks

- Visual review with `tools/screenshots.mjs` (desktop 1280×860 and Pixel 7).
- Product-owner device checklist (Phase 8): a real mid/low-range Android phone on Chrome —
  frame rate, touch, lite mode, and the feel of each game.

## Not yet

Load test tool (before production), Playwright in Firefox/WebKit, a real low-end device run.
