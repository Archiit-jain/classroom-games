import type { SettingsProps } from '@cg/game-sdk/client';
import { CATEGORY_LABELS } from '../../content/en';
import { CATEGORIES, categoryById } from '../shared/categories';
import type { ParchiSettings } from '../shared/types';
import { ItemIcon } from './icons/items';
import { parchiMessages as m } from './messages';

/** Host picks the category (default Random); guests see it read-only. */
export default function ParchiSettingsForm({
  settings,
  editable,
  onChange,
}: SettingsProps<ParchiSettings>) {
  const chosen = categoryById(settings.category);
  return (
    <div className="settings-grid sp-settings">
      <label className="field">
        <span className="field__label">{m.category}</span>
        <select
          className="field__input"
          value={settings.category}
          disabled={!editable}
          onChange={(e) => onChange({ ...settings, category: e.target.value })}
        >
          <option value="RANDOM">{m.random}</option>
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {CATEGORY_LABELS[c.id] ?? c.id}
            </option>
          ))}
        </select>
      </label>
      <div className="sp-settings__preview" aria-hidden="true">
        {chosen ? (
          chosen.items.map((item) => <ItemIcon key={item.id} item={item.id} size={34} />)
        ) : (
          <span className="sp-settings__random">{m.randomHint}</span>
        )}
      </div>
    </div>
  );
}
