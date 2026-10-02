# Draw & Guess (working name) — rules as implemented

Code: `games/draw-and-guess` (engine `src/server/engine.ts`, bot templates
`src/server/templates.ts`, guess matching `src/shared/guess.ts`, drawing model
`src/shared/drawing.ts`, board `src/client/Board.tsx`, word pack `content/en`). Approved rules:
[spec §12](../specs/PHASE_0_SPEC.md). Design notes:
[design/DRAW_AND_GUESS_DESIGN.md](../design/DRAW_AND_GUESS_DESIGN.md). This page describes
exactly what the code does. **The public name is a launch blocker (spec C9).**

## Players and setup

- **3–6 players** (humans and/or bots). Private rooms: the host sets **rounds** (1–3,
  default 2). In every round each player draws once, in seat order.
- Words come from a curated pack only (387 English words with aliases and an easy / medium /
  hard tag; players never type prompts). A word is never offered twice in a match.

## A turn

| Phase      | Length | What happens                                                                                                                                                                                                      |
| ---------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CHOOSING` | 10 s   | The drawer privately gets **three word cards** (one per difficulty where possible; at least one has a bot drawing template). Everyone else sees who is choosing. Time out → a random card.                        |
| `DRAWING`  | 60 s   | The drawer draws; everyone else sees the strokes live and the word as **blanks** (spaces and hyphens shown). **Hints:** one letter at 50 % and one at 75 % of the time, at most floor(letters ÷ 3) and at most 2. |
| `REVEAL`   | 5 s    | The word is shown to everyone with each player's points for the turn.                                                                                                                                             |

The turn ends early when **every guesser has guessed**, or when the drawer's seat is taken
over by a bot (disconnect grace expired) or the drawer leaves. After the last turn of the
last round the match ends.

## Drawing

- A fixed 4:3 sheet (4096 × 3072 units, scaled to any screen). Tools: **12 colours**, **4
  brush sizes**, **eraser**, **undo** (removes the last stroke) and **clear**.
- Only the drawer may draw, only while `DRAWING`; the server rejects anything else. Limits
  per turn: 1,000 strokes and 20,000 points; ≤ 64 points per chunk; about 20 chunks/s.
- Someone who reconnects (or resyncs) gets the whole current drawing replayed. The drawing
  stays visible through the reveal.

## Guessing

Guesses are typed in the room chat (the board has its own guess box). Each message goes
through the game before moderation:

| Who / what                           | Result                                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| The drawer, while drawing            | Blocked (`CHAT_BLOCKED`) — no hints in the chat.                                                            |
| A player who already guessed it      | Delivered only to the drawer and the others who guessed it (the **Solved** lane).                           |
| A **correct** guess                  | Never shown. The guesser gets **Correct! +points** privately; everyone sees "_name_ guessed it"; ✓ on chip. |
| A **close** guess (one letter off)   | Never shown. Only the sender sees "“…” is close!".                                                          |
| Anything else                        | Shown normally (moderated) and remembered as a wrong guess for this turn.                                   |
| Outside `DRAWING` (choosing, reveal) | Normal chat.                                                                                                |

**Guess rate limit:** while drawing, a guesser's messages are limited by the game's own
limit — 8 at once, then 1 per second; beyond that, a short "slow down" (about a second), never
the room chat's 30-second cooldown. Players who already guessed, the drawer, and chat outside
the drawing phase use the normal room-chat limit.

**Correct** means: after lower-casing and removing accents and punctuation (hyphens count as
spaces), the guess equals the word or one of its aliases (spaces ignored, so "icecream" =
"ice cream"), or contains it as a whole word or phrase ("is it a cat?"). A word hidden inside
another word does not count ("category" ≠ "cat"). **Close** means one edit away from the
word or an alias of at least 4 letters.

## Scoring

- Guessers by order: **100, 80, 65, 55, 50** (50 for everyone after the fourth).
- Drawer: **20 per correct guesser**.
- Most points wins; equal scores share a place.

## Bots

- **Choosing:** picks a card it can draw (one with a template), after 1–3 s.
- **Drawing:** replays that word's original stroke template (36 words: sun, house, kite,
  fish, …) with small random wobble over 20–40 s, through the same stream path and limits as
  a human.
- **Guessing:** every 6–12 s it types a word from the pack that fits the public pattern
  (length, spaces, revealed letters) and has not been guessed wrong this turn. It sees only
  what a human guesser sees — never the answer.

## Idle players and reconnecting

- A drawer who makes **no stroke in 2 consecutive own turns** is handed to a bot (they can
  tap "I'm back").
- Taking a seat back works at the next phase boundary: immediately, except for the current
  drawer while choosing or drawing — then at the reveal.

## Safety

- **Hide drawing** (per drawer, on your device only — strokes still arrive, so showing it
  again restores the picture; it also hides that player's chat for you).
- **Report drawing** sends a `DRAWING` report and hides the player for you. Nobody is ever
  removed automatically, and the game never claims drawings are automatically moderated.
