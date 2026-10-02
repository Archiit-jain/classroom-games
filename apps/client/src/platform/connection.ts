import type {
  Ack,
  C2SEventName,
  C2SPayload,
  C2SResults,
  ClientToServerEvents,
  ReactionId,
  ReportReason,
  RoomEvent,
  ServerToClientEvents,
} from '@cg/protocol';
import { io, type Socket } from 'socket.io-client';
import type { ClientErrorCode } from '../i18n/en';
import { errorMessage, t } from '../i18n';
import { createActionSender } from './actions';
import { estimateOffset, type PingSample } from './clock';
import { KEYS, storage } from './storage';
import { Store, initialState, type AppState, type MatchState, type Toast } from './store';
import type { StreamBatch } from '@cg/game-sdk/client';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export type ClientAck<T> = Ack<T> | { ok: false; code: ClientErrorCode; retryAfterMs?: number };

const REQUEST_TIMEOUT_MS = 8000;
const SLOW_CONNECT_MS = 3000;
/** Matches the waking-up message's promise of "up to a minute". */
const UNREACHABLE_MS = 60_000;
const MAX_CHAT = 100;
/** Streamed chunks kept for late subscribers (a board mounting mid-turn). */
const MAX_STREAM_LOG = 20_000;
/** How long a reaction bubble stays on screen. */
export const REACTION_SHOW_MS = 2400;

