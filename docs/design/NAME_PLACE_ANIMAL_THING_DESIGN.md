# Name Place Animal Thing — Phase 7 design verification

**Status:** design pass, written **before** implementation (Phase 7). Game id:
`name-place-animal-thing`; display name **Name Place Animal Thing** (the traditional name — no
other public name is proposed). Built on the existing `GameModule` / server-authoritative
runtime and the Phase 6 production architecture
([ADR-023](../decisions/ADR-023-multi-instance-cluster.md)); no new networking.

> **Decision status.** **Frozen (product owner; spec C13 and the Phase 7 brief):** 2–8 players;
> everyone gets the same random letter; default categories Name, Place, Animal, Thing, Food,
> Profession; simultaneous typing; answers privately autosaved while typing and hidden from
> everyone else until the round is locked; a round ends when the **timer expires** or when a
> player who has completed **every** category presses **STOP**; answers are **checked
> automatically first**, then players may **vote** on answers they believe are wrong;
> scoring **10** valid unique · **5** valid duplicated · **0** invalid/rejected; server
> authoritative; bots never press STOP and never vote; the existing moderation stays active.
> **Everything else is a developer proposal** marked _(proposed)_ — every number is a
> play-test value — and is listed for sign-off in §16. **Implementation blockers:** none.

Earlier drafts of this document (2026-10-01) proposed a per-player **Submit** button and "every
human has submitted" as a third way to end a round. That would add a round-end rule the owner
did not decide, so it is **dropped**: a round ends only on the timer or STOP.

---

## 1. Player journey

| #   | Step            | What happens                                                                                                                                                                                                                            |
| --- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Room            | Host creates a private room, picks Name Place Animal Thing, sets **rounds** and **answer time**; friends join by code; host may add bots (2–8 seats).                                                                                   |
| 2   | Seating         | Seats in join order, as in every game. Start is enabled at ≥ 2 seats.                                                                                                                                                                   |
| 3   | Game start      | The usual 3-2-1 start countdown; the worksheet appears with six empty category cards.                                                                                                                                                   |
| 4   | Letter reveal   | `LETTER` phase (2.5 s _(proposed)_): the letter spins and stamps onto the sheet. Inputs unlock when the stamp lands — the same moment for everyone (server deadline, clock-synced).                                                     |
| 5   | Answering       | `WRITING` phase: everyone types at once. Each sheet autosaves privately (§6). The timer counts down. Other players are shown only as present/away/bot — no progress.                                                                    |
| 6   | STOP / timer    | A player whose six answers all pass the format check (§3.2) may press **STOP** once STOP unlocks (§2). STOP or the timer ends writing: inputs freeze for everyone, the last edits are flushed (§2.4), the server **locks** every sheet. |
| 7   | Automatic check | The server checks every answer (§3) and groups identical answers (§4). Results: **invalid** (with a reason), **recognised** (in our word list) or **unverified** (looks fine, not in our list).                                         |
| 8   | Answer reveal   | `REVIEW` phase: all sheets are revealed at once, one card per category, identical answers grouped, invalid ones struck through with the reason.                                                                                         |
| 9   | Voting          | Human players vote ✗ on answers they believe are wrong (§5). Live counts, anonymous. Ends on the review timer or when every eligible voter taps **Done**.                                                                               |
| 10  | Round scoring   | `ROUND_RESULT` (6 s _(proposed)_): 10 / 5 / 0 stamps on every answer, round points roll into totals, round leader highlighted.                                                                                                          |
| 11  | Next round      | Back to 4 with a new letter (never repeated in a match).                                                                                                                                                                                |
| 12  | Results         | After the last round: the platform results/podium. Highest total wins; equal totals share a place (1, 1, 3). Results column: **Points**; extra stat: **Unique answers** _(proposed)_.                                                   |

```text
LETTER ─2.5 s─▶ WRITING ─(timer | STOP)─▶ LOCKING ─flush─▶ REVIEW ─(timer | all Done)─▶ ROUND_RESULT ─6 s─▶ LETTER … | OVER
```

## 2. Timers _(all values proposed, play-test)_

