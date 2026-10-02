import type { SettingsProps } from '@cg/game-sdk/client';
import type { DrawSettings } from '../shared';
import { f } from './messages';

/** Host picks how many rounds (everyone draws once per round); guests see it read-only. */
export default function DrawSettingsForm({
  settings,
  editable,
  onChange,
}: SettingsProps<DrawSettings>) {
  return (
    <div className="settings-grid">
      <label className="field">
        <span className="field__label">{f('rounds')}</span>
        <select
          className="field__input"
          value={settings.rounds}
          disabled={!editable}
          onChange={(e) => onChange({ ...settings, rounds: Number(e.target.value) })}
        >
          {[1, 2, 3].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span className="field__hint">{f('roundsHint')}</span>
      </label>
    </div>
  );
}
