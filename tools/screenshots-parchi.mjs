// Captures 16 Parchi screens (lobby, deal, select, pass, claim, reaction, finish, results)
// on desktop and on a Pixel 7 for visual review.
// Usage: start a server + client, then
//   node tools/screenshots-parchi.mjs http://localhost:5173 <outDir> [channel] [category]
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = process.argv[3] ?? 'screenshots';
const channel = process.argv[4] ?? 'msedge';
const category = process.argv[5] ?? 'fruits';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel });
const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const phone = await browser.newContext({ ...devices['Pixel 7'] });
const host = await desktop.newPage();
const guest = await phone.newPage();
const shot = (page, name) => page.screenshot({ path: join(out, `${name}.png`) });
const seen = new Set();
const once = async (key, fn) => {
  if (seen.has(key)) return;
  seen.add(key);
  await fn();
};
const deskText = (page) =>
  page
    .locator('.sp-desk__inner')
    .innerText()
    .catch(() => '');

for (const [page, name] of [
  [host, 'Archit'],
  [guest, 'Priya'],
]) {
  await page.goto(base);
  await page.getByLabel('Your nickname').fill(name);
}

await host.getByRole('button', { name: 'Create room: 16 Parchi' }).click();
const code = (await host.getByTestId('room-code').textContent()) ?? '';
await host.getByRole('combobox', { name: 'Category' }).selectOption(category);
await guest.getByLabel('Room code', { exact: true }).fill(code);
await guest.getByRole('button', { name: 'Join', exact: true }).click();
await guest.getByTestId('room-code').waitFor();
await host.getByRole('button', { name: 'Add bot' }).click();
await host.getByRole('button', { name: 'Add bot' }).click();
await host.waitForTimeout(600);
await shot(host, '11-parchi-lobby-desktop');
await shot(guest, '12-parchi-lobby-phone');

await host.getByRole('button', { name: 'Start game' }).click();
await host.waitForTimeout(3600);
await shot(host, '13-parchi-deal-desktop');
await shot(guest, '14-parchi-deal-phone');

const deadline = Date.now() + 300_000;
let reacted = false;
while (Date.now() < deadline) {
  if (await host.getByRole('heading', { name: 'Results' }).isVisible()) break;
  for (const [page, who] of [
    [host, 'desktop'],
    [guest, 'phone'],
  ]) {
    const text = await deskText(page);
    if (text.includes('Pass!')) {
      await once(`pass-${who}`, async () => {
        await page.waitForTimeout(260);
        await shot(page, `16-parchi-pass-${who}`);
      });
      continue;
    }
    const claim = page.getByRole('button', { name: 'Claim your full set' });
    if (await claim.isVisible().catch(() => false)) {
      await once(`claim-${who}`, async () => {
        await page.waitForTimeout(500);
        await shot(page, `17-parchi-claim-${who}`);
      });
      // The button pulses in full effects; force skips Playwright's wait-until-still check.
      await claim.click({ force: true }).catch(() => {});
      await page.waitForTimeout(900);
      await once(`claimed-${who}`, () => shot(page, `18-parchi-claimed-${who}`));
      continue;
    }
    if (text.includes('Someone has a full set')) {
      await once(`someone-${who}`, () => shot(page, `17-parchi-someone-${who}`));
    }
    const slips = page.locator('.sp-hand__slip:not([disabled])');
    if ((await slips.count()) > 0 && text.includes('Pick a slip')) {
      await once(`select-${who}`, () => shot(page, `15-parchi-select-${who}`));
      // Pass from the smallest group (the hand is grouped biggest first).
      await slips
        .last()
        .click()
        .catch(() => {});
      await page.waitForTimeout(450);
      await once(`chosen-${who}`, () => shot(page, `15-parchi-chosen-${who}`));
    }
    if (!reacted && who === 'phone' && text.includes('Passing to')) {
      reacted = true;
      await guest.getByRole('button', { name: 'React', exact: true }).click();
      await guest.waitForTimeout(250);
      await shot(guest, '19-parchi-reaction-tray-phone');
      await guest.getByRole('button', { name: 'React: On fire' }).click();
      await host.waitForTimeout(450);
      await shot(host, '19-parchi-reaction-desktop');
    }
    if (
      await page
        .locator('.sp-mine-done')
        .isVisible()
        .catch(() => false)
    ) {
      await once(`done-${who}`, async () => {
        await page.waitForTimeout(1500);
        await shot(page, `20-parchi-finished-${who}`);
      });
    }
  }
  await host.waitForTimeout(120);
}
await host.waitForTimeout(2500);
await shot(host, '21-parchi-results-desktop');
await shot(guest, '22-parchi-results-phone');
console.log('captured:', [...seen].join(', '));
await browser.close();
