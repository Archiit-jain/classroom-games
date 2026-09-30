# Classroom Games — Phase 0 Specification (FROZEN)

**Version 1.1 · Frozen 2026-09-30.** Any later change requires a change-log entry approved by the product owner.

> This is a design specification, not a description of the current code. What is actually implemented is described by the other documents in `docs/` and by the Phase reports.

---

## 0. Status & change log

**Final-review changes incorporated (v1.0):**

| # | Change | Where |
|---|---|---|
| C1 | Public `minHumans = 2` for all games | §5 |
| C2 | Reporting never auto-punishes; local hide + in-memory flag only | §7 |
| C3 | 16 Parchi is the flagship experience — full interaction/animation spec | §11 |
| C4 | v1 exclusion list is binding | §19 |
| C5 | Draw & Guess letter hints approved | §12 |
| C6 | Pen Fight shrinking desk (sudden death) approved | §13 |
| C7 | No premature infrastructure: in-memory, one instance, no Redis/DB | §2, §17 |

**Approval adjustments (v1.1, 2026-09-30 — binding):**

| # | Change | Where it applies |
|---|---|---|
| C8 | A lone public player who has waited through the matchmaking window gets an explicit **"Play with Bots"** escape hatch. Bots are never disguised as humans; the UI clearly says the resulting match contains bots. (Supersedes §20 item 1.) | §5, Phase 6 |
| C9 | "Draw & Guess" is a temporary working name. An original public-facing name and identity must be chosen before its game phase ships. Does not block Phase 1. | §12, Phase 4 |
| C10 | Before the polished game UI is implemented, the final visual direction must be established: colourful, energetic, premium, playful, nostalgic, visually catchy, NOT childish, strong game-specific animations, polished physics where applicable. | §1, UI work from Phase 2 |
| C11 | Phase 1 is infrastructure-focused, not visual polish: prove networking, private rooms, sessions, reconnect, lobby and the game runtime with the fixture game and automated tests. | Phase 1 |

**Defaults adopted from the previous proposal (no objection → frozen):** RMCS timeout = seeded random guess · 16 Parchi idle takeover + cycle safety cap · D&G rounds/scoring · room-lobby chat only (no global chat) · no sound in v1 · single brand theme · local Git only.

**One deliberate change while freezing:** D&G "close" guesses are **not** shown to other players (my earlier default broadcast them; a near-miss like "elephnt" leaks the answer). Only the sender sees "close!".

**Interpretations flagged for veto (before their phase):** I1 — 16 Parchi "reacting" = player-initiated **quick reactions** (fixed emote set, never automatic — auto-reactions would leak hidden info). I2 — per-game idle thresholds trigger platform bot takeover (values in each game section).

---

## 1. Product scope

**What it is:** a public, anonymous, browser-based multiplayer platform of quick classroom/childhood games. Broad audience (school & college students, friends, families, anyone). Core flow: **Open → Enter name → Play → Results → Play again.**

**Entry points (v1):** Quick Play (specific game) · Quick Play (Any Game) · Browse Public Games · Create Private Room · Join with Code. Nickname field is prefilled with an editable friendly suggestion so one tap reaches a game.

**Games:** Raja Mantri Chor Sipahi (RMCS) · **16 Parchi (flagship)** · Draw & Guess (working name, pending naming check) · Pen Fight.

**Platform features:** anonymous sessions · private rooms (human host) · server-controlled public rooms + matchmaking + bot fill · reconnect & bot takeover · room chat with server-side moderation · local mute · report · quick reactions · bots in every game · responsive UI (phone/tablet/desktop) · reduced-motion + lite effects · English with translation-ready structure.

**Priorities:** Fun → Simplicity → Multiplayer reliability → Visual quality → Smooth interactions → Expandability → Security → Performance → Documentation.

**Quality rules:** no fake/placeholder features presented as complete · docs describe only what exists · every decision gets an ADR.

---

## 2. Architecture

```text
┌──────────────────────── Static client (CDN) ────────────────────────┐
│ React + Vite + TS · Motion · i18n t()                                │
│ Shell: Home → QuickPlay / Browse / Private → Room → Match → Results  │
│ Platform: SocketClient · SessionStore · ClockSync · AnimationDirector│
│           ChatPanel · Reactions · EffectsController(full/lite/reduced)│
│ Game boards (lazy): render View, animate filtered Events             │
└───────────────────────────────▲─────────────────────────────────────┘
                                │ Socket.IO: acked intents ↑  updates ↓
┌───────────────────────────────┴──────── Node server (1 instance) ────┐
│ Transport     schema → size → rate limit → session → handler         │
│ SessionManager   anonymous identity, secret token, 1 socket/session  │
│ RoomManager      rooms, seats, host, lifecycle ─ RoomStore(interface)│
│                                                  └ InMemoryRoomStore │
│ LobbyService     public room index + browse feed                     │
│ Matchmaker       quick play, bot-fill window                         │
│ GameRuntime      1 per match: engine, per-viewer fan-out             │
│   ├ GameRegistry   ├ TimerService   └ BotManager                     │
│ ChatService      → Moderator(interface) → game chat hook → fan-out   │
│ ReportService    → ReportSink(interface) → InMemoryFlagStore         │
└──────────────────────────────────────────────────────────────────────┘
```

