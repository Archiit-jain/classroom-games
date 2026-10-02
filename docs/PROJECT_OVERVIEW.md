# Project overview

## What Classroom Games is

A public, browser-based multiplayer platform for quick classroom and childhood games,
built so anyone can join with only a nickname. The platform (rooms, sessions, reconnect,
chat, bots, runtime) is shared; each game is a self-contained module plugged into it.

**Seven core games:** Raja Mantri Chor Sipahi · 16 Parchi (flagship) · Draw & Guess
(working name) · Pen Fight · Dots & Boxes · Business (working title) · Name Place Animal
Thing. See the [game catalogue](GAME_SYSTEM.md#game-catalogue).

Core flow: **Open → Enter name → Play → Results → Play again.**

## Who it is for

School and college students, friends, families — anyone who wants a quick game with
people nearby or online, on a phone or a laptop.

## Principles

1. **Server authority.** Browsers send intents; the server validates them and decides
   every outcome. Hidden information (cards, roles) is never sent to players who may not
   see it.
2. **Anonymous by design.** No accounts, emails or passwords. A random secret token lets
   a player reconnect; other players only ever see a public id.
3. **Fair bots.** Bots see exactly what a human in the same seat would see and are always
   labelled as bots.
4. **Safety without punishment.** Offensive words and contact details are censored before
   anyone sees them; floods get a cooldown; nobody is banned for words.
5. **Modular games.** Adding a game should not require touching the platform.
6. **Honest documentation.** Docs describe what exists. The approved design lives in
   [specs/PHASE_0_SPEC.md](specs/PHASE_0_SPEC.md).

## Priorities

Fun → Simplicity → Multiplayer reliability → Visual quality → Smooth interactions →
Expandability → Security → Performance → Documentation.

## Current status

Phases 1–5 are complete: the platform (with quick reactions, streamed games and server-side
physics) plus Raja Mantri Chor Sipahi, the flagship 16 Parchi, Draw & Guess (working name) and
Pen Fight in the Color Burst Arcade design. Dots & Boxes, Name Place
Animal Thing and Business have design-verification documents in [design/](design/). The
12-phase plan is in the README [roadmap](../README.md#roadmap).

## Roles

- **Product owner / tester** — decides and approves.
- **Product architect** — product direction, game design, specifications.
- **Developer** — reviews specs, implements, tests and documents.

## Where to read next

| If you want to…                     | Read                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------- |
| Run it locally                      | [DEVELOPMENT_SETUP.md](DEVELOPMENT_SETUP.md)                           |
| Understand the system               | [ARCHITECTURE.md](ARCHITECTURE.md)                                     |
| Build a game                        | [GAME_SYSTEM.md](GAME_SYSTEM.md), [ADDING_A_GAME.md](ADDING_A_GAME.md) |
| Understand rooms / reconnect        | [ROOM_SYSTEM.md](ROOM_SYSTEM.md)                                       |
| See the wire protocol               | [SOCKET_EVENTS.md](SOCKET_EVENTS.md)                                   |
| Understand moderation               | [CHAT_AND_MODERATION.md](CHAT_AND_MODERATION.md)                       |
| Know why something is the way it is | [decisions/](decisions/)                                               |
