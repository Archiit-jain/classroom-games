import { expect, test, type Page } from '@playwright/test';
import { installDiagnostics } from './diagnostics';
import { NPAT, createRoom, joinRoom, newPlayer } from './helpers';

installDiagnostics(test);

const CATEGORIES = ['name', 'place', 'animal', 'thing', 'food', 'profession'] as const;
/** Format-valid answers for a letter; `tag` makes a player's sheet distinctive. */
const sheet = (letter: string, tag: string) => ({
  name: `${letter}ara`, // the same for everyone: a shared (5-point) answer
  place: `${letter}umble${tag}ton`,
  animal: `${letter}ynx${tag}`,
  thing: `${letter}amp${tag}`,
  food: `${letter}entil${tag}`,
  profession: `${letter}awyer${tag}`,
});

const visible = (page: Page, selector: string) =>
  page
    .locator(selector)
    .count()
    .then((n) => n > 0)
    .catch(() => false);
const letterOf = async (page: Page) =>
  (
    (
      await page
        .locator('.np-letter:not(.np-letter--empty)')
        .allInnerTexts()
        .catch(() => [])
    )[0] ?? ''
  ).trim();
/** Non-waiting read of the sheet's inputs. */
const fields = (page: Page) =>
  page
    .locator('input[data-category]')
    .evaluateAll((els) =>
      (els as HTMLInputElement[]).map((e) => ({
        category: e.dataset.category ?? '',
        value: e.value,
        disabled: e.disabled,
      })),
    )
    .catch(() => []);

interface Player {
  page: Page;
  tag: string;
  stops: boolean;
}

/**
 * Plays every round: each human fills their sheet, the STOP player calls STOP once it
 * opens, everyone taps Done in the review. Returns the number of rounds seen.
 */
async function playUntilResults(players: Player[], onReview?: (round: number) => Promise<void>) {
  const deadline = Date.now() + 170_000;
  const reviewed = new Set<string>();
  let rounds = 0;
  while (Date.now() < deadline) {
    for (const { page, tag, stops } of players) {
      if (await page.getByRole('heading', { name: 'Results' }).isVisible()) return rounds;
      const round =
        (
          await page
            .locator('.np-round')
            .allInnerTexts()
            .catch(() => [])
        )[0] ?? '';
      const letter = await letterOf(page);
      const inputs = await fields(page);
      if (letter && inputs.length === 6 && !inputs[0]?.disabled) {
        const answers = sheet(letter, tag);
        for (const f of inputs) {
          if (f.value === '') {
            await page
              .locator(`input[data-category="${f.category}"]`)
              .fill(answers[f.category as keyof typeof answers], { timeout: 1000 })
              .catch(() => undefined);
          }
        }
        if (stops && (await visible(page, '.np-stop--ready'))) {
          await page
            .locator('.np-stop')
            .click({ force: true, timeout: 1000 })
            .catch(() => undefined);
        }
      }
      if (await visible(page, '.np-review')) {
        const key = `${tag}:${round}`;
        if (!reviewed.has(key)) {
          reviewed.add(key);
          if (tag === 'h') {
            rounds++;
            await onReview?.(rounds);
          }
        }
        const done = page.getByRole('button', { name: 'Done', exact: true });
        if ((await done.count()) > 0 && (await done.isEnabled().catch(() => false))) {
          await done.click({ timeout: 1000 }).catch(() => undefined);
        }
      }
    }
    await players[0]?.page.waitForTimeout(150);
  }
  throw new Error('Name Place Animal Thing did not finish in time');
}