**Binding principles**
1. **Pure engines:** `(state, input, ctx) → Transition`; `ctx.rng` seeded, `ctx.now` server clock. No `Date.now()`/`Math.random()`/I/O/mutation in engines.
2. **Seat-only engine API:** engines never see session IDs, tokens or connection status; the runtime informs them via hooks.
3. **Server authority:** clients send *intents*; server validates, transitions, and sends each player only their **filtered view + filtered events**.
4. **Bots are ordinary seats** using exactly the same validation/action path.
5. **Visibility at emission:** every event carries an audience (`ALL` / `SEATS` / `ALL_EXCEPT`); no post-hoc filtering.
6. **Errors are codes, never English.** Every intent is acked.
7. **Replaceable interfaces with one v1 implementation:** `RoomStore`, `Moderator`, `ReportSink`, `PhysicsEngine`.

---

## 3. Repository tree

```text
D:\projects\Classroom Games\
├── apps/
│   ├── client/src/
│   │   ├── app/          routes, providers, error boundary
│   │   ├── screens/      Home, QuickPlay, Browse, Room, Match, Results
│   │   ├── platform/     socket, session, clock sync, animation director, chat, reactions, mute/report
│   │   ├── ui/           design tokens, components, Motion presets, effects modes
│   │   ├── i18n/         t(), en.ts
│   │   └── games.ts      client registry (lazy imports)
│   └── server/src/
│       ├── index.ts      bootstrap, /healthz, graceful shutdown
│       ├── config/       env + all tunables (Appendix A)
│       ├── transport/    handlers, validation, rate limits, origin check
│       ├── session/  rooms/  lobby/  runtime/  bots/  chat/  reports/
│       └── games.ts      server registry
├── packages/
│   ├── protocol/         event names, zod schemas, error codes, room/seat/view types
│   ├── game-sdk/         GameModule contract, seeded RNG, test harness, leak checker, fixture game
│   └── moderation/       Moderator implementation + datasets (no server deps)
├── games/
│   ├── rmcs/ · sixteen-parchi/ · draw-and-guess/ · pen-fight/
│   │   ├── src/shared/   state/view/action/event types, schemas, constants
│   │   ├── src/server/   engine, bot  (pen-fight: physics/ behind PhysicsEngine)
│   │   ├── src/client/   Board, animations, game messages
│   │   ├── content/en/   packs (16P categories, D&G words + bot stroke templates)
│   │   └── tests/
├── e2e/                  Playwright
├── tools/                load test, content-pack validator
├── docs/                 see §18
├── .github/workflows/ci.yml
├── CREDITS.md · README.md · package.json · pnpm-workspace.yaml · tsconfig.base.json
└── eslint.config.js · .prettierrc · .editorconfig · .gitignore · .node-version (24)
```

Workspace packages are consumed as **TS source** (no per-package build); server bundled with esbuild/tsup for production, `tsx` in dev. Game packages expose separate `shared` / `server` / `client` entry points so React never reaches the server bundle and Planck never reaches the client.

---

## 4. Room model

```text
Room  { id, kind: PRIVATE | PUBLIC, code?, gameId, settings, phase,
        seats: Seat[], hostPlayerId? (PRIVATE only), fillWindowEndsAt? (PUBLIC only),
        match?: { matchId, runtime }, chatBuffer (last 50, censored), createdAt }
Seat  { index, occupant: Human{playerId} | Bot{botId, replacing?: playerId}, conn: SeatConn }
phase ∈ LOBBY | STARTING | IN_GAME | RESULTS | CLOSED
```

`kind` selects a policy object (`PrivateRoomPolicy` / `PublicRoomPolicy`) that answers: who may start, who may remove, what happens after results.

**Private**
```text
LOBBY ──host: start (seat count within game min/max)──▶ STARTING (3 s) ──▶ IN_GAME
  ▲                                                                          │
  └──── host: play again / change game / change settings ◀── RESULTS ◀───────┘
```
Host: pick game, settings, add/remove bots, remove players, start. Removed players are barred from that room only. **Join closed from STARTING onward**; reconnecting to your own seat is always allowed. Host leaves/grace expires → earliest-joined connected human; bots are never host. Room code: 6 chars, alphabet without 0/O/1/I/L; join attempts rate-limited.

**Public**
```text
LOBBY (listed; joinable) ──start rule (§5)──▶ STARTING (3 s; unlisted; join closed) ──▶ IN_GAME
  ▲                                                                                        │
  └── bots removed, staying humans kept, relisted ◀── RESULTS (15 s: "Play again"/"Leave") ◀┘
```
Only the Matchmaker creates public rooms, and only when no joinable room exists for that game (players cannot spam-create them). No code shown, no host; local mute + report instead.

**Cleanup:** close after 5 min with no connected humans (LOBBY/RESULTS) or immediately when only bots remain in a match. **Global limits** (config): max rooms, private rooms created per session per minute, joins per session per minute.

---

## 5. Matchmaking

**Per-game defaults (manifest; configurable):**

| Game | targetPlayers | minHumans |
|---|---:|---:|
| RMCS | 4 | 2 |
| 16 Parchi | 4 | 2 |
| Pen Fight | 4 | 2 |
| Draw & Guess | 5 | 2 |

