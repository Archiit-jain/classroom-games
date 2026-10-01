import { expect, type Browser, type Page } from '@playwright/test';

/** Each browser context has its own storage, so each is a separate anonymous player. */
export async function newPlayer(
  browser: Browser,
  nickname: string,
  contextOptions: Parameters<Browser['newContext']>[0] = {},
): Promise<Page> {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
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
