/**
 * A minimal Socket.IO (Engine.IO v4) client over Node's built-in WebSocket, for the
 * production security smoke test: it can send exactly what a hostile client would
 * (malformed payloads, missing acknowledgements), keeps every raw frame, and needs
 * no dependency at the repository root.
 */
type Listener = (payload: unknown) => void;

export class RawSocket {
  readonly frames: string[] = [];
  readonly events: Array<{ event: string; payload: unknown }> = [];
  private nextAck = 1;
  private readonly acks = new Map<number, (args: unknown[]) => void>();
  private readonly listeners = new Map<string, Set<Listener>>();
  ready!: { playerId: string; token?: string; nickname: string | null };

  private constructor(private readonly ws: WebSocket) {}

  /** Connects (optionally resuming a session) and resolves once session:ready arrives. */
  static async connect(
    baseUrl: string,
    options: { token?: string; path?: string } = {},
  ): Promise<RawSocket> {
    const url = new URL(options.path ?? '/api/socket/socket.io/', baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.search = '?EIO=4&transport=websocket';
    const socket = new RawSocket(new WebSocket(url));
    const ready = socket.waitFor('session:ready', 10_000);
    // Wait for Engine.IO's open packet ("0{sid…}") before joining the namespace.
    await new Promise<void>((resolve, reject) => {
      socket.ws.addEventListener('message', (m) => {
        const frame = String(m.data);
        if (frame.startsWith('0')) resolve();
        socket.onFrame(frame);
      });
      socket.ws.addEventListener('error', () => reject(new Error('WebSocket error')));
      socket.ws.addEventListener('close', () => reject(new Error('closed during handshake')));
    });
    // Namespace connect with the handshake auth (Socket.IO packet type 0).
    socket.ws.send(`40${JSON.stringify(options.token ? { token: options.token } : {})}`);
    socket.ready = (await ready) as RawSocket['ready'];
    return socket;
  }

  private onFrame(frame: string): void {
    this.frames.push(frame);
    if (frame === '2') {
      this.ws.send('3'); // Engine.IO ping → pong
      return;
    }
    // Socket.IO EVENT: 42[...], ACK: 43<id>[...]
    const match = /^4([23])(\d*)(\[.*)$/su.exec(frame);
    if (!match) return;
    const [, type, id, json] = match as unknown as [string, string, string, string];
    const args = JSON.parse(json) as unknown[];
    if (type === '3') {
      this.acks.get(Number(id))?.(args);
      this.acks.delete(Number(id));
      return;
    }
    const [event, payload] = args as [string, unknown];
    this.events.push({ event, payload });
    for (const fn of this.listeners.get(event) ?? []) fn(payload);
  }

  /** Emits with an acknowledgement; resolves with the server's answer (or rejects on timeout). */
  emit(
    event: string,
    ...args: unknown[]
  ): Promise<{ ok: boolean; code?: string } & Record<string, unknown>> {
    const id = this.nextAck++;
    this.ws.send(`42${id}${JSON.stringify([event, ...args])}`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.acks.delete(id);
        reject(new Error(`no answer to ${event}`));
      }, 8_000);
      this.acks.set(id, (answer) => {
        clearTimeout(timer);
        resolve(answer[0] as { ok: boolean; code?: string });
      });
    });
  }

  /** Emits without an acknowledgement (the server must ignore it, not crash). */
  emitNoAck(event: string, ...args: unknown[]): void {
    this.ws.send(`42${JSON.stringify([event, ...args])}`);
  }

  /** Sends a raw text frame (e.g. a broken packet). */
  sendRaw(frame: string): void {
    this.ws.send(frame);
  }

  on(event: string, fn: Listener): void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(fn);
    this.listeners.set(event, set);
  }

  all(event: string): unknown[] {
    return this.events.filter((e) => e.event === event).map((e) => e.payload);
  }

  /** Resolves with the first (already received or future) payload of `event` matching `test`. */
  waitFor(
    event: string,
    timeoutMs = 8_000,
    test: (p: unknown) => boolean = () => true,
  ): Promise<unknown> {
    const seen = this.all(event).find(test);
    if (seen !== undefined) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for ${event}`)),
        timeoutMs,
      );
      const fn: Listener = (p) => {
        if (!test(p)) return;
        clearTimeout(timer);
        this.listeners.get(event)?.delete(fn);
        resolve(p);
      };
      this.on(event, fn);
    });
  }

  get open(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  close(): void {
    this.ws.close();
  }
}
