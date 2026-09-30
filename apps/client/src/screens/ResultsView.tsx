import type { RoomView } from '@cg/protocol';
import { t } from '../i18n';
import { useAppState, useConnection } from '../platform/context';

export function ResultsView({ room }: { room: RoomView }) {
  const { session, results } = useAppState();
  const conn = useConnection();
  const isHost = room.hostId === session?.playerId;
  const seats = room.match?.seats ?? [];
  const placements = [
    ...(results?.results.placements ?? room.match?.results?.placements ?? []),
  ].sort((a, b) => a.place - b.place || a.seat - b.seat);

  const act = async (run: () => ReturnType<typeof conn.request>) => {
    const res = await run();
    if (!res.ok) conn.toastError(res);
  };

  return (
    <section className="panel results">
      <h2 className="panel__title">{t('results.title')}</h2>
      <ol className="results__list">
        {placements.map((p) => {
          const seat = seats.find((s) => s.seat === p.seat);
          return (
            <li
              key={p.seat}
              className={p.place === 1 ? 'results__row results__row--first' : 'results__row'}
            >
              <span className="results__place">{t('results.place', { place: p.place })}</span>
              <span className="results__name">{seat?.displayName ?? `#${p.seat}`}</span>
              {seat?.memberKind === 'BOT' && (
                <span className="badge badge--bot">{t('room.bot')}</span>
              )}
            </li>
          );
        })}
      </ol>
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
        <p className="muted">{t('results.waitingForHost')}</p>
      )}
    </section>
  );
}
