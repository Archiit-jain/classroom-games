import { EffectsRoot, Wordmark } from '@cg/ui';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { EffectsToggle } from '../components/EffectsToggle';
import { Toasts } from '../components/Toasts';
import { t } from '../i18n';
import { useAppState, useEffectsSetting } from '../platform/context';
import { HomeScreen } from '../screens/HomeScreen';
import { RoomScreen } from '../screens/RoomScreen';

export function App() {
  const { room, session } = useAppState();
  const { mode } = useEffectsSetting();
  return (
    <EffectsRoot mode={mode}>
      <ErrorBoundary>
        <ConnectionBanner />
        <Toasts />
        <header className="app-header">
          {room ? (
            <span className="app-header__mark">
              <Wordmark top={t('app.wordTop')} main={t('app.wordMain')} size={26} />
            </span>
          ) : (
            <span />
          )}
          <EffectsToggle />
        </header>
        {!session ? (
          <main className="home">
            <div className="home__hero">
              <Wordmark top={t('app.wordTop')} main={t('app.wordMain')} size={72} />
            </div>
            <p className="muted home__loading">{t('app.loading')}</p>
          </main>
        ) : room ? (
          <RoomScreen room={room} />
        ) : (
          <HomeScreen />
        )}
      </ErrorBoundary>
    </EffectsRoot>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('UI error', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <main className="home">
          <p className="form-error">{t('errors.INTERNAL_ERROR')}</p>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => window.location.reload()}
          >
            {t('app.reload')}
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