```text
Quick Play (game G): joinable PUBLIC rooms for G in LOBBY with a free seat?
   yes → join the one with the MOST humans      no → Matchmaker creates one, join
Quick Play (Any):    joinable PUBLIC rooms of any game?
   yes → join the one with the MOST humans      no → create room for the next game in a rotation
Browse:              live feed of PUBLIC LOBBY rooms (game, humans/target, fill-window state) → tap to join
```

**Start rule:** (1) humans reach `targetPlayers` → start. (2) Humans reach `minHumans` → **fill window opens** (default **12 s**); at expiry, bots fill remaining seats and the room starts. (3) If humans drop below `minHumans`, the window is cancelled. (4) **A lone player never starts a public match** — they see "Waiting for another player…" and can cancel; per C8 they are offered an explicit **"Play with Bots"** option after waiting through the window, which clearly states the match contains bots.

Bots always show a **bot badge** and an obviously-bot name (e.g. "Bot Tiku"); `isBot` is server-set. Seat assignment is atomic (single-threaded, no await between "find seat" and "take seat"); a test proves two players cannot take the last seat. No room merging in v1.

---

## 6. Session & reconnect model

- **Token:** 256-bit random, base64url, stored in `localStorage`, sent in the Socket.IO handshake `auth.token`. New/unknown token → new session + new token returned. Public identity is `playerId` only.
- **Sessions:** in memory; expire after 24 h idle. **One active socket per session**; a newer connection displaces the older (`session:displaced` to the old tab).
- **Nickname:** 2–16 chars after normalization, moderation-checked (**rejected**, not censored), unique within a room by normalized comparison.

```text
CONNECTED ─socket lost─▶ GRACE (30 s; seat reserved; game timers keep running;
                                the engine's timeout actions play for the absent player)
GRACE ─reconnect with token─▶ CONNECTED
GRACE ─expires─▶ LOBBY: seat freed │ IN_GAME: BOT_CONTROLLED
BOT_CONTROLLED ─reconnect with token─▶ reclaim per game (IMMEDIATE or NEXT_PHASE_BOUNDARY)
IN_GAME idle (engine request MARK_IDLE) ─▶ BOT_CONTROLLED; player sees "A bot took over. Tap to resume" → reclaim
Explicit leave during a match ─▶ bot takes over immediately; that player cannot reclaim this match
```

**Resync on reconnect:** room view + latest filtered match view (with version) + last 50 chat messages + (D&G) full stroke log. **Server restart** loses sessions/rooms; clients show "Server restarted" and silently create a new session. Graceful shutdown sends a `system:notice` first.

---

## 7. Moderation

```text
chat:send → schema (≤ 200 chars) + membership
 → RATE LIMIT  per session: burst 5, refill 1/s; flooding → 30 s chat cooldown (never a ban)
 → NORMALIZE   NFKC · lowercase · strip zero-width · confusables→ASCII · collapse repeats (≥3)
               · leetspeak map · rejoin spaced letters ("b a d")
 → GAME HOOK   only while a match defines chat.intercept (PASS / RESTRICT / CONSUME / BLOCK)
 → DETECT      obscenity matcher over custom datasets: English profanity, romanized Hindi/Hinglish,
               slurs, sexual/abusive terms · whole-word · allowlist
               contact detectors: URL/domain, email, phone, @handle, platform+id phrases
 → CENSOR      profanity → same-length "****" · contact info → "[removed]" · everything else unchanged
 → BROADCAST
```

- `Moderator.moderate(text, locale) → { display, flags[] }` lives in `packages/moderation` (no server deps; replaceable).
- Datasets in `packages/moderation/data/` — **not** the library default list alone; licenses recorded in CREDITS.md.
- Allowlist covers known false positives: Classroom, pass, class, assassin, Scunthorpe, grass, Hinglish homographs.
- **Profanity never removes a player.** Only rate-limit cooldowns apply.
- **Reports:** `report:submit {playerId, reason: CHAT | DRAWING | NAME | OTHER}` → reporter's client immediately hides that player's chat & drawings (reversible). Server records `{roomId, playerId, reason, at}` via `ReportSink` into a **bounded in-memory flag store** (max 1,000 flags, 24 h TTL, lost on restart) plus a structured log line (no content). **No automatic kick, ban or skip.** `ReportSink` is the extension point for future moderation.
- **Mute:** per-player, client-side, remembered for the browser session.
- **No chat storage** beyond the 50-message in-memory room buffer (dies with the room).

---

## 8. Chat & reactions

- **Room chat only** (room lobby + in-match). No global chat, no DMs.
- Message: `{id, fromPlayerId, isBot, text (censored), sentAt, channel: ROOM | SOLVED}` (SOLVED is D&G-only).
- Games may intercept (only D&G in v1, §12). Other games pass chat through (RMCS bluffing is part of the fun).
- **Bots never chat**, except D&G guessing, which uses the chat channel as its input.
- **Quick reactions (I1):** fixed set of 8 emotes (e.g. 😂 😱 😤 🙏 👏 🔥 😭 🤫); `chat:react {reactionId}` → bubble over sender's seat for everyone; rate-limited to 1 per 1.5 s; only ever player-initiated; bots never react.

---

## 9. Game contract (final)

