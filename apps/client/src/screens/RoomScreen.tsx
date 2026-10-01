import type { RoomView } from '@cg/protocol';
import { accentVar } from '@cg/ui';
import type { CSSProperties } from 'react';
import { ChatPanel } from '../components/ChatPanel';
import { gameClients, gameName } from '../games/registry';
import { t } from '../i18n';
import { useConnection } from '../platform/context';
import { LobbyView } from './LobbyView';
import { MatchView } from './MatchView';
import { ResultsView } from './ResultsView';

export function RoomScreen({ room }: { room: RoomView }) {
  const conn = useConnection();
  const inMatch = room.phase === 'IN_GAME';
  const module = gameClients.get(room.gameId);

  const leave = async () => {
    if (!window.confirm(inMatch ? t('match.confirmLeave') : t('room.confirmLeave'))) return;
    const res = await conn.request('room:leave', {});
    if (!res.ok) conn.toastError(res);
  };

  return (
    <main
      className="room"
      style={module ? ({ '--game-accent': accentVar(module.accent) } as CSSProperties) : undefined}
    >
      <header className="room__header">
        <h1 className="room__title">
          {module && (
            <span className="room__icon" aria-hidden="true">
              <module.Icon size={34} />
            </span>
          )}
          {gameName(room.gameId)}
        </h1>
        <button type="button" className="btn btn--small btn--ghost" onClick={() => void leave()}>
          {inMatch ? t('match.leave') : t('room.leave')}
        </button>
      </header>
      <div className="room__layout">
        <div className="room__main">
          {(room.phase === 'LOBBY' || room.phase === 'STARTING') && <LobbyView room={room} />}
          {room.phase === 'IN_GAME' && <MatchView room={room} />}
          {room.phase === 'RESULTS' && <ResultsView room={room} />}
        </div>
        <aside className="room__side">
          <ChatPanel />
        </aside>
      </div>
    </main>
  );
}
