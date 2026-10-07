// Accessibility audit (Phase 11 §17) with axe-core on the main screens: home, Browse,
// a public room, a private lobby, a running game and its results. Prints every
// violation grouped by rule with its impact and where it occurs.
//   node tools/a11y-audit.mjs http://localhost:5177 [channel]   (a fast-timer server helps)
import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5177';
const channel = process.argv[3] ?? 'msedge';
const browser = await chromium.launch({ channel });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
page.on('dialog', (d) => void d.accept());
const found = new Map();
const scan = async (screen) => {
  await page.waitForTimeout(800);
  const { violations } = await new AxeBuilder({ page }).analyze();
  for (const v of violations) {
    const entry = found.get(v.id) ?? { impact: v.impact, help: v.help, where: new Set() };
    for (const node of v.nodes.slice(0, 4)) entry.where.add(`${screen}: ${node.target.join(' ')}`);
    found.set(v.id, entry);
  }
};

await page.goto(base);
await page.getByLabel('Your nickname').fill('Auditor');
await scan('home');
await page.getByRole('button', { name: 'Browse games' }).click();
await scan('browse');
await page.locator('.play-hub button', { hasText: /back/i }).first().click();
await page.getByRole('button', { name: 'Play Pen Fight with people online' }).click();
await page.locator('.public-lobby').waitFor();
await scan('public room');
await page
  .getByRole('button', { name: /^(Leave|Cancel)/ })
  .first()
  .click();
await page.locator('.play-hub').waitFor();
for (const game of ['Dots & Boxes', 'Business']) {
  await page.locator(`[aria-label="Create room: ${game}"]`).click();
  await page.getByRole('button', { name: 'Add bot' }).click();
  await scan(`${game} lobby`);
  await page.getByRole('button', { name: 'Start game' }).click();
  await page.locator('.match').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(2500);
  await scan(`${game} in play`);
  await page.locator('.results__table').waitFor({ timeout: 240_000 });
  await page.waitForTimeout(2500);
  await scan(`${game} results`);
  await page
    .getByRole('button', { name: /^Leave/ })
    .first()
    .click();
  await page.locator('.play-hub').waitFor();
}
await browser.close();
for (const [id, v] of [...found].sort((a, b) => (a[1].impact < b[1].impact ? -1 : 1))) {
  console.log(`[${v.impact}] ${id}: ${v.help}`);
  for (const w of [...v.where].slice(0, 6)) console.log(`    ${w}`);
}
console.log(`${found.size} rules violated`);
