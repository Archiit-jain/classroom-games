import type { SettingsProps } from '@cg/game-sdk/client';
import { ROUND_OPTIONS, type BusinessSettings, type RoundCount } from '../shared';
import { f } from './messages';

/** Host picks the number of rounds; guests see it read-only. */
export default function BusinessSettingsForm({
  settings,
  editable,
  onChange,
}: SettingsProps<BusinessSettings>) {
  return (
    <div className="settings-grid">
      <label className="field">
        <span className="field__label">{f('rounds')}</span>
        <select
          className="field__input"
          value={settings.rounds}
          disabled={!editable}
          onChange={(e) => onChange({ ...settings, rounds: Number(e.target.value) as RoundCount })}
        >
          {ROUND_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {f('roundsN', { n })}
            </option>
          ))}
        </select>
        <span className="field__hint">{f('settingsHint')}</span>
      </label>
    </div>
  );
}
