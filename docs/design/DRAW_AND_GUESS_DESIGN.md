# Draw & Guess (working name) — design verification

**Status:** Phase 4 design pass, written before implementation; implemented as described (rules as built: [GAME_RULES/DRAW_AND_GUESS.md](../GAME_RULES/DRAW_AND_GUESS.md), [ADR-020](../decisions/ADR-020-streamed-games.md), [ADR-021](../decisions/ADR-021-perfect-freehand.md)). Game id: `draw-and-guess`.
The rules are spec §12 (with §7 reporting, §8 chat, §9 `StreamModule`, §15 `STREAMED`);
this document records how they are built on the existing platform and the few choices the
spec leaves open.

> **Decision status.** **Binding:** spec §12 and the Appendix A tunables (3–6 players;
> CHOOSING 10 s → DRAWING 60 s → REVEAL ~5 s; hints at 50 % / 75 % capped at floor(letters/3);
> guess evaluation via the chat hook; scoring 100/80/65/55/50 and 20 per correct guesser for
> the drawer; 12 colours, 4 sizes, eraser, undo, clear; stream limits; safety rules; ≥ 300
> words and 30–40 bot templates; bot behaviour; idle after 2 empty drawing turns).
> **Developer proposals** are marked _(proposed)_. **Implementation blockers:** none.
> **Launch blocker:** an original public name (spec C9).

## 1. Storyboard

| #   | Moment      | What players see                                                                                                                                                                                                      |
| --- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Lobby       | Host sets rounds (1–3, default 2). 3–6 players.                                                                                                                                                                       |
| 2   | Choosing    | The drawer gets three word cards (one easy, one medium, one hard where possible _(proposed)_) and 10 s to pick; everyone else sees "Priya is choosing a word…". Timeout → a random card.                              |
| 3   | Drawing     | Drawer: the word, a paper canvas, palette and tools, 60 s ring. Guessers: the word as blanks (`_ _ _   _ _ _ _`), the live drawing, a guess box. Hints reveal letters at 50 % and 75 %.                               |
| 4   | Guessing    | Wrong guesses appear in the feed (moderated). A right guess is never shown: the guesser gets **Correct!**, everyone sees "Kabir guessed it", their chip turns green. A near miss shows **close!** to the sender only. |
| 5   | Solved chat | Players who already guessed (and the drawer) chat in a private "solved" lane.                                                                                                                                         |
| 6   | Reveal      | The word stamps onto the canvas; points fly to each chip; ~5 s.                                                                                                                                                       |
| 7   | Next drawer | Each player draws once per round; then the next round; then the podium (most points wins, ties share).                                                                                                                |

## 2. Interaction model and platform work

| Piece                 | Design                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Stroke protocol**   | New `match:stream` (acked) C→S and S→C, separate from `match:update` (spec §15). Chunk: `{op: 'stroke', id, tool: pen \| eraser, colour 0–11, size 0–3, points: [x, y, …]}` (integers 0–4095 × 0–3071 on a fixed 4:3 canvas, ≤ 64 points; a stroke continues across chunks with the same id), `{op: 'undo'}`, `{op: 'clear'}`. The drawer batches points every ~50 ms. |
| **Server validation** | The runtime parses the game's `chunkSchema`, then `stream.accept()`: sender is the drawer, phase DRAWING, indexes and ranges valid, ≤ 20,000 points and ≤ 1,000 strokes per turn. Rate limit bucket `stream` ≈ 20 chunks/s. Accepted chunks go to everyone else; the op log is kept for replay.                                                                        |
| **Replay**            | On reconnect and `match:resync` the server sends the whole op log (`reset: true`), so a returning player sees the current drawing.                                                                                                                                                                                                                                     |
| **Guesses**           | Ordinary room chat through the game's `ChatInterceptor` (exists since Phase 1): CONSUME (correct / close), BLOCK (drawer), RESTRICT to the `SOLVED` channel (solved players), PASS (wrong guesses, moderated as usual). The answer text is never broadcast.                                                                                                            |
| **Board contract**    | `BoardProps` gains `stream` (send chunks, subscribe to incoming batches), `chat` (messages + send, for the in-board guess box and feed) and `safety` (hidden ids, toggle, report — local Hide Drawing / report). Old games ignore them.                                                                                                                                |
| **Bots**              | Guessers return `BotDecision.CHAT`, wired through the **same** chat pipeline as humans (the hook, then moderation). Drawers return a new `STREAM` decision: a timed plan of chunks that the BotManager replays through the same `accept()` path.                                                                                                                       |

## 3. Rules details the spec leaves open _(proposed)_

1. **Word cards:** one per difficulty when the unused pool allows; never a word already used in
   the match. Bot drawers only ever get template-backed words.
2. **Scoring values** live in the game's options (server configuration), not in the lobby UI;
   the host only sets rounds.
3. **Drawer leaves / grace expires** while drawing → the turn ends at once (REVEAL); nobody is
   penalised. A bot that replaces a drawer between turns draws template words.
