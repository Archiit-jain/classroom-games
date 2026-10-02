import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests drive the real client against the real server, on their own
 * ports (server 3101, client 5174) so they never reuse your dev servers, with
 * game phases sped up (GAME_TIME_SCALE). Locally you can use an installed
 * browser instead of downloading one:
 *   PW_CHANNEL=msedge pnpm e2e      (or chrome)
 */
const channel = process.env.PW_CHANNEL;
const isCI = !!process.env.CI;
const SERVER_PORT = 3101;
const CLIENT_PORT = 5174;
const browser = channel ? { channel } : {};

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  workers: 1,
  // Keep the output (traces, screenshots, videos, diagnostics) of failed attempts only.
  preserveOutput: 'failures-only',
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${CLIENT_PORT}`,
    // Evidence from any failed attempt is kept, even when an automatic retry then passes.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], ...browser },
    },
    {
      // Phone-sized touch device. Runs the tests tagged @mobile.
      name: 'mobile',
      grep: /@mobile/,
      use: { ...devices['Pixel 7'], ...browser },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @cg/server exec tsx src/index.ts',
      url: `http://localhost:${SERVER_PORT}/healthz`,
      reuseExistingServer: !isCI,
      timeout: 60_000,
      env: {
        PORT: String(SERVER_PORT),
        ALLOWED_ORIGINS: `http://localhost:${CLIENT_PORT}`,
        GAME_TIME_SCALE: '0.25',
        LOG_LEVEL: 'warn',
      },
    },
    {
      command: `pnpm --filter @cg/client exec vite --port ${CLIENT_PORT} --strictPort`,
      url: `http://localhost:${CLIENT_PORT}`,
      reuseExistingServer: !isCI,
      timeout: 60_000,
      env: { VITE_SERVER_URL: `http://localhost:${SERVER_PORT}` },
    },
  ],
});
