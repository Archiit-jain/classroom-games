import type { RoomView } from '@cg/protocol';
import { Suspense } from 'react';
import { gameClients } from '../games/registry';
import { t } from '../i18n';
import { useAppState, useConnection, useEffectsMode } from '../platform/context';

export function MatchView({ room }: { room: RoomView }) {
  const { match, session } = useAppState();
  const conn = useConnection();
  const effects = useEffectsMode();
  const module = gameClients.get(room.gameId);
  const mySeat = room.match?.seats.find(
    (s) => s.memberId === session?.playerId && s.memberKind === 'HUMAN',
  );
  const Board = module?.Board;

  const reclaim = async () => {
    const res = await conn.request('room:reclaimSeat', {});
    if (!res.ok) conn.toastError(res);
  };

  return (
    <div className="match">
      {mySeat?.takeover?.reason === 'IDLE' && (
        <div className="banner banner--warn" role="alert">
          <span>{t('match.botPlaying')}</span>
          <button
            type="button"
            className="btn btn--small btn--primary"
            onClick={() => void reclaim()}
          >
            {t('match.imBack')}
          </button>
        </div>
      )}
      <section className="panel match__board">
        {Board && match && room.match ? (
          <Suspense fallback={<p className="muted">{t('match.loadingBoard')}</p>}>
            <Board
              view={match.view}
              events={match.events}
              version={match.version}
              me={match.you}
              seats={room.match.seats}
              effects={effects}
              msUntil={conn.msUntil}
              send={async (action) => {
                const res = await conn.sendAction(action);
                if (!res.ok) conn.toastError(res);
                return res.ok;
              }}
            />
          </Suspense>
        ) : (
          <p className="muted">{t('match.loadingBoard')}</p>
        )}
      </section>
    </div>
  );
}