```ts
type SeatIndex = number;
type Audience = { to: 'ALL' } | { to: 'SEATS'; seats: SeatIndex[] } | { to: 'ALL_EXCEPT'; seats: SeatIndex[] };
type Scoped<E> = Audience & { event: E };
interface StepCtx { now: number; rng: SeededRng }
type TimerCommand = { set: TimerId; ms: number } | { clear: TimerId };
type RuntimeRequest = { type: 'MARK_IDLE'; seat: SeatIndex };
interface Transition<S, E> { state: S; events: Scoped<E>[]; timers?: TimerCommand[]; requests?: RuntimeRequest[] }
type Verdict = { ok: true } | { ok: false; code: GameErrorCode };
type SeatChange = 'DISCONNECTED' | 'RECONNECTED' | 'BOT_TOOK_OVER' | 'RECLAIMED' | 'LEFT';

interface GameManifest {
  id: GameId; version: number; titleKey: MessageKey; descriptionKey: MessageKey;
  players: { min: number; max: number };
  sync: 'TURN_PHASE' | 'STREAMED' | 'SIMULATED';
  bots: { supported: true; canTakeOverSeat: boolean };
  publicMatch: { targetPlayers: number; minHumans: number };
  reclaim: 'IMMEDIATE' | 'NEXT_PHASE_BOUNDARY';
  layout: { orientation: 'any' | 'portrait-preferred' | 'landscape-preferred' };
}

interface GameModule<S, A, V, E, Settings> {
  manifest: GameManifest;
  settingsSchema: ZodType<Settings>; defaultSettings: Settings;
  actionSchema: ZodType<A>;
  setup(seats: SeatIndex[], settings: Settings, ctx: StepCtx): Transition<S, E>;
  validateAction(s: S, seat: SeatIndex, a: A): Verdict;
  applyAction(s: S, seat: SeatIndex, a: A, ctx: StepCtx): Transition<S, E>;
  onTimer(s: S, timer: TimerId, ctx: StepCtx): Transition<S, E>;
  onSeatChange(s: S, seat: SeatIndex, change: SeatChange, ctx: StepCtx): Transition<S, E>;
  getPlayerView(s: S, viewer: SeatIndex): V;
  isOver(s: S): boolean;
  getResults(s: S): GameResults;          // placements (ties share rank) + per-seat stats
  bot: BotModule<V, A, E>;
  stream?: StreamModule<S>;               // required iff sync === 'STREAMED'
  chat?: ChatInterceptor<S>;
}

type BotDecision<A> = { kind: 'ACTION'; action: A; thinkMs: number } | { kind: 'CHAT'; text: string; thinkMs: number };
interface BotModule<V, A, E, M = unknown> {
  createMemory(seat: SeatIndex): M;
  observe(memory: M, events: E[]): M;     // ONLY events visible to that seat
  decide(view: V, memory: M, ctx: BotCtx): BotDecision<A> | null;
}

interface StreamModule<S> {
  chunkSchema: ZodType<Chunk>;
  limits: { maxChunkBytes: number; maxChunksPerSec: number; maxPointsPerTurn: number; maxStrokesPerTurn: number };
  accept(s: S, seat: SeatIndex, c: Chunk): { state: S; relay: Chunk; audience: Audience } | Verdict;
  replay(s: S, viewer: SeatIndex): Chunk[];
}

type ChatDecision =
  | { kind: 'PASS' } | { kind: 'RESTRICT'; audience: Audience }
  | { kind: 'CONSUME'; transition: Transition<unknown, unknown> } | { kind: 'BLOCK'; code: ChatErrorCode };
interface ChatInterceptor<S> { intercept(s: S, seat: SeatIndex, normalized: string, ctx: StepCtx): ChatDecision }

interface GameClientModule<V, A, E> {
  id: GameId; messages: MessageCatalog;
  Board: LazyComponent<{ view: V; events: EventQueue<E>; me: SeatIndex; seats: SeatInfo[];
                         send(a: A): Promise<Ack>; effects: 'full' | 'lite' | 'reduced' }>;
}
```

**Adding a game** = `games/<id>/` with shared/server/client entry points, implement `GameModule` + `GameClientModule`, content pack if any, register in both registries, pass the **game-sdk harness** (seeded fuzz, invariants, **leak checker**: no view/event for seat X contains data X may not know, termination), write `GAME_RULES/<GAME>.md`. A test-only fixture game in `game-sdk` validates the runtime in Phase 1 and is never registered in production.

---

## 10. RMCS rules

| | |
|---|---|
| Players | Exactly 4 · public target 4 / minHumans 2 · reclaim IMMEDIATE |
| Match | 10 rounds · highest cumulative score wins · ties share placement (1,1,3,4) |

```text
DEALING (roles dealt secretly, ~2 s) → REVEAL_RAJA (auto, ~2 s) → REVEAL_MANTRI (auto, ~2 s)
→ GUESSING (Mantri picks one of the two unrevealed seats, 30 s; timeout → seeded random guess)
→ ROUND_RESULT (Chor + Sipahi revealed, score deltas, ~4 s) → next round | MATCH_OVER
```

| Outcome | Raja | Mantri | Sipahi | Chor |
|---|---:|---:|---:|---:|
| Correct guess | 1000 | 800 | 500 | 0 |
| Wrong guess | 1000 | 0 | 500 | 800 |

