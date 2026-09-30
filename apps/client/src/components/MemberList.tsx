import type { MemberView, ReportReason, RoomView } from '@cg/protocol';
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
  const [reporting, setReporting] = useState<string | null>(null);
  const me = session?.playerId;
  const isHost = room.hostId === me;
  const inLobby = room.phase === 'LOBBY';

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
      {room.members.map((member) => {
        const isMe = member.id === me;
        const name = member.kind === 'HUMAN' ? member.nickname : member.name;
        const canRemove = isHost && !isMe && (member.kind === 'HUMAN' || inLobby);
        return (
          <li key={member.id} className="member">
            <span className="member__name">
              {name}
              {isMe && <span className="member__you"> ({t('room.you')})</span>}
            </span>
            <span className="member__badges">
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
          </li>
        );
      })}
    </ul>
  );
}
