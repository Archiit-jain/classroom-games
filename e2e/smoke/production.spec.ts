import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Production smoke test (docs/DEPLOYMENT.md): runs against a deployed site —
 * SMOKE_URL=https://<deployment> pnpm smoke — or a local production-style build
 * (tools/serve-production.mjs). Two separate browsers ("devices") connect, create
 * and join a private room, play Dots & Boxes, and one reconnects: the room and its
 * seat must survive.
 */
const URL = process.env.SMOKE_URL ?? 'http://localhost:4300';
const PAD = 0.45;

async function device(browser: Browser, nickname: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(URL);
  await page.getByLabel('Your nickname').fill(nickname);
  return page;
}

const drawnLines = async (page: Page) =>
  new Set(
    await page
      .locator('line[data-edge]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-edge'))),
  );

/** Draws the first free line of a 4×4 grid on this page. */
async function drawOne(page: Page): Promise<string> {
  const drawn = await drawnLines(page);
  const n = 4;
  const lines: { id: string; x: number; y: number }[] = [];
  for (let r = 0; r <= n; r++)
    for (let c = 0; c < n; c++) lines.push({ id: `h:${r}:${c}`, x: c + 0.5, y: r });
  for (let r = 0; r < n; r++)
    for (let c = 0; c <= n; c++) lines.push({ id: `v:${r}:${c}`, x: c, y: r + 0.5 });
  const next = lines.find((l) => !drawn.has(l.id));
  const box = await page.locator('.db-paper').boundingBox();
  if (!next || !box) throw new Error('no line to draw');
  const cell = box.width / (n + 2 * PAD);
  await page.mouse.click(box.x + (PAD + next.x) * cell, box.y + (PAD + next.y) * cell);
  return next.id;
}

const myTurn = async (page: Page) => (await page.locator('.db-paper--active').count()) > 0;

test('production: two devices create, join, play and reconnect', async ({ browser }) => {
  test.setTimeout(120_000);
  const a = await device(browser, 'Smoke A');
  const b = await device(browser, 'Smoke B');

  // HTTPS/WSS on a real deployment; the socket must use the WebSocket transport.
  if (URL.startsWith('https://')) {
    expect(new globalThis.URL(a.url()).protocol).toBe('https:');
  }
  const sockets: string[] = [];
  a.on('websocket', (ws) => sockets.push(ws.url()));

  await a.getByRole('button', { name: 'Create room: Dots & Boxes' }).click();
  const code = (await a.getByTestId('room-code').textContent()) ?? '';
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  await b.getByLabel('Room code', { exact: true }).fill(code);
  await b.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(b.getByTestId('room-code')).toHaveText(code);
  await a.getByLabel('Grid').selectOption('4');
  await a.getByRole('button', { name: 'Start game' }).click();
  for (const page of [a, b]) await expect(page.locator('.db-paper')).toBeVisible();

  // Authoritative realtime events: a move on one device appears on the other.
  await expect
    .poll(async () => (await myTurn(a)) || (await myTurn(b)), { timeout: 20_000 })
    .toBe(true);
  const mover = (await myTurn(a)) ? a : b;
  const watcher = mover === a ? b : a;
  const line = await drawOne(mover);
  await expect(watcher.locator(`line[data-edge="${line}"]`)).toHaveCount(1);

  // One device reconnects (reload = a new WebSocket, possibly on another instance).
  await watcher.reload();
  await expect(watcher.locator('.db-paper')).toBeVisible({ timeout: 20_000 });
  await expect(watcher.locator(`line[data-edge="${line}"]`)).toHaveCount(1);
  // Still their own seat (no bot standing in for them).
  await expect(watcher.getByText('A bot is playing for you.')).toHaveCount(0);

  // …and play continues for both.
  await expect
    .poll(async () => (await myTurn(a)) || (await myTurn(b)), { timeout: 20_000 })
    .toBe(true);
  const next = await drawOne((await myTurn(a)) ? a : b);
  for (const page of [a, b]) await expect(page.locator(`line[data-edge="${next}"]`)).toHaveCount(1);

  expect(sockets.length).toBeGreaterThan(0);
  for (const url of sockets) {
    expect(url).toContain('/api/socket/socket.io/');
    expect(url).toContain('transport=websocket');
    if (URL.startsWith('https://')) expect(url.startsWith('wss://')).toBe(true);
  }
});
