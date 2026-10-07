import { expect, test, type Page } from '@playwright/test';
import { installDiagnostics } from './diagnostics';
import { BUSINESS, createRoom, joinRoom, newPlayer } from './helpers';

installDiagnostics(test);

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
/** Spaces owned on this page's board (non-waiting read). */
const owned = (page: Page) =>
  page
    .locator('.bz-tile--owned')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-space')))
    .catch(() => [] as (string | null)[]);
const tryClick = (page: Page, locator: ReturnType<Page['locator']>) =>
  locator
    .click({ timeout: 800 })
    .then(() => true)
    .catch(() => false);
const enabled = (locator: ReturnType<Page['locator']>) =>
  locator.isEnabled({ timeout: 30 }).catch(() => false);
/** Where this page's own pawn stands right now (CSS left/top of the token). */
const myToken = (page: Page) =>
  page
    .locator('.bz-token--me')
    .evaluate((el) => `${(el as HTMLElement).style.left}|${(el as HTMLElement).style.top}`)
    .catch(() => '');

/**
 * Rolls and watches the pawn: it must pass through intermediate spaces (no teleport),
 * and no landing decision may show while it is still moving.
 */
async function rollAndWatch(page: Page) {
  const positions: string[] = [];
  let decisionWhileMoving = false;
  await page.getByRole('button', { name: 'Roll the dice' }).click();
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const at = await myToken(page);
    if (at && positions.at(-1) !== at) positions.push(at);
    const moving = (await page.locator('.bz-token--me.bz-token--moving').count()) > 0;
    if (moving && (await page.getByRole('button', { name: /^BUY|^BUILD/ }).count()) > 0)
      decisionWhileMoving = true;
    if (!moving && positions.length > 1) break;
    await page.waitForTimeout(40);
  }
  return { positions, decisionWhileMoving };
}

async function setRounds(page: Page, rounds: number) {
  const input = page.getByLabel('Rounds', { exact: true });
  await input.fill(String(rounds));
  await input.blur();
  await expect(input).toHaveValue(String(rounds));
}

interface Seen {
  bought: number;
  built: number;
  events: number;
}

/**
 * Plays until the results: roll on your turn, buy whatever you land on, build one level,
 * wait out Jail, let the bank settle debts, decline trades.
 */
async function playUntilResults(
  pages: Page[],
  onBuy?: (page: Page) => Promise<void>,
): Promise<Seen> {
  const deadline = Date.now() + 420_000;
  const seen: Seen = { bought: 0, built: 0, events: 0 };
  while (Date.now() < deadline) {
    for (const page of pages) {
      if (await page.getByRole('heading', { name: 'Results' }).isVisible()) return seen;
      if ((await page.locator('.bz-event').count()) > 0) seen.events++;
      const roll = page.getByRole('button', { name: /Roll the dice|Roll for/ });
      if (await enabled(roll)) {
        await tryClick(page, roll);
        continue;
      }
      const buy = page.getByRole('button', { name: /^BUY/ });
      if (await enabled(buy)) {
        if (await tryClick(page, buy)) {
          seen.bought++;
          if (seen.bought === 1) await onBuy?.(page);
        }
        continue;
      }
      const build = page.locator('.bz-tray .btn--primary', { hasText: /house|hotel/i }).first();
      if (await enabled(build)) {
        if (await tryClick(page, build)) seen.built++;
        continue;
      }
      for (const name of [
        /Don’t buy|Not now|^Done$/,
        /Lose your next roll/,
        /Let the bank handle it/,
        /^Decline$/,
      ]) {
        const b = page.getByRole('button', { name }).first();
        if (await enabled(b)) {
          await tryClick(page, b);
          break;
        }
      }
    }
    await pages[0]?.waitForTimeout(150);
  }
  throw new Error('Business did not finish in time');
}

async function expectResults(page: Page, players: number) {
  await expect(page.locator('.results__row')).toHaveCount(players);
  for (const name of ['Final wealth', 'Cash', 'Properties', 'Houses & hotels', 'Transport']) {
    await expect(page.getByRole('columnheader', { name, exact: true })).toBeVisible();
  }
}