Invariant (tested): every round distributes exactly 2300. **Visibility:** own role always; Raja/Mantri public at reveal; Chor/Sipahi hidden from others until ROUND_RESULT. **Action:** `guess{targetSeat}` — only Mantri, only in GUESSING, only an unrevealed seat. **Events:** `roleDealt` (private), `rajaRevealed`, `mantriRevealed`, `guessMade`, `roundResolved{roles, deltas}`, `matchOver`. **Idle:** 2 consecutive guessing timeouts → MARK_IDLE. **Bot:** Mantri guesses uniformly at random (no information exists; documented honestly). **UI:** role card flip, crown reveal for Raja, Mantri reveal, "point at suspect" guess, Chor caught / escaped moment, rolling score counters.

---

## 11. 16 Parchi rules (flagship)

| | |
|---|---|
| Players | Exactly 4 · public target 4 / minHumans 2 · reclaim IMMEDIATE |
| Result | Placements 1st–4th, no cumulative score · rematch = new deal in the same room |

**Content:** a **category** has exactly 4 items × 4 copies = 16 chits; items have `{id, label, colour, icon}` (generic original icon; **brand names as text only, never logos**). Category: private = host setting (default Random); public = random.

```text
DEALING (seeded shuffle, 4 each, ~2 s) → CHECK
CHECK: any active player holds 4-of-a-kind? ─yes─▶ CLAIM_WINDOW  ─no─▶ SELECTING
SELECTING (10 s): each active player selects one chit (changeable)
   resolves when all have selected (+300 ms settle) or on timeout → safe auto-pick for missing players
PASSING: all selected chits move CLOCKWISE simultaneously to the next ACTIVE seat
   (server holds for the pass animation, ~1.2 s) → CHECK
CLAIM_WINDOW (6 s, passing paused): eligible players get CLAIM; claims ranked by server arrival
   → placement assigned, set revealed publicly, 4 chits leave play, player leaves the circle
   timeout → unclaimed eligible players auto-claimed in seeded random order
   active ≤ 1 → last player takes the final placement → MATCH_OVER; else → SELECTING
```

**Rules consequences:** circle shrinks 4 → 3 → 2. Lucky opening hand goes straight to CLAIM_WINDOW. Simultaneous completion resolved by claim race. **Safe auto-pick** (also bot baseline): keep the item you hold most of; pass from the item you hold fewest of; ties broken by seeded RNG. **Idle:** 3 consecutive auto-picks → MARK_IDLE → bot. **Safety cap:** 100 passing cycles → remaining placements ranked by largest same-item group, seeded tie-break. False claim → rejected (`NOT_ELIGIBLE`), no button shown.

**Visibility:**

| Information | You | Others |
|---|---|---|
| Your chits' items | ✔ | ✘ (only that you hold 4 folded chits) |
| Which chit you selected | ✔ | only that you *have* selected |
| Item in a passing chit | sender and receiver | ✘ (folded chit A → B) |
| Claim eligibility | the eligible player | only "Someone has a full set!" |
| A finished player's set | after claim | after claim |

Chit handles are **re-keyed per viewer** so nobody can track a chit around the table by ID.

**Actions:** `selectChit{handle}`, `claim`. **Events:** `dealt{handles, items}` (private) · `seatSelected{seat}` (public) · `mySelection{handle}` (private) · `passResolved{moves: [{from, to}]}` (public) · `chitSent{handle}` (sender) · `chitReceived{handle, item}` (receiver) · `claimWindowOpened` (public) + `youCanClaim` (private) · `claimAccepted{seat, placement, items}` · `circleChanged{activeSeats}` · `matchOver`.

**Flagship experience spec (driven only by server-confirmed events above):**
- **Table:** top-down desk; you are always at the bottom; others around (each client rotates the table). **Clockwise = pass to your screen-left, receive from your screen-right** — consistent on every screen, shown by a subtle direction ring.
- **Your hand:** 4 *open* paper slips in a loose fan (paper texture, crease line); identical items auto-group so you never count manually; touch targets ≥ 56 px.
- **Opponents:** folded slips in front of each seat; a "selected" slip lifts slightly (no item shown).
- **Select:** tap a slip → it lifts, **folds shut**, slides to the "pass spot" toward your left neighbour; tap another to swap. Selection timer is a ring around the pass spot; last 3 s pulse.
- **Pass:** all folded slips fly simultaneously on curved paths with slight flutter/rotation.
- **Receive:** incoming slip lands folded, then **unfolds** to reveal its item; a private highlight if it matches your biggest group.
- **React:** quick reactions (I1) as bubbles over seats.
- **Claim:** prominent pulsing CLAIM button + short haptic buzz on supporting phones (skipped in reduced-motion); the four slips snap together and slam onto the desk; a placement medal flies to your seat; others see your set flip face-up at your seat; the finished seat dims and pass arrows re-route around it.
- **Match end:** podium 1st–4th with confetti (full effects only).
- **Modes:** *lite* = straight slides, no flutter, no confetti; *reduced motion* = crossfades + instant positions, timers and state still clear. Performance: at most 4 slips in flight, transform/opacity only.

---

## 12. Draw & Guess rules

| | |
|---|---|
| Players | 3–6 · public target 5 / minHumans 2 · reclaim NEXT_PHASE_BOUNDARY |
| Match | Each player draws once per round · private: host 1–3 rounds (default 2) · public: 1 round |

