/* global document */
// Captures Name Place Animal Thing screens (lobby, get ready, writing, STOP, review,
// voting, round scores) on desktop and on a Pixel 7 for visual review.
// Usage: start a server + client, then
//   node tools/screenshots-npat.mjs http://localhost:5173 <outDir> [channel]
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = process.argv[3] ?? 'screenshots';
const channel = process.argv[4] ?? 'msedge';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel });
const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const phone = await browser.newContext({ ...devices['Pixel 7'] });
const host = await desktop.newPage();
const guest = await phone.newPage();
const shot = (page, name, fullPage = false) =>
  page.screenshot({ path: join(out, `${name}.png`), fullPage });
const overflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const [page, name] of [
  [host, 'Archit'],
  [guest, 'Priya'],
]) {
  await page.goto(base);
  await page.getByLabel('Your nickname').fill(name);
}

await host.getByRole('button', { name: 'Create room: Name Place Animal Thing' }).click();
const code = (await host.getByTestId('room-code').textContent()) ?? '';
await host.getByLabel('Rounds').selectOption('3');
await guest.getByLabel('Room code', { exact: true }).fill(code);
await guest.getByRole('button', { name: 'Join', exact: true }).click();
await guest.getByTestId('room-code').waitFor();
await host.getByRole('button', { name: 'Add bot' }).click();
await host.waitForTimeout(600);
await shot(host, '01-npat-lobby-desktop');
await shot(guest, '02-npat-lobby-phone');

await host.getByRole('button', { name: 'Start game' }).click();
await host.locator('.np-ready').waitFor();
await host.waitForTimeout(500);
await shot(host, '03-npat-ready-desktop');
await shot(guest, '04-npat-ready-phone');

await host.locator('.np-letter:not(.np-letter--empty)').waitFor();
const letter = ((await host.locator('.np-letter').textContent()) ?? 'A').trim();
await host.waitForTimeout(700);
await shot(host, '05-npat-writing-desktop');
await shot(guest, '06-npat-writing-phone');

const words = {
  name: `${letter}ara`,
  place: `${letter}onville`,
  animal: `${letter}ynx`,
  thing: `${letter}amp`,
  food: `${letter}entil`,
  profession: `${letter}awyer`,
};
for (const [category, word] of Object.entries(words)) {
  await host.locator(`input[data-category="${category}"]`).fill(word);
}
await guest.locator('input[data-category="name"]').fill(words.name); // a shared answer
await guest.locator('input[data-category="place"]').fill(`${letter}akeside`);
await guest.locator('input[data-category="animal"]').fill('Zebra'); // wrong letter (unless Z)
await host.waitForTimeout(800);
await shot(host, '07-npat-filled-desktop');
await shot(guest, '08-npat-filled-phone');
console.log('phone overflow while writing:', await overflow(guest));

await host.locator('.np-stop--ready').waitFor({ timeout: 30_000 });
await shot(host, '09-npat-stop-ready-desktop');
await host.locator('.np-stop').click({ force: true }); // it pulses
await guest.locator('.np-banner').waitFor();
await guest.waitForTimeout(400);
await shot(host, '10-npat-stopped-desktop');
await shot(guest, '11-npat-stopped-phone');

await host.locator('.np-review').waitFor();
await host.waitForTimeout(900);
await shot(host, '12-npat-review-desktop', true);
await shot(guest, '13-npat-review-phone');
console.log('phone overflow in review:', await overflow(guest));
await guest.locator('.np-vote').first().click();
await guest.waitForTimeout(500);
await shot(guest, '14-npat-voted-phone');
await host.waitForTimeout(300);
await shot(host, '15-npat-voted-desktop', true);

await host.getByRole('button', { name: 'Done', exact: true }).click();
await guest.getByRole('button', { name: 'Done', exact: true }).click();
await host.locator('.np-scores').waitFor();
await host.waitForTimeout(1500);
await shot(host, '16-npat-scores-desktop');
await shot(guest, '17-npat-scores-phone');
console.log('phone overflow in scores:', await overflow(guest));

await browser.close();