| Timer          | Value                                                    | Notes                                                                                                                                                                   |
| -------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Letter reveal  | 2.5 s                                                    | Same for all effects modes (reduced shows the letter at once and a short "Get ready").                                                                                  |
| Answer time    | host setting **60 / 90 / 120 s**, default **90 s**       | Six answers typed on a phone keyboard; 60 s is for fast groups.                                                                                                         |
| STOP available | **15 s** after writing opens                             | Stops a STOP that nobody else had a fair chance to answer against; also guards against accidental taps right after the reveal. The button shows a fill ring until then. |
| Flush window   | **1 s** after writing ends (`LOCKING`)                   | Accepts only the final autosave of what was typed before the client learned writing ended (§2.4).                                                                       |
| Review         | **30 s**, ends early when every eligible voter taps Done | Up to 8 × 6 answers to read on a phone. With no eligible voters (only bots opposite) the review is a 5 s read-only reveal.                                              |
| Round result   | 6 s                                                      |                                                                                                                                                                         |
| Rounds         | host setting **3 / 5 / 8 / 10**, default **5**           |                                                                                                                                                                         |

### 2.1 STOP

- Allowed only in `WRITING`, from 15 s after it opened, for a **human-controlled** seat whose
  answers — the ones carried in the STOP action itself, which the server stores first — all
  pass the **format** check (§3.2: non-empty, right letter, length, characters, not censored).
  STOP never checks meaning; an answer that is later voted out still scores 0.
- Effect: writing ends **immediately** for everyone (the round "ends" in the frozen sense);
  the STOP event names who stopped. There is no extra countdown for the others.
- Bots never press STOP (frozen). A human's seat under bot control cannot STOP either.

### 2.2 Timer expiry

Writing ends at the deadline exactly as with STOP (no STOP event; "Time's up!").

### 2.3 Partially completed answers

Whatever the server has stored for a seat when the sheet locks is the sheet. Empty fields score
0 ("blank"). Nothing typed after the lock counts.

### 2.4 The last second of typing

Autosave is debounced (§6.2), so the server may be up to ~0.5 s behind a fast typist. When a
client receives "writing ended" (STOP or time-up) it freezes its inputs and sends its final
sheet at once. The server accepts drafts during the 1 s `LOCKING` window **only** from seats
that were human-controlled when writing ended, then locks. A modified client could keep typing
for that second; the gain is one second and is accepted as a trade-off for not losing honest
players' last letters _(proposed)_.

### 2.5 Disconnected while typing

- The server keeps the last autosaved sheet. If the player is back before the lock, their client
  keeps whatever it has locally (it may be newer) and re-sends it; the server's copy is shown
  only if the client has nothing (new tab/device). Text typed while offline that never reached
  the server before the lock is discarded ("Your sheet was locked with what was saved").
- The usual 30 s reconnect grace then bot takeover applies. A bot taking over mid-writing
  **keeps the human's saved answers** and fills only the blank categories (it reads its own
  seat's sheet — never anyone else's). The returning human takes the seat back immediately
  (`reclaim: 'IMMEDIATE'`), keeping everything typed so far.
- Idle: a **connected** human whose sheet is completely empty at the lock for **2 rounds in a
  row** is handed to a bot (`MARK_IDLE`, "I'm back" reclaims) _(proposed, as in Draw & Guess)_.

## 3. Answer validation (automatic check)

The automatic check is **mechanical**. It cannot know whether "Zorbo" is a real animal, so it
never claims to: it rejects only what is certainly unacceptable, labels answers it recognises
from our curated list, and leaves the rest to the players' vote (§5).

### 3.1 Normalisation (used for every comparison, never shown)

