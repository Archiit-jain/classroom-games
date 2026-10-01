// Captures the main screens and RMCS phases for visual review.
// Usage: start a server + client (e.g. ports 3201/5274), then
//   node tools/screenshots.mjs http://localhost:5274 <outDir> [channel]
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:5174';
const out = process.argv[3] ?? 'screenshots';
const channel = process.argv[4] ?? 'msedge';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel });
const desktop = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const phone = await browser.newContext({ ...devices['Pixel 7'] });
const host = await desktop.newPage();
const guest = await phone.newPage();
const shot = (page, name) => page.screenshot({ path: join(out, `${name}.png`) });
const deskText = (page) =>
  page
    .locator('.rmcs-desk__inner')
    .innerText()
    .catch(() => '');

for (const [page, name] of [
  [host, 'Archit'],
  [guest, 'Priya'],
]) {
  await page.goto(base);
  await page.getByLabel('Your nickname').fill(name);
}
await host.waitForTimeout(900);
await shot(host, '01-home-desktop');
await shot(guest, '02-home-phone');

await host.getByRole('button', { name: 'Create room: Raja Mantri Chor Sipahi' }).click();
const code = (await host.getByTestId('room-code').textContent()) ?? '';
await guest.getByLabel('Room code', { exact: true }).fill(code);
await guest.getByRole('button', { name: 'Join', exact: true }).click();
await guest.getByTestId('room-code').waitFor();
await host.getByRole('button', { name: 'Add bot' }).click();
await host.waitForTimeout(300);
await shot(host, '03-lobby-desktop-3of4');
await host.getByRole('button', { name: 'Add bot' }).click();
await host.waitForTimeout(700);
await shot(guest, '04-lobby-phone');

await host.getByRole('button', { name: 'Start game' }).click();
await guest.waitForTimeout(1200);
await shot(guest, '05-countdown-phone');

const seen = new Set();
const deadline = Date.now() + 240_000;
while (Date.now() < deadline) {
  if (await host.getByRole('heading', { name: 'Results' }).isVisible()) break;
  for (const [page, who] of [
    [host, 'desktop'],
    [guest, 'phone'],
  ]) {
    const text = await deskText(page);
    const phase = text.includes('Shuffling')
      ? 'dealing'
      : text.includes('Raja')
        ? 'raja'
        : text.includes('Mantri!')
          ? 'mantri'
          : text.includes('hunting') || text.includes('Who is the Chor')
            ? 'guessing'
            : /caught|escaped/i.test(text)
              ? 'result'
              : null;
    if (phase && !seen.has(`${phase}-${who}`)) {
      await page.waitForTimeout(phase === 'result' ? 900 : 700);
      await shot(page, `06-rmcs-${phase}-${who}`);
      seen.add(`${phase}-${who}`);
    }
    const suspect = page.getByRole('button', { name: /^Suspect / }).first();
    if (await suspect.isVisible().catch(() => false)) {
      await suspect.click().catch(() => {});
      await page.waitForTimeout(500);
      if (!seen.has(`accuse-${who}`)) {
        await shot(page, `07-rmcs-accuse-${who}`);
        seen.add(`accuse-${who}`);
      }
      await page
        .getByRole('button', { name: /^Accuse .+!$/ })
        .click()
        .catch(() => {});
    }
  }
  await host.waitForTimeout(150);
}
await host.waitForTimeout(2200);
await shot(host, '08-results-desktop');
await guest.waitForTimeout(300);
await shot(guest, '09-results-phone');
await guest.screenshot({ path: join(out, '10-results-phone-full.png'), fullPage: true });
console.log('captured:', [...seen].join(', '));
await browser.close();
