import { writeFile } from 'node:fs/promises';
import type { Page, TestInfo, TestType } from '@playwright/test';

/**
 * End-to-end diagnostics: what each player's browser saw and what the server told it.
 *
 * Every page created by `newPlayer` is watched. We record browser console errors and page
 * errors, and we read the Socket.IO frames the page receives and sends (match updates,
 * room snapshots, room events, match end, our actions and the server's acks). That is the
 * server's own account of the match — phase, version, deadline, who it thinks is connected —
 * without any production change and without anything the page could not already see.
 *
 * When a test fails (or times out), `attachDiagnostics` attaches it all as JSON and prints a
 * compact summary.
 */

interface Frame {
  kind: 'event' | 'ack';
  id: number | undefined;
  data: unknown[];
}

/** Socket.IO v4 over Engine.IO: `42[id]["event",payload]` (event) / `43id[payload]` (ack). */
function parseFrame(raw: string | Buffer): Frame | null {
  const text = typeof raw === 'string' ? raw : raw.toString('utf8');
  const m = /^4([23])(\d*)(\[[\s\S]*)$/.exec(text);
  if (!m) return null;
  try {
    const data = JSON.parse(m[3] as string) as unknown;
    if (!Array.isArray(data)) return null;
    return { kind: m[1] === '2' ? 'event' : 'ack', id: m[2] ? Number(m[2]) : undefined, data };
  } catch {
    return null;
  }
}

type Json = Record<string, unknown>;
const asObj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});

const push = <T>(list: T[], item: T, max: number) => {
  list.push(item);
  if (list.length > max) list.shift();
};

/** What one player's page saw. */
class PlayerWatch {
  readonly started = Date.now();
  consoleErrors: string[] = [];
  pageErrors: string[] = [];
  updates: Json[] = [];
  updateCount = 0;
  rooms: Json[] = [];
  roomEvents: Json[] = [];
  actions: Json[] = [];
  matchEnd: Json | null = null;
  progress: Json[] = [];
  private readonly sent = new Map<number, Json>();

  constructor(
    readonly label: string,
    readonly page: Page,
  ) {
    page.on('console', (msg) => {
      if (msg.type() === 'error') push(this.consoleErrors, `${this.t()}ms ${msg.text()}`, 50);
    });
    page.on('pageerror', (err) => push(this.pageErrors, `${this.t()}ms ${err.message}`, 50));
    page.on('websocket', (ws) => {
      ws.on('framereceived', ({ payload }) => this.received(payload));
      ws.on('framesent', ({ payload }) => this.sentFrame(payload));
    });
  }

  t(): number {
    return Date.now() - this.started;
  }

  private received(payload: string | Buffer): void {
    const frame = parseFrame(payload);
    if (!frame) return;
    if (frame.kind === 'ack') {
      const action = frame.id === undefined ? undefined : this.sent.get(frame.id);
      if (action) {
        const res = asObj(frame.data[0]);
        action.ack = res.ok ? 'ok' : res.code;
        action.ackAt = this.t();
      }
      return;
    }
    const [name, body] = frame.data as [string, unknown];
    const p = asObj(body);
    switch (name) {
      case 'match:update': {
        this.updateCount++;
        const v = asObj(p.view);
        push(
          this.updates,
          {
            t: this.t(),
            version: p.version,
            you: p.you,
            phase: v.phase,
            pass: v.cycle,
            active: v.active,
            selected: v.selected,
            canClaim: v.canClaim,
            mySelection: v.mySelection !== null && v.mySelection !== undefined,
            handSize: Array.isArray(v.hand) ? v.hand.length : undefined,
            finishes: Array.isArray(v.finishes)
              ? v.finishes.map((f) => `${asObj(f).seat}:${asObj(f).place}`)
              : undefined,
            deadlineInMs:
              typeof v.phaseEndsAt === 'number' && typeof p.serverNow === 'number'
                ? v.phaseEndsAt - p.serverNow
                : undefined,
            events: Array.isArray(p.events) ? p.events.map((e) => asObj(e).type) : [],
          },
          25,
        );
        break;
      }
      case 'room:snapshot': {
        const room = asObj(p.room);
        const match = asObj(room.match);
        push(
          this.rooms,
          {
            t: this.t(),
            phase: room.phase ?? null,
            members: Array.isArray(room.members)
              ? room.members.map((m) => {
                  const o = asObj(m);
                  return o.kind === 'HUMAN' ? `${o.nickname}:${o.status}` : `${o.name}:BOT`;
                })
              : [],
            seats: Array.isArray(match.seats)
              ? match.seats.map((s) => {
                  const o = asObj(s);
                  const takeover = asObj(o.takeover);
                  return `${o.seat}:${o.displayName}:${o.controller}${takeover.reason ? `(${takeover.reason})` : ''}`;
                })
              : [],
          },
          10,
        );
        break;
      }
      case 'room:event':
        push(this.roomEvents, { t: this.t(), ...p }, 30);
        break;
      case 'match:end':
        this.matchEnd = { t: this.t(), placements: asObj(p.results).placements };
        break;
    }
  }

  private sentFrame(payload: string | Buffer): void {
    const frame = parseFrame(payload);
    if (!frame || frame.kind !== 'event') return;
    const [name, body] = frame.data as [string, unknown];
    if (name !== 'match:action') return;
    const p = asObj(body);
    const entry: Json = { t: this.t(), version: p.version, type: asObj(p.action).type };
    if (frame.id !== undefined) this.sent.set(frame.id, entry);
    push(this.actions, entry, 20);
  }

