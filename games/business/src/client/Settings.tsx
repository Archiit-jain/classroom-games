import type { SettingsProps } from '@cg/game-sdk/client';
import { useState } from 'react';
import { MAX_ROUNDS, MIN_ROUNDS, type BusinessSettings } from '../shared';
import { f } from './messages';
import './settings.css';

const clamp = (n: number) => Math.max(MIN_ROUNDS, Math.min(MAX_ROUNDS, Math.round(n)));

/** Host picks any number of rounds; board and event frequency have one choice each in v1. */
export default function BusinessSettingsForm({
  settings,
  editable,
  onChange,
}: SettingsProps<BusinessSettings>) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string) => {
    setDraft(null);
    const n = Number(raw);
    if (Number.isFinite(n) && raw.trim() !== '') onChange({ ...settings, rounds: clamp(n) });
  };
  const step = (d: number) => onChange({ ...settings, rounds: clamp(settings.rounds + d) });
  return (
    <div className="settings-grid">
      <div className="field">
        <label className="field__label" htmlFor="bz-rounds">
          {f('rounds')}
        </label>
        <span className="bz-stepper">
          <button
            type="button"
            className="btn btn--small"
            disabled={!editable || settings.rounds <= MIN_ROUNDS}
            onClick={() => step(-1)}
            aria-label={f('fewerRounds')}
          >
            −
          </button>
          <input
            id="bz-rounds"
            className="field__input bz-stepper__input"
            type="number"
            inputMode="numeric"
            min={MIN_ROUNDS}
            max={MAX_ROUNDS}
            step={1}
            disabled={!editable}
            value={draft ?? String(settings.rounds)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
            }}
          />
          <button
            type="button"
            className="btn btn--small"
            disabled={!editable || settings.rounds >= MAX_ROUNDS}
            onClick={() => step(1)}
            aria-label={f('moreRounds')}
          >
            +
          </button>
        </span>
        <span className="field__hint">{f('roundsHint')}</span>
      </div>
      <label className="field">
        <span className="field__label">{f('boardName')}</span>
        <select className="field__input" value={settings.board} disabled>
          <option value="india-classic">{f('indiaClassic')}</option>
        </select>
      </label>
      <label className="field">
        <span className="field__label">{f('events')}</span>
        <select className="field__input" value={settings.eventFrequency} disabled>
          <option value="normal">{f('eventsNormal')}</option>
        </select>
        <span className="field__hint">{f('pretend')}</span>
      </label>
    </div>
  );
}
