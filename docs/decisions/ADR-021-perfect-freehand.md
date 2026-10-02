# ADR-021: perfect-freehand for stroke rendering

**Status:** Accepted (Phase 4; the spec §20 item 6 library evaluation)

## Context

Raw pointer points drawn as lines look jagged and mechanical, especially from fingers on
phones. Draw & Guess needs smooth, marker-like strokes that look the same on every screen.

## Options

1. Hand-written smoothing (Catmull-Rom or quadratic midpoints) with fixed line widths.
2. **`perfect-freehand` 1.2.3** — turns points into a filled outline with streamline,
   smoothing and simulated pressure.
3. A full canvas/whiteboard library (Fabric, Konva, Excalidraw).

## Decision

Use `perfect-freehand` (option 2), **client-side only**. It is MIT-licensed, has no
dependencies, is small, maintained, and only does geometry — we keep our own canvas, protocol
and op model. The server and the wire carry plain integer points; each client computes the
outline, so the picture is identical everywhere. Finished strokes are baked into an offscreen
cache; each frame repaints only the live stroke. Eraser strokes use `destination-out` over a
CSS paper background.

Option 1 gives visibly worse strokes for little saving; option 3 brings large dependencies and
its own sync model we do not want.

## Consequences

- One small runtime dependency, listed in [CREDITS.md](../../CREDITS.md).
- Swapping it later only touches `games/draw-and-guess/src/client/surface.ts`.
