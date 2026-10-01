# Name Place Animal Thing — design verification

**Status:** design only (not implemented). Proposed phase: 7. Game id:
`name-place-animal-thing`. Built on the existing `GameModule` / server-authoritative runtime
(`sync: 'TURN_PHASE'`); no new networking.

> **Decision status.** **Binding** — product-owner brief (2026-10-01): 2–8 players; a random
> letter each round; simultaneous filling; answers hidden until submission/time expiry; the
> server locks, evaluates and reveals; default categories Name, Place, Animal, Thing, Food,
> Profession, extensible later; round timer; configurable rounds; bots use the same
> validation path. Product-owner decisions (2026-10-01): answers are **auto-checked, then put
> to a player vote**; a round ends on the **timer or STOP**; scoring **10 / 5 / 0**.
> **Everything else** — exact numbers, timers, defaults, check details, vote threshold,
> duplicate matching, bot behaviour, UI and animation choices — is a **developer proposal**
> (marked _(proposed)_ or listed in §10) awaiting owner sign-off, not a frozen decision.
> **Implementation blockers:** none. **Launch blockers:** none for this game.

## 1. Proposed rules

| Topic      | Rule                                                                                                                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Players    | 2–8. Public target 6, minHumans 2 _(proposed)_. Reclaim IMMEDIATE.                                                                                                                                                                                                 |
| Categories | Name, Place, Animal, Thing, Food, Profession (default six). Defined in a content pack, so more can be added later.                                                                                                                                                 |
| Settings   | Rounds 3 / **5** / 8 / 10; round time 45 / **60** / 90 s _(proposed)_.                                                                                                                                                                                             |
| Letter     | Each round the seeded RNG picks a letter A–Z, never repeating in a match, excluding Q, X, Z _(proposed)_.                                                                                                                                                          |
| Writing    | Everyone fills the sheet privately at the same time. **Submit** locks your sheet. A player who has filled **every** category may press **STOP**: their sheet is submitted and everyone else gets a 5 s final countdown _(proposed)_.                               |
| Round end  | Timer runs out, STOP countdown ends, or every human has submitted — whichever is first. The server then **locks** all sheets.                                                                                                                                      |
| Auto-check | An answer is invalid if: blank; does not start with the round letter (case/accents ignored); fewer than 2 letters or more than 24 characters _(proposed)_; anything but letters, spaces, `- ' .`; or the moderator flags profanity / contact details.              |
| Review     | All answers are revealed. Players may vote ✗ on other players' answers (never their own); an answer is out when **more than half** of the other human players vote it out _(proposed threshold)_. Ends on a 20 s timer _(proposed)_ or when every human taps Done. |
| Duplicates | Among answers that survived, two answers in the same category are the same if they match after normalising (lower case, accents and punctuation removed, spaces collapsed) _(proposed)_.                                                                           |
| Scoring    | **10** valid and unique · **5** valid but given by someone else too · **0** blank, auto-invalid or voted out.                                                                                                                                                      |
| Match end  | After the last round; highest total wins; equal totals share a place _(proposed, as in RMCS)_. Results column: **Points**.                                                                                                                                         |
| Idle       | A player whose sheet is empty at lock for 2 rounds in a row → `MARK_IDLE` → bot _(proposed, same as Draw & Guess)_.                                                                                                                                                |

Votes are anonymous (players see counts, not voters) _(proposed)_. If a player has no other
humans in the match (only bots), their answers are auto-checked only _(proposed)_.

## 2. Phases _(durations proposed)_

```text
LETTER (2 s spin) → WRITING (round time; STOP → 5 s countdown) → LOCK
→ REVIEW (20 s or all Done) → ROUND_RESULT (5 s) → next round | OVER
```

## 3. Engine contract and hidden information

- **Actions:** `SAVE_DRAFT {answers}` (client autosaves ~every second while typing, so a
  timeout never loses work; last write wins) · `SUBMIT {answers}` · `STOP` (only with every
  category filled) · `VOTE {seat, category, out}` · `DONE_REVIEW`. All carry `actionId`.
