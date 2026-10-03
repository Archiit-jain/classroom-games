# Name Place Animal Thing — rules as implemented

Code: `games/name-place-animal-thing` (engine and bot `src/server/engine.ts`, answer checks
`src/shared/answers.ts`, answer bank `content/en`, worksheet `src/client/Board.tsx`).
Design: [design/NAME_PLACE_ANIMAL_THING_DESIGN.md](../design/NAME_PLACE_ANIMAL_THING_DESIGN.md).
Values marked _(play-test)_ are starting points, not frozen rules.

## Players, categories and rounds

- **2–8 players**, humans and/or bots.
- **Four categories: Name, Place, Animal, Thing.** (Owner decision — no other categories.)
- The host picks **3, 5 (default), 8 or 10 rounds**.

## A round

1. **Get ready** (2.5 s _(play-test)_). Then the server draws one **letter** for everyone — never
   the same twice in a match, never Q, X or Z, and only letters our answer bank covers in all
   four categories (currently all 23 others).
2. **Writing — 90 seconds** (frozen). Everyone fills in one answer per category at the same
   time. Each sheet is **saved privately** as you type (about 0.4 s after a keystroke); nobody
   else sees anything of it — not even how much you have filled in.
3. **STOP:** from **15 seconds** into writing (frozen), a player whose four answers all pass the
   format rules below may press STOP. Writing ends at once for everyone. Bots never press STOP.
4. The round also ends when the **90 s** run out. Whatever was saved counts; empty fields score 0. A last autosave of what was typed before the end is accepted for 1 s _(play-test)_
   (not from the player who pressed STOP — their STOP carried their sheet).
5. **Automatic check**, then **reveal** of all sheets, then **voting** (with 3+ human
   players), then **scores** (6 s _(play-test)_), then the next round.

## The automatic check

| Result                           | When                                                                                                                                                                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Blank** (0)                    | Nothing, or only spaces/punctuation.                                                                                                                                                                                                                       |
| **Invalid** (0, final)           | Does not start with the letter (accents ignored; no skipping "A"/"The"); fewer than 2 letters; anything but Latin letters, spaces and `. ' ’ -` (no digits, emoji, other scripts); over 30 characters; or the moderator censors anything (shown censored). |
| **Accepted — "In our list"**     | Passes, and is in our curated list for that category.                                                                                                                                                                                                      |
| **Accepted — "Not in our list"** | Passes, but we don't know it — the players can judge it.                                                                                                                                                                                                   |

Capitalisation, accents, extra spaces and punctuation never matter. The checker cannot know
whether an unfamiliar word really is an animal; that is what the vote is for.

## Same answers

Answers in one category are **the same** when they match ignoring case, accents, spaces and
`. ' ’ -` (`Delhi`, `delhi`, `DELHI`, `Delhi.`), when one is the other plus `s`/`es` (3+
letters: `Mango`/`Mangoes`), or when both are listed variants (`Bengaluru`/`Bangalore`).
Misspellings are different answers (`Dehli` ≠ `Delhi`).

## Voting (frozen)

- There is a vote only with **3 or more human players**. With 2 (or 1), the automatic check
  decides — one player can never reject the other's answer alone.
- Players tap ✗ on **accepted** answers they think are wrong (never their own). Invalid
  answers cannot be voted back in.
- An answer is **rejected** when ✗ votes reach a **strict majority of the human players**:

  | Human players | 2       | 3   | 4   | 5   | 6   | 7   | 8   |
  | ------------- | ------- | --- | --- | --- | --- | --- | --- |
  | Votes needed  | no vote | 2   | 3   | 3   | 4   | 4   | 5   |

- Bots never vote and never count. Identical answers are judged together (one vote covers all
  of them). Votes are anonymous; anyone can withdraw theirs until the review ends.
- The review lasts 30 s _(play-test)_ or ends as soon as every connected human player taps
  **Done**. Human players are counted when it ends: a disconnected player's votes count; a
  player a bot takes over stops being a voter.

## Scoring

| Answer                                         | Points |
| ---------------------------------------------- | ------ |
| Accepted, not voted out, nobody else wrote it  | **10** |
| Accepted, not voted out, someone else wrote it | **5**  |
| Blank, invalid or voted out                    | **0**  |

At most 40 points a round. Most points after the last round wins; equal totals share a place
(1, 1, 3). The results also show each player's **unique answers**.

## Rejected actions

STOP outside writing, before it opens or with an incomplete sheet (`NOT_ELIGIBLE`), a vote
outside the review, on your own answer, with fewer than 3 human players, twice in the same
direction, on an unknown answer, anything for another round, malformed or extra fields, a
repeated action id, a version the server never issued, anything after the end.

## Timing, bots and leaving

- A connected player whose sheet is completely empty in 2 rounds in a row is handed to a bot
  ("I'm back" takes the seat back). Disconnected players have the usual 30 s grace.
- **Bots** answer from our curated list for the letter, one category at a time at a human
  pace (first after 6–14 s, then every 4–11 s _(play-test)_), finishing by ~80 % of the time —
  an early STOP can leave them with blanks, like anyone. They never STOP or vote. A bot
  standing in for a player keeps what that player had saved and fills the blanks.