test('Name Place Animal Thing: two humans and a bot write, STOP, vote and reach the podium @mobile', async ({
  browser,
}, testInfo) => {
  test.setTimeout(220_000);
  const mobile = testInfo.project.name === 'mobile';
  const host = await newPlayer(browser, 'Archit');
  const guest = await newPlayer(browser, 'Priya');
  // Everything the guest's browser receives over the WebSocket, for a leak scan.
  const guestFrames: { at: number; data: string }[] = [];
  guest.on('websocket', (ws) =>
    ws.on('framereceived', (frame) =>
      guestFrames.push({ at: Date.now(), data: String(frame.payload) }),
    ),
  );
  // The socket opened before the listener existed: reconnect so every frame is captured.
  await guest.reload();
  await guest.getByLabel('Your nickname').fill('Priya');
  const code = await createRoom(host, NPAT);
  await host.getByLabel('Rounds').selectOption('3');
  await joinRoom(guest, code);
  await expect(guest.getByLabel('Rounds')).toHaveValue('3');
  await host.getByRole('button', { name: 'Add bot' }).click();
  await host.getByRole('button', { name: 'Start game' }).click();

  // Round 1 by hand: the letter appears, Enter moves to the next field, answers stay private.
  for (const page of [host, guest]) await expect(page.locator('.np-letter')).toHaveText(/^[A-Z]$/);
  const letter = await letterOf(host);
  expect(await letterOf(guest)).toBe(letter);
  const name = host.locator('input[data-category="name"]');
  await name.fill(`${letter}ara`);
  await name.press('Enter');
  await expect(host.locator('input[data-category="place"]')).toBeFocused();
  const secret = sheet(letter, 'h').place;
  await host.locator('input[data-category="place"]').fill(secret);
  await expect(host.locator('.np-field--place.np-field--ok')).toBeVisible();
  await host.waitForTimeout(800); // autosaved
  expect(await guest.locator('body').innerText()).not.toContain(secret);

  const rounds = await playUntilResults(
    [
      { page: host, tag: 'h', stops: true },
      { page: guest, tag: 'g', stops: false },
    ],
    async (round) => {
      if (round !== 1) return;
      // The review shows the host's answer to the guest now, and the guest votes on it.
      await expect(guest.locator('.np-row__text', { hasText: secret })).toBeVisible();
      const row = guest.locator('.np-row', { hasText: secret });
      await row.locator('.np-vote').click();
      await expect(row.locator('.np-vote')).toHaveAttribute('aria-pressed', 'true');
      await expect(host.locator('.np-row', { hasText: secret })).toHaveClass(/np-row--out/);
      // No vote button on your own answers.
      await expect(host.locator('.np-row', { hasText: secret }).locator('.np-vote')).toHaveCount(0);
    },
  );
  expect(rounds).toBe(3);
  // Nothing of the host's answer reached the guest's socket before the reveal (the first
  // update in the REVIEW phase), in frame order.
  const reveal = guestFrames.findIndex((f) => f.data.includes('"phase":"REVIEW"'));
  expect(reveal).toBeGreaterThan(0);
  expect(guestFrames.slice(0, reveal).filter((f) => f.data.includes(secret))).toEqual([]);
  expect(guestFrames[reveal]?.data).toContain(secret);
  expect(guestFrames.some((f) => f.data.includes(secret))).toBe(true);

  for (const page of [host, guest]) {
    await expect(page.locator('.results__row')).toHaveCount(3);
    await expect(page.getByRole('columnheader', { name: 'Unique answers' })).toBeVisible();
  }
  if (mobile) {
    const overflow = await guest.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  }
});

test('Name Place Animal Thing fits a 360 px phone while writing and reviewing @mobile', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const page = await newPlayer(browser, 'Meera', {
    viewport: { width: 360, height: 740 },
    hasTouch: true,
    isMobile: true,
  });
  await createRoom(page, NPAT);
  await page.getByRole('button', { name: 'Add bot' }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('.np-letter')).toHaveText(/^[A-Z]$/);
  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  const letter = await letterOf(page);
  for (const [category, value] of Object.entries(sheet(letter, 'm'))) {
    await page.locator(`input[data-category="${category}"]`).fill(value);
  }
  for (const c of CATEGORIES) {
    await expect(page.locator(`.np-field--${c}.np-field--ok`)).toBeVisible();
  }
  // The STOP bar stays reachable at the bottom of the screen.
  const stop = page.locator('.np-stop');
  await expect(stop).toBeEnabled({ timeout: 20_000 });
  const box = await stop.boundingBox();
  expect(box && box.y + box.height).toBeLessThanOrEqual(740);
  await stop.click({ force: true });
  await expect(page.locator('.np-review')).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
});

test('Name Place Animal Thing is playable with reduced motion', async ({ browser }) => {
  test.setTimeout(150_000);
  const host = await newPlayer(browser, 'Kabir', { reducedMotion: 'reduce' });
  await createRoom(host, NPAT);
  await host.getByLabel('Rounds').selectOption('3');
  await host.getByRole('button', { name: 'Add bot' }).click();
  await host.getByRole('button', { name: 'Start game' }).click();
  await expect(host.locator('html')).toHaveAttribute('data-effects', 'reduced');
  // Reduced: the letter is simply shown — no spinning slot, no stamp animation.
  await expect(host.locator('.np-letter')).toHaveText(/^[A-Z]$/);
  expect(await host.locator('.np-ready__slot').count()).toBe(0);
  const transform = await host
    .locator('.np-letter')
    .evaluate((el) => getComputedStyle(el).transform);
  expect(transform).not.toContain('matrix(2'); // not caught mid-"thump"
  const rounds = await playUntilResults([{ page: host, tag: 'h', stops: true }]);
  expect(rounds).toBe(3);
  await expect(host.locator('.results__row')).toHaveCount(2);
  expect(await host.locator('.cb-confetti__piece').count()).toBe(0);
});
