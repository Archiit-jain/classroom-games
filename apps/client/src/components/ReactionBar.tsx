import { REACTION_IDS, REACTION_INTERVAL_MS, type ReactionId } from '@cg/protocol';
import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { useConnection } from '../platform/context';
import { REACTION_EMOJI } from '../platform/reactions';

/**
 * The quick-reaction picker (spec §8). Phones: a "React" toggle opening a tray
 * of eight emotes; wider screens: the row is always visible. After sending,
 * the buttons rest for the server's 1.5 s limit.
 */
export function ReactionBar() {
  const conn = useConnection();
  const [open, setOpen] = useState(false);
  const [resting, setResting] = useState(false);

  useEffect(() => {
    if (!resting) return;
    const id = setTimeout(() => setResting(false), REACTION_INTERVAL_MS);
    return () => clearTimeout(id);
  }, [resting]);

  const send = async (reactionId: ReactionId) => {
    if (resting) return;
    setResting(true);
    setOpen(false);
    const res = await conn.react(reactionId);
    // A rate-limit reply only means a tap was too quick; nothing to report.
    if (!res.ok && res.code !== 'RATE_LIMITED') conn.toastError(res);
  };

  return (
    <div className={open ? 'reactions is-open' : 'reactions'} aria-label={t('reactions.title')}>
      <button
        type="button"
        className="btn btn--small reactions__toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">{REACTION_EMOJI.LOL}</span>{' '}
        {open ? t('reactions.close') : t('reactions.open')}
      </button>
      <div className="reactions__tray" role="group" aria-label={t('reactions.title')}>
        {REACTION_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className="reactions__emote"
            disabled={resting}
            aria-label={t('reactions.send', { label: t(`reactions.${id}`) })}
            title={t(`reactions.${id}`)}
            onClick={() => void send(id)}
          >
            {REACTION_EMOJI[id]}
          </button>
        ))}
      </div>
    </div>
  );
}
