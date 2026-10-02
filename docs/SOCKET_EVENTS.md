# Socket events

Source of truth: `packages/protocol/src/events.ts` (types) and
`packages/protocol/src/schemas.ts` (server-side zod schemas). This page lists what is
implemented as of Phase 6.

## Conventions

- Transport: Socket.IO 4 over **WebSocket only** (no HTTP long-polling: requests may reach
  different server instances). Path: `/socket.io` in development; in production the client
  connects to its own site at `/api/socket/socket.io` (the Vercel Function, see
  [DEPLOYMENT.md](DEPLOYMENT.md)). The client authenticates in the handshake with
  `auth: { token }` (omit it on first visit).
- With several server instances the socket's instance forwards each event to the instance
  hosting the rooms and relays its answers ([ADR-023](decisions/ADR-023-multi-instance-cluster.md));
  the protocol is the same either way.
- **Every client → server event must carry an acknowledgement callback.** Events without
  one are ignored. The ack is always:

  ```ts
  { ok: true, ...result } | { ok: false, code: ErrorCode, retryAfterMs?: number }
  ```

- Payloads are validated with strict schemas (unknown keys rejected) **after** rate
  limiting. Invalid payloads → `INVALID_PAYLOAD`. Messages larger than 16 KB close the
  connection.
- The server never sends user-facing text; clients translate error codes.

## Client → server

| Event                 | Payload                                                  | Success result                        | Rate bucket                                                                          |
| --------------------- | -------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------ |
| `session:setNickname` | `{ nickname }`                                           | `{ nickname }` (normalised)           | nickname                                                                             |
| `room:create`         | `{ gameId }`                                             | `{ room: RoomView }`                  | roomCreate                                                                           |
| `room:join`           | `{ code }`                                               | `{ room: RoomView }`                  | roomJoin                                                                             |
| `room:leave`          | `{}`                                                     | `{}`                                  | roomAdmin                                                                            |
| `room:setGame`        | `{ gameId }`                                             | `{}` (host, LOBBY)                    | roomAdmin                                                                            |
| `room:updateSettings` | `{ settings }`                                           | `{}` (host, LOBBY)                    | roomAdmin                                                                            |
| `room:addBot`         | `{}`                                                     | `{}` (host, LOBBY)                    | roomAdmin                                                                            |
| `room:removeBot`      | `{ botId }`                                              | `{}` (host, LOBBY)                    | roomAdmin                                                                            |
| `room:kick`           | `{ playerId }`                                           | `{}` (host)                           | roomAdmin                                                                            |
| `room:start`          | `{}`                                                     | `{}` (host, LOBBY)                    | roomAdmin                                                                            |
| `room:playAgain`      | `{}`                                                     | `{}` (host, RESULTS → STARTING)       | roomAdmin                                                                            |
| `room:backToLobby`    | `{}`                                                     | `{}` (host, RESULTS → LOBBY)          | roomAdmin                                                                            |
| `room:reclaimSeat`    | `{}`                                                     | `{}` (take your seat back from a bot) | roomAdmin                                                                            |
| `match:action`        | `{ matchId, version, actionId, action }`                 | `{ version }`                         | matchAction                                                                          |
| `match:resync`        | `{ matchId }`                                            | `{ update: MatchUpdate }`             | matchAction                                                                          |
| `match:stream`        | `{ matchId, chunk }` (streamed games, e.g. a stroke)     | `{}`                                  | stream (30, 20/s)                                                                    |
| `chat:send`           | `{ text }`                                               | `{}`                                  | chat (own cooldown); game input (e.g. guesses): the game's own limit, `RATE_LIMITED` |
| `chat:react`          | `{ reactionId }` (one of the 8 `REACTION_IDS`)           | `{}`                                  | reaction (1 / 1.5 s)                                                                 |
| `report:submit`       | `{ playerId, reason: CHAT \| DRAWING \| NAME \| OTHER }` | `{}`                                  | report                                                                               |
| `time:ping`           | `{ clientTs }`                                           | `{ clientTs, serverNow }`             | ping                                                                                 |

A coarse per-socket flood guard (burst 40, 20/s) silently drops excess packets before any
handler runs.

**`match:action` details** ([ADR-014](decisions/ADR-014-lenient-action-versions.md)):
`actionId` is required — 8–64 characters from `A–Z a–z 0–9 _ -`, generated by the client once
per intent. Each id executes at most once per match; a repeat gets `DUPLICATE_ACTION`
(whatever happened to the first attempt). `version` is the view version the player acted
on: a version the server never issued gets `STALE_VERSION` (and does not use up the id);
older issued versions are fine — the game decides legality against the current state.

**`match:stream` details** ([ADR-020](decisions/ADR-020-streamed-games.md)): only for
`STREAMED` games. The chunk is parsed with the game's schema (`INVALID_PAYLOAD`), then the
game accepts or rejects it (`NOT_YOUR_TURN`, `INVALID_PHASE`, `ILLEGAL_ACTION` for limits); a
seat a bot is playing gets `SEAT_CONTROLLED_BY_BOT`. Accepted chunks change no version and send
no `match:update`; they are relayed to the game's audience (not back to the sender).