4. **Reclaim (NEXT_PHASE_BOUNDARY):** a returning player gets their seat back immediately,
   except while that seat is the current drawer in CHOOSING/DRAWING — then at the reveal.
5. **Correct guess matching:** normalised (lower case, accents, punctuation and extra spaces
   removed); equal to the word or an alias, or containing it as a whole word/phrase. **Close:**
   edit distance 1 to the word or an alias of ≥ 4 letters.
6. **Undo** removes the drawer's last stroke; **clear** wipes the canvas (both relayed as ops).

## 4. Hidden information

- Guessers' views contain only the **pattern** (blanks, spaces/hyphens, revealed letters); the
  drawer's view (and, once correct, the guesser's) contains the word. The word appears for
  everyone only in the REVEAL event.
- Correct guesses are consumed (never broadcast); "close!" goes only to the sender.
- Bots get the same views; a guesser bot never receives the answer.
- Tests: view-leak perturbation of the word over seeded matches; event scan (no event to a
  non-solved guesser contains the word before REVEAL); socket scan of every frame.

## 5. Content

- **Word pack** `content/en`: ≥ 300 English words (≥ 3 letters) with aliases (e.g. aeroplane →
  airplane, plane) and difficulty tags; everyday and Indian-familiar objects, animals, food,
  places and actions; every word and alias passes the moderator (tested); no brands.
- **Bot templates:** 30–40 original drawings (sun, house, fish, kite, …) authored as compact
  stroke data from shape primitives; each references a word in the pack. Replayed over 20–40 s
  with jitter.
- **Library:** `perfect-freehand` 1.2.3 (MIT, no dependencies, maintained) smooths strokes on
  the client only — spec §20 item 6 evaluation; ADR + CREDITS.

## 6. Layout

**Phone:** top strip (pattern or word, timer ring, round); the 4:3 canvas full width; drawer:
toolbar (12 swatches, 4 sizes, eraser, undo, clear) under the canvas; guessers: guess box +
recent guesses under the canvas; player chips (score, ✓ when solved, pencil on the drawer);
Hide Drawing and Report under the drawer's chip. **Desktop:** canvas centre, chips left,
feed right (platform chat panel).

## 7. Animation (Color Burst Arcade) _(proposed timings)_

| Moment      | Full                                                 | Lite             | Reduced |
| ----------- | ---------------------------------------------------- | ---------------- | ------- |
| Word cards  | Three cards deal in and flip                         | fade in          | instant |
| Hint        | A blank flips to its letter with a pop               | fade             | instant |
| Correct     | Chip bursts green + "Correct!" stamp (private)       | colour change    | instant |
| Close       | "close!" wobble under the guess box (sender only)    | text             | text    |
| Reveal      | The word stamps onto the canvas; points fly to chips | stamp, no flight | instant |
| Turn change | "Your turn to draw!" card slides up                  | fade             | instant |

Strokes are drawn as they arrive (never delayed by the animation director).

## 8. Safety

Curated words only (no player prompts). **Hide Drawing** per drawer (local; strokes still
arrive so un-hide restores the drawing). Report with reason DRAWING (spec §7: hides that
player's chat and drawings for the reporter, records a flag, never auto-punishes). The UI never
says drawings are automatically moderated.

## 9. Testing

Engine: phases and timers, card choice + timeout, hints (50/75 %, cap), guess evaluation
matrix (aliases, phrases, close, punctuation), BLOCK/RESTRICT/CONSUME/PASS, scoring and early
end, drawer grace, reclaim boundary, idle after 2 empty turns, rounds, results and ties.
Stream: accept/reject matrix and per-turn limits, replay. Fuzz: seeded bot matches with the
leak checker. Content: pack size, aliases, moderation, templates reference real words and stay
inside the canvas. Real sockets: relay to others only, rate limit, replay on reconnect,
correct/close/blocked/solved over the wire, answer never broadcast, bots guessing through
chat. Playwright: desktop + Pixel 7 — a human draws with the mouse/finger, the other reads
nothing but the canvas and types the word (taken from the drawer's screen by the test), hints,
reveal, podium; reduced motion.

## 10. Decisions and open points

**Blocking:** none. **Proposed (owner sign-off, non-blocking):** §3 items 1–6, animation
timings, phone layout. **Launch blocker:** the public name (C9).

## 11. Implementation notes

- **Cards (§3.1):** every set of three includes at least one word with a bot template, so a
  bot drawer always has something it can draw; a custom pack that runs out of unused words
  starts over. Human drawers may pick any card.
- **Wrong guesses** are recorded as public state through a `PASS` with a transition (a small
  platform addition), so bots never repeat a guess that was already wrong this turn.
- **Stroke ids** only ever grow within a turn (even after undo/clear), so the 1,000-stroke
  limit counts real strokes.
- **Sending:** the drawer batches points every 60 ms (≈ 16 chunks/s, under the 20/s limit)
  and skips points closer than 12 canvas units.
