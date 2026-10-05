import type { RoomView } from '@cg/protocol';
import { durationFor, useEffects } from '@cg/ui';
import { AnimatePresence, motion } from 'motion/react';
import { Suspense, useState } from 'react';
import { MemberList } from '../components/MemberList';
import { gameClients, gameName } from '../games/registry';
import { t } from '../i18n';
import { useAppState, useConnection, useTick } from '../platform/context';

export function LobbyView({ room }: { room: RoomView }) {
  const { session, games } = useAppState();
  const conn = useConnection();
  const [copied, setCopied] = useState(false);
  const isHost = room.hostId === session?.playerId;
  const module = gameClients.get(room.gameId);
  const SettingsForm = module?.Settings;
  const info = games.find((g) => g.id === room.gameId);
  const playable = games.filter((g) => gameClients.has(g.id));
  const canStart = room.members.length >= room.minPlayers;
  const exact = room.minPlayers === room.capacity;

  const act = async (run: () => ReturnType<typeof conn.request>) => {
    const res = await run();
    if (!res.ok) conn.toastError(res);
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.code ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the code is still visible */
    }
  };

  return (
    <div className="lobby">
      {room.code && (
        <section className="ticket lobby__ticket" aria-label={t('room.codeLabel')}>
          <span className="lobby__ticket-label">{t('room.codeLabel')}</span>
          <div className="lobby__ticket-row">
            <strong className="lobby__code" data-testid="room-code">
              {room.code}
            </strong>
            <button type="button" className="btn btn--small" onClick={() => void copyCode()}>
              {copied ? t('room.copied') : t('room.copy')}
            </button>
          </div>
          <p className="lobby__ticket-hint">{t('room.shareHint')}</p>
        </section>
      )}

      <section className="panel">
        <h2 className="panel__title">{t('room.game')}</h2>
        {isHost && playable.length > 1 ? (
          <select
            className="field__input"
            value={room.gameId}
            aria-label={t('room.game')}
            onChange={(e) =>
              void act(() => conn.request('room:setGame', { gameId: e.target.value }))
            }
          >
            {playable.map((g) => (
              <option key={g.id} value={g.id}>
                {gameName(g.id)}
              </option>
            ))}
          </select>
        ) : (
          <p className="lobby__game">{gameName(room.gameId)}</p>
        )}
        {module && <p className="muted">{module.messages.description}</p>}
        {SettingsForm && (
          <>
            <h3 className="panel__subtitle">{t('room.settings')}</h3>
            <Suspense fallback={null}>
              <SettingsForm
                settings={room.settings}
                editable={isHost && room.phase === 'LOBBY'}
                onChange={(settings) =>
                  void act(() =>
                    conn.request('room:updateSettings', {
                      settings: settings as Record<string, unknown>,
                    }),
                  )
                }
              />
            </Suspense>
          </>
        )}
      </section>

      <section className="panel">
        <h2 className="panel__title">
          {t('room.players', { count: room.members.length, capacity: room.capacity })}
        </h2>
        <MemberList room={room} />
        {isHost &&
          room.phase === 'LOBBY' &&
          info?.supportsBots &&
          room.members.length < room.capacity && (
            <button
              type="button"
              className="btn btn--cyan"
              onClick={() => void act(() => conn.request('room:addBot', {}))}
            >
              {t('room.addBot')}
            </button>
          )}
      </section>

      <section className="lobby__start">
        {isHost ? (
          <>
            <button
              type="button"
              className="btn btn--primary btn--big btn--block"
              disabled={!canStart || room.phase !== 'LOBBY'}
              onClick={() => void act(() => conn.request('room:start', {}))}
            >
              {t('room.start')}
            </button>
            {!canStart && (
              <p className="muted">
                {exact
                  ? t('room.needExactly', { count: room.capacity })
                  : t('room.needPlayers', { min: room.minPlayers })}
              </p>
            )}
          </>
        ) : (
          <p className="lobby__waiting">{t('room.waitingForHost')}</p>
        )}
      </section>

      <AnimatePresence>
        {room.phase === 'STARTING' && room.startsAt !== null && (
          <StartingOverlay startsAt={room.startsAt} />
        )}
      </AnimatePresence>
    </div>
  );
}

export function StartingOverlay({ startsAt }: { startsAt: number }) {
  const conn = useConnection();
  const effects = useEffects();
  useTick(100);
  const seconds = Math.max(1, Math.ceil(conn.msUntil(startsAt) / 1000));
  const d = durationFor(effects, 450, 200) / 1000;
  return (
    <motion.div
      className="overlay"
      role="status"
      aria-live="assertive"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: d / 2 }}
    >
      <span className="sr-only">{t('room.startingIn', { seconds })}</span>
      <AnimatePresence mode="popLayout">
        <motion.span
          key={seconds}
          className="countdown-number"
          aria-hidden="true"
          initial={effects === 'reduced' ? false : { scale: 2.4, opacity: 0, rotate: -12 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          exit={{ scale: 0.4, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 18 }}
        >
          {seconds}
        </motion.span>
      </AnimatePresence>
    </motion.div>
  );
}
