# Security

Scope: a casual public game platform used by students — protect players and keep games
fair, without enterprise-grade machinery. This page describes what is implemented.

## Threat model (summary)

| Threat                                                                           | Mitigation                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cheating by editing the browser (changing scores, peeking at hidden cards/roles) | Server-authoritative engines; clients only send intents; every view and event is filtered per seat before it leaves the server; hidden-info leaks are tested (harness perturbation + over-the-wire test)                                                                                         |
| Impersonating another player                                                     | Identity = a 256-bit random token held only by that browser; the server stores only its SHA-256; other players see only a public id; one active socket per session                                                                                                                               |
| Pretending to be a bot / a bot pretending to be human                            | Bot flags are server-set; human nicknames may not start with "Bot"; look-alike nicknames are refused in the same room                                                                                                                                                                            |
| Malformed or hostile messages                                                    | Strict zod schemas (unknown keys rejected), ack required, handler errors caught and reported as `INTERNAL_ERROR` without details, 16 KB message cap (larger closes the socket)                                                                                                                   |
| Flooding / spam                                                                  | Per-socket packet guard (drop), per-event token buckets, chat cooldowns, per-session limits on creating/joining rooms and reporting                                                                                                                                                              |
| Room-code guessing                                                               | 6-character codes from 31 symbols (~887 M); join attempts rate-limited                                                                                                                                                                                                                           |
| Resource exhaustion                                                              | Caps on total rooms (500) and sessions (20,000), new sessions per IP per minute (30), concurrent sockets per IP (60 — generous because a classroom shares one IP), idle session/room sweeping                                                                                                    |
| Cross-site WebSocket use                                                         | `Origin` allowlist on the connection request (`allowRequest`, WebSocket transport only); production origins come from `ALLOWED_ORIGINS` or the Vercel deployment's own domains and never include localhost; non-browser clients (no Origin) are allowed but gain nothing a browser couldn't do   |
| Offensive content / sharing contact details                                      | Moderation pipeline (see [CHAT_AND_MODERATION.md](CHAT_AND_MODERATION.md))                                                                                                                                                                                                                       |
| Client IP spoofing via headers                                                   | `X-Forwarded-For` is ignored unless `TRUST_PROXY=true`; then only the last entry (added by our proxy) is used                                                                                                                                                                                    |
| Script injection (stealing the token from storage)                               | React escapes all text; no `dangerouslySetInnerHTML`; user text is never interpreted as HTML; a strict Content-Security-Policy (`script-src 'self'`, `connect-src 'self'`, `frame-ancestors 'none'`, …) plus HSTS, `nosniff`, `X-Frame-Options` and `Permissions-Policy` headers (`vercel.json`) |
| Stale or split server state across instances                                     | One host lease with an epoch; every state write is a compare-and-set fenced by the lease, so an instance that lost it can never overwrite ([ADR-023](decisions/ADR-023-multi-instance-cluster.md))                                                                                               |

## Privacy

- No accounts, emails, passwords or personal data are collected.
- Nothing personal is stored. Sessions (a public id, the token's hash, the nickname, the room),
  rooms, the last 50 chat messages per room and report flags live in memory locally and in Redis
  in production, expiring automatically (sessions and rooms within a day of last use, report
  flags after 24 h).
- Logs are structured JSON and never contain chat text, drawings or tokens.

## Development-only relaxations

- The fixture game is registered only outside production (`NODE_ENV=production` forces it
  off; the client build strips it).
- Development origins allow `http://*.localhost:5173`. Production refuses to start with
  localhost origins, without any allowed origin, or without `REDIS_URL`.

## Reporting a problem

Open an issue (or contact the maintainer privately for anything exploitable).