```text
CHOOSING (drawer gets 3 unused prompts from the pack, 10 s; timeout → random pick)
→ DRAWING (60 s) — ends on timeout, when all guessers are correct, or when the drawer's grace expires
→ REVEAL (answer shown to all, score deltas, ~5 s) → next drawer | next round | MATCH_OVER
```

**Word pattern & hints (approved):** guessers see the letter pattern from the start (blanks; spaces/hyphens visible). At **50 %** of the timer one random hidden letter is revealed; at **75 %** another. Cap = floor(letters / 3) (so 3–5-letter words get only the 50 % hint; 6+ get both). Hints are **public events**, usable equally by humans and bots. The drawer always sees the full word.

**Guess evaluation (chat hook):** messages normalized (lowercase, trim, strip punctuation/diacritics).
- **Correct** = equals the answer or an accepted alias, or contains it as a whole word/phrase ("is it a cat?") → `CONSUME`: private "Correct!" to guesser, "X guessed it" to drawer, "X guessed correctly" to everyone else; **the answer text is never broadcast**.
- **Close** = edit distance 1 on answers ≥ 4 letters → `CONSUME`: **only the sender sees "close!"**; nobody else sees the message.
- **Drawer** cannot chat while DRAWING → `BLOCK` (input disabled + server-enforced).
- **Already-correct players** chat on the `SOLVED` channel (drawer + other solved players only) → `RESTRICT`.
- Wrong guesses → `PASS` (moderated, shown normally).

**Scoring (configurable):** guessers by order **100 / 80 / 65 / 55 / 50**; drawer **20 per correct guesser**. Highest total wins; ties share.

