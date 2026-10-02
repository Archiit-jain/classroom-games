import { expect, test, type Browser, type Page } from '@playwright/test';
import { watchPlayer } from './diagnostics';

/** Each browser context has its own storage, so each is a separate anonymous player. */
export async function newPlayer(
  browser: Browser,
  nickname: string,
  contextOptions: Parameters<Browser['newContext']>[0] = {},
): Promise<Page> {
  // Players use their own contexts, which the config's `video` option does not cover, so
  // record here (in CI, or locally with E2E_VIDEO=1 — video needs Playwright's ffmpeg).
  // Only failed tests keep their output (`preserveOutput` in the config).
  const video = !!process.env.CI || process.env.E2E_VIDEO === '1';
  const context = await browser.newContext({
    ...(video ? { recordVideo: { dir: test.info().outputPath('videos') } } : {}),
    ...contextOptions,
  });
  const page = await context.newPage();
  watchPlayer(page, nickname);
  // E2E_CPU_THROTTLE=4 slows each page's CPU (Chromium), to run locally closer to a CI machine.
  const throttle = Number(process.env.E2E_CPU_THROTTLE ?? 0);
  if (throttle > 1) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  }
  await page.goto('/');
  const nameInput = page.getByLabel('Your nickname');
  await expect(nameInput).toBeVisible();
  await nameInput.fill(nickname);
  return page;
}

/** Creates a private room for the game whose card is named `gameName`. Returns the code. */
export async function createRoom(host: Page, gameName: string | RegExp): Promise<string> {
  await host
    .getByRole('button', {
      name: typeof gameName === 'string' ? `Create room: ${gameName}` : gameName,
    })
    .click();
  const code = host.getByTestId('room-code');
  await expect(code).toHaveText(/^[A-Z0-9]{6}$/);
  return (await code.textContent()) ?? '';
}

export async function joinRoom(page: Page, code: string): Promise<void> {
  await page.getByLabel('Room code', { exact: true }).fill(code);
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page.getByTestId('room-code')).toHaveText(code);
}

export const FIXTURE = 'Count Up (dev fixture)';
export const RMCS = 'Raja Mantri Chor Sipahi';
export const PARCHI = '16 Parchi';
export const DRAW = 'Draw & Guess';
