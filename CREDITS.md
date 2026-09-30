# Credits and third-party licenses

Classroom Games uses no third-party artwork, fonts, sounds or icon sets yet.
All UI in Phase 1 is plain CSS. This file lists what ships to users (runtime
dependencies) and any content we did not write ourselves.

## Runtime dependencies

| Package                                                                                                                                                                       | Used by                               | License |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------- |
| [react](https://react.dev), react-dom, scheduler                                                                                                                              | client                                | MIT     |
| [socket.io](https://socket.io) (+ engine.io, socket.io-parser, socket.io-adapter, ws, cors, accepts, negotiator, mime-types, mime-db, vary, cookie, debug, ms, object-assign) | server                                | MIT     |
| socket.io-client (+ engine.io-client, engine.io-parser, @socket.io/component-emitter, xmlhttprequest-ssl)                                                                     | client                                | MIT     |
| [zod](https://zod.dev)                                                                                                                                                        | server (payload validation), game SDK | MIT     |
| [obscenity](https://github.com/jo3-l/obscenity)                                                                                                                               | server (moderation)                   | MIT     |

Checked with `pnpm licenses list --prod` on 2026-09-30.

## Content

| Content                                                       | Source                                                                                        | License         |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------- |
| Base English profanity dataset                                | Bundled with `obscenity` (derived from [cuss](https://github.com/words/cuss) by Titus Wormer) | MIT             |
| Hinglish / romanised Hindi word list, insult list, allow-list | Written for this project (`packages/moderation/src/datasets.ts`)                              | Project license |
| Nickname suggestions                                          | Written for this project                                                                      | Project license |

## Development-only tools (not shipped)

TypeScript (Apache-2.0), Vite (MIT), @vitejs/plugin-react (MIT), Vitest (MIT),
Playwright (Apache-2.0), ESLint (MIT), typescript-eslint (MIT),
eslint-plugin-react-hooks (MIT), Prettier (MIT), tsx (MIT), esbuild (MIT).
