import type { RoomView } from '@cg/protocol';
import { Suspense } from 'react';
import { gameClients } from '../games/registry';
import { t } from '../i18n';
import {
  useAppState,
  useConnection,
  useEffectsSetting,
  usePresentedMatch,
} from '../platform/context';

export function MatchView({ room }: { room: RoomView }) {
  const { session } = useAppState();
  const conn = useConnection();
  const { mode } = useEffectsSetting();
  const module = gameClients.get(room.gameId);
  // The animation director paces updates so each one's events can play out.
  const match = usePresentedMatch(module, mode);
  const mySeat = room.match?.seats.find(
    (s) => s.memberId === session?.playerId && s.memberKind === 'HUMAN',
  );
  const Board = module?.Board;
  const current = match && room.match && match.matchId === room.match.matchId ? match : null;

  const reclaim = async () => {
    const res = await conn.request('room:reclaimSeat', {});
    if (!res.ok) conn.toastError(res);
  };

  return (
    <div className="match">
      {mySeat?.takeover?.reason === 'IDLE' && (
        <div className="banner banner--warn" role="alert">
          <span>{t('match.botPlaying')}</span>
          <button type="button" className="btn btn--small btn--pink" onClick={() => void reclaim()}>
            {t('match.imBack')}
          </button>
        </div>
      )}
      {Board && current && room.match ? (
        <Suspense fallback={<p className="muted">{t('match.loadingBoard')}</p>}>
          <Board
            view={current.view}
            events={current.events}
            version={current.version}
            me={current.you}
            seats={room.match.seats}
            effects={mode}
            msUntil={conn.msUntil}
            send={async (action) => {
              const res = await conn.sendAction(action);
              // A duplicate means this exact intent was already sent: nothing to report.
              if (!res.ok && res.code !== 'DUPLICATE_ACTION') conn.toastError(res);
              return res.ok;
            }}
          />
        </Suspense>
      ) : (
        <p className="muted">{t('match.loadingBoard')}</p>
      )}
    </div>
  );
}
