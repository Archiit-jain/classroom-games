import type { RoomView } from '@cg/protocol';
import { CountdownRing, durationFor, useEffects } from '@cg/ui';
import { AnimatePresence, motion } from 'motion/react';
import { MemberList } from '../components/MemberList';
import { gameClients } from '../games/registry';
import { t } from '../i18n';
import { useAppState, useConnection, useTick } from '../platform/context';
import { StartingOverlay } from './LobbyView';

/**
 * A public room before its match: the server runs everything (no code, no host). The player
 * sees whether we're waiting for another human or counting down to the start, who is here,
 * and — after waiting alone through the fill window — an offer to play with bots instead.
 */
export function PublicLobbyView({ room }: { room: RoomView }) {
  const conn = useConnection();
  const { session } = useAppState();
  const effects = useEffects();
  useTick(250);
  const pub = room.public;
  const module = gameClients.get(room.gameId);
  if (!pub) return null;
  const humans = room.members.filter((m) => m.kind === 'HUMAN').length;
  const filling = pub.state === 'FILLING' && pub.fillEndsAt !== null;
  const seconds = filling
    ? Math.max(0, Math.ceil(conn.msUntil(pub.fillEndsAt as number) / 1000))
    : 0;
  const lonely =
    pub.state === 'WAITING' &&
    pub.playWithBotsAt !== null &&
    conn.msUntil(pub.playWithBotsAt) <= 0 &&
    room.members.filter((m) => m.kind === 'HUMAN' && m.status === 'CONNECTED').length === 1 &&
    room.members.some((m) => m.id === session?.playerId);

  const playWithBots = async () => {
    const res = await conn.request('public:playWithBots', {});
    if (!res.ok) conn.toastError(res);
  };

  return (
    <div className="public-lobby">
      <section
        className={`panel public-status public-status--${filling ? 'filling' : 'waiting'}`}
        role="status"
        aria-live="polite"
      >
        <span className="public-status__badge">{t('public.publicBadge')}</span>
        <div className="public-status__main">
          {filling ? (
            <CountdownRing
              key={pub.fillEndsAt}
              deadline={pub.fillEndsAt as number}
              totalMs={pub.fillWindowMs}
              msUntil={conn.msUntil}
              size={64}
              urgentMs={4000}
            />
          ) : (
            module && (
              <motion.span
                className="public-status__icon"
                aria-hidden="true"
                animate={
                  effects === 'reduced' ? undefined : { scale: [1, 1.08, 1], rotate: [0, -4, 0] }
                }
                transition={{ duration: durationFor(effects, 1600, 1200) / 1000, repeat: Infinity }}
              >
                <module.Icon size={56} />
              </motion.span>
            )
          )}
          <div className="public-status__text">
            <h2 className="public-status__title">
              {filling ? t('public.filling', { seconds }) : t('public.waiting')}
            </h2>
            <p className="muted">{filling ? t('public.fillingHint') : t('public.waitingHint')}</p>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel__title">{t('public.seats', { humans, target: pub.targetPlayers })}</h2>
        <MemberList room={room} />
      </section>

      <AnimatePresence>
        {lonely && (
          <motion.section
            className="panel public-bots"
            initial={effects === 'reduced' ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <p>{t('public.playWithBotsHint')}</p>
            <button
              type="button"
              className="btn btn--cyan btn--big btn--block"
              onClick={() => void playWithBots()}
            >
              {t('public.playWithBots')}
            </button>
          </motion.section>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {room.phase === 'STARTING' && room.startsAt !== null && (
          <StartingOverlay startsAt={room.startsAt} />
        )}
      </AnimatePresence>
    </div>
  );
}
