/* global document, window */
// Captures Business screens on desktop, Pixel 7 portrait, a 360 px phone and a landscape
// phone for the visual review (BUSINESS_REDESIGN.md §22): lobby, start, dice, walk, buy,
// build, event card, auction, trade, loan, postcard, final count-up.
// Usage: start a server + client, then
//   node tools/screenshots-business.mjs http://localhost:5173 <outDir> [channel] [rounds]
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = process.argv[3] ?? 'screenshots';
const channel = process.argv[4] ?? 'msedge';
const rounds = process.argv[5] ?? '5';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel });
const host = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const phone = await (await browser.newContext({ ...devices['Pixel 7'] })).newPage();
const narrow = await (
  await browser.newContext({
    viewport: { width: 360, height: 740 },
    isMobile: true,
    hasTouch: true,
  })
).newPage();
const landscape = await (
  await browser.newContext({
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
  })
).newPage();
const pages = [
  [host, 'Archit', 'desktop'],
  [phone, 'Priya', 'phone'],
  [narrow, 'Kabir', 'narrow'],
  [landscape, 'Meera', 'landscape'],
];
const shot = (page, name) => page.screenshot({ path: join(out, `${name}.png`) });
const overflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const has = (page, sel) =>
  page
    .locator(sel)
    .first()
    .isVisible()
    .catch(() => false);

for (const [page, name] of pages) {
  await page.goto(base);
  await page.getByLabel('Your nickname').fill(name);
}
await host.getByRole('button', { name: 'Create room: Business' }).click();
const code = (await host.getByTestId('room-code').textContent()) ?? '';
await host.getByLabel('Rounds', { exact: true }).fill(rounds);
await host.getByLabel('Rounds', { exact: true }).blur();
for (const [page] of pages.slice(1)) {
  await page.getByLabel('Room code', { exact: true }).fill(code);
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await page.getByTestId('room-code').waitFor();
}
await host.getByRole('button', { name: 'Add bot' }).click();
await host.waitForTimeout(500);
await shot(host, '01-lobby-desktop');
await shot(phone, '01-lobby-phone');
await host.getByRole('button', { name: 'Start game' }).click();
await host.locator('.bz-board').waitFor();
await host.waitForTimeout(1000);
for (const [page, , who] of pages) await shot(page, `02-start-${who}`);

