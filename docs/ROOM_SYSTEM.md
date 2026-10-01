# Room system

Implementation: `apps/server/src/rooms/` (`RoomManager`, `RoomStore`, `policies.ts`,
`naming.ts`). Phase 1 implements **private rooms**; public rooms arrive in Phase 9 (see
[PUBLIC_LOBBY_SYSTEM.md](PUBLIC_LOBBY_SYSTEM.md)).

## Room model

```text
Room {
  id, kind: 'PRIVATE', code, gameId, settings, phase, hostId,
  members: (HumanMember | BotMember)[],   // join order = seat order at match start
  barred: Set<playerId>,                   // removed by the host
  match: { matchId, runtime, seats: SeatState[], results, pendingReclaims } | null,
  startsAt, chat (last 50 censored messages), noHumansSince
}
SeatState { seat, memberId, memberKind, displayName,
            takeover: { botId, botName, reason: DISCONNECTED | IDLE | LEFT } | null,
            forfeited }
```

Room behaviour that differs by kind lives in a `RoomPolicy` (`canManage`, `isJoinable`).

## Room phases (private)

```mermaid
stateDiagram-v2
  [*] --> LOBBY: host creates room
  LOBBY --> STARTING: host starts (players within game min–max)
  STARTING --> LOBBY: players dropped below minimum
  STARTING --> IN_GAME: 3 s countdown ends
  IN_GAME --> RESULTS: game over
  IN_GAME --> LOBBY: engine error (MATCH_ABORTED)
  RESULTS --> STARTING: host "Play again"
  RESULTS --> LOBBY: host "Back to lobby"
  LOBBY --> CLOSED: last human leaves / idle 5 min
  IN_GAME --> CLOSED: only bots remain
  RESULTS --> CLOSED: last human leaves / idle 5 min
```

- **Create:** requires a nickname; creator becomes host; code is 6 characters from
  `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0/O/1/I/L), about 887 million possibilities.
  Codes are case- and space-insensitive when typed.
- **Join:** only in `LOBBY`; fails with `ROOM_NOT_FOUND`, `ROOM_FULL`, `ROOM_IN_PROGRESS`,
  `REMOVED_FROM_ROOM`, `NICKNAME_TAKEN` (look-alike names count as the same) or
  `ALREADY_IN_ROOM`. Join attempts are rate-limited (anti code-guessing).
- **Capacity:** the selected game's maximum players.
- **Host powers** (`LOBBY` unless noted): change game, change settings (validated by the
  game's schema), add/remove bots, remove players (any phase), start; from `RESULTS`:
  play again / back to lobby.
- **Removed players** are barred from that room only and told `KICKED`.
- **Host transfer:** when the host leaves or their grace period expires, the earliest-joined
  connected human becomes host (`HOST_CHANGED`). Bots are never host.

## Connection states

```mermaid
stateDiagram-v2
  [*] --> CONNECTED
  CONNECTED --> GRACE: socket lost
  GRACE --> CONNECTED: reconnects with token (within 30 s)
  GRACE --> REMOVED: grace expires (LOBBY / STARTING / RESULTS)
  GRACE --> BOT_PLAYS: grace expires (IN_GAME)
  CONNECTED --> BOT_PLAYS: engine requests MARK_IDLE
  BOT_PLAYS --> CONNECTED: reconnects (DISCONNECTED) / taps "I'm back" (IDLE)
  CONNECTED --> LEFT: leaves or is removed during a match
  LEFT --> [*]: bot keeps the seat; no reclaim this match
```

Details:

- During `GRACE` the seat is reserved; the game's own timers keep running (so the absent
  player's turns time out normally).
- A player whose grace expires **during a match** stays a member (a bot plays for them) and
  gets their seat back automatically on reconnect. When the match ends, still-absent
  players get a fresh grace period; if it expires they are removed.
- `IDLE` takeovers keep the human connected and watching; they tap **I'm back**
  (`room:reclaimSeat`). Their own actions are refused with `SEAT_CONTROLLED_BY_BOT` while a
  bot plays.
- Reclaim policy comes from the game manifest: `IMMEDIATE`, or `NEXT_PHASE_BOUNDARY`
  (the game's `canReclaimSeat` decides; pending reclaims are retried after every transition).
- Players who **leave** (or are removed) mid-match forfeit the seat to a bot for the rest of
  that match and cannot rejoin while it runs.
- When a player reconnects, the server always sends a room snapshot (or `null` if they are no
  longer in a room), the chat history and, in a match, a fresh view.

## Cleanup

- A room closes when its last human member is gone, or when **only bots remain** in a match
  (no human connected or within grace).
- A periodic sweep closes rooms that have had no connected humans for 5 minutes.
- Closing clears every timer and bot for that room.

## Limits (config)

`maxRooms` (500), `roomCreate` rate limit (burst 3, ~5/min per session), `roomJoin`
(burst 10, ~20/min), `roomAdmin` (burst 10, 2/s).
