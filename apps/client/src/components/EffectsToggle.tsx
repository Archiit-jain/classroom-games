import { t } from '../i18n';
import { useEffectsSetting } from '../platform/context';
import type { EffectsPreference } from '../platform/effects';

const NEXT: Record<EffectsPreference, EffectsPreference> = {
  auto: 'full',
  full: 'lite',
  lite: 'auto',
};

/** Cycles Auto → Full → Lite. When the OS asks for reduced motion, that always wins. */
export function EffectsToggle() {
  const { mode, state, controller } = useEffectsSetting();
  if (state.osReducedMotion) {
    return (
      <span className="effects-toggle effects-toggle--locked" title={t('effects.reduced')}>
        {t('effects.label')}: {t('effects.reduced')}
      </span>
    );
  }
  const label =
    state.preference === 'auto'
      ? `${t('effects.auto')} (${mode === 'lite' ? t('effects.lite') : t('effects.full')})`
      : t(`effects.${state.preference}`);
  return (
    <button
      type="button"
      className="btn btn--small btn--ghost effects-toggle"
      title={t('effects.hint')}
      onClick={() => controller.setPreference(NEXT[state.preference])}
    >
      <span aria-hidden="true">✨</span> {t('effects.label')}: {label}
    </button>
  );
}
