/* global document, window, getComputedStyle */
// Visual sweep (Phase 11): captures every main screen on a 360 px phone, a Pixel 7, a
// landscape phone and desktop, and checks each one for layout faults a person would
// notice: sideways overflow, text squeezed one letter per line, tiny touch targets,
// controls covered by something else, clipped text, console errors.
//
// Start a server with fast game timers and its client, e.g. the preview configs
// classroom-games-fast-server/-client (GAME_TIME_SCALE=0.05), then
//   node tools/visual-sweep.mjs http://localhost:5177 <outDir> [channel] [only-game-substring]
// With channel "android" it runs once in Chrome on a USB-connected Android phone instead,
// in a new tab of the phone's Chrome (closed afterwards). First:
//   adb forward tcp:9222 localabstract:chrome_devtools_remote
//   adb reverse tcp:5177 tcp:5177 && adb reverse tcp:3104 tcp:3104
// Output: <outDir>/<viewport>/<nn>-<screen>.png and <outDir>/issues.json.
// The human seat is left idle on purpose: bots take it over and every match reaches
// its results quickly.
import { chromium, devices } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:5177';
const out = process.argv[3] ?? 'visual-sweep';
const channel = process.argv[4] ?? 'msedge';
const only = process.argv[5] ?? '';

const VIEWPORTS = {
  narrow: { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true },
  pixel7: { ...devices['Pixel 7'] },
  landscape: { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 } },
};

