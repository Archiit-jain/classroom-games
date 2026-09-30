import { t } from '../i18n';
import { useAppState, useConnection } from '../platform/context';

export function ConnectionBanner() {
  const { connection, slow, serverRestarting } = useAppState();
  const conn = useConnection();

  if (connection === 'displaced') {
    return (
      <div className="banner banner--warn" role="alert">
        <span>{t('connection.displaced')}</span>
        <button type="button" className="btn btn--small" onClick={() => conn.reconnectHere()}>
          {t('connection.useHere')}
        </button>
      </div>
    );
  }
  if (serverRestarting) {
    return (
      <div className="banner banner--warn" role="status">
        {t('connection.restarting')}
      </div>
    );
  }
  if (connection === 'connected') return null;
  const text = slow
    ? t('connection.waking')
    : connection === 'reconnecting'
      ? t('connection.reconnecting')
      : t('connection.connecting');
  return (
    <div className="banner" role="status">
      <span className="spinner" aria-hidden="true" />
      {text}
    </div>
  );
}
