/* global document, window */
// Captures Business (working title) screens on desktop, Pixel 7 portrait, a 360 px phone
// and a landscape phone for visual review.
// Usage: start a server + client, then
//   node tools/screenshots-business.mjs http://localhost:5173 <outDir> [channel]
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = process.argv[3] ?? 'screenshots';
const channel = process.argv[4] ?? 'msedge';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel });
const host = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
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

for (const [page, name] of pages) {
  await page.goto(base);
  await page.getByLabel('Your nickname').fill(name);
}
await host.getByRole('button', { name: 'Create room: Business' }).click();
const code = (await host.getByTestId('room-code').textContent()) ?? '';
await host.getByLabel('Rounds').selectOption('12');
for (const [page] of pages.slice(1)) {
  await page.getByLabel('Room code', { exact: true }).fill(code);
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await page.getByTestId('room-code').waitFor();
}
await host.getByRole('button', { name: 'Add bot' }).click();
await host.waitForTimeout(500);
await shot(host, '01-business-lobby-desktop');
await host.getByRole('button', { name: 'Start game' }).click();
await host.locator('.bz-board').waitFor();
await host.waitForTimeout(800);
for (const [page, , who] of pages) await shot(page, `02-business-start-${who}`);

// Everyone plays: roll on your turn, buy or develop when offered.
const deadline = Date.now() + 120_000;
let captured = 0;
while (Date.now() < deadline && captured < 3) {
  for (const [page, , who] of pages) {
    const roll = page.locator('.bz-roll');
    if ((await roll.count()) > 0) {
      await roll.click({ timeout: 1000 }).catch(() => undefined);
      await page.waitForTimeout(900);
      continue;
    }
    const yes = page.locator('.bz-actions .btn--yellow, .bz-option').first();
    if ((await yes.count()) > 0 && (await yes.isEnabled().catch(() => false))) {
      if (captured < 3) {
        await shot(page, `03-business-decision-${who}-${captured}`);
        captured++;
      }
      await yes.click({ timeout: 1000 }).catch(() => undefined);
    }
  }
  await host.waitForTimeout(300);
}
await host.waitForTimeout(1500);
for (const [page, , who] of pages) {
  await shot(page, `04-business-midgame-${who}`);
  console.log(who, 'overflow', await overflow(page));
}
await phone.locator('.bz-tile[data-space="27"]').click();
await phone.waitForTimeout(400);
await shot(phone, '05-business-postcard-phone');
await browser.close();
