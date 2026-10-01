import type { AnyGameClientModule } from '@cg/game-sdk/client';
import { NICKNAME_MAX_LENGTH, ROOM_CODE_LENGTH, type GameInfo } from '@cg/protocol';
import { Wordmark, accentVar, durationFor, useEffects } from '@cg/ui';
import { motion } from 'motion/react';
import { useState, type CSSProperties, type FormEvent } from 'react';
import { randomNameSuggestion } from '../content/nameSuggestions';
import { gameClients } from '../games/registry';
import { errorMessage, t } from '../i18n';
import type { ClientAck } from '../platform/connection';
import { useAppState, useConnection } from '../platform/context';
import { KEYS, storage } from '../platform/storage';

export function HomeScreen() {
  const { session, games, connection } = useAppState();
  const conn = useConnection();
  const effects = useEffects();
  const [nickname, setNickname] = useState(
    () => session?.nickname ?? storage.get(KEYS.nickname) ?? randomNameSuggestion(),
  );
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const connected = connection === 'connected';
  const playable = [...gameClients.values()].flatMap((module) => {
    const info = games.find((g) => g.id === module.id);
    return info ? [{ module, info }] : [];
  });

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

  const join = (e: FormEvent) => {
    e.preventDefault();
    void withNickname(() => conn.request('room:join', { code }));
  };

  const enter = (i: number) =>
    effects === 'reduced'
      ? {}
      : {
          initial: { opacity: 0, y: 24, scale: 0.96 },
          animate: { opacity: 1, y: 0, scale: 1 },
          transition: {
            duration: durationFor(effects, 450, 220) / 1000,
            delay: effects === 'full' ? 0.08 * i : 0,
            ease: [0.22, 1, 0.36, 1] as const,
          },
        };

  return (
    <main className="home">
      <motion.header className="home__hero" {...enter(0)}>
        <h1 className="sr-only">{t('app.title')}</h1>
        <Wordmark top={t('app.wordTop')} main={t('app.wordMain')} size={76} />
        <p className="home__tagline">{t('app.tagline')}</p>
      </motion.header>

      <motion.div className="home__nametag" {...enter(1)}>
        <div className="nametag">
          <div className="nametag__head">
            <span className="nametag__hello">{t('home.hello')}</span>
            <span className="nametag__sub">{t('home.myNameIs')}</span>
          </div>
          <div className="nametag__body">
            <input
              className="nametag__input"
              value={nickname}
              maxLength={NICKNAME_MAX_LENGTH + 8}
              autoComplete="nickname"
              aria-label={t('home.nicknameLabel')}
              aria-describedby="nickname-hint"
              onChange={(e) => setNickname(e.target.value)}
            />
            <button
              type="button"
              className="btn btn--small btn--cyan"
              onClick={() => setNickname(randomNameSuggestion(nickname))}
            >
              {t('home.suggest')}
            </button>
          </div>
        </div>
        <span id="nickname-hint" className="field__hint home__hint">
          {t('home.nicknameHint')}
        </span>
      </motion.div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <section className="home__section" aria-labelledby="pick-title">
        <motion.div {...enter(2)}>
          <h2 id="pick-title" className="home__section-title">
            {t('home.pickTitle')}
          </h2>
          <p className="muted">{t('home.pickHint')}</p>
        </motion.div>
        {playable.length === 0 && connected ? (
          <p className="muted">{t('home.noGames')}</p>
        ) : (
          <div className="game-grid">
            {playable.map(({ module, info }, i) => (
              <motion.div key={module.id} {...enter(3 + i)}>
                <GameCard
                  module={module}
                  info={info}
                  disabled={!connected || busy}
                  onCreate={() =>
                    void withNickname(() => conn.request('room:create', { gameId: module.id }))
                  }
                />
              </motion.div>
            ))}
          </div>
        )}
      </section>

      <motion.section
        className="join-card"
        aria-labelledby="join-title"
        {...enter(4 + playable.length)}
      >
        <h2 id="join-title" className="home__section-title">
          {t('home.joinTitle')}
        </h2>
        <form className="join-card__row" onSubmit={join}>
          <input
            className="field__input join-card__input"
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
            className="btn btn--pink"
            disabled={!connected || busy || !code.trim()}
          >
            {t('home.joinButton')}
          </button>
        </form>
      </motion.section>
    </main>
  );
}

function GameCard({
  module,
  info,
  disabled,
  onCreate,
}: {
  module: AnyGameClientModule;
  info: GameInfo;
  disabled: boolean;
  onCreate(): void;
}) {
  const name = module.messages.name ?? module.id;
  const players =
    info.minPlayers === info.maxPlayers
      ? t('home.playersExact', { count: info.minPlayers })
      : t('home.players', { min: info.minPlayers, max: info.maxPlayers });
  return (
    <article
      className="game-card"
      style={{ '--accent': accentVar(module.accent) } as CSSProperties}
    >
      <div className="game-card__art" aria-hidden="true">
        <module.Icon size={64} />
      </div>
      <div className="game-card__body">
        <h3 className="game-card__name">{name}</h3>
        <p className="game-card__desc">{module.messages.description}</p>
        <span className="game-card__meta">{players}</span>
      </div>
      <button
        type="button"
        className="btn btn--primary btn--block"
        disabled={disabled}
        aria-label={`${t('home.createButton')}: ${name}`}
        onClick={onCreate}
      >
        {t('home.createButton')}
      </button>
    </article>
  );
}
