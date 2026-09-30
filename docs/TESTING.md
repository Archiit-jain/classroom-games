# Testing

## Running tests

| Command                       | What                                                                   |
| ----------------------------- | ---------------------------------------------------------------------- |
| `pnpm test`                   | All Vitest suites (unit + Socket.IO integration)                       |
| `pnpm test:watch`             | Watch mode                                                             |
| `pnpm vitest run apps/server` | One area                                                               |
| `pnpm e2e`                    | Playwright end-to-end (starts the dev servers if they are not running) |
| `PW_CHANNEL=msedge pnpm e2e`  | Use an installed browser instead of Playwright's Chromium              |
| `pnpm check`                  | lint + typecheck + test (what CI's first job runs, plus build)         |

Vitest picks up `{apps,packages,games}/*/test/**/*.test.ts` (root `vitest.config.ts`).
Playwright specs live in `e2e/*.spec.ts`.

## Current suite (Phase 1)

| File                                             |   Tests | Covers                                                                                                                                                                                                                                 |
| ------------------------------------------------ | ------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/game-sdk/test/rng.test.ts`             |       6 | Seeded RNG determinism, bounds, shuffle, errors                                                                                                                                                                                        |
| `packages/game-sdk/test/audience.test.ts`        |       2 | Event audience routing                                                                                                                                                                                                                 |
| `packages/game-sdk/test/fixture.test.ts`         |      12 | Fixture rules, idle requests, view-leak checker (and that it catches a leaking view), **300 seeded bot-vs-bot matches**, timer-only termination, reproducibility                                                                       |
| `packages/moderation/test/moderation.test.ts`    |      79 | Must-censor (English, Hinglish, insults, leetspeak, spacing, zero-width), must-NOT-censor corpus ("Classroom", "pass", "chod do", "chakka"…), contact details, nicknames, look-alike keys                                              |
| `apps/server/test/unit.test.ts`                  |      23 | Rate limiter, config (fixture never in production), origin allowlist, flag store, registry validation, GameRuntime (filtering, validation, versions, timers, idle requests, end, crash handling, re-entrancy order, chat CONSUME)      |
| `apps/server/test/session-and-transport.test.ts` |      13 | Sessions/tokens, displacement, nicknames, malformed payloads, missing acks, oversized messages, origin refusal, join rate limit, health endpoint, per-IP cap                                                                           |
| `apps/server/test/rooms.test.ts`                 |      18 | Create/join/capacity/in-progress, look-alike nicknames, host-only powers, settings validation, bots, removal + bar, host transfer (leave and grace), reconnect within grace, return after grace, cleanup                               |
| `apps/server/test/match.test.ts`                 |       9 | Full match lifecycle, play again, hidden info never leaks over the wire, illegal/stale/unknown-match actions, double-tap, resync, bot takeover + reclaim, idle takeover + "I'm back", leaving mid-match, closing when only bots remain |
| `apps/server/test/chat.test.ts`                  |       6 | Censoring + contact removal end-to-end, cooldown without punishment, empty/too-long, history for late joiners, reports (no removal), game chat interception (consume/block/restrict)                                                   |
| **Total**                                        | **168** |                                                                                                                                                                                                                                        |

| E2E (`e2e/private-room.spec.ts`)                      | Covers                                                                                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| two players and a bot play a full private match       | create → join by code → add bot → censored chat → start → play to results → back to lobby, in two separate browser contexts |
| a guest who reloads the page returns to the same room | reconnect with the stored token                                                                                             |
| friendly errors                                       | wrong room code, disallowed nickname                                                                                        |
| no horizontal scroll on a 360 px phone                | layout guard                                                                                                                |

## Techniques

- **Pure engines + harness:** `simulateMatch` (`@cg/game-sdk/testing`) plays whole matches
  with bots on a virtual clock, deep-freezes state (catches mutation), checks invariants,
  serialisability, termination, results and **view leaks** (`perturbHidden`: change every
  secret hidden from a viewer; that viewer's view must not change).
- **Integration tests use real sockets:** `apps/server/test/helpers.ts` starts a real server
  on a random port with short timers and connects real `socket.io-client` instances
  (`forceNew`, websocket transport).
- **Fake timers** (`vi.useFakeTimers`) for runtime timer tests.
- `waitFor` in the helpers resolves with already-received messages too — clear old messages
  (`client.clear('room:snapshot')`) before waiting for a _new_ state.

## Manual checks

Product-owner device checklist (Phase 8): a real mid/low-range Android phone on Chrome —
frame rate, touch, lite mode, and the feel of each game.

## Not yet

Load test tool (`tools/loadtest`, before production), per-game suites (with each game),
Playwright in more browsers (Firefox/WebKit).
