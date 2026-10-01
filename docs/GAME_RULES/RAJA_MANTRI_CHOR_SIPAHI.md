# Raja Mantri Chor Sipahi — rules as implemented

Code: `games/rmcs` (engine `src/server/engine.ts`, board `src/client/Board.tsx`).
Approved rules: [spec §10](../specs/PHASE_0_SPEC.md#10-rmcs-rules). This page describes
exactly what the code does.

## Players and match

- **Exactly 4 players** (humans and/or bots). The lobby will not start with fewer and the
  room is full at 4.
- **10 rounds.** The highest total score wins; equal totals share a place (1, 1, 3, 4).
- No host settings in v1.

## A round

| Phase           | Length | What happens                                                                                                                                                          |
| --------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEALING`       | 2 s    | The four chits (Raja, Mantri, Sipahi, Chor) are shuffled with the match's seeded random generator and dealt one per player. Each player sees **only their own** chit. |
| `REVEAL_RAJA`   | 2 s    | The Raja is revealed to everyone.                                                                                                                                     |
| `REVEAL_MANTRI` | 2 s    | The Mantri is revealed to everyone. The other two players become the **suspects**.                                                                                    |
| `GUESSING`      | 30 s   | Only the Mantri may act: they accuse one of the two suspects. If the timer runs out, the server picks one of the two at random for them.                              |
| `ROUND_RESULT`  | 4 s    | Every chit is revealed, the round is scored, the verdict is shown. Then the next round is dealt (or the match ends after round 10).                                   |

## Scoring

| Outcome                   | Raja | Mantri | Sipahi | Chor |
| ------------------------- | ---: | -----: | -----: | ---: |
| Mantri accuses the Chor   | 1000 |    800 |    500 |    0 |
| Mantri accuses the Sipahi | 1000 |      0 |    500 |  800 |

Every round hands out exactly **2300** points (so a full match hands out 23,000). This is
checked by tests in every simulated match.

## What each player can see

| Information               | You                                                        | Everyone else                                          |
| ------------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| Your own role             | always                                                     | after `ROUND_RESULT` (or as Raja/Mantri when revealed) |
| Who is the Raja           | from `REVEAL_RAJA`                                         | from `REVEAL_RAJA`                                     |
| Who is the Mantri         | from `REVEAL_MANTRI`                                       | from `REVEAL_MANTRI`                                   |
| Which suspect is the Chor | only if you are the Chor or the Sipahi (you can deduce it) | at `ROUND_RESULT`                                      |
| Scores and past rounds    | always                                                     | always                                                 |

Hidden roles are never sent to a player who may not see them: not in views, not in events.
Tests check this both in the engine (perturbation leak check on every step of 200 simulated
matches) and over real sockets.

## Actions

`{ type: 'GUESS', target: <seat> }` — accepted only from the Mantri, only during
`GUESSING`, and only for one of the two suspects. Anything else is rejected
(`NOT_YOUR_TURN`, `INVALID_PHASE`, `ILLEGAL_ACTION`). Like every game action it carries a
unique `actionId`, so a double tap or replay cannot count twice.

## Events (for animation)

`ROUND_STARTED` · `ROLE_DEALT` (private to its owner) · `RAJA_REVEALED` ·
`MANTRI_REVEALED` · `GUESSING_STARTED` · `GUESS_MADE` · `ROUND_RESOLVED` (all roles,
deltas, scores) · `MATCH_OVER`.

## Idle players and bots

- A player who lets the guessing timer run out **twice in a row** while Mantri is handed to
  a bot (they can tap "I'm back").
- Disconnected players keep their seat for 30 s, then a bot plays until they return
  (reclaim is immediate).
- **The bot:** the only decision in this game is the Mantri's guess between two players the
  bot knows nothing about, so the bot guesses uniformly at random after a short "thinking"
  delay (0.8–2.5 s). It never looks at hidden roles — it receives the same view a human in
  its seat would.

## Results

Placements by total score (ties share a place). The results screen shows a podium, the
winner, and a **Score** column for every player.

## On screen

- A chalkboard-green classroom desk in a wooden frame; you always sit at the bottom, play
  goes clockwise (left, top, right).
- Folded paper chits fly in when dealt and flip over as roles are revealed; your own chit is
  also shown as a large card with what it is worth and a hint.
- The Raja's chit pops when revealed; a countdown ring circles the Mantri while they think.
- As Mantri: tap **Suspect** on a player, then **Accuse!** (two steps, so a mis-tap never
  costs 800 points). The accuse bar stays pinned to the bottom of the screen on phones.
- The verdict lands as a rubber stamp — **CHOR CAUGHT!** or **CHOR ESCAPED!** — while score
  changes float up from each seat and totals roll to their new values.
- Every animation has a lite version and is skipped entirely in reduced-motion mode.
