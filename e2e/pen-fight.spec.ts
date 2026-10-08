import { expect, test, type Page } from '@playwright/test';
import { installDiagnostics } from './diagnostics';
import { PEN_FIGHT, createRoom, joinRoom, newPlayer } from './helpers';

installDiagnostics(test);

/** Drags back from this page's own pen and lets go (a slingshot flick). */
async function flick(page: Page, dx = -90, dy = -35): Promise<boolean> {
  const box = await page
    .locator('.pf-pen--mine .pf-pen__barrel')
    .boundingBox({ timeout: 1000 })
    .catch(() => null);
  if (!box) return false;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up();
  return true;
}

/**
 * Flicks for every human whose turn it is until the results screen. Polling uses
 * only non-waiting reads; a flick that misses its turn is simply tried again.
 */
async function playUntilResults(pages: Page[]) {
  let flicks = 0;
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    for (const page of pages) {
      if (await page.getByRole('heading', { name: 'Results' }).isVisible()) return flicks;
      if (await page.getByText('Your flick!').isVisible()) {
        if (await flick(page, -60 - (flicks % 3) * 25, -30 + (flicks % 5) * 15)) flicks++;
      }
    }
    await pages[0]?.waitForTimeout(150);
  }
  throw new Error('Pen Fight did not finish in time');
}

test('Pen Fight: two humans and a bot flick to the podium @mobile', async ({
  browser,
}, testInfo) => {
  test.setTimeout(200_000);
  const mobile = testInfo.project.name === 'mobile';
  const host = await newPlayer(browser, 'Archit');
  const guest = await newPlayer(browser, 'Priya');
  const code = await createRoom(host, PEN_FIGHT);
  await joinRoom(guest, code);
  await host.getByRole('button', { name: 'Add bot' }).click();
  await host.getByRole('button', { name: 'Start game' }).click();

  for (const page of [host, guest]) {
    await expect(page.getByRole('img', { name: /^The desk:/ })).toBeVisible();
    await expect(page.locator('.pf-pen')).toHaveCount(3);
  }
  if (mobile) {
    // Portrait phone: the desk is turned to fill the width (taller than wide).
    const box = await host.locator('.pf-svg').boundingBox();
    expect((box?.height ?? 0) > (box?.width ?? 0)).toBe(true);
  }

  // Whoever aims, the others only see who is aiming and the timer — never their aim.
  const myTurn = (page: Page) => page.getByText('Your flick!').isVisible();
  await expect
    .poll(async () => (await myTurn(host)) || (await myTurn(guest)), { timeout: 30_000 })
    .toBe(true);
  const aimer = (await myTurn(host)) ? host : guest;
  const watcher = aimer === host ? guest : host;
  const box = await aimer.locator('.pf-pen--mine .pf-pen__barrel').boundingBox();
  if (box) {
    await aimer.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await aimer.mouse.down();
    await aimer.mouse.move(box.x + box.width / 2 - 70, box.y + box.height / 2 - 30, { steps: 5 });
    // Immediate (non-waiting) reads: the aim timer is short in end-to-end runs.
    expect(await aimer.locator('.pf-aim').count()).toBe(1);
    expect(await watcher.getByText(/is aiming…/).isVisible()).toBe(true);
    expect(await watcher.locator('.pf-aim').count()).toBe(0);
    await aimer.mouse.up();
    // The replay of the server's simulation plays for both.
    await expect(watcher.getByText(/flicked!/)).toBeVisible();
  }

  const flicks = await playUntilResults([host, guest]);
  for (const page of [host, guest]) {
    await expect(page.locator('.results__row')).toHaveCount(3);
    await expect(page.getByRole('columnheader', { name: 'Knockouts' })).toBeVisible();
  }
  if (mobile) {
    const overflow = await host.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  }
  testInfo.annotations.push({ type: 'match', description: `${flicks} human flicks` });
});

test('Pen Fight is playable with reduced motion (no replay animation)', async ({ browser }) => {
  test.setTimeout(150_000);
  const host = await newPlayer(browser, 'Meera', { reducedMotion: 'reduce' });
  await createRoom(host, PEN_FIGHT);
  await host.getByRole('button', { name: 'Add bot' }).click();
  await host.getByRole('button', { name: 'Start game' }).click();
  await expect(host.locator('html')).toHaveAttribute('data-effects', 'reduced');
  await expect(host.locator('.pf-pen')).toHaveCount(2);

  const flicks = await playUntilResults([host]);
  expect(flicks).toBeGreaterThan(0);
  await expect(host.locator('.results__row')).toHaveCount(2);
  // Nothing flew: no motion ghosts, sparks or confetti were ever drawn.
  expect(await host.locator('.pf-pen--ghost, .pf-spark, .cb-confetti__piece').count()).toBe(0);
});

test('Pen Fight on a phone turned sideways: the whole desk and the controls are on screen @mobile', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const page = await newPlayer(browser, 'Ishaan', {
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
  });
  await createRoom(page, PEN_FIGHT);
  await page.getByRole('button', { name: 'Add bot' }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.getByText('Your flick!')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(500);
  const box = (selector: string) =>
    page.locator(selector).evaluate((e) => {
      const r = e.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    });
  const desk = await box('.pf-svg');
  const controls = await box('.pf-controls');
  // No scrolling needed to aim: the desk fits the screen height, the controls sit beside it.
  expect(desk.top).toBeGreaterThanOrEqual(0);
  expect(desk.bottom).toBeLessThanOrEqual(390);
  expect(controls.left).toBeGreaterThanOrEqual(desk.right);
  expect(controls.bottom).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(844);
  // And a flick from there still lands.
  expect(await flick(page)).toBe(true);
  await expect(page.getByText('Your flick!')).toBeHidden({ timeout: 10_000 });
});