test('Business: two humans and a bot play to the podium; boards stay in sync @mobile', async ({
  browser,
}, testInfo) => {
  test.setTimeout(480_000);
  const mobile = testInfo.project.name === 'mobile';
  const host = await newPlayer(browser, 'Archit');
  const guest = await newPlayer(browser, 'Priya');
  const code = await createRoom(host, BUSINESS);
  await setRounds(host, 5);
  await joinRoom(guest, code);
  await expect(guest.getByLabel('Rounds', { exact: true })).toHaveValue('5');
  await host.getByRole('button', { name: 'Add bot' }).click();
  await host.getByRole('button', { name: 'Start game' }).click();
  for (const page of [host, guest]) {
    await expect(page.locator('.bz-tile')).toHaveCount(36);
    await expect(page.locator('.bz-player')).toHaveCount(3);
    // Your own identity is always marked.
    await expect(page.locator('.bz-player--me .bz-you')).toBeVisible();
    await expect(page.locator('.bz-token--me')).toHaveCount(1);
    await expect(page.locator('.bz-banner')).toContainText(/YOUR TURN|’S TURN/);
  }
  // The (tilted) board takes taps: a tile opens its card. It closes itself when your own next
  // turn starts, so open it during your own turn.
  const hostTurn = host.getByRole('button', { name: 'Roll the dice' });
  for (let k = 0; k < 120 && !(await enabled(hostTurn)); k++) {
    const guestRoll = guest.getByRole('button', { name: /Roll the dice|Roll for/ });
    if (await enabled(guestRoll)) await tryClick(guest, guestRoll);
    for (const name of [/Don’t buy|Not now/, /Lose your next roll/, /Let the bank handle it/]) {
      const b = guest.getByRole('button', { name }).first();
      if (await enabled(b)) await tryClick(guest, b);
    }
    await host.waitForTimeout(250);
  }
  await expect(hostTurn).toBeEnabled();
  await host.locator('.bz-tile[data-space="35"]').click();
  await expect(host.locator('.bz-card__name')).toHaveText('Delhi');
  await host.getByRole('button', { name: 'Close' }).click();
  await expect(host.locator('.bz-card')).toHaveCount(0);
  // The pawn walks space by space (a roll is at least 2): never a jump to the destination.
  const walk = await rollAndWatch(host);
  expect(walk.positions.length, walk.positions.join(' → ')).toBeGreaterThanOrEqual(3);
  expect(walk.decisionWhileMoving).toBe(false);

  const seen = await playUntilResults([host, guest], async (buyer) => {
    // MY PROPERTIES lists it, by group, with the group progress.
    await buyer.getByRole('button', { name: /My properties · \d/ }).click();
    const panel = buyer.locator('.bz-holdings--open');
    await expect(panel).toContainText('MY PROPERTIES');
    await expect(panel.locator('.bz-hcard')).toHaveCount(1);
    await expect(panel).toContainText(/NORTH\s*\d \/ 6/);
    await expect(panel).toContainText(/TRANSPORT\s*\d \/ 6/);
    await buyer.locator('.bz-holdings__close').click();
    await expect(panel).toHaveCount(0);
    // A purchase on one screen shows as owned on the other.
    const other = buyer === host ? guest : host;
    await expect
      .poll(async () => (await owned(other)).length, { timeout: 10_000 })
      .toBeGreaterThan(0);
    // Compared afresh on every attempt: others (the bot) keep buying meanwhile.
    await expect
      .poll(async () => (await owned(other)).sort().join() === (await owned(buyer)).sort().join(), {
        timeout: 10_000,
      })
      .toBe(true);
  });
  expect(seen.bought).toBeGreaterThan(0);
  for (const page of [host, guest]) await expectResults(page, 3);
  if (mobile) expect(await overflow(guest)).toBeLessThanOrEqual(0);
});

