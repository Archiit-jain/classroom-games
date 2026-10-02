# Dots & Boxes — rules as implemented

Code: `games/dots-and-boxes` (engine and bot `src/server/engine.ts`, grid geometry
`src/shared/grid.ts`, touch picking `src/shared/pick.ts`, board `src/client/Board.tsx`).
Design: [design/DOTS_AND_BOXES_DESIGN.md](../design/DOTS_AND_BOXES_DESIGN.md). Values marked
_(play-test)_ are starting points, not frozen rules.

## Players and grid

- **2–4 players**, humans and/or bots.
- The host picks the grid, counted in boxes: **4×4**, **5×5 (default)** or **7×7**.

  | Grid | Dots | Lines (2n(n+1)) | Boxes |
  | ---- | ---- | --------------- | ----- |
  | 4×4  | 25   | 40              | 16    |
  | 5×5  | 36   | 60              | 25    |
  | 7×7  | 64   | 112             | 49    |

- A line is `h:r:c` (dot (r, c) to (r, c+1)) or `v:r:c` (dot (r, c) to (r+1, c)); box (r, c)
  has the sides `h:r:c`, `h:r+1:c`, `v:r:c`, `v:r:c+1`.
- The first player is chosen by the match's seeded random generator; play then goes round in
  seat order.

## A move

1. The player whose move it is draws **one** free line. The move contains only the line's id —
   the server decides everything else.
2. Every box whose four sides are now drawn (one, or two at once) goes to that player.
3. Closing at least one box ⇒ the **same player moves again**; otherwise the turn passes.
4. The game ends when every box is claimed (the last line always closes a box).

**Rejected:** a move by anyone but the current player (`NOT_YOUR_TURN`), a drawn or
out-of-range line (`ILLEGAL_ACTION`), a malformed move or any extra field such as claimed
boxes or a score (`INVALID_PAYLOAD`), a repeated action id (`DUPLICATE_ACTION`), a version the
server never issued (`STALE_VERSION`), moves after the end (`INVALID_PHASE`).

## Result

Most boxes wins; equal counts share a place (1, 1, 3). The results table shows **Boxes**.

## Timing

- **No turn timer.**
- A player who makes no move on their turn for **90 s** _(play-test)_ is handed to a bot (with
  "I'm back" to take the seat back at once); a nudge appears on their screen after 60 s.
- A disconnected player has the usual 30 s reconnect grace before a bot plays for them.

## Bot

One level. On its move it:

1. takes every box it can (a line closing two first) and keeps going;
2. otherwise draws a **safe** line — one that gives no box its third side — preferring quiet
   parts of the board;
3. when no line is safe, gives the opponents the **smallest** chain or loop.

It sometimes misjudges _(play-test)_: with ≤ 4 safe lines left, 15 % of the time it plays an
unsafe line; in the end phase, 20 % of the time it gives away a random chain. It never misses an
available box. Thinking time: 0.7–1.6 s, 0.35–0.7 s per extra move inside a chain.

## Playing

- **Touch:** touch near a line — the nearest free line previews in your colour — slide to
  adjust, lift to draw. Touches right at a dot or a box centre (two lines about equally near)
  draw nothing.
- **Mouse:** hover previews, click draws. **Keyboard:** arrow keys move a cursor, Enter draws.
- Your line shows at once while the server confirms it.