**`chat:react` details:** only from a seated human while the room's match is running
(`NOT_IN_ROOM` / `INVALID_PHASE` otherwise); unknown ids are `INVALID_PAYLOAD`; more than one
per 1.5 s is `RATE_LIMITED` with `retryAfterMs`. Bots never react.

## Server → client

| Event               | Payload                                                        | When                                                                                                             |
| ------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `session:ready`     | `{ playerId, nickname, token?, games: GameInfo[], serverNow }` | After every connection. `token` only when a new session was created — the client must store it.                  |
| `session:displaced` | —                                                              | Another tab took over this session; this socket is then disconnected.                                            |
| `room:snapshot`     | `{ room: RoomView \| null }`                                   | Any room change; on every connect; `null` when not in a room.                                                    |
| `room:event`        | `RoomEvent`                                                    | `KICKED`, `ROOM_CLOSED`, `HOST_CHANGED {hostId}`, `SEAT_TAKEN_OVER {reason}`, `SEAT_RECLAIMED`, `MATCH_ABORTED`  |
| `match:update`      | `MatchUpdate`                                                  | After every transition, per player: `{ matchId, gameId, version, you, events, view, serverNow }`                 |
| `match:end`         | `{ matchId, results }`                                         | Match finished.                                                                                                  |
| `match:stream`      | `{ matchId, chunks, reset }`                                   | Streamed-game data (drawing strokes) as it is accepted; `reset: true` = full replay on reconnect/reclaim/resync. |
| `chat:message`      | `ChatMessage`                                                  | A (moderated) message you may see.                                                                               |
| `chat:history`      | `{ messages }`                                                 | On joining or reconnecting to a room (last 50 room-channel messages).                                            |
| `chat:reaction`     | `{ fromId, seat, reactionId, sentAt }`                         | A player in your room's running match sent a quick reaction ([ADR-018](decisions/ADR-018-quick-reactions.md)).   |
| `system:notice`     | `{ code: 'SERVER_RESTARTING' }`                                | Graceful shutdown started.                                                                                       |

## Key types

```ts
RoomView {
  id; kind: 'PRIVATE' | 'PUBLIC'; code: string | null; gameId; settings;
  phase: 'LOBBY' | 'STARTING' | 'IN_GAME' | 'RESULTS' | 'CLOSED';
  hostId; startsAt; capacity; minPlayers;
  members: ({ kind: 'HUMAN'; id; nickname; status: 'CONNECTED' | 'AWAY' } | { kind: 'BOT'; id; name })[];
  match: { matchId; gameId; results; seats: SeatView[] } | null;
}
SeatView { seat; memberId; memberKind; displayName; controller: 'HUMAN' | 'BOT';
           takeover: { reason: 'DISCONNECTED' | 'IDLE' | 'LEFT'; botName } | null }
ChatMessage { id; fromId; fromName; isBot; text; sentAt; channel }
GameResults { placements: { seat; place }[]; stats? }
```

## Error codes

`INVALID_PAYLOAD`, `RATE_LIMITED`, `SERVER_BUSY`, `INTERNAL_ERROR`, `NICKNAME_REQUIRED`,
`NICKNAME_INVALID`, `NICKNAME_REJECTED`, `NICKNAME_TAKEN`, `NICKNAME_LOCKED_IN_ROOM`,
`GAME_NOT_FOUND`, `ROOM_NOT_FOUND`, `ROOM_FULL`, `ROOM_IN_PROGRESS`, `ALREADY_IN_ROOM`,
`NOT_IN_ROOM`, `NOT_HOST`, `REMOVED_FROM_ROOM`, `INVALID_SETTINGS`,
`TOO_MANY_PLAYERS_FOR_GAME`, `NOT_ENOUGH_PLAYERS`, `BOTS_NOT_SUPPORTED`, `INVALID_PHASE`,
`PLAYER_NOT_FOUND`, `BOT_NOT_FOUND`, `CANNOT_TARGET_SELF`, `MATCH_NOT_FOUND`,
`STALE_VERSION`, `DUPLICATE_ACTION`, `NOT_YOUR_TURN`, `ILLEGAL_ACTION`, `NOT_ELIGIBLE`,
`SEAT_NOT_RECLAIMABLE`, `SEAT_CONTROLLED_BY_BOT`, `CHAT_EMPTY`, `CHAT_COOLDOWN`,
`CHAT_BLOCKED`. Handshake refusals arrive as `connect_error` with message `RATE_LIMITED`
or `SERVER_BUSY`.

## Not implemented yet

`mm:quickPlay`, `mm:cancel`, `lobby:watch`, `lobby:unwatch`, `lobby:rooms` (Phase 9).
