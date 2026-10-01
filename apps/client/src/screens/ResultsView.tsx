import type { RoomView, SeatView } from '@cg/protocol';
import { Avatar, ConfettiBurst, RollingNumber, durationFor, seatAccent, useEffects } from '@cg/ui';
import { motion } from 'motion/react';
import { gameClients } from '../games/registry';
import { gameText, t } from '../i18n';
import { useAppState, useConnection } from '../platform/context';

/** Podium order on screen: 2nd, 1st, 3rd. */
const PODIUM_ORDER = [1, 0, 2];

export function ResultsView({ room }: { room: RoomView }) {
  const { session, results } = useAppState();
  const conn = useConnection();
  const effects = useEffects();
  const isHost = room.hostId === session?.playerId;
  const seats = room.match?.seats ?? [];
  const module = gameClients.get(room.gameId);
  const final = results?.results ?? room.match?.results;
  const placements = [...(final?.placements ?? [])].sort(
    (a, b) => a.place - b.place || a.seat - b.seat,
  );
  const stats = (final?.stats ?? {}) as Record<number, Record<string, number>>;
  const columns = module?.resultStats ?? [];
  const seatOf = (seat: number): SeatView | undefined => seats.find((s) => s.seat === seat);
  const winners = placements.filter((p) => p.place === 1);
  const headline =
    winners.length === 1
      ? t('results.winner', { name: seatOf(winners[0]?.seat ?? -1)?.displayName ?? '' })
      : t('results.tie');
  const enter = (i: number) =>
    effects === 'reduced'
      ? {}
      : {
          initial: { opacity: 0, y: 40, scale: 0.9 },
          animate: { opacity: 1, y: 0, scale: 1 },
          transition: {
            type: 'spring' as const,
            stiffness: 260,
            damping: 20,
            delay: effects === 'full' ? 0.15 + i * 0.18 : 0,
          },
        };

  const act = async (run: () => ReturnType<typeof conn.request>) => {
    const res = await run();
    if (!res.ok) conn.toastError(res);
  };

  return (
    <section className="results" aria-labelledby="results-title">
      <div className="results__burst">
        <ConfettiBurst burstKey={placements.length} lite={module?.liteConfetti ?? true} />
      </div>
      <motion.h2
        id="results-title"
        className="results__headline"
        initial={effects === 'reduced' ? false : { scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{
          duration: durationFor(effects, 500, 250) / 1000,
          ease: [0.34, 1.56, 0.64, 1],
        }}
      >
        <span className="results__title">{t('results.title')}</span>
        {headline}
      </motion.h2>

      <div className="podium" aria-hidden="true">
        {PODIUM_ORDER.map((index, i) => {
          const p = placements[index];
          if (!p) return <div key={index} className="podium__slot podium__slot--empty" />;
          const seat = seatOf(p.seat);
          const name = seat?.displayName ?? `#${p.seat + 1}`;
          const primary = columns[0] ? (stats[p.seat]?.[columns[0].key] ?? 0) : null;
          return (
            <motion.div
              key={p.seat}
              className={`podium__slot podium__slot--${Math.min(p.place, 3)}`}
              {...enter(i)}
            >
              <Avatar
                name={name}
                accent={seatAccent(p.seat)}
                size={p.place === 1 ? 64 : 50}
                botLabel={seat?.controller === 'BOT' ? t('room.bot') : undefined}
              />
              <span className="podium__name">{name}</span>
              {primary !== null && (
                <span className="podium__score">
                  <RollingNumber value={primary} durationMs={1400} />
                </span>
              )}
              <div className="podium__block">
                <span className="podium__place">{p.place}</span>
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="panel">
        <table className="results__table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">{t('results.player')}</th>
              {columns.map((c) => (
                <th key={c.key} scope="col" className="results__num">
                  {module ? gameText(module.messages, c.labelKey) : c.key}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {placements.map((p) => {
              const seat = seatOf(p.seat);
              return (
                <tr
                  key={p.seat}
                  className={p.place === 1 ? 'results__row results__row--first' : 'results__row'}
                >
                  <td className="results__place">{t('results.place', { place: p.place })}</td>
                  <td className="results__name">
                    {seat?.displayName ?? `#${p.seat + 1}`}
                    {seat?.memberId === session?.playerId && (
                      <span className="badge badge--you">{t('room.you')}</span>
                    )}
                    {seat?.memberKind === 'BOT' && (
                      <span className="badge badge--bot">{t('room.bot')}</span>
                    )}
                  </td>
                  {columns.map((c) => (
                    <td key={c.key} className="results__num">
                      <RollingNumber value={stats[p.seat]?.[c.key] ?? 0} durationMs={1400} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {isHost ? (
        <div className="results__actions">
          <button
            type="button"
            className="btn btn--primary btn--big"
            onClick={() => void act(() => conn.request('room:playAgain', {}))}
          >
            {t('results.playAgain')}
          </button>
          <button
            type="button"
            className="btn btn--big"
            onClick={() => void act(() => conn.request('room:backToLobby', {}))}
          >
            {t('results.backToLobby')}
          </button>
        </div>
      ) : (
        <p className="lobby__waiting">{t('results.waitingForHost')}</p>
      )}
    </section>
  );
}
