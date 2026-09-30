# Public lobby system

> **Status: not implemented. Planned for Phase 6.** Nothing in this document exists in the
> code yet. The approved design is in [specs/PHASE_0_SPEC.md](specs/PHASE_0_SPEC.md) §4–§5
> and change-log item C8.

## What Phase 6 will add

- **Public rooms** created and controlled by the server (no human host), listed in a
  browse feed while waiting, closed to joining once a match starts.
- **Quick Play** for a specific game and for "Any Game", placing players in the waiting
  room with the most humans.
- **Bot fill**: once a room has at least `minHumans` (2 for every v1 game), a configurable
  window (default 12 s) opens; when it ends, clearly-labelled bots fill the empty seats.
- **"Play with Bots"** escape hatch for a lone player who has waited through the window —
  the resulting match is explicitly labelled as containing bots.

## How the Phase 1 foundation prepares for it

- Rooms already carry a `kind` (`PRIVATE` | `PUBLIC`) and route kind-specific behaviour
  through a `RoomPolicy` (`apps/server/src/rooms/policies.ts`). Phase 6 adds the public
  policy.
- Game manifests already declare `publicMatch: { targetPlayers, minHumans }`.
- Bot seats, takeover and labelling are implemented and tested.
