import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Game packages import React/Motion from their own folders: always use one copy.
    dedupe: ['react', 'react-dom', 'motion'],
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