  /** The page as a person would see it right now (DOM only). */
  async snapshot(): Promise<Json> {
    if (this.page.isClosed()) return { closed: true };
    return this.page
      .evaluate(() => {
        const q = (s: string) => document.querySelector(s);
        const text = (s: string) => q(s)?.textContent?.trim() ?? null;
        const all = (s: string, attr?: string) =>
          [...document.querySelectorAll(s)].map((el) =>
            attr ? el.getAttribute(attr) : (el.textContent?.trim() ?? ''),
          );
        return {
          url: location.href,
          effects: document.documentElement.dataset.effects ?? null,
          banners: all('.banner'),
          toasts: all('.toast'),
          screen: q('.results')
            ? 'results'
            : q('.match')
              ? 'match'
              : q('.lobby')
                ? 'lobby'
                : 'other',
          desk: text('.sp-desk__inner'),
          passCounter: text('.sp-pass'),
          countdown: text('.sp-desk .cb-ring__label'),
          handSlips: document.querySelectorAll('.sp-hand__slip').length,
          handEnabled: document.querySelectorAll('.sp-hand__slip:not([disabled])').length,
          passSpotFilled: !!q('.sp-spot.is-filled'),
          claimButton: !!q('.sp-claim__btn'),
          opponentsSelected: all('.sp-seat.is-selected', 'aria-label'),
          finishedSeats: all('.sp-seat.is-done', 'aria-label'),
          myFinish: text('.sp-mine-done__text'),
        };
      })
      .catch((err: unknown) => ({ error: String(err) }));
  }

  async sample(): Promise<void> {
    const s = await this.snapshot();
    push(
      this.progress,
      {
        t: this.t(),
        screen: s.screen,
        pass: s.passCounter,
        desk: s.desk,
        version: this.updates.at(-1)?.version,
      },
      40,
    );
  }

  async report(): Promise<Json> {
    return {
      player: this.label,
      elapsedMs: this.t(),
      dom: await this.snapshot(),
      lastUpdate: this.updates.at(-1) ?? null,
      updateCount: this.updateCount,
      lastRoom: this.rooms.at(-1) ?? null,
      roomEvents: this.roomEvents,
      matchEnd: this.matchEnd,
      recentActions: this.actions,
      recentUpdates: this.updates,
      progress: this.progress,
      consoleErrors: this.consoleErrors,
      pageErrors: this.pageErrors,
    };
  }
}

const watches: PlayerWatch[] = [];

/** Starts recording a player's page (called by `newPlayer`). */
export function watchPlayer(page: Page, label: string): void {
  watches.push(new PlayerWatch(label, page));
}

export function resetWatches(): void {
  watches.length = 0;
}

/** Records a light progress sample for every watched page (no waiting involved). */
export async function sampleProgress(): Promise<void> {
  await Promise.all(watches.map((w) => w.sample()));
}

/** Length of the match as the server reported it to the first player (passes, seconds). */
export function matchLength(): string {
  const w = watches[0];
  const u = w?.updates.at(-1);
  return w ? `${String(u?.pass)} passes in ${Math.round(w.t() / 1000)} s` : 'unknown';
}

/** One-line state of every watched page, for error messages. */
export async function progressSummary(): Promise<string> {
  const parts = await Promise.all(
    watches.map(async (w) => {
      const s = await w.snapshot();
      const u = w.updates.at(-1);
      return `${w.label}: screen=${String(s.screen)} ${String(s.passCounter)} desk="${String(s.desk)}" server: v${String(u?.version)} ${String(u?.phase)} pass ${String(u?.pass)} active=${JSON.stringify(u?.active)}`;
    }),
  );
  return parts.join(' | ');
}

/** Attaches everything recorded to the test report and prints a summary. */
export async function attachDiagnostics(testInfo: TestInfo): Promise<void> {
  const reports = await Promise.all(watches.map((w) => w.report()));
  const body = JSON.stringify(
    {
      test: testInfo.title,
      project: testInfo.project.name,
      retry: testInfo.retry,
      players: reports,
    },
    null,
    2,
  );
  const file = testInfo.outputPath('diagnostics.json');
  await writeFile(file, body);
  await testInfo.attach('diagnostics.json', { path: file, contentType: 'application/json' });
  console.warn(
    `[diagnostics] ${testInfo.title} (${testInfo.project.name}, retry ${testInfo.retry})`,
  );
  console.warn(`[diagnostics] ${await progressSummary()}`);
}

/**
 * Closes every player's browser context (which finishes their video files) and, for a
 * failed test, attaches the videos. Passing tests' output is discarded by the config.
 */
async function closePlayers(testInfo: TestInfo, failed: boolean): Promise<void> {
  for (const w of watches) {
    const video = w.page.video();
    await w.page
      .context()
      .close()
      .catch(() => undefined);
    const path = await video?.path().catch(() => undefined);
    if (failed && path) {
      await testInfo.attach(`video-${w.label}`, { path, contentType: 'video/webm' });
    }
  }
}

/** Clears the recorders before each test and attaches diagnostics when a test fails. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function installDiagnostics(test: TestType<any, any>): void {
  test.beforeEach(() => resetWatches());
  // Playwright requires the fixtures argument to be destructured, even when empty.
  // eslint-disable-next-line no-empty-pattern
  test.afterEach(async ({}, testInfo) => {
    const failed = testInfo.status !== testInfo.expectedStatus;
    if (failed) await attachDiagnostics(testInfo);
    await closePlayers(testInfo, failed);
  });
}
