import type { PublicRoomListing } from '@cg/protocol';
import { accentVar, useEffects } from '@cg/ui';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, type CSSProperties } from 'react';
import { gameClients, gameName } from '../games/registry';
import { t } from '../i18n';
import { useAppState, useConnection, useTick } from '../platform/context';

/**
 * The live list of joinable public rooms. The server pushes changes (players joining,
 * countdowns, rooms filling or starting); a room that filled a moment ago is refused by the
 * server and the list refreshes itself.
 */
export function BrowsePanel({
  disabled,
  onJoin,
}: {
  disabled: boolean;
  onJoin(roomId: string): void;
}) {
  const conn = useConnection();
  const { publicRooms } = useAppState();
  const effects = useEffects();
  useTick(500);

  useEffect(() => {
    conn.browse(true);
    return () => conn.browse(false);
  }, [conn]);

  return (
    <section className="browse" aria-labelledby="browse-title" aria-busy={publicRooms === null}>
      <h2 id="browse-title" className="home__section-title">
        {t('public.browseTitle')}
      </h2>
      <p className="muted">{t('public.browseHint')}</p>
      {publicRooms !== null && publicRooms.length === 0 && (
        <p className="browse__empty">{t('public.browseEmpty')}</p>
      )}
      <ul className="browse__list">
        <AnimatePresence initial={false}>
          {(publicRooms ?? []).map((room) => (
            <motion.li
              key={room.roomId}
              layout={effects === 'full'}
              initial={effects === 'reduced' ? false : { opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
            >
              <RoomCard room={room} disabled={disabled} onJoin={() => onJoin(room.roomId)} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </section>
  );
}

function RoomCard({
  room,
  disabled,
  onJoin,
}: {
  room: PublicRoomListing;
  disabled: boolean;
  onJoin(): void;
}) {
  const conn = useConnection();
  const module = gameClients.get(room.gameId);
  const name = gameName(room.gameId);
  const seconds =
    room.state === 'FILLING' && room.fillEndsAt !== null
      ? Math.max(0, Math.ceil(conn.msUntil(room.fillEndsAt) / 1000))
      : null;
  return (
    <article
      className="room-card"
      style={module ? ({ '--accent': accentVar(module.accent) } as CSSProperties) : undefined}
    >
      <span className="room-card__icon" aria-hidden="true">
        {module && <module.Icon size={40} />}
      </span>
      <div className="room-card__body">
        <h3 className="room-card__name">{name}</h3>
        <p className="room-card__desc">{module?.messages.description}</p>
        <div className="room-card__meta">
          <span className="room-card__count">
            {t('public.seats', { humans: room.humans, target: room.targetPlayers })}
          </span>
          <span className={`room-card__state room-card__state--${room.state.toLowerCase()}`}>
            {seconds !== null ? t('public.stateFilling', { seconds }) : t('public.stateWaiting')}
          </span>
        </div>
      </div>
      <button
        type="button"
        className="btn btn--primary"
        disabled={disabled}
        aria-label={t('public.joinLabel', { game: name })}
        onClick={onJoin}
      >
        {t('public.join')}
      </button>
    </article>
  );
}
