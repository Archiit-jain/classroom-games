import { expect, test, type Page } from '@playwright/test';
import { installDiagnostics } from './diagnostics';
import { FIXTURE, createRoom, joinRoom, newPlayer } from './helpers';

installDiagnostics(test);

/**
 * Phase 11 §19: bad networks. A player's Wi-Fi drops for a few seconds in the middle of
 * a match, or the connection is slow: the screen says what is happening, play resumes
 * with the server's state, and no move is sent twice.
 */
const counter = async (page: Page) =>
  Number(await page.locator('.fixture__value').innerText({ timeout: 15_000 }));
/** The connection banner (not the screen-reader-only status regions). */
const banner = (page: Page) => page.locator('.banner');

test('a brief Wi-Fi loss mid-match: clear status, then the same game resumes @mobile', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const host = await newPlayer(browser, 'Anu');
  const guest = await newPlayer(browser, 'Bela');
  const code = await createRoom(host, FIXTURE);
  await joinRoom(guest, code);
  await host.getByRole('button', { name: 'Start game' }).click();
  await expect(guest.locator('.fixture__value')).toBeVisible();

  // The guest's connection disappears for a few seconds (as on a train or a lift).
  await guest.context().setOffline(true);
  // Within seconds, not the ~45 s Socket.IO's heartbeat would take on its own.
  await expect(banner(guest)).toContainText(/reconnecting|offline/i, { timeout: 12_000 });
  // Meanwhile the host keeps playing whenever it is their turn.
  const plus = host.getByRole('button', { name: '+1', disabled: false });
  if (await plus.isVisible()) await plus.click({ timeout: 2000 }).catch(() => undefined);
  await host.waitForTimeout(3000);
  await guest.context().setOffline(false);

  // Back online: the banner goes away and both screens agree on the board.
  await expect(banner(guest)).toHaveCount(0, { timeout: 20_000 });
  await expect
    .poll(async () => (await counter(guest)) === (await counter(host)), { timeout: 10_000 })
    .toBe(true);
  // And play goes on: whoever's turn it is makes one move, counted once on both screens.
  const mover = (await guest.getByRole('button', { name: '+1', disabled: false }).isVisible())
    ? guest
    : host;
  const before = await counter(host);
  await mover.getByRole('button', { name: '+1', disabled: false }).click({ timeout: 15_000 });
  await expect.poll(() => counter(host), { timeout: 10_000 }).toBe(before + 1);
  await expect.poll(() => counter(guest), { timeout: 10_000 }).toBe(before + 1);
});

test('a slow, high-latency connection: moves still land once, nothing freezes', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const host = await newPlayer(browser, 'Kabir');
  const guest = await newPlayer(browser, 'Meera');
  // ~400 ms round trips and a 3G-like bandwidth for the guest.
  const cdp = await guest.context().newCDPSession(guest);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 400,
    downloadThroughput: (400 * 1024) / 8,
    uploadThroughput: (400 * 1024) / 8,
  });
  const code = await createRoom(host, FIXTURE);
  await joinRoom(guest, code);
  await host.getByRole('button', { name: 'Start game' }).click();
  await expect(guest.locator('.fixture__value')).toBeVisible({ timeout: 30_000 });

  // Three turns each (well short of the target of 15, so the match doesn't end); the
  // guest double-taps every time - a slow network invites it.
  for (let turn = 0; turn < 3; turn++) {
    for (const page of [host, guest]) {
      const plus = page.getByRole('button', { name: '+1', disabled: false });
      if (!(await plus.isVisible().catch(() => false))) continue;
      const before = await counter(host);
      await plus.click({ timeout: 3000 }).catch(() => undefined);
      if (page === guest) await plus.click({ timeout: 300 }).catch(() => undefined);
      // Exactly one step, on both screens.
      await expect.poll(() => counter(host), { timeout: 10_000 }).toBe(before + 1);
      await expect.poll(() => counter(guest), { timeout: 10_000 }).toBe(before + 1);
      if (await page.getByRole('heading', { name: 'Results' }).isVisible()) return;
    }
  }
});
