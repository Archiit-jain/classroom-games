# Credits and third-party licenses

This file lists what ships to users (runtime dependencies, fonts) and any content we did not
write ourselves. All icons and artwork are original (inline SVG and CSS) — no third-party
artwork, icon sets or sounds are used.

## Runtime dependencies

| Package                                                                                                                                                                       | Used by                               | License           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ----------------- |
| [react](https://react.dev), react-dom, scheduler                                                                                                                              | client                                | MIT               |
| [motion](https://motion.dev) (+ framer-motion, motion-dom, motion-utils, tslib)                                                                                               | client animation                      | MIT (tslib: 0BSD) |
| [socket.io](https://socket.io) (+ engine.io, socket.io-parser, socket.io-adapter, ws, cors, accepts, negotiator, mime-types, mime-db, vary, cookie, debug, ms, object-assign) | server                                | MIT               |
| socket.io-client (+ engine.io-client, engine.io-parser, @socket.io/component-emitter, xmlhttprequest-ssl)                                                                     | client                                | MIT               |
| [zod](https://zod.dev)                                                                                                                                                        | server (payload validation), game SDK | MIT               |
| [obscenity](https://github.com/jo3-l/obscenity)                                                                                                                               | server (moderation)                   | MIT               |
| [perfect-freehand](https://github.com/steveruizok/perfect-freehand) (no dependencies)                                                                                         | client (Draw & Guess stroke shapes)   | MIT               |
| [ioredis](https://github.com/redis/ioredis) (+ @ioredis/commands, debug, redis-errors, standard-as-callback; cluster-key-slot and denque are Apache-2.0)                      | server (production shared state)      | MIT / Apache-2.0  |
| [planck](https://github.com/piqnt/planck.js) (no dependencies)                                                                                                                | server (Pen Fight physics)            | MIT               |

Checked with `pnpm licenses list --prod` on 2026-10-02.

## Fonts

| Font                              | Source                                                                                                                           | License                   |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **Baloo 2** (variable) by Ek Type | Self-hosted via [`@fontsource-variable/baloo-2`](https://fontsource.org/fonts/baloo-2) — no requests to third-party font servers | SIL Open Font License 1.1 |

## Content

| Content                                                                    | Source                                                                                        | License         |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------- |
| Base English profanity dataset                                             | Bundled with `obscenity` (derived from [cuss](https://github.com/words/cuss) by Titus Wormer) | MIT             |
| Hinglish / romanised Hindi word list, insult list, allow-list              | Written for this project (`packages/moderation/src/datasets.ts`)                              | Project license |
| Draw & Guess word pack and bot drawing templates                           | Written for this project (`games/draw-and-guess/content/en`, `src/server/templates.ts`)       | Project license |
| Nickname suggestions, game texts, role icons (crown, scroll, shield, mask) | Written/drawn for this project                                                                | Project license |
| 16 Parchi categories, item labels and the 40 item icons, medals            | Written/drawn for this project (`games/sixteen-parchi`)                                       | Project license |
| Quick-reaction emoji                                                       | Drawn by each device's own system emoji font — no emoji images or fonts are shipped           | —               |

## Development-only tools (not shipped)

TypeScript (Apache-2.0), Vite (MIT), @vitejs/plugin-react (MIT), Vitest (MIT),
Playwright (Apache-2.0), ESLint (MIT), typescript-eslint (MIT),
eslint-plugin-react-hooks (MIT), Prettier (MIT), tsx (MIT), esbuild (MIT).