- **Hidden until lock:** drafts and submitted sheets never leave the server; others see only
  "submitted ✓" per seat and the STOP event. Leak checks: the view-leak checker perturbs
  other players' drafts; a socket test scans every update before lock.
- **Moderation inside a pure engine:** the server passes the platform moderator into the
  game factory (`createNpatGame({ moderate })`); it is pure text processing, so the engine
  stays deterministic and testable. Revealed answers are shown censored.
- **Events:** `ROUND_STARTED {round, letter, deadline}` · `SEAT_SUBMITTED` · `STOP_CALLED
{seat, deadline}` · `ANSWERS_REVEALED {sheets, autoInvalid}` · `VOTES_CHANGED {counts}` ·
  `ROUND_SCORED {points, totals}` · `MATCH_OVER`.

## 4. Bots _(proposed)_

- Answer from an **original answer bank** (per category, per letter; every entry passes the
  moderator — tested). They fill 60–85 % of categories _(proposed)_ with realistic typing
  delays, submit before the timer, and go through the **same** `SUBMIT` path and auto-check.
- Bots never press STOP (they would rush humans) and never vote.

## 5. Phone and desktop UI _(proposed)_

- **Worksheet card:** a big letter stamp at the top; six rows (category icon + input); a live
  tick when an answer starts with the right letter; Submit, and STOP once the sheet is full.
- Phone keyboard: inputs use `enterkeyhint="next"`, capitalised words, no autocorrect; the
  action bar stays above the on-screen keyboard (`visualViewport`).
- Players strip: avatars with "writing…" / "submitted ✓".
- **Review:** one card per category (swipe on phones, grid on desktop) showing every player's
  answer, duplicates highlighted, ✗ vote buttons with counts.
- **Result:** 10 / 5 / 0 stamps on each answer, totals roll up, round leader highlighted.
- 8 players: a "class register" list layout instead of a round table.

## 6. Animation (Color Burst Arcade) _(proposed)_

| Moment  | Full                                                  | Lite       | Reduced |
| ------- | ----------------------------------------------------- | ---------- | ------- |
| Letter  | Slot-machine spin of letters → stamp thump            | quick flip | instant |
| Submit  | Pencil scribble tick, sheet slides into a tray        | slide      | instant |
| STOP    | Big STOP sign slams in, countdown pulses              | no pulse   | text    |
| Review  | Cards flip in; voted-out answers get a red-pen strike | fade       | instant |
| Scoring | 10 / 5 stamps fly into the totals                     | no flight  | instant |

## 7. Content and licensing

Categories, labels and the bot answer bank are written for this project (first names are
common given names, not famous people; places are real geography). Everything passes the
moderator. Nothing to license. Name Place Animal Thing is a traditional classroom game.

## 8. Testing

Engine: letter selection, lock timing, STOP countdown, auto-check matrix, vote majority
maths, duplicate normalisation, scoring table, idle. Fuzz: seeded bot matches with drafts
hidden until lock. Real sockets: simultaneous submit/STOP race, no answer visible before
lock, votes. Playwright: typing on desktop and Pixel 7, review voting, results.

## 9. Risks

- **Subjective validity:** handled by voting; in a 2-human game the other player decides
  alone. For public rooms (public-lobby phase) consider requiring 3+ humans for voting.
- **Spelling variants** ("Mumbai"/"Bombay") count as different answers.
- **Phone keyboards** covering inputs; fast-typing latency near the deadline (server lock is
  authoritative; autosave keeps drafts current).
- **Autosave volume:** at most one draft per second per player; the runtime's action-id
  memory (10,000 per match) is plenty at that rate.

## 10. Decisions and open points

**Implementation blockers:** none. **Launch blockers:** none. **Proposed — awaiting owner
sign-off (non-blocking):** public target 6; rounds default 5;
round time default 60 s; STOP countdown 5 s; review 20 s; letters exclude Q, X, Z; idle
after 2 empty rounds; answers 2–24 characters; bots fill 60–85 % and never STOP or vote;
anonymous votes.