function loadHidden(): string[] {
  try {
    const raw = storage.get(KEYS.hidden, 'session');
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * The client's single link to the server. Owns the socket, keeps the app
 * store in sync with server messages and exposes typed request methods.
 * The client never decides game outcomes; it only sends intents.
 */
export class GameConnection {
  readonly store = new Store<AppState>({ ...initialState, hidden: loadHidden() });
  private readonly socket: ClientSocket;
  private clockOffset = 0;
  private toastSeq = 0;
  private reactionSeq = 0;
  private connectTimers: ReturnType<typeof setTimeout>[] = [];
  /** The game server this client talks to (shown when it cannot be reached). */
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    this.socket = io(url, {
      path: socketPath(),
      // WebSocket only: long-polling cannot work when requests may reach different
      // server instances (Vercel), and every supported browser has WebSockets.
      transports: ['websocket'],
      auth: (cb) => {
        const token = storage.get(KEYS.token);
        cb(token ? { token } : {});
      },
      reconnectionDelayMax: 5000,
    });
    this.armConnectTimers();
    this.wire();
  }

  // ─────────────────────────── requests ───────────────────────────

  request<K extends C2SEventName>(
    name: K,
    payload: C2SPayload<K>,
  ): Promise<ClientAck<C2SResults[K]>> {
    if (!this.socket.connected) return Promise.resolve({ ok: false, code: 'OFFLINE' });
    const s = this.socket as unknown as {
      timeout(ms: number): {
        emitWithAck(event: string, payload: unknown): Promise<ClientAck<C2SResults[K]>>;
      };
    };
    return s
      .timeout(REQUEST_TIMEOUT_MS)
      .emitWithAck(name, payload)
      .catch(() => ({ ok: false as const, code: 'TIMEOUT' as const }));
  }

  private readonly actionSender = createActionSender((payload) =>
    this.request('match:action', payload),
  );

  private readonly updateListeners = new Set<(update: MatchState) => void>();
  private readonly streamListeners = new Set<(batch: StreamBatch) => void>();
  /** Everything streamed in the current match (replaced by a server reset). */
  private streamLog: { matchId: string; chunks: unknown[] } | null = null;

  /**
   * Streamed chunks of the current match (STREAMED games): first everything so far as one
   * `reset` batch, then new chunks as they arrive. Returns an unsubscribe function.
   */
  subscribeStream(listener: (batch: StreamBatch) => void): () => void {
    const matchId = this.store.get().match?.matchId;
    const chunks =
      this.streamLog && this.streamLog.matchId === matchId ? this.streamLog.chunks : [];
    listener({ chunks: [...chunks], reset: true });
    this.streamListeners.add(listener);
    return () => this.streamListeners.delete(listener);
  }

  /** Sends a stream chunk for the current match (fire-and-forget; the server validates it). */
  sendStream(chunk: unknown): void {
    const matchId = this.store.get().match?.matchId;
    if (!matchId || !this.socket.connected) return;
    void this.request('match:stream', { matchId, chunk });
  }

  /** Receive every match update in arrival order (used by the animation director). */
  subscribeUpdates(listener: (update: MatchState) => void): () => void {
    this.updateListeners.add(listener);
    return () => this.updateListeners.delete(listener);
  }

  /**
   * Sends a game action for the current match with a fresh action id. An
   * identical action still waiting for its ack is not sent twice (double taps).
   */
  sendAction(action: unknown): Promise<ClientAck<{ version: number }>> {
    const match = this.store.get().match;
    if (!match) return Promise.resolve({ ok: false, code: 'MATCH_NOT_FOUND' });
    return this.actionSender(match, action);
  }

  async setNickname(nickname: string): Promise<ClientAck<{ nickname: string }>> {
    const res = await this.request('session:setNickname', { nickname });
    if (res.ok) {
      storage.set(KEYS.nickname, res.nickname);
      this.store.set((s) => ({
        session: s.session ? { ...s.session, nickname: res.nickname } : s.session,
      }));
    }
    return res;
  }

  toggleHidden(playerId: string, hide?: boolean): void {
    this.store.set((s) => {
      const isHidden = s.hidden.includes(playerId);
      const shouldHide = hide ?? !isHidden;
      const hidden = shouldHide
        ? isHidden
          ? s.hidden
          : [...s.hidden, playerId]
        : s.hidden.filter((id) => id !== playerId);
      storage.set(KEYS.hidden, JSON.stringify(hidden), 'session');
      return { hidden };
    });
  }

  /** Sends a quick reaction (shown over your seat for everyone in the match). */
  react(reactionId: ReactionId): Promise<ClientAck<C2SResults['chat:react']>> {
    return this.request('chat:react', { reactionId });
  }

  async report(playerId: string, reason: ReportReason): Promise<void> {
    // Hide immediately for the reporter, whatever the server says.
    this.toggleHidden(playerId, true);
    const res = await this.request('report:submit', { playerId, reason });
    if (res.ok) this.toast(t('room.reported'));
  }

  /** Milliseconds from now until a server timestamp, on this device's clock. */
  msUntil = (serverTs: number): number => serverTs - (Date.now() + this.clockOffset);

  toast(message: string, tone: Toast['tone'] = 'info'): void {
    const id = ++this.toastSeq;
    this.store.set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
    setTimeout(
      () => this.store.set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
      4500,
    );
  }

  toastError(res: { code: Parameters<typeof errorMessage>[0]; retryAfterMs?: number }): void {
    this.toast(errorMessage(res.code, res.retryAfterMs), 'error');
  }

  reconnectHere(): void {
    this.store.set({ connection: 'connecting' });
    this.socket.connect();
  }

  // ─────────────────────────── wiring ───────────────────────────

  /** Marks a connection attempt as slow, then as unreachable, while it keeps retrying. */
  private armConnectTimers(): void {
    for (const timer of this.connectTimers) clearTimeout(timer);
    const mark = (patch: Pick<AppState, 'slow'> | Pick<AppState, 'unreachable'>) => () => {
      if (this.store.get().connection !== 'connected') this.store.set(patch);
    };
    this.connectTimers = [
      setTimeout(mark({ slow: true }), SLOW_CONNECT_MS),
      setTimeout(mark({ unreachable: true }), UNREACHABLE_MS),
    ];
  }

  private async syncClock(): Promise<void> {
    const samples: PingSample[] = [];
    for (let i = 0; i < 5; i++) {
      const sentAt = Date.now();
      const res = await this.request('time:ping', { clientTs: sentAt });
      if (!res.ok) break;
      samples.push({ sentAt, receivedAt: Date.now(), serverNow: res.serverNow });
    }
    if (samples.length > 0) this.clockOffset = estimateOffset(samples);
  }

  private wire(): void {
    const { socket, store } = this;

    socket.on('connect', () => {
      store.set({
        connection: 'connected',
        slow: false,
        unreachable: false,
        serverRestarting: false,
      });
      void this.syncClock();
    });

    socket.on('connect_error', (err) => {
      if (store.get().connection === 'connected') store.set({ connection: 'reconnecting' });
      if (err.message === 'SERVER_BUSY' || err.message === 'RATE_LIMITED') {
        this.toastError({ code: err.message });
      }
    });

    socket.on('disconnect', (reason) => {
      if (store.get().connection === 'displaced') return;
      store.set({ connection: 'reconnecting' });
      this.armConnectTimers();
      // A server-initiated disconnect is not retried automatically by Socket.IO.
      if (reason === 'io server disconnect') socket.connect();
    });

    socket.on('session:ready', (ready) => {
      if (ready.token) storage.set(KEYS.token, ready.token);
      store.set((s) => {
        const session = { playerId: ready.playerId, nickname: ready.nickname };
        // A different identity (e.g. the server restarted) owns none of the old room state.
        if (s.session && s.session.playerId !== ready.playerId) {
          return { session, games: ready.games, room: null, match: null, results: null, chat: [] };
        }
        return { session, games: ready.games };
      });
    });

    socket.on('session:displaced', () => {
      store.set({ connection: 'displaced' });
    });

    socket.on('room:snapshot', ({ room }) => {
      store.set((s) => {
        if (!room) return { room: null, match: null, results: null, chat: [] };
        const sameMatch = room.match && s.match?.matchId === room.match.matchId;
        return {
          room,
          match: sameMatch ? s.match : null,
          results: room.match?.results
            ? { matchId: room.match.matchId, results: room.match.results }
            : null,
        };
      });
    });

    socket.on('room:event', (event) => this.onRoomEvent(event));

    socket.on('match:stream', ({ matchId, chunks, reset }) => {
      const fresh = reset || this.streamLog?.matchId !== matchId;
      if (fresh) this.streamLog = { matchId, chunks: [...chunks] };
      else this.streamLog?.chunks.push(...chunks);
      if (this.streamLog && this.streamLog.chunks.length > MAX_STREAM_LOG) {
        this.streamLog.chunks.splice(0, this.streamLog.chunks.length - MAX_STREAM_LOG);
      }
      for (const listener of this.streamListeners) listener({ chunks, reset: fresh });
    });

    socket.on('match:update', (update) => {
      const current = store.get().match;
      // Ignore out-of-order deliveries for the same match. Every update carries a
      // complete view, so a skipped version only means skipped animations.
      if (current?.matchId === update.matchId && update.version <= current.version) return;
      const match = {
        matchId: update.matchId,
        gameId: update.gameId,
        version: update.version,
        you: update.you,
        view: update.view,
        events: update.events,
      };
      store.set({ match });
      // Every update also goes straight to the animation director, so updates
      // arriving within one render frame are never coalesced away.
      for (const listener of this.updateListeners) listener(match);
    });

    socket.on('match:end', (end) => store.set({ results: end }));

    socket.on('chat:message', (message) => {
      store.set((s) => ({ chat: [...s.chat, message].slice(-MAX_CHAT) }));
    });

    socket.on('chat:history', ({ messages }) => store.set({ chat: messages.slice(-MAX_CHAT) }));

    socket.on('chat:reaction', ({ fromId, seat, reactionId }) => {
      // Muted / reported players' reactions are hidden like their chat.
      if (store.get().hidden.includes(fromId)) return;
      const key = ++this.reactionSeq;
      store.set((s) => ({
        reactions: [...s.reactions, { key, fromId, seat, reactionId }].slice(-12),
      }));
      setTimeout(
        () => store.set((s) => ({ reactions: s.reactions.filter((r) => r.key !== key) })),
        REACTION_SHOW_MS,
      );
    });

    socket.on('system:notice', ({ code }) => {
      if (code === 'SERVER_RESTARTING') store.set({ serverRestarting: true });
    });
  }

  private onRoomEvent(event: RoomEvent): void {
    const me = this.store.get().session?.playerId;
    switch (event.type) {
      case 'KICKED':
        this.toast(t('room.kicked'), 'error');
        break;
      case 'ROOM_CLOSED':
        this.toast(t('room.closed'));
        break;
      case 'HOST_CHANGED':
        if (event.hostId === me) this.toast(t('room.nowHost'));
        break;
      case 'MATCH_ABORTED':
        this.toast(t('room.matchAborted'), 'error');
        break;
      case 'SEAT_TAKEN_OVER':
      case 'SEAT_RECLAIMED':
        // Shown from the room snapshot (seat takeover state), which survives reconnects.
        break;
    }
  }
}

/**
 * Where the game server is. A production build talks to its own site (same
 * origin, HTTPS/WSS — e.g. the Vercel deployment) unless VITE_SERVER_URL says
 * otherwise; only a development build falls back to a local server on port 3001.
 */
export function defaultServerUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (configured) return configured;
  if (import.meta.env.PROD) return window.location.origin;
  return `${window.location.protocol}//${window.location.hostname}:3001`;
}

/**
 * The Socket.IO path. A production build that talks to its own site uses the
 * game-server Function's route on Vercel (`/api/socket/…`, see vercel.json);
 * development and a separate server (VITE_SERVER_URL) use the Socket.IO default.
 * VITE_SOCKET_PATH overrides both.
 */
export function socketPath(): string {
  const configured = import.meta.env.VITE_SOCKET_PATH as string | undefined;
  if (configured) return configured;
  const sameSite = import.meta.env.PROD && !import.meta.env.VITE_SERVER_URL;
  return sameSite ? '/api/socket/socket.io' : '/socket.io';
}