/** Runs in the page: layout faults on the current screen. */
function inspect() {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const describe = (el) => {
    const cls = typeof el.className === 'string' ? el.className.split(' ')[0] : '';
    const label = el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 30) || '';
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''} "${label}"`;
  };
  const issues = [];
  const overflow = document.documentElement.scrollWidth - window.innerWidth;
  if (overflow > 0) issues.push({ kind: 'overflow-x', detail: `${overflow}px` });

  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || el.closest('.sr-only')) continue;
    const ownText = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join('');
    if (ownText.length < 4) continue;
    const r = el.getBoundingClientRect();
    const fs = parseFloat(getComputedStyle(el).fontSize) || 16;
    // A word broken one letter per line: very narrow and very tall for its font size.
    if (r.width < fs * 2 && r.height > fs * 3.5) {
      issues.push({ kind: 'squeezed-text', detail: describe(el) });
    }
    const s = getComputedStyle(el);
    if (
      (s.overflow === 'hidden' || s.overflowX === 'hidden') &&
      s.textOverflow !== 'ellipsis' &&
      el.scrollWidth > el.clientWidth + 2 &&
      el.children.length === 0
    ) {
      issues.push({ kind: 'clipped-text', detail: describe(el) });
    }
  }

  const controls = document.querySelectorAll(
    'button, a[href], [role="button"], input:not([type="hidden"]), select, textarea',
  );
  for (const el of controls) {
    if (!visible(el) || el.closest('[aria-hidden="true"]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 32 || r.height < 32) {
      issues.push({
        kind: 'small-target',
        detail: `${describe(el)} ${Math.round(r.width)}×${Math.round(r.height)}`,
      });
    }
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
    const top = document.elementFromPoint(x, y);
    // A full-screen overlay (the start countdown) covers everything on purpose.
    if (top?.closest('.overlay')) continue;
    if (top && top !== el && !el.contains(top) && !top.contains(el) && !el.disabled) {
      issues.push({ kind: 'covered', detail: `${describe(el)} under ${describe(top)}` });
    }
  }
  return issues;
}

const android = channel === 'android';
const browser = android
  ? await chromium.connectOverCDP('http://127.0.0.1:9222')
  : await chromium.launch({ channel });
const report = {};

// Each viewport waits in a different game's public room, so the sweeps don't match
// each other into a real game.
const PUBLIC_GAME = {
  narrow: 'Raja Mantri Chor Sipahi',
  pixel7: '16 Parchi',
  landscape: 'Pen Fight',
  desktop: 'Dots & Boxes',
};

async function sweep(name, options) {
  const context = android ? browser.contexts()[0] : await browser.newContext({ ...options });
  const page = await context.newPage();
  page.on('dialog', (d) => void d.accept());
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  const dir = join(out, name);
  mkdirSync(dir, { recursive: true });
  const screens = [];
  let n = 0;
  const capture = async (screen, fullPage = false) => {
    await page.waitForTimeout(700);
    const issues = await page.evaluate(inspect);
    const file = `${String(++n).padStart(2, '0')}-${screen}.png`;
    await page.screenshot({ path: join(dir, file), fullPage });
    screens.push({ screen, file, issues });
  };
  const leave = async () => {
    const leaveButton = page.getByRole('button', { name: /^(Leave|Cancel)/ }).first();
    if (await leaveButton.isVisible().catch(() => false)) await leaveButton.click();
    const home = await page
      .locator('.play-hub')
      .waitFor({ timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!home) throw new Error(`${name}: could not get back to the home screen`);
  };

  await page.goto(base);
  await page.getByLabel('Your nickname').fill(`Sweep${name.slice(0, 4)}`);
  await capture('home', true);
  await page.getByRole('button', { name: 'Browse games' }).click();
  await capture('browse');
  // While browsing, the same button reads "Back".
  await page.locator('.play-hub button', { hasText: /back/i }).first().click();
  await page
    .getByRole('button', { name: `Play ${PUBLIC_GAME[name] ?? 'Pen Fight'} with people online` })
    .click();
  await page.locator('.public-lobby').waitFor({ timeout: 15_000 });
  await capture('public-waiting');
  await leave();

  const games = (
    await page
      .locator('[aria-label^="Create room: "]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label').slice(13)))
  ).filter((g) => !/fixture/i.test(g) && g.toLowerCase().includes(only.toLowerCase()));

  const failures = [];
  for (const game of games) {
    try {
      const slug = game.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      await page.locator(`[aria-label="Create room: ${game}"]`).click();
      await page.getByRole('button', { name: 'Start game' }).waitFor({ timeout: 15_000 });
      if (game === 'Business') {
        await page.locator('#bz-rounds').fill('5');
        await page.locator('#bz-rounds').press('Enter');
      }
      const start = page.getByRole('button', { name: 'Start game' });
      for (let i = 0; i < 7 && !(await start.isEnabled()); i++) {
        await page.getByRole('button', { name: 'Add bot' }).click();
        await page.waitForTimeout(250);
      }
      await capture(`${slug}-lobby`, true);
      await start.click();
      await page.locator('.match').waitFor({ timeout: 20_000 });
      await capture(`${slug}-play-1`);
      await page.waitForTimeout(4000);
      await capture(`${slug}-play-2`);
      await page.locator('.results__table').waitFor({ timeout: 240_000 });
      await page.waitForTimeout(2500); // count-ups settle
      await capture(`${slug}-results`, true);
      await leave();
    } catch (err) {
      // Record it with a picture of the moment, and carry on with the next game.
      failures.push({ game, error: String(err).split(String.fromCharCode(10))[0] });
      await capture(`${game.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-FAILED`);
      await page.goto(base);
      await page
        .locator('.play-hub')
        .waitFor({ timeout: 20_000 })
        .catch(() => undefined);
      const stuck = page.getByRole('button', { name: /^Leave/ }).first();
      if (await stuck.isVisible().catch(() => false)) await leave().catch(() => undefined);
    }
  }
  report[name] = { screens, failures, consoleErrors: [...new Set(consoleErrors)] };
  if (android) await page.close();
  else await context.close();
}

if (android) {
  await sweep('android', null);
  await browser.close(); // only disconnects: the phone's Chrome keeps running
} else {
  await Promise.all(Object.entries(VIEWPORTS).map(([name, options]) => sweep(name, options)));
  await browser.close();
}
writeFileSync(join(out, 'issues.json'), JSON.stringify(report, null, 1));
const total = Object.values(report).reduce(
  (sum, v) => sum + v.screens.reduce((s, x) => s + x.issues.length, 0),
  0,
);
console.log(`swept ${Object.keys(report).length} viewports; ${total} issues → ${out}/issues.json`);
