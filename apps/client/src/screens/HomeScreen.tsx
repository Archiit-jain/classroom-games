import { NICKNAME_MAX_LENGTH, ROOM_CODE_LENGTH } from '@cg/protocol';
import { useState, type FormEvent } from 'react';
import { randomNameSuggestion } from '../content/nameSuggestions';
import { gameClients } from '../games/registry';
import { errorMessage, t } from '../i18n';
import type { ClientAck } from '../platform/connection';
import { useAppState, useConnection } from '../platform/context';
import { KEYS, storage } from '../platform/storage';

export function HomeScreen() {
  const { session, games, connection } = useAppState();
  const conn = useConnection();
  const [nickname, setNickname] = useState(
    () => session?.nickname ?? storage.get(KEYS.nickname) ?? randomNameSuggestion(),
  );
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const playable = games.filter((g) => gameClients.has(g.id));
  const connected = connection === 'connected';

  /** Sets the nickname if needed, then runs the room request. */
  const withNickname = async (run: () => Promise<ClientAck<unknown>>) => {
    setBusy(true);
    setError(null);
    try {
      if (session?.nickname !== nickname.trim()) {
        const res = await conn.setNickname(nickname);
        if (!res.ok) return setError(errorMessage(res.code, res.retryAfterMs));
      }
      const res = await run();
      if (!res.ok) setError(errorMessage(res.code, res.retryAfterMs));
    } finally {
      setBusy(false);
    }
  };

  const create = () => {
    const game = playable[0];
    if (game) void withNickname(() => conn.request('room:create', { gameId: game.id }));
  };

  const join = (e: FormEvent) => {
    e.preventDefault();
    void withNickname(() => conn.request('room:join', { code }));
  };

  return (
    <main className="home">
      <header className="home__header">
        <h1 className="home__title">{t('app.title')}</h1>
        <p className="home__tagline">{t('app.tagline')}</p>
      </header>

      <section className="panel">
        <label className="field">
          <span className="field__label">{t('home.nicknameLabel')}</span>
          <span className="field__row">
            <input
              className="field__input"
              value={nickname}
              maxLength={NICKNAME_MAX_LENGTH + 8}
              autoComplete="nickname"
              onChange={(e) => setNickname(e.target.value)}
            />
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setNickname(randomNameSuggestion(nickname))}
            >
              {t('home.suggest')}
            </button>
          </span>
          <span className="field__hint">{t('home.nicknameHint')}</span>
        </label>
      </section>

      <div className="home__actions">
        <section className="panel">
          <h2 className="panel__title">{t('home.createTitle')}</h2>
          {playable.length === 0 && connected ? (
            <p className="muted">{t('home.noGames')}</p>
          ) : (
            <button
              type="button"
              className="btn btn--primary btn--big btn--block"
              disabled={!connected || busy || playable.length === 0}
              onClick={create}
            >
              {t('home.createButton')}
            </button>
          )}
        </section>

        <section className="panel">
          <h2 className="panel__title">{t('home.joinTitle')}</h2>
          <form className="field__row" onSubmit={join}>
            <input
              className="field__input field__input--code"
              value={code}
              maxLength={ROOM_CODE_LENGTH + 4}
              placeholder={t('home.codePlaceholder')}
              aria-label={t('home.codeLabel')}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <button
              type="submit"
              className="btn btn--primary"
              disabled={!connected || busy || !code.trim()}
            >
              {t('home.joinButton')}
            </button>
          </form>
        </section>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
