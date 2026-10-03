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
  // Record each device's sockets from its first connection (not only after a reload).
  const ra = await recordedDevice(browser, 'Smoke A');
  const rb = await recordedDevice(browser, 'Smoke B');
  const a = ra.page;
  const b = rb.page;

  // HTTPS/WSS on a real deployment; the socket must use the WebSocket transport.
  if (URL.startsWith('https://')) {
    expect(new globalThis.URL(a.url()).protocol).toBe('https:');
  }

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

  const sockets = [...ra.sockets, ...rb.sockets];
  expect(ra.sockets.length).toBeGreaterThan(0);
  expect(rb.sockets.length).toBeGreaterThan(0);
  for (const url of sockets) {
    expect(url).toContain('/api/socket/socket.io/');
    expect(url).toContain('transport=websocket');
    if (URL.startsWith('https://')) expect(url.startsWith('wss://')).toBe(true);
  }
});

/** A device whose every WebSocket frame is recorded from the first connection. */
async function recordedDevice(browser: Browser, nickname: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const frames: string[] = [];
  const sockets: string[] = [];
  page.on('websocket', (ws) => {
    sockets.push(ws.url());
    ws.on('framereceived', (f) => frames.push(String(f.payload)));
  });
  await page.goto(URL);
  await page.getByLabel('Your nickname').fill(nickname);
  return { page, frames, sockets };
}

const npatLetter = async (page: Page) =>
  ((await page.locator('.np-letter:not(.np-letter--empty)').allInnerTexts())[0] ?? '').trim();
const fill = async (page: Page, answers: Record<string, string>) => {
  for (const [category, value] of Object.entries(answers)) {
    await page.locator(`input[data-category="${category}"]`).fill(value);
  }
};
const scoreOf = (page: Page, name: string) =>
  page.locator('.np-player', { hasText: name }).locator('.np-player__score');

test('production: three devices play a Name Place Animal Thing round with the frozen voting rule', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const a = await recordedDevice(browser, 'Smoke A');
  const b = await recordedDevice(browser, 'Smoke B');
  const c = await recordedDevice(browser, 'Smoke C');

  await a.page.getByRole('button', { name: 'Create room: Name Place Animal Thing' }).click();
  const code = (await a.page.getByTestId('room-code').textContent()) ?? '';
  for (const d of [b, c]) {
    await d.page.getByLabel('Room code', { exact: true }).fill(code);
    await d.page.getByRole('button', { name: 'Join', exact: true }).click();
    await expect(d.page.getByTestId('room-code')).toHaveText(code);
  }
  await a.page.getByLabel('Rounds').selectOption('3');
  await a.page.getByRole('button', { name: 'Start game' }).click();
  // Production timings: the start countdown, then 2.5 s of "get ready".
  for (const d of [a, b, c]) {
    await expect(d.page.locator('.np-letter')).toHaveText(/^[A-Z]$/, { timeout: 15_000 });
  }
  const L = await npatLetter(a.page);

  // Everyone types. A shares one answer with B; A's place is odd; C fills only a name.
  const aSheet = {
    name: `${L}aravq`,
    place: `${L}zorbaplace`,
    animal: `${L}yxa`,
    thing: `${L}ompq`,
  };
  await fill(a.page, aSheet);
  await fill(b.page, {
    name: `${L}aravq`,
    place: `${L}umbleb`,
    animal: `${L}ynxb`,
    thing: `${L}ampb`,
  });
  await fill(c.page, { name: `${L}orvikc` });
  await c.page.waitForTimeout(1000); // C's autosave reaches the server

  // Reconnect: C reloads mid-round and gets the same seat and their own saved sheet back.
  await c.page.reload();
  await expect(c.page.locator('input[data-category="name"]')).toHaveValue(`${L}orvikc`);
  await expect(c.page.getByText('A bot is playing for you.')).toHaveCount(0);
  // Drafts stay private: nothing of A's sheet reached the others' sockets so far.
  for (const d of [b, c]) expect(d.frames.some((f) => f.includes(aSheet.place))).toBe(false);

  // STOP (open after 15 s) ends writing for everyone.
  const stop = a.page.locator('.np-stop--ready');
  await expect(stop).toBeVisible({ timeout: 30_000 });
  await stop.click({ force: true }); // it pulses
  for (const d of [a, b, c]) await expect(d.page.locator('.np-review')).toBeVisible();
  for (const d of [b, c]) {
    const reveal = d.frames.findIndex((f) => f.includes('"phase":"REVIEW"'));
    expect(d.frames.slice(0, reveal).some((f) => f.includes(aSheet.place))).toBe(false);
  }

  // Automatic check: C's blanks show as blank; A's odd place is "Not in our list".
  const oddRow = (page: Page) => page.locator('.np-row', { hasText: aSheet.place });
  await expect(oddRow(b.page)).toContainText('Not in our list');
  // Frozen voting rule, three human players: 2 votes needed.
  await expect(oddRow(b.page).locator('.np-row__votes')).toHaveText('0 of 2 ✗');
  await oddRow(b.page).locator('.np-vote').click();
  await expect(oddRow(a.page).locator('.np-row__votes')).toHaveText('1 of 2 ✗');
  await expect(oddRow(a.page)).not.toHaveClass(/np-row--out/);
  await oddRow(c.page).locator('.np-vote').click();
  await expect(oddRow(a.page)).toHaveClass(/np-row--out/);
  await expect(oddRow(a.page).locator('.np-vote')).toHaveCount(0); // never your own

  for (const d of [a, b, c])
    await d.page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(a.page.locator('.np-scores')).toBeVisible();
  // Scoring: A 5 (shared name) + 0 (voted out) + 10 + 10; B 5 + 10 + 10 + 10; C 10.
  await expect(scoreOf(a.page, 'Smoke A')).toHaveText('25');
  await expect(scoreOf(a.page, 'Smoke B')).toHaveText('35');
  await expect(scoreOf(a.page, 'Smoke C')).toHaveText('10');

  for (const d of [a, b, c]) {
    expect(d.sockets.length).toBeGreaterThan(0);
    for (const url of d.sockets) {
      expect(url).toContain('/api/socket/socket.io/');
      expect(url).toContain('transport=websocket');
      if (URL.startsWith('https://')) expect(url.startsWith('wss://')).toBe(true);
    }
  }
});
