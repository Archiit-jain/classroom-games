import type { CSSProperties } from 'react';
import { BRUSH_SIZES, PALETTE } from '../shared';
import type { Brush } from './DrawCanvas';
import { EraserIcon, TrashIcon, UndoIcon } from './icons';
import { f, type DrawMessageKey } from './messages';

/** The drawer's tools: 12 colours, 4 sizes, eraser, undo and clear (spec §12). */
export function Toolbar({
  brush,
  onBrush,
  canUndo,
  onUndo,
  onClear,
}: {
  brush: Brush;
  onBrush(next: Brush): void;
  canUndo: boolean;
  onUndo(): void;
  onClear(): void;
}) {
  const largest = BRUSH_SIZES[BRUSH_SIZES.length - 1] as number;
  return (
    <div className="dg-tools" role="toolbar" aria-label={f('tools')}>
      <div className="dg-tools__group dg-swatches" role="group" aria-label={f('colours')}>
        {PALETTE.map((colour, i) => (
          <button
            key={colour}
            type="button"
            className="dg-swatch"
            style={{ '--swatch': colour } as CSSProperties}
            aria-label={f(`colour${i}` as DrawMessageKey)}
            aria-pressed={brush.tool === 'pen' && brush.colour === i}
            onClick={() => onBrush({ ...brush, tool: 'pen', colour: i })}
          />
        ))}
      </div>
      <div className="dg-tools__group" role="group" aria-label={f('sizes')}>
        {BRUSH_SIZES.map((size, i) => (
          <button
            key={size}
            type="button"
            className="dg-tool dg-size"
            aria-label={f(`size${i}` as DrawMessageKey)}
            aria-pressed={brush.size === i}
            onClick={() => onBrush({ ...brush, size: i })}
          >
            <span
              className="dg-size__dot"
              style={
                {
                  '--dot': `${Math.round(6 + (size / largest) * 18)}px`,
                  '--swatch': brush.tool === 'eraser' ? '#fff7e3' : PALETTE[brush.colour],
                } as CSSProperties
              }
            />
          </button>
        ))}
        <button
          type="button"
          className="dg-tool"
          aria-label={f('eraser')}
          aria-pressed={brush.tool === 'eraser'}
          onClick={() => onBrush({ ...brush, tool: brush.tool === 'eraser' ? 'pen' : 'eraser' })}
        >
          <EraserIcon />
        </button>
        <button
          type="button"
          className="dg-tool"
          aria-label={f('undo')}
          disabled={!canUndo}
          onClick={onUndo}
        >
          <UndoIcon />
        </button>
        <button
          type="button"
          className="dg-tool"
          aria-label={f('clear')}
          disabled={!canUndo}
          onClick={onClear}
        >
          <TrashIcon />
        </button>
      </div>
    </div>
  );
}