1. Unicode NFKC, remove invisible characters (the moderation package's `stripInvisible`).
2. Trim; collapse runs of whitespace to one space.
3. Lower-case; strip accents (NFD, remove combining marks): `Écolé` → `ecole`.
4. Remove `. ' ’ -` and spaces for the **comparison key**: `St. Louis`, `st louis`, `St-Louis`
   → `stlouis`.

The **display text** is the trimmed, whitespace-collapsed, moderated original (the player's
own capitalisation, accents kept).

### 3.2 Format rules → **invalid** (score 0, final, not votable)

| Rule                   | Proposed                                                                                                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty                  | Blank or only spaces/punctuation → **blank** (0).                                                                                                                                                                                                                                     |
| Characters             | Latin letters (accents allowed), spaces, `. ' ’ -`. **Digits are not allowed** ("7 Up" → write "Seven Up"); emoji and other symbols are not allowed. Other scripts (e.g. Devanagari) are not allowed: the letter is a Latin letter _(proposed; may be revisited with Hindi support)_. |
| Starts with the letter | **Required.** The first letter of the normalised answer must be the round letter (accents ignored: `Élan` counts for E). Leading articles are not skipped: for D, "A Dog" is invalid — write "Dog".                                                                                   |
| Length                 | At least **2 letters**; at most **30 characters** _(proposed)_.                                                                                                                                                                                                                       |
| Moderation             | If the platform moderator censors anything (profanity, Hinglish abuse, contact details), the answer is **invalid — "Not allowed"** and is revealed only in its censored form.                                                                                                         |
| Same answer twice      | A player may repeat a word across categories (Place "Chennai", Food "Chennai biryani" are different answers); no special rule.                                                                                                                                                        |

Capitalisation, accents, extra spaces and punctuation never make an answer invalid — they are
normalised away.

### 3.3 Recognised vs unverified

- Each category has a curated **word list** (the same content pack the bots answer from,
  plus accepted variants). A valid answer whose key is in its category's list is
  **recognised** (✓ "In our list"); otherwise it is **unverified** ("Not in our list —
  vote if it's wrong").
- Recognition is a hint for voters, not a verdict: recognised answers can still be voted out
  (the list may be ambiguous, e.g. a place that is also a name) _(proposed)_.
- Category-specific automatic rules beyond this are deliberately **not** attempted (e.g.
  "is this a profession?"): that is what voting is for.

### 3.4 Plurals and common variants

- **Plurals:** within a category, two valid keys that differ only by a trailing `s` or `es`
  where the shorter key has at least 3 letters are treated as the **same answer**
  (`Mango`/`Mangoes`, `Apple`/`Apples`) _(proposed)_. This only ever turns "unique" into
  "duplicate" (10 → 5), never makes anything invalid.
- **Variants:** the content pack lists curated aliases per category that map to one key
  (`Bengaluru`/`Bangalore`, `Kolkata`/`Calcutta`, `Doctor`/`Dr`) — only when both start with
  the same letter; `Mumbai`/`Bombay` start with different letters, so they can never meet.
- Spelling mistakes are **not** auto-merged ("Elefant" ≠ "Elephant"): voters decide whether
  "Elefant" is acceptable; if accepted it is a separate (unique) answer _(proposed)_.

### 3.5 Pipeline

```text
sheet locked → normalise → format rules → moderation → INVALID (0, final)
                                                     ↘ VALID: recognised | unverified
                                                         → grouped by key (§4)
                                                         → REVIEW votes (§5) → rejected (0) | accepted
                                                         → duplicate count among accepted → 10 | 5
```

## 4. Duplicates

- Computed by the server per category over the comparison key (§3.1) with the plural and
  alias rules (§3.4). Examples (letter D, category Place): `Delhi`, `delhi`, `DELHI`,
  `Delhi.` → one group; `New Delhi` → a different group (key `newdelhi`); `Dehli` → a
  different group (voters may reject it as a misspelling).
- Identical answers form one **answer group**. Voting targets the group (§5), so identical
  answers always share one fate.
- Final: an accepted group with **one** author scores **10** for that author; with **two or
  more** authors scores **5** for each. Duplicates are counted only among **accepted**
  answers (an invalid or rejected answer never makes someone else's answer a duplicate).

## 5. Voting _(rules proposed — this is the main open product area)_

| Question                    | Proposal                                                                                                                                                                                                                                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What can be voted on        | Every **valid** answer group (recognised or unverified). Invalid answers cannot be voted back in.                                                                                                                                                                                                        |
| Who can vote                | Human players controlling their seat (not bots — frozen; not a seat under bot control).                                                                                                                                                                                                                  |
| Own answers                 | You cannot vote on a group you are an author of.                                                                                                                                                                                                                                                         |
| How many votes              | One ✗ per voter per group; tap again to withdraw. Any number of groups. Changes allowed until review ends.                                                                                                                                                                                               |
| Threshold                   | A group is **rejected** when its ✗ votes are **more than half** of its **eligible voters** (eligible humans who are not its authors). **Exactly half is a tie → the answer stands** (benefit of the doubt).                                                                                              |
| No eligible voters          | A group whose eligible voters number 0 (e.g. everyone else is a bot, or all humans wrote it) stands on the automatic check alone.                                                                                                                                                                        |
| Two humans                  | Each answer has exactly one eligible voter, so the other player's ✗ rejects it — like arguing over a paper sheet. Bots' answers (if any) need both humans. **Open decision for the owner (§16).**                                                                                                        |
| Disconnect during review    | Eligibility is evaluated **when review ends**: votes of players who are disconnected (in grace) still count; a seat taken over by a bot or left loses eligibility and its votes are dropped. Done is not needed from disconnected players (review ends when every **connected** eligible voter is Done). |
| Visibility                  | Counts are live and anonymous ("2 ✗ of 3"); voters' identities are never sent _(proposed)_.                                                                                                                                                                                                              |
| Interaction with auto-check | Votes can only remove valid answers; they never override an invalid verdict and never touch the letter/format rules.                                                                                                                                                                                     |
| Public matchmaking          | The "voting only with 3+ humans" idea is **not** part of this phase (no public rooms yet). It is recorded as a proposal for the public-lobby phase: with fewer than 3 humans, a public match would use the automatic check only.                                                                         |

## 6. Anti-copying and information flow

### 6.1 What other players can see before the lock

Nothing about anyone's answers — not text, not length, not how many categories are filled.
Other seats show only present / away / bot. The STOP event (who stopped) is the only
answer-related signal before the reveal.

### 6.2 Autosave path

- The client autosaves the **whole sheet** (≤ 6 × 30 chars) 400 ms after the last keystroke,
  on blur, and immediately when writing ends _(proposed)_.
- It travels on the existing **`match:stream`** path (already rate-limited per socket at the
  gateway: 30 burst, 20/s) — **not** as a versioned action — so autosaves create no new
  versions, no `match:update` broadcasts, and no action ids in the snapshot. The game's
  `stream.accept` validates it (phase, round, categories, sizes) and relays it to **nobody**
  (empty audience).
- The draft lives in the authoritative state on the host and in the Redis room snapshot (server
  infrastructure only, same TTL as the room). In multi-instance play it travels gateway → host
  inside the forwarded request; host → gateway messages for other players never contain it.
- Each player's **own** saved sheet is part of **their own** view only (`getPlayerView` for that
  seat), so a reconnect restores it; `stream.replay` returns nothing (no shared picture).

### 6.3 Tests that prove it (§13)

The view-leak checker (`perturbHidden`) changes every other seat's draft and requires the
viewer's view to stay identical; a real-socket test types distinctive strings for player A and
scans **every** message player B receives (updates, stream, chat, room snapshots) until the
reveal; the same scan runs across two instances (gateway ≠ host) and across a host failover.

## 7. Bots _(proposed)_

- **One level.** Answers from a curated, original **answer bank** per category and letter
  (`content/en`), which doubles as the recognition list. Every entry passes the moderator and
  the format rules (tested); every allowed letter × category has at least 5 entries, so a bot
  **always fills all six** (tested).
- Picks a random entry per category (seeded RNG); two bots may collide — a natural duplicate.
- **Same path as humans:** a bot's answers arrive as draft chunks through `stream.accept`
  (`BotDecision.STREAM`), with typing-like timing: first answer after 6–14 s, then one
  category every 4–11 s, in random order, finishing by ~80 % of the answer time; if writing
  ends first, whatever it had saved counts. Its sheet goes through the same normalisation,
  format check, moderation, grouping and voting as a human's.
- **Never** sees other seats' drafts (its view is its own seat's view), never presses STOP,
  never votes, never taps Done.
- On takeover of a human seat, keeps the human's saved answers and fills only blanks.

## 8. Phone UX (designed for 360 px first)

- **Worksheet:** the round letter stamp and the timer pinned at the top; six full-width
  category cards (icon, label, input) in one column.
- **Inputs:** `autocapitalize="words"`, `autocomplete="off"`, `autocorrect="off"`,
  `spellcheck="false"`, `enterkeyhint="next"` (last one `done`), `maxlength="30"`; Enter /
  Next moves to the next empty card; the focused card scrolls into view above the keyboard
  (`visualViewport`); a small ✓ appears when the answer passes the **format** rules (letter,
  length, characters) — a local hint only, the server decides.
- **Action bar** (sticks above the keyboard): timer bar + **STOP** button (disabled with a fill
  ring until STOP unlocks; enabled only when all six pass the format hint).
- **Locked:** inputs freeze, a "Pencils down!" stamp, sheets slide away.
- **Review:** one category at a time as a swipeable card with a category stepper (Name ·
  Place · …); each answer row: player chip(s), answer, ✓/? badge, ✗ vote button (48 px) with
  count; your own rows have no vote button; a sticky **Done** button with "x of y done".
- **Round result:** a compact table (players × categories) with 10 / 5 / 0 stamps, scrolled
  horizontally only inside the table on narrow screens; totals at the end of each row.

## 9. Desktop UX

A polished classroom worksheet, not a form: ruled-paper sheet on the arcade background, a
large letter stamp in the margin, category cards in a 2 × 3 grid with playful icons and
colour accents, the timer as a pencil-shaped bar, a big round STOP sign. Review shows all six
categories as a grid of cards side by side; votes use the same ✗ buttons; the room chat stays
beside the board. Keyboard: Tab/Enter move between fields; STOP is reachable by keyboard.

## 10. Animation modes (Color Burst Arcade)

| Moment  | Full                                       | Lite            | Reduced                        |
| ------- | ------------------------------------------ | --------------- | ------------------------------ |
| Letter  | Slot-machine spin of letters → stamp thump | quick flip      | letter shown, "Get ready" text |
| Field ✓ | ink tick draws in                          | tick fades in   | tick shown                     |
| STOP    | STOP sign slams in, short shake            | sign fades in   | "STOP — called by Asha" banner |
| Lock    | sheets slide into a tray                   | fade            | "Pencils down" text            |
| Reveal  | category cards flip in one by one          | fade in         | shown                          |
| Vote    | red-pen strike grows with the count        | count changes   | count changes                  |
| Scores  | 10 / 5 / 0 stamps thump, totals count up   | stamps fade in  | values shown                   |
| Results | platform podium                            | platform podium | platform podium                |

Reduced motion keeps every state change readable (text labels, counts, stamps) — only
movement is removed. Gameplay information is never conveyed by motion alone.

## 11. Server authority and protocol

The client never decides validity, duplicates, scores, votes, round completion or the winner;
it only sends intents.

| Intent   | Path           | Payload (strict)                                         | Rejected when                                                                                                                                                                                         |
| -------- | -------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Autosave | `match:stream` | `{ round, answers: { [category]: string } }`             | not `WRITING`/`LOCKING` (flush only for seats human at writing end), wrong round, unknown category, answer > 30 chars, > 6 keys, seat under bot control (human socket), malformed (`INVALID_PAYLOAD`) |
| `STOP`   | `match:action` | `{ type: 'STOP', round, answers }`                       | wrong phase/round (`INVALID_PHASE`), before STOP unlocks or any answer fails format (`NOT_ELIGIBLE`), already stopped                                                                                 |
| `VOTE`   | `match:action` | `{ type: 'VOTE', round, category, group, out: boolean }` | not `REVIEW`, wrong round, unknown/invalid group, own group, voter not eligible, no change (`ILLEGAL_ACTION`)                                                                                         |
| `DONE`   | `match:action` | `{ type: 'DONE', round }`                                | not `REVIEW`, wrong round, already done, not eligible                                                                                                                                                 |

Plus the platform's protections, unchanged: unique action ids (`DUPLICATE_ACTION`), versions
the server never issued (`STALE_VERSION`), wrong seat / not a member, anything after the match
ends (`INVALID_PHASE`), strict schemas rejecting extra fields (`INVALID_PAYLOAD`) — so a
client cannot send a score, a validity flag or a group's status.

## 12. Production architecture

NPAT is an ordinary `GameModule` (plus a `stream` module for autosaves) and so runs through the
Phase 6 path without changes: gateways validate and forward `match:stream` / `match:action` to
the host; the host owns all state and timers; snapshots (including drafts and votes) go to
Redis fenced by the lease; on failover the new host restores the phase, the deadlines (an
overdue lock fires at once), the drafts and the votes, re-attaches bots, and resends each player
**their own** view. No local state, no filesystem, no browser-side scoring. The answer bank is
bundled into the server build (imported JSON/TS, not read from disk at runtime).

To verify (tests, §13): answers through a non-host gateway; reconnect on another instance with
the draft restored; host crash during `WRITING` (draft survives, lock still happens) and during
`REVIEW` (votes survive); no draft in any message to other players during forwarding or after
failover.

## 13. Testing plan

| Area                         | Tests                                                                                                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Letter                       | seeded, uniform over allowed letters, never repeats in a match, excluded letters never drawn                                                                                |
| Categories / settings        | default six, settings schema (rounds, time), unknown settings rejected                                                                                                      |
| Normalisation                | case, accents, spaces, punctuation, invisible chars, NFKC                                                                                                                   |
| Format check                 | the full matrix of §3.2 (blank, digits, symbols, other scripts, wrong letter, short/long, moderated, articles)                                                              |
| Duplicates                   | `Delhi`/`delhi`/`Delhi.`/`DELHI`, `St. Louis`/`st louis`, plurals (and the 3-letter guard), aliases, misspellings stay separate                                             |
| Scoring                      | 10 / 5 / 0 table, duplicates only among accepted, totals, ties share places                                                                                                 |
| Voting                       | threshold maths for 2–8 humans, tie stands, own-group ban, toggling, bots don't count, no-eligible-voter groups, disconnect/takeover during review, early end on all Done   |
| STOP                         | requires all six format-valid answers carried in the action, unlock time, human only, ends writing immediately, flush window                                                |
| Timer expiry                 | lock at the deadline, partial sheets, flush window                                                                                                                          |
| Disconnect / reconnect       | draft kept and restored to its owner only, local-newer-wins on the client, takeover keeps answers and fills blanks, reclaim                                                 |
| Bots                         | bank coverage (every letter × category ≥ 5, all pass moderator and format), always six answers, timing within the answer time, never STOP / VOTE / DONE, same path          |
| Information leaks            | `perturbHidden` view-leak checker on drafts; socket scan of every message player B receives; the same across two instances and after failover                               |
| Protocol                     | malformed payloads, unknown categories, oversize answers, wrong round, after lock, votes outside review, duplicate votes, wrong seat, duplicate/stale action ids, after end |
| Multi-instance (Redis in CI) | a match across two instances; host crash in `WRITING` and in `REVIEW`                                                                                                       |
| Fuzz                         | 300 seeded bot matches through the harness (termination, invariants, serialisable state)                                                                                    |
| E2E                          | desktop and Pixel 7: type, STOP, review, vote, results; reduced motion; 360 px layout without horizontal scrolling; repeated runs (`--repeat-each=3`)                       |
| Smoke                        | the production smoke test stays on Dots & Boxes; NPAT runs through the identical path (same Function, same Redis) and is covered by the multi-instance tests                |

## 14. Production deployment readiness

Nothing NPAT-specific: same same-origin Socket.IO path (`/api/socket/socket.io`), WebSocket
only, the same environment variables (`REDIS_URL`, origins), CSP/security headers unchanged
(no new external resources: icons are inline SVG, no fonts beyond the bundled one), reconnect
via the platform. The answer bank adds an estimated ≈ 15–25 KB to the server bundle and nothing
to the client (the client never receives the bank — it would reveal the recognition list).

## 15. Documentation plan

Game rules (`GAME_RULES/NAME_PLACE_ANIMAL_THING.md`), game catalogue, game system (drafts on
the stream path for a turn-phase game), architecture, bots, moderation (answers are moderated;
censored = invalid), UI/UX, testing, deployment (no changes needed — stated), README, project
overview, ADR-024 (private autosaved drafts via the stream path).

## 16. Decisions for the product owner

**Implementation blockers:** none — the proposals below are implemented as play-test values and
can be changed without code restructuring.

1. Voting threshold "more than half of eligible voters; tie stands" — and the **two-human**
   consequence (one player's ✗ rejects the other's answer).
2. Recognised answers can still be voted out (alternative: recognised answers are immune).
3. Timers: answer time 60/**90**/120 s; STOP unlocks after 15 s; 1 s flush; review 30 s;
   letter 2.5 s; result 6 s; rounds 3/**5**/8/10.
4. Letters exclude **Q, X, Z**; no repeats within a match.
5. Answers: Latin letters only, no digits, 2 letters – 30 characters, must literally start with
   the letter (no article skipping).
6. Plural folding (`s`/`es`, ≥ 3 letters) and curated aliases count as duplicates; misspellings
   are separate answers.
7. No progress indicators for other players during writing.
8. Bots: always fill all six, typing-like timing; on takeover keep the human's answers.
9. Idle after 2 consecutive empty sheets.
10. Public-lobby policy (later phase): voting only with 3+ humans.
