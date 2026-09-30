import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { Toasts } from '../components/Toasts';
import { t } from '../i18n';
import { useAppState } from '../platform/context';
import { HomeScreen } from '../screens/HomeScreen';
import { RoomScreen } from '../screens/RoomScreen';

export function App() {
  const { room, session } = useAppState();
  return (
    <ErrorBoundary>
      <ConnectionBanner />
      <Toasts />
      {!session ? (
        <main className="home">
          <h1 className="home__title">{t('app.title')}</h1>
          <p className="muted">{t('app.loading')}</p>
        </main>
      ) : room ? (
        <RoomScreen room={room} />
      ) : (
        <HomeScreen />
      )}
    </ErrorBoundary>
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