test('Business: loan, auction and trade between two players', async ({ browser }) => {
  test.setTimeout(300_000);
  const host = await newPlayer(browser, 'Kabir');
  const guest = await newPlayer(browser, 'Meera');
  const code = await createRoom(host, BUSINESS);
  await setRounds(host, 5);
  await joinRoom(guest, code);
  await host.getByRole('button', { name: 'Start game' }).click();
  await expect(host.locator('.bz-tile')).toHaveCount(36);

  // Play until the host owns something and it is the host's roll again.
  const deadline = Date.now() + 200_000;
  const hostRoll = host.getByRole('button', { name: 'Roll the dice' });
  while (Date.now() < deadline) {
    if ((await host.locator('.bz-tile--mine').count()) > 0 && (await enabled(hostRoll))) break;
    for (const page of [host, guest]) {
      const roll = page.getByRole('button', { name: /Roll the dice|Roll for/ });
      if (await enabled(roll)) await tryClick(page, roll);
      const buy = page.getByRole('button', { name: /^BUY/ });
      // Only the host buys, so the guest keeps its cash for the auction.
      if (page === host && (await enabled(buy))) await tryClick(page, buy);
      for (const name of [/Don’t buy|Not now/, /Lose your next roll/, /Let the bank handle it/]) {
        const b = page.getByRole('button', { name }).first();
        if (await enabled(b)) await tryClick(page, b);
      }
    }
    await host.waitForTimeout(150);
  }
  await expect(hostRoll).toBeEnabled();

  // A loan: cash up by ₹5,000, debt ₹5,500 shown on the player card.
  await host.getByRole('button', { name: 'Loan', exact: true }).click();
  await host.getByRole('button', { name: 'Borrow ₹5,000' }).click();
  await expect(host.locator('.bz-player--me .bz-debt')).toContainText('₹5,500');
  await expect(guest.locator('.bz-log')).toContainText('borrowed ₹5,000');

  // An auction: the guest wins the host's first property.
  const space = (await owned(host))[0] as string;
  await host.getByRole('button', { name: 'Auction', exact: true }).click();
  await host
    .getByRole('button', { name: /^Auction / })
    .first()
    .click();
  // Auctions run 15 s (3.75 s at the e2e time scale): bid straight away.
  await guest.locator('.bz-auction .btn--primary').first().click();
  await expect(host.locator('.bz-auction__note')).toBeVisible(); // the seller can't bid
  await expect(host.locator('.bz-auction__bid')).toContainText('Meera');
  await expect
    .poll(async () => (await owned(guest)).includes(space), { timeout: 30_000 })
    .toBe(true);
  await expect(host.locator(`.bz-tile[data-space="${space}"]`)).not.toHaveClass(/bz-tile--mine/);

  // A trade: the host offers ₹500 for nothing; the guest accepts.
  await expect(hostRoll).toBeEnabled({ timeout: 20_000 });
  await host.getByRole('button', { name: 'Trade', exact: true }).click();
  await host.locator('.bz-trade input[type=number]').first().fill('500');
  await host.getByRole('button', { name: 'Send offer' }).click();
  await expect(guest.locator('.bz-offer')).toContainText('₹500');
  await guest.getByRole('button', { name: 'Accept' }).click();
  await expect(host.locator('.bz-log')).toContainText('YOU and Meera traded');

  await playUntilResults([host, guest]);
  for (const page of [host, guest]) await expectResults(page, 2);
});

test('Business: six players (two humans, four bots) finish with events on the board', async ({
  browser,
}) => {
  test.setTimeout(600_000);
  const host = await newPlayer(browser, 'Ishaan');
  const guest = await newPlayer(browser, 'Zoya');
  const code = await createRoom(host, BUSINESS);
  await setRounds(host, 8);
  await joinRoom(guest, code);
  for (let k = 0; k < 4; k++) await host.getByRole('button', { name: 'Add bot' }).click();
  await host.getByRole('button', { name: 'Start game' }).click();
  await expect(host.locator('.bz-player')).toHaveCount(6);
  await expect(host.locator('.bz-token')).toHaveCount(6);
  const seen = await playUntilResults([host, guest]);
  await expectResults(host, 6);
  // Over 48 turns somebody lands on Chance / Community Chest (≈ 99.7 %) and the card shows.
  expect(seen.events).toBeGreaterThan(0);
});

