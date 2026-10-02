import { expect, test, type Page } from '@playwright/test';
import { installDiagnostics } from './diagnostics';
import { DRAW, createRoom, joinRoom, newPlayer } from './helpers';

installDiagnostics(test);

/** Whether the visible canvas has any painted pixel (the paper itself is CSS). */
const hasInk = (page: Page) =>
  page
    .locator('canvas.dg-canvas')
    .evaluateAll((canvases) =>
      canvases.some((node) => {
        const c = node as HTMLCanvasElement;
        const data = c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data;
        if (!data) return false;
        for (let i = 3; i < data.length; i += 4) if ((data[i] as number) > 0) return true;
        return false;
      }),
    )
    .catch(() => false);

/** Draws a zig-zag across this page's canvas with the pointer. */
async function scribble(page: Page): Promise<void> {
  const box = await page.locator('canvas.dg-canvas').boundingBox();
  if (!box) return;
  const at = (fx: number, fy: number) => [box.x + box.width * fx, box.y + box.height * fy] as const;
  await page.mouse.move(...at(0.2, 0.3));
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(...at(0.2 + i * 0.05, i % 2 ? 0.7 : 0.3));
  await page.mouse.up();
}

/**
 * Plays the humans' parts until the results screen: a drawer picks the first card
 * and scribbles; a guesser types the word — read from the drawer's screen, never
 * from its own. Polling uses only non-waiting reads and short-timeout clicks.
 */
async function playUntilResults(pages: Page[]) {
  const drawn = new Set<string>();
  const guessed = new Set<string>();
  let word: string | null = null;
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    for (const page of pages) {
      if (await page.getByRole('heading', { name: 'Results' }).isVisible()) {
        return { drawn: drawn.size, guessed: guessed.size };
      }
      const card = page.locator('.dg-card').first();
      if (await card.isVisible().catch(() => false)) {
        await card.click({ timeout: 2000, force: true }).catch(() => undefined);
        continue;
      }
      if (await page.getByRole('toolbar', { name: 'Drawing tools' }).isVisible()) {
        word = (await page.locator('.dg-word').allInnerTexts())[0]?.trim() ?? word;
        if (word && !drawn.has(word)) {
          drawn.add(word);
          await scribble(page);
        }
        continue;
      }
      const box = page.getByPlaceholder('Type your guess…');
      if (word && drawn.has(word) && !guessed.has(`${word}:${pages.indexOf(page)}`)) {
        if (await box.isVisible()) {
          await box.fill(word, { timeout: 2000 }).catch(() => undefined);
          await box.press('Enter', { timeout: 2000 }).catch(() => undefined);
          guessed.add(`${word}:${pages.indexOf(page)}`);
        }
      }
    }
    await pages[0]?.waitForTimeout(150);
  }
  throw new Error('Draw & Guess did not finish in time');
}

test('Draw & Guess: two humans and a bot draw, guess and reach the podium @mobile', async ({
  browser,
}, testInfo) => {
  test.setTimeout(200_000);
  const mobile = testInfo.project.name === 'mobile';
  const host = await newPlayer(browser, 'Archit');
  const guest = await newPlayer(browser, 'Priya');
  const code = await createRoom(host, DRAW);
  await joinRoom(guest, code);
  await host.getByLabel('Rounds').selectOption('1');
  await host.getByRole('button', { name: 'Add bot' }).click();
  await host.getByRole('button', { name: 'Start game' }).click();

  // The first drawer (the host) gets three cards; the guest only sees who is choosing.
  await expect(host.locator('.dg-card')).toHaveCount(3);
  await expect(guest.getByText('Archit is choosing a word…').first()).toBeVisible();
  await expect(guest.locator('.dg-card')).toHaveCount(0);

  // The host's scribble shows up on the guest's canvas; the guest sees blanks, not the word.
  const picked = (await host.locator('.dg-card__word').allInnerTexts())[0]?.trim() as string;
  await host.locator('.dg-card').first().click({ force: true });
  await expect(host.locator('.dg-word')).toHaveText(picked);
  await expect(guest.getByRole('img', { name: /^Secret word/ })).toBeVisible();
  expect(await guest.locator('.dg-word').count()).toBe(0);
  await scribble(host);
  await expect.poll(() => hasInk(guest), { timeout: 10_000 }).toBe(true);

  // The guest types the word: "Correct!" privately, and the word is never in the chat.
  await guest.getByPlaceholder('Type your guess…').fill(picked);
  await guest.getByPlaceholder('Type your guess…').press('Enter');
  await expect(guest.locator('.dg-word')).toHaveText(picked);
  await expect(host.getByRole('img', { name: 'Guessed it' }).first()).toBeVisible();
  expect(await host.locator('.chat__text', { hasText: picked }).count()).toBe(0);

  const played = await playUntilResults([host, guest]);
  for (const page of [host, guest]) {
    await expect(page.locator('.results__row')).toHaveCount(3);
    await expect(page.getByRole('columnheader', { name: 'Points' })).toBeVisible();
  }
  if (mobile) {
    const overflow = await host.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  }
  testInfo.annotations.push({
    type: 'match',
    description: `${played.drawn} human drawings, ${played.guessed} human guesses`,
  });
});

test('Draw & Guess is playable with reduced motion, and bots draw', async ({ browser }) => {
  test.setTimeout(120_000);
  const host = await newPlayer(browser, 'Meera', { reducedMotion: 'reduce' });
  await createRoom(host, DRAW);
  await host.getByLabel('Rounds').selectOption('1');
  for (let i = 0; i < 2; i++) await host.getByRole('button', { name: 'Add bot' }).click();
  await host.getByRole('button', { name: 'Start game' }).click();
  await expect(host.locator('html')).toHaveAttribute('data-effects', 'reduced');
  await host.locator('.dg-card').first().click({ force: true });
  await expect(host.getByRole('toolbar', { name: 'Drawing tools' })).toBeVisible();
  await host.getByRole('button', { name: 'Red' }).click();
  await scribble(host);
  await expect.poll(() => hasInk(host)).toBe(true);
  await host.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => hasInk(host)).toBe(false);

  // The next turn is a bot's: its template drawing appears on the host's canvas.
  await expect(host.getByRole('img', { name: /^Secret word/ })).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => hasInk(host), { timeout: 15_000 }).toBe(true);
  await expect(host.getByRole('heading', { name: 'Results' })).toBeVisible({ timeout: 60_000 });
  expect(await host.locator('.cb-confetti__piece').count()).toBe(0);
});
