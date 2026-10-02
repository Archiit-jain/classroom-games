# ADR-020: Streamed games — `match:stream`, replay, and chat/stream bot moves

**Status:** Accepted (Phase 4, implements spec §9 `StreamModule` and §15 `STREAMED`)

## Context

Draw & Guess sends drawing strokes many times a second. Making every stroke a game
transition would bump the match version, re-send every view and queue behind the animation
director — far too heavy, and drawings would stutter. Its guesses are chat messages, and its
bots must both guess (in the chat) and draw.

## Decision

- **Protocol:** `match:stream {matchId, chunk}` C→S (acked, rate bucket `stream`: burst 30,
  20/s) and `match:stream {matchId, chunks, reset}` S→C. The runtime parses the game's
  `stream.chunkSchema`, then `stream.accept(state, seat, chunk)` decides (sender, phase,
  limits) and returns the new state, the chunk to relay and its audience. Accepted chunks
  update state **without** a version bump or `match:update`, and are relayed at once to the
  connected humans in the audience (Draw & Guess: everyone but the drawer, who draws locally).
- **Replay:** `stream.replay(state, seat)` returns everything a seat should have; the server
  sends it as one `reset: true` batch on reconnect, seat reclaim and `match:resync`.
- **Client:** the connection mirrors the stream (bounded log) and boards subscribe through
  `BoardProps.stream` (`send`, `subscribe` — the current log first as a reset batch). Streams
  bypass the animation director. Boards also get `chat` (messages + send) and `safety`
  (hidden ids, toggle, report) for in-board guess boxes and Hide/Report.
- **Bots:** `BotDecision` gains `CHAT {text}` — sent through `ChatService.sendFromBot`, the
  **same** game hook and moderation as humans, shown as a bot — and `STREAM {steps}` — a timed
  plan the `BotManager` plays chunk by chunk through `acceptStream` (the same validation as a
  human; the first rejection cancels the rest). Bots never chat otherwise.
- **Chat hook:** `ChatDecision.PASS` may carry a transition, so a game can record public
  facts about ordinary messages (Draw & Guess remembers wrong guesses for its bots and board).
- A seat a bot controls cannot stream (`SEAT_CONTROLLED_BY_BOT`).

## Consequences

- Strokes cost one small relay each; views and versions stay quiet while someone draws.
- Everything streamed is still server-validated and replayable, so late joiners and
  reconnects see the same picture.
- Bots use exactly the human input paths (actions, chat, stream), so fairness rules and rate
  limits apply to them too.
