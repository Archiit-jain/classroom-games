# Architecture decision records

Short records of _why_ things are the way they are. Format: Context → Decision →
Consequences. Status is `Accepted`, `Proposed` (waiting for approval) or `Superseded`.

| ADR                                              | Title                                                                                             | Status                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| [001](ADR-001-pnpm-monorepo.md)                  | pnpm monorepo, packages consumed as TypeScript source                                             | Accepted                                    |
| [002](ADR-002-react-vite.md)                     | React + Vite + Motion for the client                                                              | Accepted                                    |
| [003](ADR-003-socketio-view-event-sync.md)       | Socket.IO with acked intents; full per-player view + filtered events                              | Accepted                                    |
| [004](ADR-004-pure-engines-seeded-rng.md)        | Pure game engines with a seeded RNG                                                               | Accepted                                    |
| [005](ADR-005-in-memory-room-store.md)           | In-memory RoomStore; documented scaling path                                                      | Accepted                                    |
| [006](ADR-006-anonymous-session-tokens.md)       | Anonymous session tokens                                                                          | Accepted                                    |
| [007](ADR-007-moderation-pipeline.md)            | Moderation pipeline on obscenity + our datasets                                                   | Accepted                                    |
| 008                                              | Server-side physics with keyframe playback                                                        | Accepted in spec; record written in Phase 5 |
| [009](ADR-009-static-client-websocket-server.md) | Static client + WebSocket server                                                                  | Accepted                                    |
| [010](ADR-010-typed-i18n-catalog.md)             | Lightweight typed i18n catalog                                                                    | Accepted                                    |
| [011](ADR-011-report-flags-no-auto-punish.md)    | Reports create flags; no automatic punishment                                                     | Accepted                                    |
| [012](ADR-012-typescript-6.md)                   | Pin TypeScript 6.0 (not 7)                                                                        | Accepted                                    |
| [013](ADR-013-node-http-no-express.md)           | Plain `node:http`, no Express                                                                     | Accepted                                    |
| [014](ADR-014-lenient-action-versions.md)        | Lenient action versions + unique action ids                                                       | Accepted                                    |
| [015](ADR-015-shared-ui-package.md)              | Shared design system package (`@cg/ui`)                                                           | Accepted                                    |
| [016](ADR-016-animation-director.md)             | Animation director and effects modes                                                              | Accepted                                    |
| [017](ADR-017-sixteen-parchi-engine.md)          | 16 Parchi engine: simultaneous passing, re-keyed slips, claim races                               | Accepted                                    |
| [018](ADR-018-quick-reactions.md)                | Quick reactions as a platform feature                                                             | Accepted                                    |
| [019](ADR-019-category-content-packs.md)         | Category content packs with original icons                                                        | Accepted                                    |
| [020](ADR-020-streamed-games.md)                 | Streamed games: `match:stream`, replay, chat/stream bot moves                                     | Accepted                                    |
| [021](ADR-021-perfect-freehand.md)               | perfect-freehand for stroke rendering                                                             | Accepted                                    |
| [022](ADR-022-pen-fight-physics.md)              | Pen Fight physics: Planck.js on the server, keyframes in one event                                | Accepted                                    |
| [023](ADR-023-multi-instance-cluster.md)         | Multi-instance production: one host lease, gateways, Redis                                        | Accepted                                    |
| [024](ADR-024-private-drafts-and-voting.md)      | Private autosaved drafts on the stream path; server-side answer voting (frozen rule)              | Accepted                                    |
| [025](ADR-025-business-economy.md)               | Business: ring-road board, clearance sales instead of elimination, an economy tuned by simulation | Accepted                                    |
