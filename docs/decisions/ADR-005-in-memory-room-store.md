# ADR-005: In-memory RoomStore; documented scaling path

**Status:** Accepted (Phase 0 spec §2, §17; change C7)

## Context

v1 has no persistent requirements (no accounts, stats or history) and modest expected
traffic. A database or Redis would add cost and complexity with no user-visible benefit.

## Decision

Rooms, sessions, chat buffers and report flags live in one Node process's memory. Rooms are
accessed through a `RoomStore` interface (v1: `InMemoryRoomStore`).

## Consequences

- A restart or deploy ends every game and session (clients show a notice and start fresh).
- **Scaling path (not built):** game state and timers live in the process hosting a room, so
  a shared store alone is not enough. Scaling out needs, in order: room affinity (each room
  pinned to one instance), sticky sessions, `@socket.io/redis-adapter` for cross-instance
  broadcasts, and a Redis-backed `RoomStore` for the room index/lobby.
