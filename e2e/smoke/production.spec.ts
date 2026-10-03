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

test('production: two devices play a full Business match, staying in sync through a reconnect', async ({
  browser,
}) => {
  test.setTimeout(480_000);
  const a = await recordedDevice(browser, 'Smoke A');
  const b = await recordedDevice(browser, 'Smoke B');
  await a.page.getByRole('button', { name: 'Create room: Business' }).click();
  const code = (await a.page.getByTestId('room-code').textContent()) ?? '';
  await b.page.getByLabel('Room code', { exact: true }).fill(code);
  await b.page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(b.page.getByTestId('room-code')).toHaveText(code);
  await expect(a.page.getByLabel('Rounds', { exact: true })).toHaveValue('15');
  await a.page.getByRole('button', { name: 'Start game' }).click();
  for (const d of [a, b])
    await expect(d.page.locator('.bz-tile')).toHaveCount(36, { timeout: 15_000 });

  const owned = (page: Page) =>
    page
      .locator('.bz-tile--owned')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-space')).sort())
      .catch(() => [] as (string | null)[]);
  const cash = (page: Page) =>
    page
      .locator('.bz-player__cash')
      .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
      .catch(() => [] as (string | null)[]);
  const logText = (page: Page) =>
    page
      .locator('.bz-log__item')
      .allInnerTexts()
      .catch(() => [] as string[]);
  const enabled = (l: ReturnType<Page['locator']>) =>
    l.isEnabled({ timeout: 30 }).catch(() => false);
  const click = (l: ReturnType<Page['locator']>) =>
    l.click({ timeout: 1000 }).catch(() => undefined);
  const seen = {
    rolled: false,
    bought: false,
    rent: false,
    built: false,
    event: false,
    loan: false,
    auction: false,
    reconnected: false,
  };
  const pages = () => [a.page, b.page];
  const sameBoards = async () => {
    await expect
      .poll(async () => (await owned(b.page)).join(), { timeout: 10_000 })
      .toBe((await owned(a.page)).join());
    await expect
      .poll(async () => (await cash(b.page)).join(), { timeout: 10_000 })
      .toBe((await cash(a.page)).join());
  };

  const deadline = Date.now() + 460_000;
  while (Date.now() < deadline) {
    if (await a.page.getByRole('heading', { name: 'Results' }).isVisible()) break;
    for (const page of pages()) {
      const roll = page.getByRole('button', { name: /Roll the dice|Roll for/ });
      if (await enabled(roll)) {
        // A, once it owns something: a loan, then an auction that B wins.
        if (page === a.page && (await a.page.locator('.bz-tile--mine').count()) > 0) {
          if (!seen.loan) {
            await click(a.page.getByRole('button', { name: 'Loan', exact: true }));
            await click(a.page.getByRole('button', { name: 'Borrow ₹1,000' }));
            await expect(b.page.locator('.bz-log')).toContainText('borrowed ₹1,000');
            seen.loan = true;
            continue;
          }
          if (!seen.auction) {
            const space = (await owned(a.page))[0];
            await click(a.page.getByRole('button', { name: 'Auction', exact: true }));
            await click(a.page.getByRole('button', { name: /^Auction / }).first());
            await expect(b.page.locator('.bz-auction')).toBeVisible();
            await click(b.page.locator('.bz-auction .btn--primary').first());
            await expect(a.page.locator(`.bz-tile[data-space="${space}"]`)).not.toHaveClass(
              /bz-tile--mine/,
              { timeout: 40_000 },
            );
            await sameBoards();
            seen.auction = true;
            continue;
          }
        }
        await click(roll);
        continue;
      }
      const buy = page.getByRole('button', { name: /^BUY/ });
      if (await enabled(buy)) {
        await click(buy);
        continue;
      }
      const build = page.locator('.bz-tray .btn--primary', { hasText: /house|hotel/i }).first();
      if (await enabled(build)) {
        await click(build);
        continue;
      }
      for (const name of [
        /Don’t buy|Not now/,
        /Lose your next roll/,
        /Let the bank handle it/,
        /^Decline$/,
      ]) {
        const btn = page.getByRole('button', { name }).first();
        if (await enabled(btn)) await click(btn);
      }
    }
    const lines = [...(await logText(a.page)), ...(await logText(b.page))];
    // Dice, ownership, rent, buildings and event effects reach both devices.
    if (!seen.rolled && lines.some((l) => / rolled \d \+ \d/u.test(l))) seen.rolled = true;
    if (!seen.bought && lines.some((l) => l.includes(' bought '))) {
      await sameBoards();
      seen.bought = true;
    }
    if (!seen.rent && lines.some((l) => / paid ₹[\d,]+ to /u.test(l))) {
      await sameBoards();
      seen.rent = true;
    }
    if (!seen.built && lines.some((l) => / built a | got a free /u.test(l))) {
      const buildings = (page: Page) => page.locator('.bz-tile__buildings > span').count();
      await expect.poll(() => buildings(b.page), { timeout: 10_000 }).toBe(await buildings(a.page));
      seen.built = true;
    }
    if (!seen.event && lines.some((l) => /: (Chance|Community Chest) \d+ — /u.test(l))) {
      await sameBoards();
      seen.event = true;
    }
    // After the first purchase, B reloads mid-match: same seat, same board.
    if (seen.bought && !seen.reconnected) {
      await b.page.reload();
      await expect(b.page.locator('.bz-tile')).toHaveCount(36, { timeout: 15_000 });
      await sameBoards();
      await expect(b.page.locator('.bz-player--me')).toHaveCount(1);
      await expect(b.page.getByText('A bot is playing for you.')).toHaveCount(0);
      seen.reconnected = true;
    }
    await a.page.waitForTimeout(200);
  }
  expect(seen).toEqual({
    rolled: true,
    bought: true,
    rent: true,
    built: true,
    event: true,
    loan: true,
    auction: true,
    reconnected: true,
  });
  for (const d of [a, b]) {
    await expect(d.page.getByRole('heading', { name: 'Results' })).toBeVisible({ timeout: 30_000 });
    await expect(d.page.locator('.results__row')).toHaveCount(2);
    await expect(
      d.page.getByRole('columnheader', { name: 'Final wealth', exact: true }),
    ).toBeVisible();
    for (const url of d.sockets) {
      expect(url).toContain('/api/socket/socket.io/');
      expect(url).toContain('transport=websocket');
    }
  }
});
