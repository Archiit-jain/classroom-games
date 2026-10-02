import { expect, test, type Page } from '@playwright/test';
import { installDiagnostics } from './diagnostics';
import { DOTS, createRoom, joinRoom, newPlayer } from './helpers';

installDiagnostics(test);

const PAD = 0.45;

interface Point {
  x: number;
  y: number;
}

/** Screen position of a grid point (x = column, y = row) on this page's paper. */
async function at(page: Page, n: number, p: Point): Promise<Point | null> {
  const box = await page.locator('.db-paper').boundingBox();
  if (!box) return null;
  const cell = box.width / (n + 2 * PAD);
  return { x: box.x + (PAD + p.x) * cell, y: box.y + (PAD + p.y) * cell };
}

/** Every line's midpoint, in grid order. */
function midpoints(n: number): (Point & { id: string })[] {
  const out: (Point & { id: string })[] = [];
  for (let r = 0; r <= n; r++)
    for (let c = 0; c < n; c++) out.push({ id: `h:${r}:${c}`, x: c + 0.5, y: r });
  for (let r = 0; r < n; r++)
    for (let c = 0; c <= n; c++) out.push({ id: `v:${r}:${c}`, x: c, y: r + 0.5 });
  return out;
}

const drawnLines = async (page: Page) =>
  new Set(
    await page
      .locator('line[data-edge]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-edge'))),
  );

/** Touch (phones) or click (desktop) at a grid point. */
async function tap(page: Page, n: number, p: Point, touch: boolean): Promise<void> {
  const screen = await at(page, n, p);
  if (!screen) return;
  if (touch) await page.touchscreen.tap(screen.x, screen.y);
  else await page.mouse.click(screen.x, screen.y);
}

/** Plays the humans' moves until the results: each draws the next free line on its turn. */
async function playUntilResults(pages: Page[], n: number, touch: boolean): Promise<number> {
  const deadline = Date.now() + 150_000;
  let moves = 0;
  while (Date.now() < deadline) {
    for (const page of pages) {
      if (await page.getByRole('heading', { name: 'Results' }).isVisible()) return moves;
      if ((await page.locator('.db-paper--active').count()) === 0) continue;
      const drawn = await drawnLines(page);
      const next = midpoints(n).find((m) => !drawn.has(m.id));
      if (next) {
        await tap(page, n, next, touch);
        moves++;
      }
    }
    await pages[0]?.waitForTimeout(120);
  }
  throw new Error('Dots & Boxes did not finish in time');
}

test('Dots & Boxes: two humans and a bot play 5×5 to the podium @mobile', async ({
  browser,
}, testInfo) => {
  test.setTimeout(200_000);
  const mobile = testInfo.project.name === 'mobile';
  const host = await newPlayer(browser, 'Archit');
  const guest = await newPlayer(browser, 'Priya');
  const code = await createRoom(host, DOTS);
  await joinRoom(guest, code);
  await expect(guest.getByLabel('Grid')).toHaveValue('5'); // the 5×5 default
  await host.getByRole('button', { name: 'Add bot' }).click();
  await host.getByRole('button', { name: 'Start game' }).click();
  for (const page of [host, guest]) {
    await expect(page.locator('.db-paper')).toBeVisible();
    await expect(page.locator('.db-dot')).toHaveCount(36);
  }

  // A move on one screen appears on the other.
  const active = async () =>
    (await host.locator('.db-paper--active').count()) +
    (await guest.locator('.db-paper--active').count());
  await expect.poll(active, { timeout: 20_000 }).toBeGreaterThan(0);
  const mover = (await host.locator('.db-paper--active').count()) ? host : guest;
  const watcher = mover === host ? guest : host;
  const drawn = await drawnLines(mover);
  const target = midpoints(5).find((m) => !drawn.has(m.id));
  if (target) {
    await tap(mover, 5, target, mobile);
    await expect
      .poll(() => watcher.locator(`line[data-edge="${target.id}"]`).count(), { timeout: 10_000 })
      .toBe(1);
  }

  const moves = await playUntilResults([host, guest], 5, mobile);
  for (const page of [host, guest]) {
    await expect(page.locator('.results__row')).toHaveCount(3);
    await expect(page.getByRole('columnheader', { name: 'Boxes' })).toBeVisible();
  }
  if (mobile) {
    const overflow = await host.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  }
  testInfo.annotations.push({ type: 'match', description: `${moves} human moves` });
});

test('Dots & Boxes 7×7 on a 360 px phone: each touch draws exactly the intended line @mobile', async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'touch precision is a phone test');
  test.setTimeout(150_000);
  const host = await newPlayer(browser, 'Meera', {
    viewport: { width: 360, height: 740 },
    hasTouch: true,
    isMobile: true,
  });
  await createRoom(host, DOTS);
  await host.getByLabel('Grid').selectOption('7');
  await host.getByRole('button', { name: 'Add bot' }).click();
  await host.getByRole('button', { name: 'Start game' }).click();
  await expect(host.locator('.db-dot')).toHaveCount(64);
  let checked = 0;
  const deadline = Date.now() + 100_000;
  while (checked < 15 && Date.now() < deadline) {
    if ((await host.locator('.db-paper--active').count()) === 0) {
      await host.waitForTimeout(120);
      continue;
    }
    const drawn = await drawnLines(host);
    const next = midpoints(7).find((m) => !drawn.has(m.id));
    if (!next) break;
    // A finger lands a little off the line, towards the box beside it.
    const off = next.id.startsWith('h')
      ? { x: next.x + 0.12, y: next.y + 0.18 }
      : { x: next.x + 0.18, y: next.y - 0.12 };
    await tap(host, 7, off, true);
    await expect
      .poll(() => host.locator(`line[data-edge="${next.id}"]`).count(), { timeout: 5000 })
      .toBe(1);
    // Exactly one new line: the intended one (no neighbour was drawn instead).
    const after = await drawnLines(host);
    const added = [...after].filter((id) => !drawn.has(id));
    expect(added[0]).toBe(next.id);
    checked++;
  }
  expect(checked).toBeGreaterThanOrEqual(10);
});

test('Dots & Boxes is playable with reduced motion (the board stays clear)', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const host = await newPlayer(browser, 'Kabir', { reducedMotion: 'reduce' });
  await createRoom(host, DOTS);
  await host.getByLabel('Grid').selectOption('4');
  await host.getByRole('button', { name: 'Add bot' }).click();
  await host.getByRole('button', { name: 'Start game' }).click();
  await expect(host.locator('html')).toHaveAttribute('data-effects', 'reduced');
  await expect(host.locator('.db-dot')).toHaveCount(25);
  await playUntilResults([host], 4, false);
  await expect(host.locator('.results__row')).toHaveCount(2);
  // No drawing animation or confetti ran.
  expect(await host.locator('.db-line--fresh, .cb-confetti__piece').count()).toBe(0);
});
