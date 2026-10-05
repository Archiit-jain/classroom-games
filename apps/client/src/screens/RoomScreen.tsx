import type { RoomView } from '@cg/protocol';
import { accentVar } from '@cg/ui';
import { useEffect, useState, type CSSProperties } from 'react';
import { ChatPanel } from '../components/ChatPanel';
import { gameClients, gameName } from '../games/registry';
import { t } from '../i18n';
import { useConnection, useEffectsSetting } from '../platform/context';
import { LobbyView } from './LobbyView';
import { MatchView } from './MatchView';
import { PublicLobbyView } from './PublicLobbyView';
import { ResultsView } from './ResultsView';

/**
 * True for a short while after a match this player watched ends, so the board can
 * finish its last move and its end-of-game reveal before the results (opt-in per
 * game via `revealMs`). Joining or reconnecting into finished results never holds.
 */
function useRevealHold(room: RoomView, revealMs: number): boolean {
  const matchId = room.match?.matchId ?? null;
  const [seen, setSeen] = useState({ phase: room.phase, matchId, hold: false });
  if (seen.phase !== room.phase || seen.matchId !== matchId) {
    const hold = revealMs > 0 && seen.phase === 'IN_GAME' && room.phase === 'RESULTS';
    setSeen({ phase: room.phase, matchId, hold });
  }
  useEffect(() => {
    if (!seen.hold) return;
    const timer = setTimeout(() => setSeen((s) => ({ ...s, hold: false })), revealMs);
    return () => clearTimeout(timer);
  }, [seen.hold, revealMs]);
  return seen.hold;
}

export function RoomScreen({ room }: { room: RoomView }) {
  const conn = useConnection();
  const inMatch = room.phase === 'IN_GAME';
  const module = gameClients.get(room.gameId);
  const { mode } = useEffectsSetting();
  const holding = useRevealHold(room, module?.revealMs?.(mode) ?? 0);
  // Entering a room (e.g. from a card far down the home screen): start at the top.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [room.id]);

  const publicLobby =
    room.kind === 'PUBLIC' && (room.phase === 'LOBBY' || room.phase === 'STARTING');
  const leave = async () => {
    // Cancelling a public search needs no confirmation; leaving a room or a match does.
    if (!publicLobby && !window.confirm(inMatch ? t('match.confirmLeave') : t('room.confirmLeave')))
      return;
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
        <button
          type="button"
          className="btn btn--small btn--ghost"
          disabled={room.kind === 'PUBLIC' && room.phase === 'STARTING'}
          onClick={() => void leave()}
        >
          {inMatch ? t('match.leave') : publicLobby ? t('public.cancel') : t('room.leave')}
        </button>
      </header>
      <div className="room__layout">
        <div className="room__main">
          {publicLobby && <PublicLobbyView room={room} />}
          {!publicLobby && (room.phase === 'LOBBY' || room.phase === 'STARTING') && (
            <LobbyView room={room} />
          )}
          {(room.phase === 'IN_GAME' || holding) && <MatchView room={room} />}
          {room.phase === 'RESULTS' && !holding && <ResultsView room={room} />}
        </div>
        <aside className="room__side">
          <ChatPanel />
        </aside>
      </div>
    </main>
  );
}
