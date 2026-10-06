# Security

Scope: a casual public game platform used by students — protect players and keep games
fair, without enterprise-grade machinery, accounts or tracking. This page describes what
is implemented. The Phase 10 audit (findings, fixes, abuse cases, tests) is in
[design/MODERATION_HARDENING.md](design/MODERATION_HARDENING.md).

## Threat model (summary)

| Threat                                                                           | Mitigation                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cheating by editing the browser (changing scores, peeking at hidden cards/roles) | Server-authoritative engines; clients only send intents (strict schemas refuse any outcome field — dice, cash, ownership, scores…); every view and event is filtered per seat; hidden-info leaks are tested (harness perturbation, over-the-wire frame scans through gateways, reconnects and failovers)                                        |
| Impersonating another player                                                     | Identity = a 256-bit random token held only by that browser; the server stores only its SHA-256; other players see only a public id; one active socket per session; forged or malformed tokens only ever get a new session                                                                                                                      |
| Look-alike names                                                                 | Room-unique nickname key folds case, accents, leetspeak, spacing, invisible characters and Cyrillic/Greek look-alike letters; "Bot…" names are refused; bot flags are server-set                                                                                                                                                                |
| Malformed or hostile messages                                                    | Strict zod schemas on the gateway and again on the host (unknown keys refused), ack required, unknown events ignored, handler errors answered as `INTERNAL_ERROR` without details, 16 KB message cap, `__proto__` keys dropped by Socket.IO's parser; game engines fuzzed with hostile actions                                                  |
| Flooding / spam                                                                  | Per-socket packet guard, per-event token buckets counted on the gateway **and once for the whole cluster on the room host**, chat cooldown and repeat check, game-specific input limits — see [Rate limits](#rate-limits)                                                                                                                       |
| Room-code guessing                                                               | 6-character codes from 31 symbols (~887 M); per-session join bucket; per-IP budget for wrong codes, shared by every session from that address                                                                                                                                                                                                   |
| Resource exhaustion                                                              | Caps on rooms (500) and sessions (20,000 — a full table forgets the longest-idle sessions instead of refusing newcomers), new sessions per IP (120/min), concurrent sockets per IP (60 per instance), declared stream chunk sizes enforced, idle sweeping                                                                                       |
| Cross-site WebSocket use                                                         | `Origin` allow-list on the connection request (foreign origins get 403); production origins come from `ALLOWED_ORIGINS` or the deployment's own Vercel domains and never include localhost; non-browser clients (no Origin) are allowed but gain nothing a browser couldn't do                                                                  |
| Offensive content / sharing contact details                                      | Moderation pipeline ([CHAT_AND_MODERATION.md](CHAT_AND_MODERATION.md))                                                                                                                                                                                                                                                                          |
| Client IP spoofing via headers                                                   | `X-Forwarded-For` is ignored unless `TRUST_PROXY=true` (automatic on Vercel, which overwrites the header with the real client IP); then only the last entry is used                                                                                                                                                                             |
| Script injection (stealing the token from storage)                               | React escapes all text; no `dangerouslySetInnerHTML`; strict Content-Security-Policy (`script-src 'self'`, `connect-src 'self'`, `frame-ancestors 'none'`, …), HSTS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` (`vercel.json`); HTTP redirects to HTTPS                                                       |
| Stale or split server state across instances                                     | One host lease with an epoch; every state write fenced by the lease; a host that can't reach the store and is half a lease overdue stops hosting before anyone else can take over (a mere freeze does not count) ([ADR-023](decisions/ADR-023-multi-instance-cluster.md), [ADR-028](decisions/ADR-028-cluster-wide-limits-and-self-fencing.md)) |
| Double execution across a failover                                               | Action ids and deadlines are part of the fenced snapshot: a retried action answers `DUPLICATE_ACTION`; progress after the last commit is lost, never duplicated                                                                                                                                                                                 |

## Rate limits

Per session unless noted. **Shared** = counted once for the whole cluster (on the room
host, in memory — no Redis round trip per request; reset when the host role moves).

| Event / action                       | Limit (burst · refill)                       | Where                     | On exceeding                                          | Why                                                     |
| ------------------------------------ | -------------------------------------------- | ------------------------- | ----------------------------------------------------- | ------------------------------------------------------- |
| Any packet on a socket               | 40 · 20/s                                    | gateway (per instance)    | dropped silently                                      | cheap flood guard before any work                       |
| `session:setNickname`                | 5 · 1 per 5 s                                | gateway + shared          | `RATE_LIMITED` + `retryAfterMs`                       | no nickname churn                                       |
| `room:create`, `public:playWithBots` | 3 · 5/min                                    | gateway + shared          | `RATE_LIMITED`                                        | room creation is the most expensive request             |
| `room:join`, `public:play/join`      | 10 · 20/min                                  | gateway + shared          | `RATE_LIMITED`                                        | code guessing, matchmaking churn                        |
| Wrong room codes (`ROOM_NOT_FOUND`)  | **per IP** 30 · 1 per 10 s                   | shared                    | `RATE_LIMITED` (also for a right code while locked)   | a classroom's typos fit; guessing does not              |
| `public:play/join/playWithBots`      | 5 · 1 per 2 s                                | shared (`matchmaking`)    | `RATE_LIMITED`                                        | Quick Play / cancel loops                               |
| `public:browse`                      | 5 · 1/s                                      | shared                    | `RATE_LIMITED`                                        | Browse toggling (the feed itself is pushed at most 4/s) |
| Host commands, leave, results choice | 10 · 2/s                                     | gateway + shared          | `RATE_LIMITED`                                        | lobby button mashing                                    |
| `match:action`, `match:resync`       | 20 · 10/s                                    | gateway + shared          | `RATE_LIMITED`                                        | far above any game's pace                               |
| `match:stream` (drawing, drafts)     | 30 · 20/s; chunk ≤ the game's declared bytes | gateway + shared; runtime | `RATE_LIMITED` / `INVALID_PAYLOAD`                    | smooth drawing, bounded relay                           |
| Room chat                            | 5 · 1/s, then a **30 s cooldown**            | shared                    | `CHAT_COOLDOWN`                                       | flooding                                                |
| Same chat message again within 30 s  | refused                                      | shared                    | `CHAT_REPEATED`                                       | repeat spam (owner decision, Phase 10)                  |
| Draw & Guess guesses                 | 8 · 1/s (no cooldown, separate from chat)    | shared (game-defined)     | `RATE_LIMITED`                                        | fast guessing is the game                               |
| `chat:react`                         | 1 per 1.5 s                                  | gateway + shared          | `RATE_LIMITED`                                        | reactions stay readable                                 |
| `report:submit`                      | 3 · 5/min                                    | shared                    | `RATE_LIMITED`                                        | report spam                                             |
| `time:ping`                          | 10 · 2/s                                     | gateway                   | `RATE_LIMITED`                                        | clock sync only                                         |
| New sessions                         | **per IP** 120/min                           | shared                    | connection refused `RATE_LIMITED`                     | several classes behind one school IP                    |
| Concurrent sockets                   | **per IP** 60                                | per instance              | connection refused                                    | a classroom shares one IP                               |
| Message size                         | 16 KB                                        | gateway                   | socket closed                                         | memory                                                  |
| Chat length / nickname length        | 200 / 2–16 characters                        | schema + host             | `INVALID_PAYLOAD` / `NICKNAME_INVALID`                |                                                         |
| Rooms / sessions                     | 500 / 20,000                                 | shared                    | `SERVER_BUSY` (sessions: idle ones are evicted first) | memory and Redis size                                   |

Every limit is in `apps/server/src/config.ts`; the event → bucket table is
`apps/server/src/transport/eventBuckets.ts`.

## What is never automatic

No bans, kicks or mutes are applied automatically — not for profanity, not for reports,
not for flooding (which only earns a cooldown). Reports are stored for review (24 h) and
hide the reported player only for the reporter.

## Privacy

- No accounts, emails, passwords or personal data are collected.
- Nothing personal is stored. Sessions (a public id, the token's hash, the nickname, the room),
  rooms, the last 50 chat messages per room and report flags live in memory locally and in Redis
  in production, expiring automatically (sessions and rooms within a day of last use, report
  flags after 24 h).
- Client IP addresses are used only in memory, for the per-IP limits above. They travel
  inside forwarded requests between instances (Redis pub/sub, which stores nothing) and are
  never written to Redis keys, snapshots or logs.
- Logs are structured JSON and never contain chat text, drawings or tokens.
- The operator metrics endpoint (only with `METRICS_TOKEN`) reports counts and process
  resource use — no player data.

## Development-only relaxations

- The fixture game is registered only outside production (`NODE_ENV=production` forces it
  off; the client build strips it).
- Development origins allow `http://*.localhost:5173`. Production refuses to start with
  localhost origins, without any allowed origin, or without `REDIS_URL`.

## Known limitations

See [MODERATION_HARDENING.md §7](design/MODERATION_HARDENING.md#7-intentional-limitations).

## Reporting a problem

Open an issue (or contact the maintainer privately for anything exploitable).
