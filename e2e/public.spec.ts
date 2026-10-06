import { expect, test, type Page } from '@playwright/test';
import { installDiagnostics } from './diagnostics';
import { newPlayer } from './helpers';

installDiagnostics(test);

/** The e2e server runs a 4 s fill window (playwright.config.ts). */
const START_TIMEOUT = 30_000;

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const playGame = (page: Page, game: string) =>
  page.getByRole('button', { name: `Play ${game} with people online` }).click();
/** Names of everyone (humans and bots) in the room as this page shows them. */
const memberNames = (page: Page) =>
  page.locator('.member:not(.member--empty) .member__name').allInnerTexts();

test('Quick Play on two devices: same room, bots fill, the match starts @mobile', async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const a = await newPlayer(browser, 'Archit');
  const b = await newPlayer(browser, 'Priya');
  // A fresh device has no last game: Quick Play means "any game".
  await a.getByRole('button', { name: /^Quick Play/ }).click();
  await expect(a.locator('.public-lobby')).toBeVisible();
  await expect(a.locator('.public-status')).toContainText('Waiting for another player');
  await expect(a.getByTestId('room-code')).toHaveCount(0); // no codes, no host controls
  await expect(a.getByRole('button', { name: 'Start game' })).toHaveCount(0);
  await b.getByRole('button', { name: /^Quick Play/ }).click();
  for (const page of [a, b]) {
    await expect(page.locator('.public-status')).toContainText('Starting soon');
  }
  expect((await memberNames(b)).sort()).toEqual((await memberNames(a)).sort());
  // The window ends: bots take the open seats and both screens enter the same match.
  for (const page of [a, b]) {
    await expect(page.locator('.match')).toBeVisible({ timeout: START_TIMEOUT });
  }
  if (testInfo.project.name === 'mobile') expect(await overflow(b)).toBeLessThanOrEqual(0);
  // That game is now this device's Quick Play game.
  const game = (await a.locator('.room__title').innerText()).trim();
  a.once('dialog', (d) => void d.accept());
  await a.getByRole('button', { name: 'Leave game' }).click();
  await expect(a.getByRole('button', { name: /^Quick Play/ })).toContainText(game);
});

for (const [game, target, board] of [
  ['Business', 6, '.bz-board'],
  ['Name Place Animal Thing', 8, '.match'],
] as const) {
  test(`${game}: two players pick it, bots fill to ${target}, the game starts`, async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const a = await newPlayer(browser, 'Kabir');
    const b = await newPlayer(browser, 'Meera');
    await playGame(a, game);
    await expect(a.locator('.public-lobby')).toBeVisible();
    await expect(a.locator('.panel__title').filter({ hasText: /\/\d+ players/ })).toContainText(
      `/${target} players`,
    );
    await playGame(b, game);
    for (const page of [a, b]) {
      await expect(page.locator(board)).toBeVisible({ timeout: START_TIMEOUT });
      await expect(page.locator('.room__title')).toContainText(game);
    }
  });
}

test('Browse: a room shows up live and can be joined; reconnecting keeps the seat', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const a = await newPlayer(browser, 'Ishaan');
  const b = await newPlayer(browser, 'Zoya');
  await b.getByRole('button', { name: 'Browse games' }).click();
  await expect(b.locator('.browse')).toBeVisible();
  await playGame(a, 'Pen Fight');
  // The new room appears in b's list without any refresh.
  const card = b.locator('.room-card').filter({ hasText: 'Pen Fight' }).first();
  await expect(card).toBeVisible();
  await expect(card).toContainText('/4 players');
  await card.getByRole('button', { name: 'Join Pen Fight' }).click();
  await expect(b.locator('.public-lobby')).toBeVisible();
  await expect(a.locator('.public-status')).toContainText('Starting soon');
  // b drops (reload) during the fill window and comes back to the same room.
  await b.reload();
  await expect(b.locator('.room__title')).toContainText('Pen Fight');
  for (const page of [a, b]) {
    await expect(page.locator('.match')).toBeVisible({ timeout: START_TIMEOUT });
  }
  // And again during the match: the same seat and board come back.
  await b.reload();
  await expect(b.locator('.match')).toBeVisible({ timeout: 15_000 });
});

test('a full room takes nobody else: a fifth player gets a different room', async ({ browser }) => {
  test.setTimeout(120_000);
  const players = await Promise.all(
    ['Anu', 'Bela', 'Chet', 'Dev'].map((name) => newPlayer(browser, name)),
  );
  for (const p of players) await playGame(p, 'Dots & Boxes');
  // Four humans = the target: the match starts without bots.
  for (const p of players)
    await expect(p.locator('.match')).toBeVisible({ timeout: START_TIMEOUT });
  const fifth = await newPlayer(browser, 'Esha');
  await playGame(fifth, 'Dots & Boxes');
  await expect(fifth.locator('.public-lobby')).toBeVisible();
  const names = await memberNames(fifth);
  expect(names).toContain('Esha');
  for (const n of ['Anu', 'Bela', 'Chet', 'Dev']) expect(names).not.toContain(n);
});