for (const [label, viewport] of [
  ['a 360 px phone', { width: 360, height: 740 }],
  ['a landscape phone', { width: 844, height: 390 }],
] as const) {
  test(`Business fits ${label} from the first roll to the results @mobile`, async ({ browser }) => {
    test.setTimeout(420_000);
    const page = await newPlayer(browser, 'Meera', { viewport, isMobile: true, hasTouch: true });
    await createRoom(page, BUSINESS);
    // The lobby's settings are styled before the board (and its stylesheet) ever loaded:
    // − / rounds / + sit on one row (they used to stack, unstyled).
    await expect(page.locator('.bz-stepper > *')).toHaveCount(3);
    const stepper = await page
      .locator('.bz-stepper > *')
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
    expect(stepper).toHaveLength(3);
    const [minus, box, plus] = stepper as [DOMRect, DOMRect, DOMRect];
    expect(minus.right).toBeLessThanOrEqual(box.left);
    expect(box.right).toBeLessThanOrEqual(plus.left);
    await setRounds(page, 5);
    await page.getByRole('button', { name: 'Add bot' }).click();
    await page.getByRole('button', { name: 'Start game' }).click();
    await expect(page.locator('.bz-tile')).toHaveCount(36);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    // The camera zooms in: every tile is big enough to tap.
    const smallest = await page
      .locator('.bz-tile')
      .evaluateAll((els) => Math.min(...els.map((e) => Math.min(e.clientWidth, e.clientHeight))));
    expect(smallest).toBeGreaterThanOrEqual(28);
    // Tapping a tile opens its card; it stays until closed (or your next turn: tap on your turn).
    await expect(page.getByRole('button', { name: 'Roll the dice' })).toBeEnabled({
      timeout: 30_000,
    });
    // Start was tapped low in the lobby: the game opens at the top, not on the chat.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    // On your turn nothing covers the board's own buttons (the tray used to, on phones).
    for (const name of [/My properties · \d/, /See whole board/]) {
      const button = page.getByRole('button', { name }).first();
      const hit = await button.evaluate((el) => {
        const r = el.getBoundingClientRect();
        el.scrollIntoView({ block: 'nearest' });
        const r2 = el.getBoundingClientRect();
        const top = document.elementFromPoint(r2.left + r2.width / 2, r2.top + r2.height / 2);
        return { reachable: !!top && (top === el || el.contains(top)), width: r.width };
      });
      expect(hit.reachable, `${String(name)} is covered`).toBe(true);
    }
    if (viewport.height < 500) {
      // A phone on its side: the actions sit beside the board, not under it.
      const board = await page.locator('.bz-viewport').boundingBox();
      const tray = await page.locator('.bz-tray').boundingBox();
      expect(tray && board && tray.x).toBeGreaterThanOrEqual((board?.x ?? 0) + (board?.width ?? 0));
    }
    await page.locator('.bz-tile[data-space="33"]').click();
    await expect(page.locator('.bz-card__name')).toHaveText('Mumbai');
    await page.getByRole('button', { name: 'Close' }).click({ timeout: 10_000 });
    await expect(page.locator('.bz-card')).toHaveCount(0);
    // The whole board on one screen, and back.
    await page.getByRole('button', { name: 'See whole board' }).click();
    await expect(page.locator('.bz-viewport--zoom')).toHaveCount(0);
    await page.getByRole('button', { name: 'Follow the play' }).click();
    await expect(page.locator('.bz-viewport--zoom')).toHaveCount(1);
    // MY PROPERTIES opens as a bottom sheet without leaving the game.
    await page.getByRole('button', { name: /My properties · \d/ }).click();
    await expect(page.locator('.bz-holdings--open')).toContainText('NORTH');
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.locator('.bz-holdings__close').click();
    await playUntilResults([page]);
    await expectResults(page, 2);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    // Five stat columns on a phone: no label or value is squeezed into a column one letter
    // wide ("F / I / N / A / L…" on Android Chrome). Each stays at most two lines tall.
    const cells = await page
      .locator('.results__table th:visible, .results__num:visible')
      .evaluateAll((els) =>
        els
          // On phones the header row is hidden from sight (kept for screen readers).
          .filter((e) => {
            const head = e.closest('thead');
            return !head || getComputedStyle(head).clipPath === 'none';
          })
          .map((e) => ({
            text: e.textContent,
            height: e.getBoundingClientRect().height,
            width: e.getBoundingClientRect().width,
          })),
      );
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(cell.height, `${cell.text} is ${Math.round(cell.height)} px tall`).toBeLessThan(64);
      expect(cell.width, `${cell.text} is ${Math.round(cell.width)} px wide`).toBeGreaterThan(24);
    }
  });
}

