import { CHAT_MAX_LENGTH } from '@cg/protocol';
import { useEffects } from '@cg/ui';
import { motion } from 'motion/react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { errorMessage, t } from '../i18n';
import { useAppState, useConnection } from '../platform/context';

export function ChatPanel() {
  const { chat, hidden, session } = useAppState();
  const conn = useConnection();
  const effects = useEffects();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const visible = chat.filter((m) => !hidden.includes(m.fromId));

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible.length]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const message = text.trim();
    if (!message) return;
    const res = await conn.request('chat:send', { text: message });
    if (res.ok) {
      setText('');
      setError(null);
    } else {
      setError(errorMessage(res.code, res.retryAfterMs));
    }
  };

  return (
    <section className="panel chat" aria-label={t('chat.title')}>
      <h2 className="panel__title">{t('chat.title')}</h2>
      <ol className="chat__list" ref={listRef} aria-live="polite">
        {visible.length === 0 && <li className="chat__empty">{t('chat.empty')}</li>}
        {visible.map((m) => (
          <motion.li
            key={m.id}
            className={m.fromId === session?.playerId ? 'chat__msg chat__msg--mine' : 'chat__msg'}
            initial={effects === 'reduced' ? false : { opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.18 }}
          >
            <span className="chat__from">
              {m.fromName}
              {m.isBot && <span className="badge badge--bot">{t('room.bot')}</span>}
            </span>
            <span className="chat__text">{m.text}</span>
          </motion.li>
        ))}
      </ol>
      <form className="chat__form" onSubmit={(e) => void submit(e)}>
        <input
          className="field__input"
          value={text}
          maxLength={CHAT_MAX_LENGTH}
          placeholder={t('chat.placeholder')}
          aria-label={t('chat.placeholder')}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn btn--pink" disabled={!text.trim()}>
          {t('chat.send')}
        </button>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
