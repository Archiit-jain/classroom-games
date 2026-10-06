# Moderation hardening, security and abuse testing (Phase 10)

Status: implemented (Phase 10). Scope: make the public platform resilient against misuse,
spam, malformed clients, griefing and protocol abuse **without** accounts, bans, global
chat, tracking or new data collection, and without players noticing during normal play.

Related: [SECURITY.md](../SECURITY.md) (threat model and the rate-limit table),
[CHAT_AND_MODERATION.md](../CHAT_AND_MODERATION.md),
[ADR-028](../decisions/ADR-028-cluster-wide-limits-and-self-fencing.md),
[TESTING.md](../TESTING.md#abuse-and-security-tests).

## 1. Method

1. Audit every entry point (below) by reading the code path from the socket to the
   authoritative state.
2. Attack it with reusable tools (§6): malformed-payload batteries, bursts, crowds,
   forged identities, reconnect storms, frame recording, an engine fuzzer, a
   per-instance Redis fault injector and a lightweight load test.
3. For every problem: reproduce it with a test, fix the root cause at the
   authoritative source, keep the test as a regression test (each one was checked to
   fail on the old code), rerun the suite.

Owner decisions taken in this phase: destructive tests (Redis failures, failover, load)
run locally and in CI against a real Redis — the live site gets only controlled,
low-volume checks; chat refuses an exact repeat of a player's previous message within
30 s.

## 2. Attack surface — current protections

| Area                              | Protections (as implemented)                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Anonymous sessions                | 256-bit random token, only its SHA-256 stored; unknown/malformed tokens get a **new** session (never someone else's); token sent only once, to its owner; one active socket per session (newer tab displaces older); new sessions per IP per minute (host-wide); full table evicts the longest-idle sessions                                                                               |
| Transport (every instance)        | Origin allow-list on the handshake; 16 KB message cap; concurrent sockets per IP; per-socket packet flood guard; per-event token bucket; strict zod schema (unknown keys refused) before anything is forwarded; every request must be acknowledged; unknown events ignored; Socket.IO's parser drops `__proto__` keys                                                                      |
| Room host (one per cluster)       | The same schema again; the same per-event buckets counted **once for the cluster**; per-IP wrong-room-code budget; game rules, matchmaking, chat cooldowns, repeat check and report budget                                                                                                                                                                                                 |
| Matchmaking / public rooms        | Seats, counts, timers and bots computed on the host only; joins atomic on the single host; private rooms unreachable through `public:*`; host commands refused (`NOT_HOST`); `matchmaking` and `browse` buckets                                                                                                                                                                            |
| Private rooms / codes             | 6 characters from 31 symbols (~887 million); `room:join` bucket per session; **per-IP budget for wrong codes** (30, then one per 10 s, shared by every session from that address); join only in `LOBBY`; barred players stay out                                                                                                                                                           |
| Reconnect / bot takeover          | Token-proven identity; grace → bot takeover → reclaim; reclaim policy per game; leaving forfeits the seat for the match                                                                                                                                                                                                                                                                    |
| Chat                              | Room members only; ≤ 200 characters; burst 5 + 1/s then a 30 s cooldown; **exact repeat refused** (`CHAT_REPEATED`); game input (guesses) has the game's own bucket; normalise → game hook → censor profanity → remove contact details; never punished                                                                                                                                     |
| Reactions                         | Fixed enum of eight; seated players during a match only; one per 1.5 s; sender id/seat set by the server; bots never react                                                                                                                                                                                                                                                                 |
| Game actions                      | Envelope schema; game's strict action schema; versions the server never issued refused; each action id processed once per match (persisted with the match); engine `validateAction` against the current state; engines are pure and server-side; per-seat view filtering                                                                                                                   |
| Drawing / NPAT drafts (streams)   | Chunk schema; **declared chunk size enforced by the runtime**; `stream` bucket (20/s); engines enforce points and strokes per turn; drafts relayed to nobody; per-seat sequence numbers                                                                                                                                                                                                    |
| Business trades / auctions        | Same action pipeline; strict schemas carry only intents (a bid amount, a trade offer) — never outcomes; the engine checks ownership, cash, phase and turn                                                                                                                                                                                                                                  |
| Redis state / forwarding / hosts  | One host lease with an epoch; every state write fenced by the lease; **a host that cannot renew for 2/3 of the lease stops hosting**; full-state updates (`reset`) after a restore; action ids and deadlines in the snapshot                                                                                                                                                               |
| Vercel / production configuration | HTTPS only (308 from HTTP), HSTS, CSP (`script-src 'self'`, `connect-src 'self'`, `frame-ancestors 'none'`), `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`; production refuses to start without Redis or with localhost origins; Vercel overwrites `X-Forwarded-For` (client IPs can't be spoofed there); metrics endpoint off unless `METRICS_TOKEN` is set |

## 3. Findings

Severity: **Critical** (takeover / data loss at will) · **High** (cheating, impersonation
or outage at will, easily) · **Medium** (realistic abuse or failure with limited impact) ·
**Low** (narrow conditions or minor impact) · **Informational** (by design / no impact).
No Critical or High findings.

| #   | Severity      | Finding                                                                                                                                                                                                                                                                                                          | Fix (commit)                                                                                                                                                     | Regression test                                                                                 |
| --- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| F1  | Medium        | Per-session rate buckets lived only in each gateway's memory: reconnecting through another instance reset them — including `room:join`, the anti code-guessing limit; with cheap new sessions, guessing scaled with sessions and instances                                                                       | Host applies the same buckets once for the cluster; per-IP wrong-code budget (`7ad6348`)                                                                         | `abuse/rooms.test.ts` (12/12 guesses passed before), `abuse/cluster.test.ts` (across instances) |
| F2  | Medium        | Only the host's Redis connection hangs (ioredis queues commands): the host kept running timers and bots for its local players while its lease expired and another instance took over — **two hosts acting**; afterwards clients ignored the new host's lower versions and moves were refused as "future version" | Self-fencing at 2/3 of the lease; `MatchUpdate.reset` for full states, honoured by the client store and animation director (`4cb87f1`)                           | `abuse/cluster.test.ts` (the old host never stepped down), `director.test.ts`                   |
| F3  | Medium        | Full session table (20,000) → `SERVER_BUSY` for every new player; named sessions live 24 h, so one address creating sessions at the allowed rate could lock everyone out within hours                                                                                                                            | Evict the longest-idle sessions (disconnected, not in a room) (`bc15df8`)                                                                                        | `abuse/sessions.test.ts`                                                                        |
| F4  | Medium        | New sessions per IP per minute was 30: a class of 40 behind one school IP opening the link together left ten children refused for up to a minute                                                                                                                                                                 | Raised to 120 (safe because of F3) (`bc15df8`) — **owner may veto**                                                                                              | `abuse/sessions.test.ts` (45 at the default limit)                                              |
| F5  | Medium        | Nickname impersonation: a name written with Cyrillic/Greek look-alike letters (e.g. a Cyrillic "А" in "Archit") had a different room key, so it could sit next to the real player                                                                                                                                | `nicknameKey` folds look-alikes to Latin (`b2e7b89`)                                                                                                             | `packages/moderation/test/hardening.test.ts`                                                    |
| F6  | Low           | Phone numbers written in Devanagari (or other scripts') digits were not removed                                                                                                                                                                                                                                  | Phone detector accepts any decimal digit (`b2e7b89`)                                                                                                             | `hardening.test.ts`                                                                             |
| F7  | Low           | The game contract's `maxChunkBytes` was never enforced; current games were safe only because their schemas keep chunks small                                                                                                                                                                                     | Runtime refuses chunks over the declared size (`1c0f790`)                                                                                                        | `stream.test.ts`; largest legal chunks still fit (`abuse/authority.test.ts`)                    |
| F8  | Low           | Repeated identical chat messages were only slowed by the flood limit                                                                                                                                                                                                                                             | Owner decision: exact repeat within 30 s refused (`24be43d`)                                                                                                     | `abuse/chat.test.ts`, smoke                                                                     |
| F9  | Informational | Test-layer gap found by a coverage check: bots never send NPAT's STOP/VOTE/DONE nor Business's LOAN/REPAY/BID/AUCTION_START/SELL_*/JAIL_WAIT, so fuzzing had never reached the money-moving actions                                                                                                              | Seeded fuzzing from the live state, one level deep, on every transition (`bba29fe`); measured: LOAN 1228, REPAY 852, BID 440, AUCTION_START 254, VOTE 18 applied | `abuse/engines.fuzz.test.ts`                                                                    |
| F10 | Informational | Room-code errors distinguish "not found" from "in progress" / "full"                                                                                                                                                                                                                                             | Kept: needed by real players; reveals only that a guessed code exists (and guesses are budgeted)                                                                 | `abuse/rooms.test.ts`                                                                           |
| F11 | Informational | Vercel serves static files with `Access-Control-Allow-Origin: *`                                                                                                                                                                                                                                                 | Kept: public, credential-free assets; the socket enforces origins (403 for foreign ones)                                                                         | security smoke                                                                                  |
| F12 | Informational | Pen Fight clamps out-of-range power/anchor/angle instead of refusing them                                                                                                                                                                                                                                        | Kept: a forged flick becomes at most a legal maximum flick                                                                                                       | engine tests, fuzzing                                                                           |

Checked and **not** vulnerable (tests in brackets): forged/oversized/replayed tokens
(`abuse/sessions`), duplicate sockets and reconnect storms (one seat, one membership),
prototype pollution through payloads (`abuse/protocol`), malformed payloads on every event
in and out of a match with no `INTERNAL_ERROR` and nothing logged, acting in or reading
another room's match, duplicate action ids under bursts and across a host failover,
forged outcome fields on every game's actions (`abuse/authority`), engine exceptions under
hostile input for all seven games (`abuse/engines.fuzz`), private rooms through public APIs,
host powers by guests and strangers, reactions forged/out of phase/attributed to others,
Draw & Guess card leaks in any frame through a gateway, a reconnect and a host failover
(`abuse/cluster`), Redis down for every instance and back.

## 4. Abuse cases and outcomes

| Abuse                           | Outcome                                                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Flood any event                 | Gateway drops/limits; host limits the same bucket cluster-wide; `RATE_LIMITED` + retry time              |
| Guess room codes                | 30 wrong codes per IP, then one per 10 s; ~887 M codes                                                   |
| Rotate sessions to dodge limits | Session creation per IP; the code budget is per IP; buckets follow the session across instances          |
| Fill the session table          | Idle sessions evicted; players in rooms and connected players untouched                                  |
| Spam chat / alternate messages  | Burst then 30 s cooldown; exact repeats refused; no punishment                                           |
| Evade the filter                | Spacing, leetspeak, stretching, invisible characters, look-alikes, fullwidth, Hinglish caught            |
| Share contact details           | URLs, domains, "dot com", e-mails, phones (any digits), handles → `[removed]`                            |
| Impersonate a player            | Look-alike names collide in a room; "Bot…" names refused; ids are server-set                             |
| Cheat in a game                 | Only intents are accepted; engines decide; hidden information filtered per seat                          |
| Crash a room                    | Engines never threw under fuzzing; a schema-valid action that throws would abort only that match, logged |
| Exploit a host failover         | Fenced writes, self-fencing, persisted action ids; retries answer `DUPLICATE_ACTION`                     |

## 5. Rate limits

The central table is in [SECURITY.md](../SECURITY.md#rate-limits).

## 6. Test tools (reusable)

- `packages/game-sdk/src/testing/fuzz.ts` — `fuzzMatch` (mutations, replays, seeded moves).
- `apps/server/test/abuse/harness.ts` — malformed batteries, bursts, crowds, forged
  tokens, reconnect storms, frame leak scans, health and pollution checks, log capture.
- `apps/server/test/faultyStore.ts` + `clusterHelpers.ts` — per-instance Redis faults.
- `apps/server/test/load.test.ts` — lightweight 20/40-player load test.
- `e2e/smoke/security.spec.ts` + `rawSocket.ts` — production security smoke.

## 7. Intentional limitations

- **No automatic punishment**: no bans, kicks or mutes for profanity or reports; flooding
  only earns a cooldown.
- A spaced two-letter abbreviation ("m c") passes (owner rule: bc/mc whole words only);
  spelled-out numbers ("nine eight seven…") are not detected as phone numbers.
- Alternating two messages evades the repeat rule (the flood limit still applies).
- Rate buckets and the repeat memory live on the host: a host failover resets them.
- Many-IP (botnet) code guessing is limited only by the code space and per-IP budgets.
- Non-browser clients (no `Origin`) may connect; they gain nothing a browser couldn't do.
- Concurrent sockets per IP are counted per instance.
- One instance hosts every room; there is no sharding (ADR-023).
- The load test is a lightweight stress test, not a capacity benchmark.
