import type { SettingsProps } from '@cg/game-sdk/client';
import type { FixtureSettings as Settings } from '@cg/game-sdk/fixture';
import { fixtureMessages as m } from './messages';

const TARGETS = [10, 15, 20, 25, 30];
const TURNS = [5, 10, 15, 20, 30];

export default function FixtureSettings({ settings, editable, onChange }: SettingsProps<Settings>) {
  return (
    <div className="settings-grid">
      <label className="field">
        <span className="field__label">{m.settingTarget}</span>
        <select
          className="field__input"
          value={settings.target}
          disabled={!editable}
          onChange={(e) => onChange({ ...settings, target: Number(e.target.value) })}
        >
          {TARGETS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field__label">{m.settingTurn}</span>
        <select
          className="field__input"
          value={settings.turnSeconds}
          disabled={!editable}
          onChange={(e) => onChange({ ...settings, turnSeconds: Number(e.target.value) })}
        >
          {TURNS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
