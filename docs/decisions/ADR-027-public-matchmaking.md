# ADR-027: Public matchmaking runs on the room host

**Status:** Accepted (Phase 9).

## Context

Public play needs Quick Play, Any Game, a live Browse list, a fill window and bot fill, with
players spread over several server instances (Vercel). Concurrent players must never take
the same seat, create needless duplicate rooms, start a room twice or fill bots twice — and
the brief forbids a second networking architecture.

## Decision

- Matchmaking is a host service (`Matchmaker` + public lifecycle in `RoomManager`), called
  from `HostServices` like every other room command. Gateways forward `public:*` events to the
  single host (ADR-023), where each choice of a room and the join that follows run in one
  synchronous step — no Redis locks or queues are needed for atomicity.
- Public rooms are ordinary `Room`s with `kind: PUBLIC`, no code, no host, and a
  `PublicState` (fill deadline, lone-since, results deadline, stayers) that is part of the
  room snapshot, so failover restores and re-arms it like any other timer.
- The start rule (target → start; `minHumans` connected → one fill window → bots to the
  target) and all per-game values come from `GameManifest.publicMatch` and `bots.supported`.
- Bot fill uses the existing bot members and `BotManager`; public matches never start with one
  human — a lone player can choose a private bots-only match instead.
- Browse is a server push (`public:rooms`) coalesced per 250 ms; the subscription lives on the
  session so it survives a host hand-over.

## Consequences

- Correct under concurrency and failover by construction; the cluster tests cover joins across
  instances and a host crash during the fill window.
- All matchmaking load is on the one host instance — fine at classroom scale (sub-millisecond
  per request in-process); sharding rooms across hosts remains a later step (ADR-023).
- No queues, ratings or room merging in v1.
