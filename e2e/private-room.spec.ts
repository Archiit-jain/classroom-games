import { expect, test, type Page } from '@playwright/test';
import { FIXTURE, createRoom, joinRoom, newPlayer } from './helpers';
import { installDiagnostics } from './diagnostics';

installDiagnostics(test);

/** Clicks "+3" whenever it is this player's turn, until the results screen appears. */
async function playUntilResults(pages: Page[]): Promise<void> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    for (const page of pages) {
      const results = page.getByRole('heading', { name: 'Results' });
      if (await results.isVisible()) return;
      const plusThree = page.getByRole('button', { name: '+3' });
      if ((await plusThree.isVisible()) && (await plusThree.isEnabled())) await plusThree.click();
    }
    await pages[0]?.waitForTimeout(150);
  }
  throw new Error('The match did not finish in time');
}

test('two players and a bot play a full private match', async ({ browser }) => {
  const host = await newPlayer(browser, 'Archit');
  const guest = await newPlayer(browser, 'Priya');

  const code = await createRoom(host, FIXTURE);
  await joinRoom(guest, code);
  await expect(host.locator('.member', { hasText: 'Priya' })).toBeVisible();

  await host.getByRole('button', { name: 'Add bot' }).click();
  await expect(guest.locator('.member', { hasText: 'Bot Tiku' })).toBeVisible();

  // Chat is censored before the other player sees it.
  await host.getByPlaceholder('Say something nice…').fill('you are stupid');
  await host.getByRole('button', { name: 'Send' }).click();
  await expect(guest.getByText('you are ******')).toBeVisible();

  await expect(guest.getByText('Waiting for the host to start the game…')).toBeVisible();
  await host.getByRole('button', { name: 'Start game' }).click();
  await expect(host.getByText('Your secret number')).toBeVisible();
  await expect(guest.getByText('Your secret number')).toBeVisible();

  await playUntilResults([host, guest]);
  await expect(host.getByRole('heading', { name: 'Results' })).toBeVisible();
  await expect(guest.getByRole('heading', { name: 'Results' })).toBeVisible();
  await expect(host.locator('.results__row')).toHaveCount(3);
  await expect(guest.getByText('Waiting for the host…')).toBeVisible();

  await host.getByRole('button', { name: 'Back to lobby' }).click();
  await expect(guest.getByText('Waiting for the host to start the game…')).toBeVisible();
});

test('a guest who reloads the page returns to the same room', async ({ browser }) => {
  const host = await newPlayer(browser, 'Host');
  const guest = await newPlayer(browser, 'Guest');
  const code = await createRoom(host, FIXTURE);
  await joinRoom(guest, code);

  await guest.reload();
  await expect(guest.getByTestId('room-code')).toHaveText(code);
  await expect(host.locator('.member', { hasText: 'Guest' })).not.toContainText('away');
});

test('friendly errors for a wrong code and a disallowed nickname', async ({ browser }) => {
  const page = await newPlayer(browser, 'Tester');
  await page.getByLabel('Room code', { exact: true }).fill('ZZZZZZ');
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'No room with that code. Check the code and try again.',
  );

  await page.getByLabel('Your nickname').fill('Bot Fake');
  await page.getByRole('button', { name: `Create room: ${FIXTURE}` }).click();
  await expect(page.getByRole('alert')).toHaveText('That nickname isn’t allowed. Try another one.');
});

test('the home screen fits a 360 px phone without horizontal scrolling @mobile', async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Create room: / }).first()).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
