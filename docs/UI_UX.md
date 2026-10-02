# UI / UX — Color Burst Arcade

**Visual direction (approved for Phase 2):** _nostalgic classroom games × modern
multiplayer arcade_ — colourful, energetic, premium, playful, nostalgic, highly animated,
catchy, **not childish, not a dashboard.** Raja Mantri Chor Sipahi was the first full
demonstration; 16 Parchi (the flagship) is the second. Implementation: `packages/ui` ([ADR-015](decisions/ADR-015-shared-ui-package.md)).

## Design language

| Element   | Treatment                                                                                                                                                                                                                                                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stage     | Deep "arcade night" indigo with soft pink / cyan / yellow / violet colour bursts and a faint arcade dot grid (fixed layer, no repaint on scroll).                                                                                                                                                  |
| Accents   | Pink `#ff3e8a`, Yellow `#ffd23f`, Cyan `#2de2e6`, Lime `#9cf04a`, Orange `#ff8a3d`, Violet `#9b7bff`, each with a deeper shade for edges/pressed states. Seats get a stable accent each.                                                                                                           |
| Surfaces  | Chunky "sticker" panels: gradient fill, thick dark outline, hard offset shadow + soft float shadow.                                                                                                                                                                                                |
| Nostalgia | Notebook paper (ruled lines + red margin) for chits and your role card, a "HELLO my name is" name tag for the nickname, a ticket stub for the room code, rubber stamps for verdicts, a chalkboard desk with a wooden frame for the RMCS table, a wooden school desk and paper slips for 16 Parchi. |
| Buttons   | "Arcade keys": bright fill, thick outline, 5 px hard shadow that compresses on press. Yellow = primary, pink = decisive (accuse, send, join), cyan = secondary.                                                                                                                                    |
| Type      | **Baloo 2** (variable, OFL, self-hosted; has Devanagari for future Hindi) for display, buttons and numbers; the system UI font for body text.                                                                                                                                                      |
| Icons     | Original inline SVGs (crown, scroll, shield, mask, arrow; the 40 16 Parchi item icons and medals); no third-party artwork ([ADR-019](decisions/ADR-019-category-content-packs.md)).                                                                                                                |

Tokens live in `packages/ui/src/styles/tokens.css`; components never use raw colours.

## Motion principles

Animations communicate **server-confirmed** state changes; they are not decoration.

| Moment          | Animation                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Screen entrance | Staggered rise-in of home cards; players slide into the lobby list.                                                       |
| Match start     | Big bouncing 3-2-1 countdown over a blurred lobby.                                                                        |
| Deal            | Folded chits fly from the desk centre to each seat; your role card flips in.                                              |
| Reveal          | Chits flip in 3D; the revealed Raja/Mantri chit pops.                                                                     |
| Thinking        | Countdown ring around the acting player's avatar (turns pink in the last 5 s).                                            |
| Accusation      | Two-step Suspect → Accuse; an arrow lands on the accused chit, which shakes.                                              |
| Verdict         | A rubber stamp thumps onto the desk; score changes float up; totals roll.                                                 |
| Results         | Podium rises in place order; confetti burst; scores roll up.                                                              |
| 16P select      | Tap a slip: it folds shut and slides into the pass spot inside the countdown ring.                                        |
| 16P pass        | Folded slips fly clockwise together on curved, fluttering paths; yours lands folded and unfolds.                          |
| 16P claim       | Pulsing CLAIM button (+ haptic buzz); the set is revealed at the seat with a medal; the seat dims and the ring re-routes. |
| Reactions       | An emote bubble pops over the sender's seat and floats away.                                                              |

Pacing is handled by the **animation director** and three **effects modes**
([ADR-016](decisions/ADR-016-animation-director.md)):

- **Full** — everything above.
- **Lite** — shorter, simpler motion (no 3D flourishes on low-end devices, a third of the
  confetti — none for 16 Parchi, spec §11 — no shake, straight slip slides). Chosen
  automatically on low-end devices.
- **Reduced** — no motion; states change instantly. Forced when the OS asks for reduced
  motion.

Players can switch **Effects: Auto / Full / Lite** from the header.

## Layout

- **Phone first.** Single column below 960 px (chat under the game); two columns above.
- No horizontal scrolling at 360 px (end-to-end tested); the RMCS table compacts its seats
  below 700 px so the whole table fits; the Mantri's accuse bar sticks to the bottom of the
  screen.
- Touch targets ≥ 48 px (small buttons 36 px with generous spacing).
- RMCS and 16 Parchi seats are always relative to you: you at the bottom, play clockwise —
  you pass to your screen-left and receive from your screen-right.
- 16 Parchi: your hand (four slips ≥ 56 px wide on phones, grouped by item with a ×N badge)
  sits under the table; the CLAIM button sticks above it; quick reactions are a "React" tray
  on phones and an always-visible row on wider screens.
- Draw & Guess: a 4:3 notebook-paper canvas, full width on phones, with the player chips
  (score, ✓ when guessed, pencil on the drawer) above it on phones and beside it from 700 px.
  Under the canvas the drawer gets the toolbar (12 colour swatches of 40 px, 4 sizes, eraser,
  undo, clear); guessers get the guess box, "close!" feedback and the last few messages (on
  wide screens the room chat beside the board takes over). The word is shown as blanks with a
  letter count; hint letters pop in. Word cards deal in and flip (full), fade (lite) or
  appear (reduced); "Correct!" and the reveal use the rubber stamp. Strokes are painted as
  they arrive and never wait for the animation director.
- Pen Fight: a top-down wooden desk (SVG) with ballpoint pens in the seat colours and name
  tags. On a portrait phone the landscape desk is drawn turned 90° so it fills the width (input
  is mapped back). Your pen has a 52 px touch target; touch it, drag back (rubber band, a
  strength arrow turning yellow → red, a curl showing spin) and let go; a pen-shaped Spin
  slider sets the spin point precisely; keyboard controls on desktop. Others see only "…is
  aiming" and the timer. Replays interpolate the server's keyframes at 60 fps with motion
  ghosts, a squash on the flicked pen, sparks and a small shake on hard hits (full), sparks only
  (lite) or no replay at all (reduced: pens appear at their final places). Knocked-out pens tip
  off the edge with an "OUT!" stamp; places appear only once the pen has fallen. Sudden death:
  a brief banner, a glowing dashed preview of the smaller desk and the old outline kept as a
  ghost while the desk shrinks.

## Accessibility

Real buttons with labels (e.g. "Suspect Priya", "Red", "Undo"; the Draw & Guess canvas is
an image labelled with whose drawing it is, and the secret word is read out as "6 letters:
blank blank …"), visible focus rings, `aria-live` for
desk messages, chat and toasts, alerts for errors, reduced motion honoured everywhere,
colour never the only signal (roles have icons and names; bots have badges and names).

## Text and translation

No user-facing string is hard-coded in components: platform text goes through `t()` and
`apps/client/src/i18n/en.ts` (typed keys); game text lives in each game's `messages`.

## Not built yet

Per-game sound (excluded from v1), Motion bundle trimming and a measured low-end device pass
(Phase 11).
