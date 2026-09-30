# ADR-011: Reports create flags; no automatic punishment

**Status:** Accepted (Phase 0 spec §7, change C2)

## Context

With no database and no admin, a report that "goes nowhere" would be fake functionality;
automatic punishment on reports is easy to abuse against innocent players.

## Decision

A report immediately hides the reported player's chat/drawings for the reporter (client),
and the server records `{roomId, reportedId, reporterId, reason, at}` through a `ReportSink`
into a bounded, expiring in-memory store plus a content-free log line. Reports never kick,
ban or skip anyone in v1.

## Consequences

- The reporter gets immediate relief; nobody can weaponise reports.
- Flags are lost on restart; stronger moderation plugs into `ReportSink` later.
