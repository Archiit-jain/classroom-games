import { expect, test, type Page } from '@playwright/test';
import { PARCHI, createRoom, joinRoom, newPlayer } from './helpers';

/**
 * Plays like a person: whenever this page may pass a slip it taps the last one
 * (the hand is grouped biggest first), and it claims a full set as soon as the
 * CLAIM button appears. Stops when the results screen appears.
 */
async function playUntilResults(pages: Page[]): Promise<{ picks: number; claims: number }> {
  const done = { picks: 0, claims: 0 };
  const deadline = Date.now() + 100_000;
  while (Date.now() < deadline) {
    for (const page of pages) {
      if (await page.getByRole('heading', { name: 'Results' }).isVisible()) return done;
      const claim = page.getByRole('button', { name: 'Claim your full set' });
      if (await claim.isVisible().catch(() => false)) {
        // The button pulses in full effects; force skips the wait-until-still check.
        await claim.click({ force: true, timeout: 2000 }).catch(() => undefined);
        done.claims++;
        continue;
      }
      const desk = await page
        .locator('.sp-desk__inner')
        .innerText()
        .catch(() => '');
      const slips = page.locator('.sp-hand__slip:not([disabled])');
      if (desk.includes('Pick a slip') && (await slips.count()) > 0) {
        await slips
          .last()
          .click({ timeout: 2000 })
          .catch(() => undefined);
        done.picks++;
      }
    }
    await pages[0]?.waitForTimeout(100);
  }
  throw new Error('16 Parchi did not finish in time');
}

test('16 Parchi: two humans and two bots pass, claim and reach the podium @mobile', async ({
  browser,
}, testInfo) => {
  const mobile = testInfo.project.name === 'mobile';
  const host = await newPlayer(browser, 'Archit');
  const guest = await newPlayer(browser, 'Priya');

  const code = await createRoom(host, PARCHI);
  await host.getByRole('combobox', { name: 'Category' }).selectOption('fruits');
  await joinRoom(guest, code);
  await expect(guest.getByRole('combobox', { name: 'Category' })).toHaveValue('fruits');
  await host.getByRole('button', { name: 'Add bot' }).click();
  await host.getByRole('button', { name: 'Add bot' }).click();
  await expect(host.getByRole('button', { name: 'Add bot' })).toHaveCount(0); // room is full
  await host.getByRole('button', { name: 'Start game' }).click();

  for (const page of [host, guest]) {
    await expect(page.getByLabel('Your slips')).toBeVisible();
    await expect(page.locator('.sp-category')).toContainText('Fruits');
    // Four open slips in your own hand…
    await expect
      .poll(
        async () =>
          (await page.locator('.sp-hand__slip').count()) +
          (await page.locator('.sp-spot.is-filled').count()),
      )
      .toBe(4);
    // …and nothing but folded slips at the other seats.
    expect(await page.locator('.sp-seat:not(.is-me) .sp-slip[data-folded="false"]').count()).toBe(
      0,
    );
  }

  // A quick reaction pops over the sender's seat on the other player's screen.
  if (await guest.getByRole('button', { name: 'React', exact: true }).isVisible()) {
    await guest.getByRole('button', { name: 'React', exact: true }).click();
  }
  await guest.getByRole('button', { name: 'React: On fire' }).click();
  await expect(host.locator('.sp-seat .cb-reaction__bubble[aria-label="On fire"]')).toBeVisible();

  const played = await playUntilResults([host, guest]);
  expect(played.picks).toBeGreaterThan(0);
  for (const page of [host, guest]) {
    await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible();
    await expect(page.locator('.results__row')).toHaveCount(4);
    const places = await page.locator('.results__row td:first-child').allTextContents();
    expect(places.map((p) => p.trim())).toEqual(['#1', '#2', '#3', '#4']);
  }

  if (mobile) {
    expect(host.viewportSize()?.width ?? 0).toBeLessThan(500);
    const overflow = await host.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  }
  testInfo.annotations.push({
    type: 'human moves',
    description: `${played.picks} picks, ${played.claims} claims`,
  });
});

test('16 Parchi is fully playable with reduced motion', async ({ browser }) => {
  const host = await newPlayer(browser, 'Meera', { reducedMotion: 'reduce' });
  await createRoom(host, PARCHI);
  for (let i = 0; i < 3; i++) await host.getByRole('button', { name: 'Add bot' }).click();
  await host.getByRole('button', { name: 'Start game' }).click();
  await expect(host.locator('html')).toHaveAttribute('data-effects', 'reduced');
  await expect(host.getByLabel('Your slips')).toBeVisible();

  const played = await playUntilResults([host]);
  expect(played.picks).toBeGreaterThan(0);
  await expect(host.locator('.results__row')).toHaveCount(4);
  // No confetti and no flying slips in reduced motion.
  expect(await host.locator('.cb-confetti__piece').count()).toBe(0);
  expect(await host.locator('.sp-flight').count()).toBe(0);
});
