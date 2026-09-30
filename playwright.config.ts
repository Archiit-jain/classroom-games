import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests drive the real client against the real server.
 * Locally you can use an installed browser instead of downloading one:
 *   PW_CHANNEL=msedge pnpm e2e      (or chrome)
 */
const channel = process.env.PW_CHANNEL;
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], ...(channel ? { channel } : {}) },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @cg/server exec tsx src/index.ts',
      url: 'http://localhost:3001/healthz',
      reuseExistingServer: !isCI,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @cg/client dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !isCI,
      timeout: 60_000,
    },
  ],
});