test('Business is playable with reduced motion: every change is in the log', async ({
  browser,
}) => {
  test.setTimeout(420_000);
  const host = await newPlayer(browser, 'Kabir', { reducedMotion: 'reduce' });
  await createRoom(host, BUSINESS);
  await setRounds(host, 5);
  await host.getByRole('button', { name: 'Add bot' }).click();
  await host.getByRole('button', { name: 'Start game' }).click();
  await expect(host.locator('html')).toHaveAttribute('data-effects', 'reduced');
  const roll = host.getByRole('button', { name: 'Roll the dice' });
  await expect(roll).toBeEnabled({ timeout: 30_000 });
  // Reduced motion still walks the pawn space by space (movement is gameplay).
  const walk = await rollAndWatch(host);
  expect(walk.positions.length, walk.positions.join(' → ')).toBeGreaterThanOrEqual(3);
  expect(walk.decisionWhileMoving).toBe(false);
  await expect(host.locator('.bz-log')).toContainText(/rolled \d \+ \d/u);
  await playUntilResults([host]);
  await expectResults(host, 2);
  expect(await host.locator('.cb-confetti__piece').count()).toBe(0);
});

test('Business scripted: insolvency without elimination, then a hotel built level by level', async ({
  browser,
}) => {
  // The scripted server (playwright.config.ts): every roll is 6 + 6 (spaces 12, 24, START, 12…),
  // start cash ₹10,000, rent 3× the price, no loan base.
  test.setTimeout(300_000);
  const scenario = { baseURL: 'http://localhost:5175' };
  const host = await newPlayer(browser, 'Kabir', scenario);
  const guest = await newPlayer(browser, 'Meera', scenario);
  const code = await createRoom(host, BUSINESS);
  await setRounds(host, 5);
  await joinRoom(guest, code);
  await host.getByRole('button', { name: 'Start game' }).click();
  const pages = [host, guest];
  // The first player buys Thiruvananthapuram (12); the second lands there and can't pay.
  let debtor: Page | null = null;
  const deadline = Date.now() + 60_000;
  while (!debtor && Date.now() < deadline) {
    for (const page of pages) {
      const roll = page.getByRole('button', { name: 'Roll the dice' });
      if (await enabled(roll)) await tryClick(page, roll);
      const buy = page.getByRole('button', { name: /^BUY/ });
      if (await enabled(buy)) await tryClick(page, buy);
      if (await page.locator('.bz-raise').isVisible()) debtor = page;
    }
    await host.waitForTimeout(150);
  }
  if (!debtor) throw new Error('no Raise money panel');
  const owner = debtor === host ? guest : host;
  await expect(debtor.locator('.bz-raise')).toContainText('You owe');
  await debtor.getByRole('button', { name: 'Let the bank handle it' }).click();
  await expect(debtor.locator('.bz-player--me .bz-insolvent')).toBeVisible();
  await expect(debtor.locator('.bz-token--me.bz-token--insolvent')).toHaveCount(1);
  await expect(owner.locator('.bz-log')).toContainText('is INSOLVENT');
  // The owner comes back to 12 three turns later and builds House 1, 2, 3, then the Hotel —
  // one BUILD click per level. The insolvent player keeps rolling meanwhile.
  const hotel = (page: Page) => page.locator('.bz-tile[data-space="12"] .bz-hotel');
  const offered = new Set<string>();
  const until = Date.now() + 120_000;
  while ((await hotel(owner).count()) === 0 && Date.now() < until) {
    for (const page of pages) {
      const roll = page.getByRole('button', { name: 'Roll the dice' });
      if (await enabled(roll)) await tryClick(page, roll);
      const build = page.getByRole('button', { name: /^BUILD/ });
      if (page === owner && (await enabled(build))) {
        // Each BUILD button offers exactly the next level.
        const level = /House \d|Hotel/.exec((await build.textContent().catch(() => '')) ?? '');
        if (level) offered.add(level[0]);
        await tryClick(page, build);
      }
      for (const name of [/Don’t buy/, /Let the bank handle it/]) {
        const b = page.getByRole('button', { name }).first();
        if (await enabled(b)) await tryClick(page, b);
      }
    }
    await host.waitForTimeout(150);
  }
  expect([...offered].sort()).toEqual(['Hotel', 'House 1', 'House 2', 'House 3']);
  await expect(hotel(debtor)).toHaveCount(1); // the other screen shows the hotel too
  await playUntilResults(pages);
  for (const page of pages) await expectResults(page, 2);
});
