# ADR-019: Category content packs with original icons

**Status:** Accepted (Phase 3, implements spec §11 content rules)

## Context

16 Parchi needs categories of four items, each with an id, label, colour and icon; brand names
may appear only as text and never as logos (spec §11). Content must be translation-ready and
must not drag third-party artwork licences into the project.

## Decision

- **Language-neutral pack** in `games/sixteen-parchi/src/shared/categories.ts`: category ids,
  item ids and an accent colour per item (four distinct colours per category). The engine only
  uses ids.
- **Labels per language** in `games/sixteen-parchi/content/en` (spec §3 `content/en`); a
  translation adds a sibling folder.
- **Icons are original inline SVGs** drawn for this project (`src/client/icons/items.tsx`),
  in the Color Burst Arcade outline style — no emoji fonts, clip-art packs or logos, so there
  is nothing to license or credit. An item is never identified by colour alone: icon and label
  are always shown.
- **Content rules:** no brands, religious, political or national symbols; vegetarian food.
  Ten initial categories (see [GAME_RULES/16_PARCHI.md](../GAME_RULES/16_PARCHI.md)).
- **Enforced by tests:** four items per category, unique ids, distinct colours, a label and an
  icon for every item, every label passes the chat moderator, labels fit a phone slip.

## Consequences

- New categories are a data change plus four icons and labels; the tests catch omissions.
- Custom (player-made) categories remain out of v1 (spec §19).
