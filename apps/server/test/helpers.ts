import { randomBytes } from 'node:crypto';
import type { AnyGameModule } from '@cg/game-sdk';
import { createFixtureGame } from '@cg/game-sdk/fixture';
import type {
  Ack,
  C2SEventName,
  C2SPayload,
  C2SResults,
  ClientToServerEvents,
  RoomView,
  ServerToClientEvents,
  SessionReady,
} from '@cg/protocol';
import { io as ioClient, type Socket } from 'socket.io-client';
import { createGameServer, type GameServer } from '../src/app';
import { loadConfig, mergeConfig, type ConfigOverrides } from '../src/config';
import type { Logger } from '../src/log';
import type { ReportSink } from '../src/reports/ReportService';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export type S2CName = keyof ServerToClientEvents;
export type S2CPayload<K extends S2CName> = Parameters<ServerToClientEvents[K]>[0];

/** A fresh client-style action id (unique per intent). */
export const newActionId = (): string => `t_${randomBytes(9).toString('base64url')}`;

/** Fast fixture for integration tests: short turns, quick bots. */
export const testFixture = (options: Parameters<typeof createFixtureGame>[0] = {}) =>
  createFixtureGame({ turnMs: 250, botThinkMs: [20, 60], ...options });

export interface TestServer {
  server: GameServer;
  url: string;
  connect(options?: ConnectOptions): Promise<TestClient>;
  /** Connects and sets a nickname. */
  player(nickname: string): Promise<TestClient>;
  close(): Promise<void>;
}

export interface ConnectOptions {
  token?: string;
  origin?: string;
  /** Socket.IO path (the production build serves it at /api/socket/socket.io). */
  path?: string;
}

export async function startServer(
  overrides: ConfigOverrides = {},
  options: { games?: AnyGameModule[]; reportSink?: ReportSink; log?: Logger } = {},
): Promise<TestServer> {
  const config = mergeConfig(
    loadConfig(
      {},
      {
        host: '127.0.0.1',
        logLevel: 'silent',
        timing: { reconnectGraceMs: 400, startingCountdownMs: 50 },
        limits: { newSessionsPerIpPerMinute: 10_000 },
      },
    ),
    overrides,
  );
  const server = createGameServer({
    config,
    games: options.games ?? [testFixture()],
    ...(options.reportSink ? { reportSink: options.reportSink } : {}),
    ...(options.log ? { log: options.log } : {}),
  });
  const port = await server.listen(0);
  const url = `http://127.0.0.1:${port}`;
  const clients: TestClient[] = [];

  const connect = async (connectOptions: ConnectOptions = {}) => {
    const client = await TestClient.connect(url, connectOptions);
    clients.push(client);
    return client;
  };

  return {
    server,
    url,
    connect,
    async player(nickname) {
      const client = await connect();
      const res = await client.emit('session:setNickname', { nickname });
      if (!res.ok) throw new Error(`setNickname failed: ${res.code}`);
      return client;
    },
    async close() {
      for (const c of clients) c.close();
      await server.close();
    },
  };
}

interface RawEngine {
  on(event: 'packet', fn: (packet: { data?: unknown }) => void): void;
}

interface Waiter {
  event: string;
  predicate: (payload: unknown) => boolean;
  resolve: (payload: unknown) => void;
}

export class TestClient {
  readonly received = new Map<string, unknown[]>();
  /** Every raw frame the server sent this client (Engine.IO payloads), for leak scans. */
  readonly frames: string[] = [];
  private waiters: Waiter[] = [];
  ready!: SessionReady;

  private constructor(readonly socket: ClientSocket) {
    // The Engine.IO connection exists once the manager opens; record from then on.
    socket.io.on('open', () => {
      const engine = (socket.io as unknown as { engine: RawEngine }).engine;
      engine.on('packet', (packet) => {
        if (typeof packet.data === 'string') this.frames.push(packet.data);
      });
    });
    socket.onAny((event: string, payload: unknown) => {
      const list = this.received.get(event) ?? [];
      list.push(payload);
      this.received.set(event, list);
      this.waiters = this.waiters.filter((w) => {
        if (w.event === event && w.predicate(payload)) {
          w.resolve(payload);
          return false;
        }
        return true;
      });
    });
  }

