# Classroom Games

Quick multiplayer classroom and childhood games in the browser. No accounts, no login:
pick a nickname, create or join a room, play.

> **Status: Phase 9 of 12 — all seven games playable with friends, bots or people online, production-ready architecture.**
> The multiplayer platform (sessions, private rooms, reconnect, bots, chat moderation, quick
> reactions, live drawing streams, server-side physics) runs on several server instances with
> shared state in Redis, built for **Vercel**. **Raja Mantri Chor Sipahi**, the flagship
> **16 Parchi**, **Draw & Guess** (working name), **Pen Fight**, **Dots & Boxes**, **Name Place Animal Thing** and **Business** (working title) are fully
> playable with friends and bots in the **Color Burst Arcade** design.
> **Quick Play**, **Any Game** and a live **Browse** list put players into public rooms
> that fill with bots after a short wait. Next: moderation hardening. See the [roadmap](#roadmap).

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
- **Pen Fight** — 2–4 players flick their pens (touch the pen, drag back, let go — where you
  touch sets the spin) to knock the others off the desk; the server simulates every shot with
  real physics and everyone watches the same replay; after 10 quiet rounds the desk starts
  shrinking. Rules: [docs/GAME_RULES/PEN_FIGHT.md](docs/GAME_RULES/PEN_FIGHT.md).
- **Dots & Boxes** — 2–4 players join dots on squared paper; close a box to claim it and go
  again; 4×4, 5×5 or 7×7. Touch near a line to preview it, lift to draw. Rules:
  [docs/GAME_RULES/DOTS_AND_BOXES.md](docs/GAME_RULES/DOTS_AND_BOXES.md).
- **Name Place Animal Thing** — 2–8 players, one letter, four categories (Name, Place,
  Animal, Thing), 90 seconds; fill your sheet and call STOP. Answers are checked
  automatically, then the players vote out doubtful ones (with 3+ players); 10 for a unique
  answer, 5 for a shared one. Rules:
  [docs/GAME_RULES/NAME_PLACE_ANIMAL_THING.md](docs/GAME_RULES/NAME_PLACE_ANIMAL_THING.md).
- **Business** _(working title)_ — 2–6 players roll round a 36-space square board of
  Indian cities and transport (Railways to Satellite), build houses and hotels, collect rent
  (3+ cities of a group double it), roll for Chance / Community Chest by dice sum, trade,
  auction and take loans; nobody is knocked out (insolvent players keep playing). Richest by
  cash + everything spent on properties, buildings and transport after the host's number of
  rounds wins. ₹65,000 to start; pretend ₹ only. Rules:
  [docs/GAME_RULES/BUSINESS.md](docs/GAME_RULES/BUSINESS.md).
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

| Game                        | Players | Status                                     |
| --------------------------- | ------- | ------------------------------------------ |
| Raja Mantri Chor Sipahi     | 4       | ✅ Playable (Phase 2)                      |
| 16 Parchi (flagship)        | 4       | ✅ Playable (Phase 3)                      |
| Draw & Guess (working name) | 3–6     | ✅ Playable (Phase 4)                      |
| Pen Fight                   | 2–4     | ✅ Playable (Phase 5)                      |
| Dots & Boxes                | 2–4     | ✅ Playable (Phase 6)                      |
| Name Place Animal Thing     | 2–8     | ✅ Playable (Phase 7)                      |
| Business (working title)    | 2–6     | ✅ Playable (Phase 8)                      |
| Count Up (fixture)          | 2–4     | Development/test only, never in production |

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
  dots-and-boxes/ Dots & Boxes (shared grid + picking, engine + bot, board)
  business/       Business (board, economy, events, engine + bot, simulator, board client)
  name-place-animal-thing/ Name Place Animal Thing (answer checks, answer bank, engine + bot, worksheet)
  pen-fight/      Pen Fight (shared desk/replay helpers, engine + Planck physics + bot, board)
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

Built for **Vercel + Redis**: the client is served from the CDN and the realtime game server
runs as a Vercel Function on the same domain (`wss://<site>/api/socket/…`), with sessions,
rooms and messages shared between instances through Redis
([ADR-023](docs/decisions/ADR-023-multi-instance-cluster.md)). Locally everything runs in one
process with in-memory state. Setup, environment variables, the readiness checklist and the
production smoke test (`pnpm smoke`) are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Adding a game

See [docs/ADDING_A_GAME.md](docs/ADDING_A_GAME.md) and [docs/GAME_SYSTEM.md](docs/GAME_SYSTEM.md).
`games/rmcs` is the reference implementation.

## Testing

See [docs/TESTING.md](docs/TESTING.md). Current suite: 543 unit/integration tests (the Redis
adapter and the multi-instance tests run against a real Redis in CI), 42 end-to-end runs (incl. public Quick Play, Browse and bot fill)
(desktop + mobile, every game, reduced motion, 360 px and landscape phones, a WebSocket leak
scan) and a production smoke test (Dots & Boxes, a three-player Name Place Animal Thing round
a full Business match, Quick Play and Browse).

## Known limitations

- A live deployment needs a Vercel project and a Redis database (see DEPLOYMENT.md).
- One instance at a time hosts every room (others forward to it); sharding rooms across hosts is
  a later step if needed.
- Public matchmaking has no skill rating, queues or room merging (v1); a lone player is offered
  a private match with bots instead of a public start.
- Business is best with 3–6 players (two-player games are more decided by the early lead).
- Client bundle is ≈ 150 KB gzipped (Motion; game boards load separately); trimming is
  planned for Phase 11.
- No sound (excluded from v1). English only (the UI is translation-ready).

## Roadmap

1. ✅ Infrastructure and private rooms
2. ✅ Raja Mantri Chor Sipahi + Color Burst Arcade design system
3. ✅ 16 Parchi + quick reactions
4. ✅ Draw & Guess (working name)
5. ✅ Pen Fight
6. ✅ Dots & Boxes + production architecture (Vercel + Redis)
7. ✅ Name Place Animal Thing
8. ✅ Business (working title)
9. ✅ Public lobby, Quick Play, bot fill, "Play with Bots"
10. Moderation hardening and abuse testing
11. Performance, mobile and animation polish
12. Production deployment

Phases 6–12 follow the order proposed after Phase 3 and await the product owner's approval.

**Launch blockers (not implementation blockers):** an original public name for Draw & Guess
(spec C9) and a trademark / name-availability check for Business's final public name.

## Documentation

Start at [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md). Design decisions are
recorded in [docs/decisions/](docs/decisions/). Third-party licenses: [CREDITS.md](CREDITS.md).