const seen = new Set();
const once = async (key, page, name) => {
  if (seen.has(key)) return;
  seen.add(key);
  await shot(page, name);
};
const deadline = Date.now() + 600_000;
let auctioned = false;
let traded = false;
let loanShown = false;
while (Date.now() < deadline) {
  if (
    await host
      .getByRole('heading', { name: 'Results' })
      .isVisible()
      .catch(() => false)
  )
    break;
  for (const [page, , who] of pages) {
    if (await has(page, '.bz-final')) await once(`final-${who}`, page, `20-final-${who}`);
    if ((await has(page, '.bz-event')) && !seen.has(`event-${who}`)) {
      await page.waitForTimeout(900);
      await once(`event-${who}`, page, `08-event-${who}`);
    }
    if (await has(page, '.bz-auction')) {
      await once(`auction-${who}`, page, `10-auction-${who}`);
      const bid = page.locator('.bz-auction .btn--primary:not([disabled])').first();
      if (who !== 'desktop' && (await bid.count()) > 0)
        await bid.click({ timeout: 800 }).catch(() => undefined);
    }
    if (await has(page, '.bz-offer')) {
      await once(`offer-${who}`, page, `12-trade-offer-${who}`);
      await page
        .getByRole('button', { name: 'Accept' })
        .click({ timeout: 800 })
        .catch(() => undefined);
    }
    if (await has(page, '.bz-token--moving')) await once(`walk-${who}`, page, `04-walk-${who}`);
    const roll = page.getByRole('button', { name: /Roll the dice|Roll for/ });
    if (await roll.isVisible().catch(() => false)) {
      // The host shows off the side actions once it owns something.
      if (page === host && (await host.locator('.bz-tile--mine').count()) > 0) {
        if (!loanShown) {
          loanShown = true;
          try {
            await host.getByRole('button', { name: 'Loan', exact: true }).click();
            await host.waitForTimeout(300);
            await shot(host, '13-loan-desktop');
            await host
              .getByRole('button', { name: /^Borrow/ })
              .first()
              .click();
            await host.waitForTimeout(900);
            await shot(host, '14-loan-taken-desktop');
          } catch {
            console.log('loanShown step skipped');
          }
          continue;
        }
        if (!auctioned) {
          auctioned = true;
          try {
            await host.getByRole('button', { name: 'Auction', exact: true }).click();
            await host.waitForTimeout(300);
            await host
              .getByRole('button', { name: /^Auction / })
              .first()
              .click();
            await host.waitForTimeout(900);
          } catch {
            console.log('auctioned step skipped');
          }
          continue;
        }
        if (!traded && (await host.locator('.bz-auction').count()) === 0) {
          traded = true;
          try {
            await host.getByRole('button', { name: 'Trade', exact: true }).click();
            await host.waitForTimeout(300);
            await host.getByLabel('Trade with').selectOption({ index: 0 });
            await host.locator('.bz-trade input[type=number]').first().fill('500');
            await shot(host, '11-trade-builder-desktop');
            await host.getByRole('button', { name: 'Send offer' }).click();
            await host.waitForTimeout(600);
          } catch {
            console.log('trade step skipped');
          }
          continue;
        }
      }
      await roll.click({ timeout: 1000 }).catch(() => undefined);
      await page.waitForTimeout(250);
      await once(`dice-${who}`, page, `03-dice-${who}`);
      continue;
    }
    const buy = page.getByRole('button', { name: /^BUY/ });
    if (await buy.isEnabled({ timeout: 50 }).catch(() => false)) {
      await once(`buy-${who}`, page, `05-buy-${who}`);
      await buy.click({ timeout: 800 }).catch(() => undefined);
      await page.waitForTimeout(300);
      await once(`sold-${who}`, page, `06-sold-${who}`);
      continue;
    }
    const build = page.locator('.bz-tray .btn--primary:not([disabled])').last();
    if (
      (await page.locator('.bz-tray__q', { hasText: 'Build on' }).count()) > 0 &&
      (await build.count()) > 0
    ) {
      await once(`build-${who}`, page, `07-build-${who}`);
      await build.click({ timeout: 800 }).catch(() => undefined);
      await page.waitForTimeout(700);
      await once(`built-${who}`, page, `07b-built-${who}`);
      continue;
    }
    const other = page
      .locator('.bz-tray .btn--primary:not([disabled]), .bz-tray .btn--ghost:not([disabled])')
      .first();
    if ((await other.count()) > 0) await other.click({ timeout: 800 }).catch(() => undefined);
  }
  if (seen.size > 6 && !seen.has('postcard')) {
    seen.add('postcard');
    await phone
      .locator('.bz-tile[data-space="26"]')
      .click()
      .catch(() => undefined);
    await phone.waitForTimeout(400);
    await shot(phone, '15-postcard-phone');
    await phone
      .locator('.bz-card__close')
      .click()
      .catch(() => undefined);
    await narrow
      .getByRole('button', { name: 'See whole board' })
      .click()
      .catch(() => undefined);
    await narrow.waitForTimeout(500);
    await shot(narrow, '16-see-whole-board-narrow');
    await narrow
      .getByRole('button', { name: 'Follow the play' })
      .click()
      .catch(() => undefined);
    for (const [page, , who] of pages) {
      await shot(page, `09-midgame-${who}`);
      console.log(who, 'overflow', await overflow(page));
    }
  }
  await host.waitForTimeout(200);
}
await host.waitForTimeout(2500);
for (const [page, , who] of pages) await shot(page, `21-results-${who}`);
console.log('captured', [...seen].join(' '));
await browser.close();