  static async connect(url: string, options: ConnectOptions = {}): Promise<TestClient> {
    const socket: ClientSocket = ioClient(url, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: options.token ? { token: options.token } : {},
      ...(options.origin ? { extraHeaders: { origin: options.origin } } : {}),
      ...(options.path ? { path: options.path } : {}),
    });
    const client = new TestClient(socket);
    client.ready = await client.waitFor('session:ready');
    return client;
  }

  get playerId(): string {
    return this.ready.playerId;
  }

  emit<K extends C2SEventName>(name: K, payload: C2SPayload<K>): Promise<Ack<C2SResults[K]>> {
    const s = this.socket as unknown as {
      timeout(ms: number): { emitWithAck(event: string, payload: unknown): Promise<unknown> };
    };
    return s.timeout(3000).emitWithAck(name, payload) as Promise<Ack<C2SResults[K]>>;
  }

  /** Sends an arbitrary (possibly malformed) event and returns the raw acknowledgement. */
  emitRaw(name: string, ...args: unknown[]): Promise<unknown> {
    const s = this.socket as unknown as {
      timeout(ms: number): { emitWithAck(event: string, ...args: unknown[]): Promise<unknown> };
    };
    return s.timeout(3000).emitWithAck(name, ...args);
  }

  /** Fire-and-forget emit with no acknowledgement (for abuse tests). */
  emitNoAck(name: string, ...args: unknown[]): void {
    (this.socket as unknown as { emit(event: string, ...rest: unknown[]): void }).emit(
      name,
      ...args,
    );
  }

  /** Sends a game action for the match/version in `ref`, with a fresh (or given) action id. */
  act(
    ref: { matchId: string; version: number },
    action: unknown,
    actionId: string = newActionId(),
  ): Promise<Ack<C2SResults['match:action']>> {
    return this.emit('match:action', {
      matchId: ref.matchId,
      version: ref.version,
      actionId,
      action,
    });
  }

  all<K extends S2CName>(event: K): S2CPayload<K>[] {
    return (this.received.get(event) ?? []) as S2CPayload<K>[];
  }

  last<K extends S2CName>(event: K): S2CPayload<K> | undefined {
    const list = this.all(event);
    return list[list.length - 1];
  }

  /** Resolves with the first (already received or future) payload matching `predicate`. */
  waitFor<K extends S2CName>(
    event: K,
    predicate: (payload: S2CPayload<K>) => boolean = () => true,
    timeoutMs = 4000,
  ): Promise<S2CPayload<K>> {
    const existing = this.all(event).find((p) => predicate(p));
    if (existing !== undefined) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        event,
        predicate: predicate as (p: unknown) => boolean,
        resolve: (p) => {
          clearTimeout(timer);
          resolve(p as S2CPayload<K>);
        },
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new Error(`Timed out waiting for "${event}"`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  /** Waits for a room snapshot matching `predicate` (null room allowed). */
  waitForRoom(
    predicate: (room: RoomView | null) => boolean,
    timeoutMs?: number,
  ): Promise<RoomView | null> {
    return this.waitFor('room:snapshot', (p) => predicate(p.room), timeoutMs).then((p) => p.room);
  }

  clear(event?: S2CName): void {
    if (event) this.received.delete(event);
    else this.received.clear();
  }

  close(): void {
    this.socket.disconnect();
  }
}

export async function expectConnectError(
  url: string,
  options: ConnectOptions = {},
): Promise<Error> {
  const socket = ioClient(url, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    ...(options.origin ? { extraHeaders: { origin: options.origin } } : {}),
  });
  return new Promise((resolve, reject) => {
    socket.on('connect', () => {
      socket.disconnect();
      reject(new Error('Expected the connection to be refused'));
    });
    socket.on('connect_error', (err) => {
      socket.disconnect();
      resolve(err);
    });
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Polls until `check` returns true. */
export async function eventually(
  check: () => boolean,
  timeoutMs = 4000,
  stepMs = 20,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Condition not met in time');
    await sleep(stepMs);
  }
}

/** Host creates a private room; guests join it. Returns the room code. */
export async function setupRoom(host: TestClient, ...guests: TestClient[]): Promise<string> {
  return setupGameRoom('fixture', host, ...guests);
}

export async function setupGameRoom(
  gameId: string,
  host: TestClient,
  ...guests: TestClient[]
): Promise<string> {
  const created = await host.emit('room:create', { gameId });
  if (!created.ok) throw new Error(`create failed: ${created.code}`);
  const code = created.room.code as string;
  for (const guest of guests) {
    const joined = await guest.emit('room:join', { code });
    if (!joined.ok) throw new Error(`join failed: ${joined.code}`);
  }
  return code;
}

/** Makes a client play "+amount" automatically whenever it is their turn. */
export function autoPlay(client: TestClient, amount: 1 | 2 | 3 = 3): void {
  client.socket.on('match:update', (update) => {
    const view = update.view as { phase: string; turn: number };
    if (view.phase === 'PLAYING' && view.turn === update.you) {
      void client.act(update, { type: 'ADD', amount }).catch(() => undefined);
    }
  });
}
