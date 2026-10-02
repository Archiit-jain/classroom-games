import { defineConfig, devices } from '@playwright/test';

/**
 * Production smoke test against a deployed site (no local servers are started):
 *   SMOKE_URL=https://<your-deployment>.vercel.app pnpm smoke
 * Without SMOKE_URL it targets a local production-style build on :4300
 * (see docs/DEPLOYMENT.md, "Smoke test").
 */
const channel = process.env.PW_CHANNEL;

export default defineConfig({
  testDir: 'e2e/smoke',
  timeout: 120_000,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    ...(channel ? { channel } : {}),
  },
});
