import { expect, test, type Page } from '@playwright/test';
import { RMCS, createRoom, joinRoom, newPlayer } from './helpers';

/**
 * Plays as a human whenever this page is the Mantri: picks the first suspect,
 * then accuses. Stops when the results screen appears.
 */
async function playRmcsUntilResults(pages: Page[]): Promise<number> {
  let guesses = 0;
  const deadline = Date.now() + 100_000;
  while (Date.now() < deadline) {
    for (const page of pages) {
      if (await page.getByRole('heading', { name: 'Results' }).isVisible()) return guesses;
      const suspect = page.getByRole('button', { name: /^Suspect / }).first();
      if (await suspect.isVisible().catch(() => false)) {
        await suspect.click().catch(() => undefined);
        const accuse = page.getByRole('button', { name: /^Accuse .+!$/ });
        if (await accuse.isVisible().catch(() => false)) {
          await accuse.click().catch(() => undefined);
          guesses++;
        }
      }
    }
    await pages[0]?.waitForTimeout(120);
  }
  throw new Error('RMCS did not finish in time');
}

test('Raja Mantri Chor Sipahi: two humans and two bots play all 10 rounds @mobile', async ({
  browser,
}, testInfo) => {
  const mobile = testInfo.project.name === 'mobile';
  const host = await newPlayer(browser, 'Archit');
  const guest = await newPlayer(browser, 'Priya');

  const code = await createRoom(host, RMCS);
  await joinRoom(guest, code);
  await expect(host.getByText('This game needs exactly 4 players')).toBeVisible();
  await host.getByRole('button', { name: 'Add bot' }).click();
  await host.getByRole('button', { name: 'Add bot' }).click();
  await expect(host.locator('.member', { hasText: 'Bot Chintu' })).toBeVisible();
  await expect(host.getByRole('button', { name: 'Add bot' })).toHaveCount(0); // room is full

  await host.getByRole('button', { name: 'Start game' }).click();

  // Each player sees their own chit…
  for (const page of [host, guest]) {
    await expect(page.getByText('Your chit').first()).toBeVisible();
    await expect(page.getByText(/Round 1\/10/)).toBeVisible();
  }

  // …and only their own role while the chits are being dealt: of the four
  // seat chits on the table, at most one (yours) is face up during DEALING.
  const faceUpDuringDeal = await guest.evaluate(
    () =>
      document.querySelectorAll('.rmcs-seat .cb-chit[aria-label]:not([aria-label="Folded chit"])')
        .length,
  );
  expect(faceUpDuringDeal).toBeLessThanOrEqual(3); // own + possibly revealed Raja/Mantri

  const guesses = await playRmcsUntilResults([host, guest]);
  for (const page of [host, guest]) {
    await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible();
    await expect(page.locator('.results__row')).toHaveCount(4);
    await expect(page.getByRole('columnheader', { name: 'Score' })).toBeVisible();
  }

  // Scores always add up to 10 × 2300 = 23,000 (wait for the counters to finish rolling).
  await expect
    .poll(
      async () => {
        const cells = await host.locator('.results__row .results__num').allTextContents();
        return cells.reduce((sum, text) => sum + Number(text.replace(/[^\d]/g, '')), 0);
      },
      { timeout: 10_000 },
    )
    .toBe(23_000);

  // The page never scrolls sideways on a phone.
  if (mobile) {
    const overflow = await host.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  }
  testInfo.annotations.push({ type: 'human guesses', description: String(guesses) });
});
