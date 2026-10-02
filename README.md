# Classroom Games

Quick multiplayer classroom and childhood games in the browser. No accounts, no login:
pick a nickname, create or join a room, play.

> **Status: Phase 4 of 12 — three of seven games playable.** The multiplayer platform
> (sessions, private rooms, reconnect, bots, chat moderation, quick reactions, live drawing
> streams, game runtime) is built, and **Raja Mantri Chor Sipahi**, the flagship **16 Parchi**
> and **Draw & Guess** (working name) are fully playable with friends and bots in the
> **Color Burst Arcade** design. Four more games are planned: Pen Fight, Dots & Boxes,
> Name Place Animal Thing and Business. See the [roadmap](#roadmap).

## Why

Games like Raja Mantri Chor Sipahi, 16 Parchi and pen fighting are played with paper and
pens in classrooms everywhere. Classroom Games brings them online so a group can play from
their phones in seconds — without creating accounts — while keeping the game fair: the
server, not the browser, decides every outcome.

## What works today

- **Raja Mantri Chor Sipahi** — 4 players, 10 rounds, secret chits, the Mantri hunts the
  Chor; clearly-labelled bots fill empty seats. Rules: [docs/GAME_RULES/RAJA_MANTRI_CHOR_SIPAHI.md](docs/GAME_RULES/RAJA_MANTRI_CHOR_SIPAHI.md).
- **16 Parchi** (flagship) — 4 players pass folded paper slips clockwise all at once,
  collect four of a kind and race to CLAIM; finished players leave the circle until everyone
  is placed. Ten categories with original artwork (Fruits, Street Food, Childhood Toys…),
  chosen by the host or Random. Rules: [docs/GAME_RULES/16_PARCHI.md](docs/GAME_RULES/16_PARCHI.md).
- **Draw & Guess** (working name) — 3–6 players take turns drawing a secret word while the
  others race to guess it in the chat; correct guesses are never shown, hints reveal letters,
  bots draw from original templates and guess from the public pattern. Rules:
  [docs/GAME_RULES/DRAW_AND_GUESS.md](docs/GAME_RULES/DRAW_AND_GUESS.md).
- **Quick reactions** — eight emotes that pop over your seat for everyone (one per 1.5 s,
  only ever sent by a person).
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

| Game                        | Players | Status                                                                                 |
| --------------------------- | ------- | -------------------------------------------------------------------------------------- |
| Raja Mantri Chor Sipahi     | 4       | ✅ Playable (Phase 2)                                                                  |
| 16 Parchi (flagship)        | 4       | ✅ Playable (Phase 3)                                                                  |
| Draw & Guess (working name) | 3–6     | ✅ Playable (Phase 4)                                                                  |
| Pen Fight                   | 2–4     | Planned — Phase 5                                                                      |
| Dots & Boxes                | 2–4     | Designed — Phase 6 (proposed); [design](docs/design/DOTS_AND_BOXES_DESIGN.md)          |
| Name Place Animal Thing     | 2–8     | Designed — Phase 7 (proposed); [design](docs/design/NAME_PLACE_ANIMAL_THING_DESIGN.md) |
| Business (working title)    | 2–6     | Designed — Phase 8 (proposed); [design](docs/design/BUSINESS_DESIGN.md)                |
| Count Up (fixture)          | 2–4     | Development/test only, never in production                                             |

The agreed rules for the first four games are in [docs/specs/PHASE_0_SPEC.md](docs/specs/PHASE_0_SPEC.md);
the three newer games are specified by their design-verification documents in
[docs/design/](docs/design/). "Business" is a working title: its public name needs a
trademark / name-availability check before launch.

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
  sixteen-parchi/ 16 Parchi (shared types + categories, engine + bot, board, content/en labels)
  draw-and-guess/ Draw & Guess (shared types + guess matching, engine + bot templates, board, content/en words)
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

Planned for Phase 12. The client is a static site; the server needs a host that supports
long-lived WebSocket connections (serverless platforms do not). What exists today —
build outputs, environment variables, health check, graceful shutdown — is described in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Adding a game

See [docs/ADDING_A_GAME.md](docs/ADDING_A_GAME.md) and [docs/GAME_SYSTEM.md](docs/GAME_SYSTEM.md).
`games/rmcs` is the reference implementation.

## Testing

See [docs/TESTING.md](docs/TESTING.md). Current suite: 304 unit/integration tests and 13
end-to-end runs (desktop + mobile), including full RMCS, 16 Parchi and Draw & Guess matches on
a phone profile and 16 Parchi and Draw & Guess with reduced motion.

## Known limitations

- All rooms and sessions live in server memory: a restart or deploy ends every game.
- One server instance only (scaling path documented, not built).
- Three of the seven games so far; public lobby and matchmaking arrive in Phase 9.
- Client bundle is ≈ 146 KB gzipped (Motion; game boards load separately); trimming is
  planned for Phase 11.
- No sound (excluded from v1). English only (the UI is translation-ready).

## Roadmap

1. ✅ Infrastructure and private rooms
2. ✅ Raja Mantri Chor Sipahi + Color Burst Arcade design system
3. ✅ 16 Parchi + quick reactions
4. ✅ Draw & Guess (working name)
5. Pen Fight
6. Dots & Boxes _(proposed order)_
7. Name Place Animal Thing _(proposed order)_
8. Business (working title) _(proposed order)_
9. Public lobby, Quick Play, bot fill, "Play with Bots"
10. Moderation hardening and abuse testing
11. Performance, mobile and animation polish
12. Production deployment

Phases 6–12 follow the order proposed after Phase 3 and await the product owner's approval.

**Launch blockers (not implementation blockers):** an original public name for Draw & Guess
(spec C9) and a trademark / name-availability check for Business's final public name.

## Documentation

Start at [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md). Design decisions are
recorded in [docs/decisions/](docs/decisions/). Third-party licenses: [CREDITS.md](CREDITS.md).
