import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { GameConnection, defaultServerUrl } from './platform/connection';
import { ConnectionProvider } from './platform/context';
import './ui/tokens.css';
import './ui/global.css';

const connection = new GameConnection(defaultServerUrl());

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ConnectionProvider connection={connection}>
      <App />
    </ConnectionProvider>
  </StrictMode>,
);
