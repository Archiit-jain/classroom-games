import type { SettingsProps } from '@cg/game-sdk/client';
import {
  ANSWER_SECONDS,
  ROUND_OPTIONS,
  type AnswerSeconds,
  type NpatSettings,
  type RoundCount,
} from '../shared';
import { f } from './messages';

/** Host picks the number of rounds and the answer time; guests see them read-only. */
export default function NpatSettingsForm({
  settings,
  editable,
  onChange,
}: SettingsProps<NpatSettings>) {
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
      </label>
      <label className="field">
        <span className="field__label">{f('answerTime')}</span>
        <select
          className="field__input"
          value={settings.answerSeconds}
          disabled={!editable}
          onChange={(e) =>
            onChange({ ...settings, answerSeconds: Number(e.target.value) as AnswerSeconds })
          }
        >
          {ANSWER_SECONDS.map((n) => (
            <option key={n} value={n}>
              {f('seconds', { n })}
            </option>
          ))}
        </select>
        <span className="field__hint">{f('settingsHint')}</span>
      </label>
    </div>
  );
}
