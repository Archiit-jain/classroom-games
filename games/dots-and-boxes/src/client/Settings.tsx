import type { SettingsProps } from '@cg/game-sdk/client';
import { GRID_SIZES, type DotsSettings, type GridSize } from '../shared';
import { f } from './messages';

/** Host picks the grid (5×5 by default); guests see it read-only, with a tiny preview. */
export default function DotsSettingsForm({
  settings,
  editable,
  onChange,
}: SettingsProps<DotsSettings>) {
  const n = settings.grid;
  return (
    <div className="settings-grid db-settings">
      <label className="field">
        <span className="field__label">{f('grid')}</span>
        <select
          className="field__input"
          value={n}
          disabled={!editable}
          onChange={(e) => onChange({ ...settings, grid: Number(e.target.value) as GridSize })}
        >
          {GRID_SIZES.map((size) => (
            <option key={size} value={size}>
              {f('gridSize', { n: size })}
            </option>
          ))}
        </select>
        <span className="field__hint">{f('gridHint')}</span>
      </label>
      <svg
        className="db-settings__preview"
        viewBox={`-0.5 -0.5 ${n + 1} ${n + 1}`}
        aria-hidden="true"
        focusable="false"
      >
        {Array.from({ length: (n + 1) * (n + 1) }, (_, i) => (
          <circle key={i} cx={i % (n + 1)} cy={Math.floor(i / (n + 1))} r={0.09} />
        ))}
      </svg>
    </div>
  );
}
