# Classroom Games

Quick multiplayer classroom and childhood games in the browser. No accounts, no login:
pick a nickname, create or join a room, play.

> **Status: Phase 2 of 9 — first game playable.** The multiplayer platform (sessions,
> private rooms, reconnect, bots, chat moderation, game runtime) is built, and **Raja Mantri
> Chor Sipahi** is fully playable with friends and bots in the new **Color Burst Arcade**
> design. 16 Parchi, Draw & Guess and Pen Fight arrive in Phases 3–5. See the
> [roadmap](#roadmap).

## Why

Games like Raja Mantri Chor Sipahi, 16 Parchi and pen fighting are played with paper and
pens in classrooms everywhere. Classroom Games brings them online so a group can play from
their phones in seconds — without creating accounts — while keeping the game fair: the
server, not the browser, decides every outcome.

## What works today

- **Raja Mantri Chor Sipahi** — 4 players, 10 rounds, secret chits, the Mantri hunts the
  Chor; clearly-labelled bots fill empty seats. Rules: [docs/GAME_RULES/RAJA_MANTRI_CHOR_SIPAHI.md](docs/GAME_RULES/RAJA_MANTRI_CHOR_SIPAHI.md).
- **Color Burst Arcade design** — nostalgic classroom games × modern arcade: paper chits,
  chalkboard desk, rubber-stamp verdicts, rolling scores, podium and confetti. Phone first.
  Effects modes: Full / Lite (auto on low-end devices) / Reduced (OS setting). See
  [docs/UI_UX.md](docs/UI_UX.md).
- **Anonymous sessions** — a nickname plus a secret reconnect token stored in the browser.
- **Private rooms** — 6-character room codes, host controls (game, settings, bots,
  removing players, start), host transfer, automatic cleanup.
- **Reconnect** — a 30 s grace period keeps your seat; after that a bot plays for you until
  you return. Idle players are handed to a bot and can tap "I'm back".
- **Server-authoritative game runtime** — pure game engines, per-player filtered views and
  events, server timers, bots on the same action path as humans, and actions that can never
  execute twice (unique action ids).
- **Room chat with moderation** — profanity (English + romanised Hindi/Hinglish), insults,
  slurs and contact details are censored before anyone sees them; floods get a cooldown;
  nobody is banned for words. Local mute and report.
- **Abuse protection** — schema validation on every message, rate limits, message-size
  limit, per-IP connection cap, origin allowlist.

## Games

| Game                        | Status                                     |
| --------------------------- | ------------------------------------------ |
| Raja Mantri Chor Sipahi     | ✅ Playable (Phase 2)                      |
| 16 Parchi (flagship)        | Planned — Phase 3                          |
| Draw & Guess (working name) | Planned — Phase 4                          |
| Pen Fight                   | Planned — Phase 5                          |
| Count Up (fixture)          | Development/test only, never in production |

The agreed rules for every game are in [docs/specs/PHASE_0_SPEC.md](docs/specs/PHASE_0_SPEC.md).

## Tech stack

| Area          | Choice                                                                                 |
| ------------- | -------------------------------------------------------------------------------------- |
| Client        | React 19, TypeScript, Vite 8, Motion (animation)                                       |
| Design system | `@cg/ui` — Color Burst Arcade tokens + animated primitives, Baloo 2 font (self-hosted) |
| Server        | Node.js 24, TypeScript, Socket.IO 4 (plain `node:http`, no Express)                    |
| Validation    | Zod 4 (server-side only)                                                               |
| Moderation    | obscenity + our own datasets                                                           |
| Tests         | Vitest 5, Socket.IO integration tests, Playwright (desktop + mobile)                   |
| Workspace     | pnpm 11 workspaces                                                                     |
| Storage       | In memory (no database in v1)                                                          |

## Project structure

```text
apps/
  client/         React app (screens, platform layer, animation director, i18n)
  server/         Socket.IO server (sessions, rooms, runtime, bots, chat, reports, transport)
packages/
  protocol/       Event contract, error codes, view types (+ zod schemas at /schemas)
  game-sdk/       Game module contract, seeded RNG, test harness, fixture game
  moderation/     Replaceable moderation pipeline and word lists
  ui/             Color Burst Arcade design system (tokens, styles, animated primitives)
games/
  rmcs/           Raja Mantri Chor Sipahi (shared types, engine + bot, board)
e2e/              Playwright end-to-end tests
tools/            Screenshot capture for visual review
docs/             Documentation, frozen spec, architecture decision records
```

## Quick start

Requirements: **Node.js 24+** and **pnpm 11+**.

```bash
pnpm install
pnpm dev
```

Open http://localhost:5173. The server runs on http://localhost:3001.

To try multiplayer on one computer, open a second browser window at
http://p2.localhost:5173 (a different origin, so it gets its own anonymous session). For
quicker test games, start the server with `GAME_TIME_SCALE=0.3` (development only).

Full setup notes: [docs/DEVELOPMENT_SETUP.md](docs/DEVELOPMENT_SETUP.md).

## Commands

| Command          | What it does                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `pnpm dev`       | Server (watch mode) and client dev server together                                           |
| `pnpm test`      | All unit and integration tests (Vitest)                                                      |
| `pnpm e2e`       | Playwright end-to-end tests, desktop + mobile (`PW_CHANNEL=msedge` to use an installed Edge) |
| `pnpm lint`      | ESLint                                                                                       |
| `pnpm typecheck` | TypeScript across all packages and the e2e suite                                             |
| `pnpm check`     | lint + typecheck + test                                                                      |
| `pnpm build`     | Production builds: `apps/client/dist` (static) and `apps/server/dist` (Node bundle)          |
| `pnpm start`     | Run the built server                                                                         |

## Architecture in one paragraph

The browser sends **intents** ("I want to play this") over Socket.IO; every intent is
schema-validated, rate-limited and acknowledged, and game actions carry a unique id so they
can never run twice. The server owns all state. Each running match is hosted by a
`GameRuntime` that feeds inputs to a **pure game engine** (`(state, action) → new state +
events`), schedules the engine's timers and sends every player **only their own filtered
view plus the events they are allowed to see**. On the client an **animation director**
plays each update's events before showing the next. Bots sit in seats and use the exact
same action path as humans. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Deployment

Planned for Phase 9. The client is a static site; the server needs a host that supports
long-lived WebSocket connections (serverless platforms do not). What exists today —
build outputs, environment variables, health check, graceful shutdown — is described in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Adding a game

See [docs/ADDING_A_GAME.md](docs/ADDING_A_GAME.md) and [docs/GAME_SYSTEM.md](docs/GAME_SYSTEM.md).
`games/rmcs` is the reference implementation.

## Testing

See [docs/TESTING.md](docs/TESTING.md). Current suite: 219 unit/integration tests and 7
end-to-end runs (desktop + mobile), including a full RMCS match on a phone profile.

## Known limitations

- All rooms and sessions live in server memory: a restart or deploy ends every game.
- One server instance only (scaling path documented, not built).
- Only one product game so far; public lobby and matchmaking arrive in Phase 6.
- Client bundle is ≈ 142 KB gzipped (Motion); trimming is planned for Phase 8.
- No sound (excluded from v1). English only (the UI is translation-ready).

## Roadmap

1. ✅ Infrastructure and private rooms
2. ✅ Raja Mantri Chor Sipahi + Color Burst Arcade design system
3. 16 Parchi
4. Draw & Guess
5. Pen Fight
6. Public lobby, Quick Play, bot fill, "Play with Bots"
7. Moderation hardening and abuse testing
8. Performance, mobile and animation polish
9. Production deployment

## Documentation

Start at [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md). Design decisions are
recorded in [docs/decisions/](docs/decisions/). Third-party licenses: [CREDITS.md](CREDITS.md).
