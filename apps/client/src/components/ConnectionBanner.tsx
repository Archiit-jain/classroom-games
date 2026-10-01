import { t } from '../i18n';
import { connectionNotice } from '../platform/connectionNotice';
import { useAppState, useConnection } from '../platform/context';

export function ConnectionBanner() {
  const state = useAppState();
  const conn = useConnection();
  const notice = connectionNotice(state, import.meta.env.DEV);

  switch (notice) {
    case null:
      return null;
    case 'displaced':
      return (
        <div className="banner banner--warn" role="alert">
          <span>{t('connection.displaced')}</span>
          <button type="button" className="btn btn--small" onClick={() => conn.reconnectHere()}>
            {t('connection.useHere')}
          </button>
        </div>
      );
    case 'restarting':
      return (
        <div className="banner banner--warn" role="status">
          {t('connection.restarting')}
        </div>
      );
    case 'devServerDown':
    case 'unreachable':
      // Still retrying in the background, but this needs the player's attention.
      return (
        <div className="banner banner--warn" role="alert">
          <span className="spinner" aria-hidden="true" />
          {t(`connection.${notice}`, { url: conn.url })}
        </div>
      );
    default:
      return (
        <div className="banner" role="status">
          <span className="spinner" aria-hidden="true" />
          {t(`connection.${notice}`)}
        </div>
      );
  }
}