**Drawing:** 12-colour palette, 4 brush sizes, eraser, undo (drawer's last stroke), clear; no fill, no layers; strokes smoothed with perfect-freehand. **Protocol:** fixed 4:3 logical canvas, integer coords 0–4095; `{strokeId, tool, colour, size, points[]}` batched ~50 ms; `undo`/`clear` ops. **Server validates:** sender is drawer, phase DRAWING, palette/size indexes, coordinate ranges, ≤ 64 points/chunk, ≤ 20 chunks/s, ≤ 20,000 points & ≤ 1,000 strokes per turn. Server keeps the op log for reconnect replay.

**Safety:** curated packs only, no user prompts; **"Hide Drawing"** per-player local toggle per drawer (strokes still arrive, so un-hide works); report as §7; **UI never claims drawings are automatically moderated.**

**Content:** ≥ 300 English words (≥ 3 letters) with aliases and difficulty tags; every word passes moderation (tested); **30–40 hand-authored bot stroke templates**.

**Bots:** *drawer* — only offered template-backed prompts; replays template strokes over 20–40 s with jitter. *Guesser* — candidate filter over the pack using only public info (pattern, revealed letters, prior wrong guesses); guesses every 6–12 s via `BotDecision.CHAT` through the same chat/hook path; probability of being right = 1/|candidates|. **Bots never receive the answer.** **Idle:** 2 consecutive drawing turns with no strokes → MARK_IDLE.

---

## 13. Pen Fight rules

| | |
|---|---|
| Players | 2–4, one pen each · public target 4 / minHumans 2 · reclaim IMMEDIATE |
| Win | Last pen standing · others placed by reverse elimination order |

```text
SETUP (pens placed symmetrically, random facing; turn order seeded shuffle)
→ AIMING (active player, 15 s; timeout → turn skipped)
→ flick{anchor ∈ [-1,1] along the pen, angle, power ∈ [0,1]}  (validated + clamped)
→ SIMULATING (server) → keyframes broadcast → wait playback + 0.5 s
→ RESOLVE (eliminations; sudden-death step at round boundary) → next alive player | MATCH_OVER
```

A **full round** = every alive pen has had one turn.

**Controls:** touch/click the pen — **the touch point sets the anchor** (off-centre = spin); drag back to aim; release to flick. Aim preview shows direction arrow + power arc only (no predicted path — clients never run physics).

**Physics:** Planck.js on the server behind `PhysicsEngine.simulateShot(table, shot, params) → {frames, events, final}`. Top-down, no gravity; table friction via linear + angular damping; moderate restitution; pens are capsule bodies; fixed 60 Hz steps until all bodies sleep (cap 8 s). **Elimination: pen's centre of mass leaves the current desk boundary** → removed from the simulation at that tick; client plays a "falls off the desk" animation. Self-eliminations count.

**Keyframes:** per pen `{x, y, angle}` quantized at 30–60 Hz (tuned by payload); collision events `{tick, a, b, impulse}` drive sparks and screen shake (full effects only). Client interpolates at 60 fps, then snaps to the authoritative final state.

**Sudden death (approved):** count consecutive full rounds without an elimination; **at 10, sudden death arms permanently**. From then, at the start of each full round, the desk boundary shrinks about its centre by 6 % of the original dimensions until the match ends (guarantees termination). **The next boundary is previewed for the whole round before it applies** (glowing dashed line + "Desk shrinking!" banner); when applied, the edge animates inward and pens whose centre is outside are eliminated.

**Tie-breaks:** same shot → later-leaving pen ranks higher; same shrink step → pen closer to centre ranks higher; exact ties share placement.

**Idle:** 3 consecutive skipped turns → MARK_IDLE. **Visibility:** everything public. **Action:** `flick`. **Events:** `turnStarted{seat, deadline}`, `shotPlayed{keyframes, collisions, eliminations}`, `suddenDeathArmed{nextBoundary}`, `deskShrunk{boundary, eliminated}`, `matchOver`. **Bot:** samples up to 24 candidate shots with the same `PhysicsEngine`, scores outcomes (opponents out +, self out −−, edge distance +), picks with difficulty noise; **20 ms CPU budget**, `worker_threads` fallback if exceeded.

---

## 14. Bot architecture

```text
BotManager
  ├ occupies seats: public fill, host-added (private), takeover (grace expiry / MARK_IDLE / explicit leave)
  ├ per bot seat: memory = game.bot.createMemory(); on each update: memory = observe(memory, seat-visible events)
  ├ decide(view, memory) → BotDecision (ACTION | CHAT) with thinkMs → schedule
  ├ on fire: drop if match version changed and decision is stale → re-decide
  └ submit through the SAME validateAction/applyAction (or ChatService) path as humans
```

Bots see only their seat's filtered view/events. One difficulty ("Normal") in v1. Human-like think delays (0.8–2.5 s typical; 16P claim delay 0.8–2.5 s so humans can win claim races). Always labelled; never chat/react except D&G guessing. On human reclaim the bot hands back per the game's reclaim policy; bot memory is discarded.

---

## 15. Event & state synchronization

- **Per-viewer update:** `match:update {matchId, version, events[], view, serverNow}` sent to each seat separately (already filtered). `version` increments per transition; a client that detects a gap sends `match:resync` and receives a fresh view. Views are small → **no diff/patch protocol in v1**.
- **Client:** `AnimationDirector` plays the event queue (respecting effects mode), then commits the view; if updates pile up it fast-forwards (never more than ~1.5 s visually behind).
- **Timers:** the server accounts for animation durations in phase holds; deadlines are server timestamps; the client estimates clock offset from the median of 5 `time:ping` round trips.
- **STREAMED** (D&G strokes) uses `match:stream`, separate from `match:update`. **SIMULATED** (Pen Fight) delivers the full keyframe set inside one `shotPlayed` event.
- Actions carry `{matchId, version}`; stale → `STALE_VERSION` (double-taps harmless).

**Protocol (acked C→S; ack = `{ok: true, …} | {ok: false, code}`):**

| Client → Server | Server → Client |
|---|---|
| `session:setNickname` | `session:ready {playerId, token?, nickname}` |
| `room:create` · `room:join {code}` · `room:leave` | `session:displaced` |
| `room:setGame` · `room:updateSettings` · `room:addBot` · `room:removeBot` · `room:kick` · `room:start` · `room:playAgain` | `room:snapshot` · `room:event` |
| `mm:quickPlay {gameId \| 'ANY'}` · `mm:cancel` | `lobby:rooms` (throttled) |
| `lobby:watch` · `lobby:unwatch` | `match:update` · `match:stream` · `match:end` |
| `match:action` · `match:stream` · `match:resync` | `chat:message` · `chat:reaction` |
| `chat:send` · `chat:react` · `report:submit` · `time:ping` | `system:notice {code}` |

**Error codes:** ROOM_NOT_FOUND, ROOM_FULL, ROOM_IN_PROGRESS, NOT_HOST, REMOVED_FROM_ROOM, NICKNAME_TAKEN, NICKNAME_REJECTED, INVALID_PAYLOAD, PAYLOAD_TOO_LARGE, RATE_LIMITED, CHAT_COOLDOWN, STALE_VERSION, NOT_YOUR_TURN, ILLEGAL_ACTION, NOT_ELIGIBLE, SERVER_BUSY (each mapped to a friendly client message).

---

## 16. Testing strategy

| Level | Tooling | Covers |
|---|---|---|
| Engine unit | Vitest | every rule, score, timeout, illegal action, idle rule; invariants (16 chits/4 per active; RMCS 2300/round; D&G hint cap & score order; sudden-death termination) |
| Harness fuzz | game-sdk | thousands of seeded bot-only matches per game: invariants, termination, **leak checker** on every view/event; failures replay from seed + action log |
| Physics | Vitest golden | fixed shots → fixed final states (same Node version); bot CPU budget |
| Moderation | Vitest table-driven | must-censor / must-not-censor corpora, Hinglish, leetspeak, spacing, contact info, nickname rejection; every content-pack word passes |
| Server integration | real Socket.IO + socket.io-client, short timers | create/join/leave, full room, join-after-start, grace/bot-takeover/reclaim, idle takeover, host transfer, removal, duplicate tab, simultaneous claims, last-public-seat race, minHumans wait & fill window, report flags, malformed/oversized/flood payloads, forged tokens |
| Timers | Vitest fake timers | TimerService and every phase timeout |
| E2E | Playwright (~8 flows) | private room with 2 contexts; RMCS vs bots to completion; two-human quick play with bot fill; 16P pass + claim; D&G draw→guess→reveal; mobile viewport; reduced motion |
| Load | `tools/loadtest` | 200 concurrent simulated clients: CPU, memory, event-loop lag — before production |
| Manual | device checklist (product owner) | real mid/low Android Chrome: FPS, touch, lite mode, 16P & Pen Fight feel |

CI runs lint, typecheck, unit and integration tests on every push; Playwright joins CI once stable.

---

## 17. Deployment architecture

```text
Browser ─HTTPS─▶ static host / CDN (client build, CSP + security headers)
   └──WSS──▶ Node server — ONE instance, in-memory state, persistent WebSocket host
              /healthz · origin allowlist · TRUST_PROXY · graceful SIGTERM (notice → drain → exit)
```

Provider selection in Phase 9 after re-checking current pricing/sleep behaviour (static host/CDN for the client; a container host with long-lived WebSockets for the server). A throwaway staging deploy at the end of Phase 1 to validate WebSockets. Client handles sleeping servers ("Waking up the game server…" + auto-reconnect). Limits: messages ≤ 16 KB; per-IP connection ceiling ≈ 60 (generous: shared classroom IPs); room caps per §4. **Documented, not built:** room-affinity → sticky sessions → `@socket.io/redis-adapter` → `RedisRoomStore` (ADR only).

---

## 18. Documentation plan

```text
README.md · CREDITS.md
docs/
├── specs/PHASE_0_SPEC.md          this document (frozen, with change log)
├── PROJECT_OVERVIEW.md · ARCHITECTURE.md (Mermaid; i18n section) · DEVELOPMENT_SETUP.md
├── GAME_SYSTEM.md · ADDING_A_GAME.md · ROOM_SYSTEM.md · PUBLIC_LOBBY_SYSTEM.md
├── SOCKET_EVENTS.md · CHAT_AND_MODERATION.md · BOT_SYSTEM.md · UI_UX.md
├── TESTING.md · SECURITY.md · DEPLOYMENT.md · CONTRIBUTING.md
├── GAME_RULES/  RAJA_MANTRI_CHOR_SIPAHI.md · 16_PARCHI.md · DRAW_AND_GUESS.md · PEN_FIGHT.md
└── decisions/   ADR-001 pnpm monorepo · 002 React+Vite+Motion · 003 Socket.IO + view/event sync
                 004 pure engines + seeded RNG · 005 in-memory RoomStore + scaling path
                 006 anonymous session tokens · 007 moderation pipeline · 008 server physics + keyframes
                 009 static client + WS server · 010 lightweight typed i18n · 011 report flags, no auto-punish
```

Docs are written in the phase that builds the thing they describe (rules docs arrive with their game).

**Implementation phases (approved):** 1 Infra + private rooms · 2 RMCS · 3 16 Parchi · 4 Draw & Guess · 5 Pen Fight · 6 Public lobby/matchmaking/bot fill · 7 Moderation hardening + abuse testing · 8 Performance & polish · 9 Production deployment. Each game phase is a complete slice (engine + UI + bot + tests + docs) with a logical commit.

---

## 19. v1 exclusions

From the product owner: global chat, user accounts, profiles, friends, leaderboards, achievements, persistent statistics, voice chat, dedicated mobile app, database, social feed.

Also out of v1: direct messages, spectators, bot difficulty levels, sound, light/dark toggle, non-English languages, custom word lists/categories, room passwords, admin/moderation dashboard, automatic kick/ban from reports, stored chat, automated drawing moderation, Redis/multi-instance, room merging, replays UI, analytics.

---

## 20. Remaining non-blocking considerations

1. ~~Lone public player UX~~ — **resolved by C8** ("Play with Bots" escape hatch, Phase 6).
2. **Hosting provider + budget** — decide by Phase 9.
3. **Public names** for Draw & Guess and a domain — naming check (C9).
4. **Mood board / visual direction** — required before polished game UI (C10).
5. **Hinglish word list** needs ongoing curation post-launch (documented maintenance task).
6. **Library evaluation** at first use: `motion`, `perfect-freehand`, `obscenity`, `planck` (license, maintenance; `obscenity` transformer false positives).
7. **Feel tuning:** 16 Parchi animation timings and Pen Fight physics constants need owner play-test sessions on a real phone.
8. **Deploys end live matches** (in-memory) — accepted for v1.
9. **Future:** sound, spectators, bot difficulty levels, Hindi, stronger moderation behind `ReportSink`/`Moderator`, multi-instance scaling.

---

## Appendix A — Tunables (server config, defaults)

| Key | Default | Key | Default |
|---|---|---|---|
| reconnect grace | 30 s | public fill window | 12 s |
| starting countdown | 3 s | public results screen | 15 s |
| room idle close | 5 min | session idle expiry | 24 h |
| chat max length | 200 | chat burst / refill / cooldown | 5 / 1 per s / 30 s |
| reaction rate | 1 per 1.5 s | chat buffer | 50 |
| report flag store | 1,000 flags, 24 h | message max size | 16 KB |
| RMCS guess timer / rounds | 30 s / 10 | 16P select / claim window | 10 s / 6 s |
| 16P pass animation hold / cycle cap | 1.2 s / 100 | D&G choose / draw | 10 s / 60 s |
| D&G hints | 50 %, 75 %, cap floor(letters/3) | D&G guesser / drawer points | 100·80·65·55·50 / 20 each |
| Pen aim timer / sim cap | 15 s / 8 s | Pen sudden death | after 10 rounds, −6 %/round |
| Pen bot candidates / budget | 24 / 20 ms | idle thresholds | RMCS 2 · 16P 3 · D&G 2 · Pen 3 |
