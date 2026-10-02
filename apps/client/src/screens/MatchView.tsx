import type { BoardChat, BoardReaction, BoardSafety, BoardStream } from '@cg/game-sdk/client';
import type { RoomView } from '@cg/protocol';
import { Suspense, useMemo } from 'react';
import { ReactionBar } from '../components/ReactionBar';
import { gameClients } from '../games/registry';
import { t } from '../i18n';
import {
  useAppState,
  useConnection,
  useEffectsSetting,
  usePresentedMatch,
} from '../platform/context';
import { REACTION_EMOJI } from '../platform/reactions';

export function MatchView({ room }: { room: RoomView }) {
  const { session, reactions, chat, hidden } = useAppState();
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
  const stream = useMemo<BoardStream>(
    () => ({
      send: (chunk) => conn.sendStream(chunk),
      subscribe: (listener) => conn.subscribeStream(listener),
    }),
    [conn],
  );
  const boardChat = useMemo<BoardChat>(
    () => ({
      messages: chat.filter((m) => !hidden.includes(m.fromId)),
      send: async (text) => {
        const res = await conn.request('chat:send', { text });
        if (!res.ok) conn.toastError(res);
        return res.ok;
      },
    }),
    [chat, hidden, conn],
  );
  const safety = useMemo<BoardSafety>(
    () => ({
      hidden,
      toggleHidden: (memberId) => conn.toggleHidden(memberId),
      report: (memberId, reason) => void conn.report(memberId, reason),
    }),
    [hidden, conn],
  );
  const boardReactions = useMemo<BoardReaction[]>(
    () =>
      reactions.map((r) => ({
        key: String(r.key),
        seat: r.seat,
        emoji: REACTION_EMOJI[r.reactionId],
        label: t(`reactions.${r.reactionId}`),
      })),
    [reactions],
  );

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
            reactions={module?.reactions ? boardReactions : []}
            stream={stream}
            chat={boardChat}
            safety={safety}
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
      {module?.reactions && mySeat && current && <ReactionBar />}
    </div>
  );
}
