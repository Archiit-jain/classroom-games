/* global document, getComputedStyle */
// Generates the static brand images in apps/client/public from the running app, so they
// always show the real game icons and colours:
//   og-image.png (1200 × 630, link previews), apple-touch-icon.png (180 × 180).
// Usage: start the client (and server), then
//   node tools/make-brand-images.mjs http://localhost:5173 [channel]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const base = process.argv[2] ?? 'http://localhost:5173';
const channel = process.argv[3] ?? 'msedge';
const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'apps/client/public');
mkdirSync(out, { recursive: true });
const require = createRequire(join(root, 'packages/ui/package.json'));
const fontDir = dirname(require.resolve('@fontsource-variable/baloo-2/package.json'));
const fontUrl = pathToFileURL(join(fontDir, 'files/baloo-2-latin-wght-normal.woff2')).href;

const browser = await chromium.launch({ channel });
const app = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await app.goto(base);
await app.locator('.game-card').first().waitFor();
const icons = await app.locator('.game-card').evaluateAll((cards) =>
  cards
    .filter(
      (c) => !/fixture|Count Up/i.test(c.querySelector('.game-card__name')?.textContent ?? ''),
    )
    .map((c) => ({
      accent: getComputedStyle(c.querySelector('.game-card__art')).backgroundColor,
      svg: c.querySelector('.game-card__art svg').outerHTML,
    })),
);

const tokens = `
  --cb-outline: #07041a; --cb-ink: #1f1647; --cb-yellow: #ffd23f; --cb-yellow-deep: #e39b00;
  --cb-pink: #ff3e8a; --cb-cyan: #2de2e6; --cb-night-900: #130b2e;`;
const page = (body, w, h) => `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: 'Baloo'; src: url('${fontUrl}') format('woff2'); font-weight: 400 800; }
  :root {${tokens} }
  * { box-sizing: border-box; }
  html, body { margin: 0; width: ${w}px; height: ${h}px; overflow: hidden; }
  body {
    font-family: 'Baloo', system-ui, sans-serif; color: #fbf8ff;
    background:
      radial-gradient(circle at 10% 6%, rgba(255, 62, 138, 0.32), transparent 36%),
      radial-gradient(circle at 92% 2%, rgba(45, 226, 230, 0.24), transparent 34%),
      radial-gradient(circle at 60% 104%, rgba(255, 210, 63, 0.18), transparent 44%),
      radial-gradient(circle at -10% 90%, rgba(155, 123, 255, 0.22), transparent 40%),
      radial-gradient(rgba(255, 255, 255, 0.06) 1px, transparent 1.5px) 0 0 / 22px 22px,
      var(--cb-night-900);
  }
  .wordmark { display: flex; flex-direction: column; align-items: center; line-height: 0.9; }
  .top { font-weight: 800; font-size: 0.32em; letter-spacing: 0.38em; margin-right: -0.38em; color: var(--cb-cyan); }
  .main { font-weight: 800; letter-spacing: 0.02em; color: var(--cb-yellow);
    -webkit-text-stroke: 0.035em var(--cb-outline); paint-order: stroke fill;
    text-shadow: 0.05em 0.07em 0 var(--cb-pink), 0.09em 0.12em 0 var(--cb-outline); }
  .tile { display: grid; place-items: center; border: 4px solid var(--cb-outline);
    box-shadow: 0 6px 0 var(--cb-outline), inset 0 4px 0 rgba(255,255,255,0.4); }
</style></head><body>${body}</body></html>`;

const og = await (await browser.newContext({ viewport: { width: 1200, height: 630 } })).newPage();
const tiles = icons
  .map(
    (i, n) =>
      `<div class="tile" style="width:120px;height:120px;border-radius:32px;background:${i.accent};transform:rotate(${n % 2 ? 4 : -4}deg)">${i.svg.replace(/width="\d+"/, 'width="80"').replace(/height="\d+"/, 'height="80"')}</div>`,
  )
  .join('');
await og.setContent(
  page(
    `<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:34px">
      <div class="wordmark" style="font-size:150px"><span class="top">Classroom</span><span class="main">Games</span></div>
      <div style="font-size:38px;font-weight:600;color:#d9d0ff;text-align:center;line-height:1.2">
        Quick multiplayer classroom games. No login — just a name.</div>
      <div style="display:flex;gap:26px;margin-top:6px">${tiles}</div>
    </div>`,
    1200,
    630,
  ),
);
await og.evaluate(() => document.fonts.ready);
await og.screenshot({ path: join(out, 'og-image.png') });

const touch = await (await browser.newContext({ viewport: { width: 180, height: 180 } })).newPage();
await touch.setContent(
  page(
    `<div style="height:100%;display:grid;place-items:center;background:#5b3df5">
      <div class="wordmark" style="font-size:88px"><span class="main">CG</span></div></div>`,
    180,
    180,
  ),
);
await touch.evaluate(() => document.fonts.ready);
await touch.screenshot({ path: join(out, 'apple-touch-icon.png') });
await browser.close();
console.log(`wrote og-image.png and apple-touch-icon.png to ${out}`);
