import { expect, test, type Page } from '@playwright/test';
import { installDiagnostics } from './diagnostics';
import { BUSINESS, createRoom, joinRoom, newPlayer } from './helpers';

installDiagnostics(test);

const visible = (page: Page, selector: string) =>
  page
    .locator(selector)
    .count()
    .then((n) => n > 0)
    .catch(() => false);
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
/** Spaces owned on this page's board (non-waiting read). */
const owned = (page: Page) =>
  page
    .locator('.bz-tile--owned')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-space')))
    .catch(() => [] as (string | null)[]);

/**
 * Plays until the results: roll on your turn, accept every offer (buy, build or the
 * Start expansion). Returns how many offers were accepted.
 */
async function playUntilResults(pages: Page[], onBuy?: (page: Page) => Promise<void>) {
  const deadline = Date.now() + 200_000;
  let accepted = 0;
  while (Date.now() < deadline) {
    for (const page of pages) {
      if (await page.getByRole('heading', { name: 'Results' }).isVisible()) return accepted;
      if (await visible(page, '.bz-roll:not([disabled])')) {
        await page
          .locator('.bz-roll')
          .click({ timeout: 1000 })
          .catch(() => undefined);
        continue;
      }
      const yes = page
        .locator('.bz-actions .btn--yellow:not([disabled]), .bz-option:not([disabled])')
        .first();
      if ((await yes.count()) > 0) {
        const clicked = await yes
          .click({ timeout: 1000 })
          .then(() => true)
          .catch(() => false);
        if (clicked) {
          accepted++;
          if (accepted === 1) await onBuy?.(page);
        }
      }
    }
    await pages[0]?.waitForTimeout(150);
  }
  throw new Error('Business did not finish in time');
}

test('Business: two humans and a bot roll, buy and build to the podium @mobile', async ({
  browser,
}, testInfo) => {
  test.setTimeout(260_000);
  const mobile = testInfo.project.name === 'mobile';
  const host = await newPlayer(browser, 'Archit');
  const guest = await newPlayer(browser, 'Priya');
  const code = await createRoom(host, BUSINESS);
  await host.getByLabel('Rounds').selectOption('12');
  await joinRoom(guest, code);
  await expect(guest.getByLabel('Rounds')).toHaveValue('12');
  await host.getByRole('button', { name: 'Add bot' }).click();
  await host.getByRole('button', { name: 'Start game' }).click();
  for (const page of [host, guest]) {
    await expect(page.locator('.bz-tile')).toHaveCount(28);
    await expect(page.locator('.bz-player')).toHaveCount(3);
  }

  const accepted = await playUntilResults([host, guest], async (buyer) => {
    // A purchase on one screen shows as owned on the other.
    const other = buyer === host ? guest : host;
    await expect
      .poll(async () => (await owned(other)).length, { timeout: 10_000 })
      .toBeGreaterThan(0);
    expect((await owned(other)).sort()).toEqual((await owned(buyer)).sort());
  });
  expect(accepted).toBeGreaterThan(0);
  for (const page of [host, guest]) {
    await expect(page.locator('.results__row')).toHaveCount(3);
    await expect(page.getByRole('columnheader', { name: 'Wealth' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Cities' })).toBeVisible();
  }
  if (mobile) expect(await overflow(guest)).toBeLessThanOrEqual(0);
});

for (const [label, viewport] of [
  ['a 360 px phone', { width: 360, height: 740 }],
  ['a landscape phone', { width: 844, height: 390 }],
] as const) {
  test(`Business fits ${label} from the first roll to the results @mobile`, async ({ browser }) => {
    test.setTimeout(220_000);
    const page = await newPlayer(browser, 'Meera', { viewport, isMobile: true, hasTouch: true });
    await createRoom(page, BUSINESS);
    await page.getByLabel('Rounds').selectOption('12');
    await page.getByRole('button', { name: 'Add bot' }).click();
    await page.getByRole('button', { name: 'Start game' }).click();
    await expect(page.locator('.bz-tile')).toHaveCount(28);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    // Every tile is at least big enough to tap.
    const smallest = await page
      .locator('.bz-tile')
      .evaluateAll((els) => Math.min(...els.map((e) => Math.min(e.clientWidth, e.clientHeight))));
    expect(smallest).toBeGreaterThanOrEqual(28);
    // Tapping a tile shows its postcard (it stays up for the rest of this turn).
    await expect(page.locator('.bz-roll')).toBeVisible({ timeout: 20_000 });
    await page.locator('.bz-tile[data-space="27"]').click();
    await expect(page.locator('.bz-postcard__name')).toHaveText('Mumbai');
    await playUntilResults([page]);
    await expect(page.locator('.results__row')).toHaveCount(2);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
}

test('Business is playable with reduced motion: every change is in the log', async ({
  browser,
}) => {
  test.setTimeout(220_000);
  const host = await newPlayer(browser, 'Kabir', { reducedMotion: 'reduce' });
  await createRoom(host, BUSINESS);
  await host.getByLabel('Rounds').selectOption('12');
  await host.getByRole('button', { name: 'Add bot' }).click();
  await host.getByRole('button', { name: 'Start game' }).click();
  await expect(host.locator('html')).toHaveAttribute('data-effects', 'reduced');
  await host.locator('.bz-roll').click();
  await expect(host.locator('.bz-log__item').first()).toContainText(/rolled \d \+ \d/u);
  await playUntilResults([host]);
  await expect(host.locator('.results__row')).toHaveCount(2);
  expect(await host.locator('.cb-confetti__piece').count()).toBe(0);
});
