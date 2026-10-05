import type { MemberView, ReportReason, RoomView } from '@cg/protocol';
import { Avatar, seatAccent, useEffects } from '@cg/ui';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { t } from '../i18n';
import { useAppState, useConnection } from '../platform/context';

const REPORT_OPTIONS: Array<[ReportReason, Parameters<typeof t>[0]]> = [
  ['CHAT', 'room.reportChat'],
  ['NAME', 'room.reportName'],
  ['OTHER', 'room.reportOther'],
];

export function MemberList({ room }: { room: RoomView }) {
  const { session, hidden } = useAppState();
  const conn = useConnection();
  const effects = useEffects();
  const [reporting, setReporting] = useState<string | null>(null);
  const me = session?.playerId;
  const isHost = room.hostId === me;
  const inLobby = room.phase === 'LOBBY';
  // Public rooms show open seats up to their target (bots fill the rest at the start).
  const empty = Math.max(0, (room.public?.targetPlayers ?? room.capacity) - room.members.length);

  const remove = async (member: MemberView) => {
    if (member.kind === 'BOT') {
      const res = await conn.request('room:removeBot', { botId: member.id });
      if (!res.ok) conn.toastError(res);
      return;
    }
    if (!window.confirm(t('room.confirmRemove', { name: member.nickname }))) return;
    const res = await conn.request('room:kick', { playerId: member.id });
    if (!res.ok) conn.toastError(res);
  };

  return (
    <ul className="members">
      <AnimatePresence initial={false}>
        {room.members.map((member, index) => {
          const isMe = member.id === me;
          const name = member.kind === 'HUMAN' ? member.nickname : member.name;
          const canRemove = isHost && !isMe && (member.kind === 'HUMAN' || inLobby);
          return (
            <motion.li
              key={member.id}
              className={isMe ? 'member member--me' : 'member'}
              layout={effects === 'full'}
              initial={effects === 'reduced' ? false : { opacity: 0, x: -24, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.9 }}
              transition={{ type: 'spring', stiffness: 380, damping: 28 }}
            >
              <Avatar name={name} accent={seatAccent(index)} size={40} />
              <span className="member__name">{name}</span>
              <span className="member__badges">
                {isMe && <span className="badge badge--you">{t('room.you')}</span>}
                {member.id === room.hostId && (
                  <span className="badge badge--host">{t('room.host')}</span>
                )}
                {member.kind === 'BOT' && <span className="badge badge--bot">{t('room.bot')}</span>}
                {member.kind === 'HUMAN' && member.status === 'AWAY' && (
                  <span className="badge badge--away">{t('room.away')}</span>
                )}
              </span>
              <span className="member__actions">
                {member.kind === 'HUMAN' && !isMe && (
                  <>
                    <button
                      type="button"
                      className="btn btn--small btn--ghost"
                      onClick={() => conn.toggleHidden(member.id)}
                    >
                      {hidden.includes(member.id) ? t('room.unmute') : t('room.mute')}
                    </button>
                    <button
                      type="button"
                      className="btn btn--small btn--ghost"
                      aria-expanded={reporting === member.id}
                      onClick={() => setReporting(reporting === member.id ? null : member.id)}
                    >
                      {t('room.report')}
                    </button>
                  </>
                )}
                {canRemove && (
                  <button
                    type="button"
                    className="btn btn--small btn--danger"
                    onClick={() => void remove(member)}
                  >
                    {t('room.remove')}
                  </button>
                )}
              </span>
              {reporting === member.id && (
                <span className="member__report">
                  {REPORT_OPTIONS.map(([reason, label]) => (
                    <button
                      key={reason}
                      type="button"
                      className="btn btn--small"
                      onClick={() => {
                        setReporting(null);
                        void conn.report(member.id, reason);
                      }}
                    >
                      {t(label)}
                    </button>
                  ))}
                </span>
              )}
            </motion.li>
          );
        })}
      </AnimatePresence>
      {inLobby &&
        Array.from({ length: empty }, (_, i) => (
          <li key={`empty-${i}`} className="member member--empty" aria-hidden="true">
            <span className="member__ghost" />
            <span className="member__name">{t('room.emptySeat')}</span>
          </li>
        ))}
    </ul>
  );
}
