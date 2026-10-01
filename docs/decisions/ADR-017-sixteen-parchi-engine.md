# ADR-017: 16 Parchi engine — simultaneous passing, re-keyed slips, claim races

**Status:** Accepted (Phase 3, implements spec §11; derived points recorded in
[design/16_PARCHI_DESIGN.md](../design/16_PARCHI_DESIGN.md) §8)

## Context

16 Parchi is the first game where every player acts at the same time and where the core
information (which slip is where) must stay hidden while slips move around the table. The
spec fixes the rules, timings and visibility; a few mechanics needed concrete decisions.

## Decision

- **Simultaneous selection, one pass transition.** Selections are stored per seat; the pass
  is resolved in a single engine transition (all slips move at once), 300 ms after the last
  missing choice or at the 10 s timeout (safe auto-pick for the rest). Only one runtime
  timer (`phase`) exists; setting it again replaces it.
- **Slip handles are re-keyed per holder.** Every slip that enters a hand gets a fresh
  random handle from the match RNG. Players never see another hand's handles, cannot track a
  slip around the table, and an action built on an older hand fails cleanly
  (`ILLEGAL_ACTION`) instead of selecting a different slip — which matters with lenient
  action versions (ADR-014).
- **Private by audience, not by filtering.** Items travel only in private events
  (`DEALT`, `CHIT_RECEIVED`, `MY_SELECTION` — your own slips) and in the public
  `CLAIM_ACCEPTED` after a claim. `SEAT_SELECTED` is emitted only on a player's first choice
  of a cycle, so changing your mind is invisible.
- **Claim races** are ranked by arrival in the match's single transition queue. The claim
  window stays open until every eligible player has claimed, then closes early (passing is
  paused, so nothing actionable leaks); unclaimed sets are auto-claimed in seeded order at
  the timeout. When one player is left they take the last place in the same transition.
- **Claim hold (1.5 s)** after a window before selection resumes, so the claim animation is
  not cut short (spec §15: server holds account for animations).
- **Safety cap** is checked when the next selection would start (a due claim window runs
  first); remaining players are ranked by largest same-item group, seeded tie-break.
- Test-only factory options: `timing`, `botThinkMs`, `botClaimMs`, `cycleCap`, `timeScale`,
  and `deck` (rigged deals for lucky hands and claim races). Production uses the defaults.

## Consequences

- Invariants checked after every transition in tests (16 slips, 4 copies of each item, 4 per
  active hand, claimed sets are four of a kind, places 1..n, unique handles).
- 300 seeded bot matches with the view-leak checker, an event-leak check, AFK matches that
  must terminate, and over-the-wire tests for simultaneous claims and foreign handles.
