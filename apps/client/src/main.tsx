import '@cg/ui/styles.css';
import './ui/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { GameConnection, defaultServerUrl } from './platform/connection';
import { PlatformProvider } from './platform/context';
import { EffectsController } from './platform/effects';

const connection = new GameConnection(defaultServerUrl());
const effects = new EffectsController();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <PlatformProvider connection={connection} effects={effects}>
      <App />
    </PlatformProvider>
  </StrictMode>,
);
