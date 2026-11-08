import { io, type Socket } from 'socket.io-client';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type RaceCountdown,
  type RaceProgressPayload,
  type RaceResultsPayload,
  type RoomStatePayload,
} from '@typeroom/shared';

/**
 * A scripted Socket.IO player. It only needs a server URL, so the same class drives the
 * in-process integration tests and (later) load tests against a deployed server.
 */

export interface ServerEventPayloads {
  [SERVER_EVENTS.ROOM_STATE]: RoomStatePayload;
  [SERVER_EVENTS.RACE_COUNTDOWN]: RaceCountdown;
  [SERVER_EVENTS.RACE_PROGRESS]: RaceProgressPayload;
  [SERVER_EVENTS.RACE_RESULTS]: RaceResultsPayload;
  [SERVER_EVENTS.ERROR]: { error: string };
}
export type ServerEventName = keyof ServerEventPayloads;

export interface ReceivedEvent<E extends ServerEventName = ServerEventName> {
  /** Monotonic sequence number across every event this client has received, on any socket. */
  seq: number;
  event: E;
  payload: ServerEventPayloads[E];
  receivedAt: number;
}

export interface JoinAck {
  playerId: string;
  token: string;
  room: RoomStatePayload;
}

export interface WaitOptions {
  timeoutMs?: number;
  /** Only consider events with `seq` greater than this cursor (see `mark()`). Defaults to every event received so far. */
  after?: number;
}

export interface RaceClientOptions {
  /** Default timeout for acks and waits. */
  timeoutMs?: number;
}

export class RaceClientError extends Error {}

export class RaceClient {
  socket: Socket;
  playerId?: string;
  token?: string;
  roomCode?: string;
  readonly events: ReceivedEvent[] = [];
  private seq = 0;
  private readonly listeners = new Set<() => void>();
  private readonly timeoutMs: number;

  private constructor(
    readonly url: string,
    readonly username: string,
    options: RaceClientOptions,
  ) {
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.socket = this.openSocket();
  }

  /** Opens a websocket connection and resolves once it is established. */
  static async connect(url: string, username: string, options: RaceClientOptions = {}): Promise<RaceClient> {
    const client = new RaceClient(url, username, options);
    await client.waitForConnect();
    return client;
  }

  // ---- requests -----------------------------------------------------------------------------

  async createRoom(options: { bot?: { targetWpm: 40 | 60 | 90 | 120 } } = {}): Promise<JoinAck> {
    const payload = { username: this.username, ...(this.token ? { token: this.token } : {}), ...options };
    return this.storeJoin(await this.request(CLIENT_EVENTS.CREATE_ROOM, payload));
  }

  async joinRoom(code: string | undefined = this.roomCode): Promise<JoinAck> {
    const payload = { username: this.username, ...(code ? { code } : {}), ...(this.token ? { token: this.token } : {}) };
    return this.storeJoin(await this.request(CLIENT_EVENTS.JOIN_ROOM, payload));
  }

  async startRace(): Promise<void> {
    await this.request(CLIENT_EVENTS.START_RACE, {});
  }

  async raceAgain(): Promise<void> {
    await this.request(CLIENT_EVENTS.RACE_AGAIN, {});
  }

  /** Fire-and-forget: the server does not acknowledge leave_room. */
  leave(): void {
    this.socket.emit(CLIENT_EVENTS.LEAVE_ROOM);
  }

  /** Sends one keystroke exactly as the web client does: `{ char, index }`, no ack. */
  keystroke(char: string, index: number): void {
    this.socket.emit(CLIENT_EVENTS.KEYSTROKE, { char, index });
  }

  /** Sends arbitrary (possibly malicious) payloads; used to probe validation. */
  emitRaw(event: string, ...args: unknown[]): void {
    this.socket.emit(event, ...args);
  }

  /** Emits and resolves with the raw ack value, without throwing on `{ error }`. */
  async requestRaw(event: string, payload: unknown): Promise<unknown> {
    return this.socket.timeout(this.timeoutMs).emitWithAck(event, payload);
  }

  /** Emits and resolves with the ack, throwing `RaceClientError` when the server answers `{ error }`. */
  async request(event: string, payload: unknown): Promise<unknown> {
    const ack = await this.requestRaw(event, payload);
    if (ack && typeof ack === 'object' && 'error' in ack) throw new RaceClientError(String((ack as { error: unknown }).error));
    return ack;
  }

  /**
   * Types `chars` starting at server position `startIndex`. With `intervalMs` > 0 keystrokes are
   * paced, which keeps a long text under the server's per-second burst limit.
   */
  async type(chars: string, startIndex = 0, options: { intervalMs?: number } = {}): Promise<void> {
    const intervalMs = options.intervalMs ?? 0;
    for (let offset = 0; offset < chars.length; offset += 1) {
      this.keystroke(chars[offset] ?? '', startIndex + offset);
      if (intervalMs > 0) await delay(intervalMs);
    }
  }

  // ---- connection lifecycle -----------------------------------------------------------------

  /** Drops the connection the way a closed tab or lost network would. */
  async disconnect(): Promise<void> {
    if (!this.socket.connected) return;
    const closed = new Promise<void>((resolve) => this.socket.once('disconnect', () => resolve()));
    this.socket.disconnect();
    await closed;
  }

  /** Opens a fresh socket and reattaches to the room with the stored session token. */
  async reconnect(): Promise<JoinAck> {
    if (!this.token || !this.roomCode) throw new RaceClientError('Nothing to reconnect to: create or join a room first');
    await this.disconnect();
    this.socket.removeAllListeners();
    this.socket = this.openSocket();
    await this.waitForConnect();
    return this.joinRoom(this.roomCode);
  }

  async close(): Promise<void> {
    await this.disconnect();
    this.socket.removeAllListeners();
    this.socket.close();
    for (const wake of this.listeners) wake();
  }

  // ---- observing server events --------------------------------------------------------------

  /** A cursor for `waitFor({ after })`: only events received after this call will match. */
  mark(): number {
    return this.seq;
  }

  received<E extends ServerEventName>(event: E, after = 0): Array<ReceivedEvent<E>> {
    return this.events.filter((item): item is ReceivedEvent<E> => item.event === event && item.seq > after);
  }

  /** Resolves with the first matching event, including ones already received after `options.after`. */
  async waitFor<E extends ServerEventName>(
    event: E,
    predicate: (payload: ServerEventPayloads[E]) => boolean = () => true,
    options: WaitOptions = {},
  ): Promise<ServerEventPayloads[E]> {
    const after = options.after ?? 0;
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const find = () => this.received(event, after).find((item) => predicate(item.payload));
    const existing = find();
    if (existing) return existing.payload;
    return new Promise((resolve, reject) => {
      const check = () => {
        const match = find();
        if (!match) return;
        cleanup();
        resolve(match.payload);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new RaceClientError(`${this.username}: timed out after ${timeoutMs}ms waiting for ${event}`));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.listeners.delete(check);
      };
      this.listeners.add(check);
    });
  }

  /** Waits for `count` progress broadcasts that arrive after this call; a cheap "server has caught up" barrier. */
  async nextProgress(count = 1, options: Omit<WaitOptions, 'after'> = {}): Promise<RaceProgressPayload> {
    const start = this.mark();
    let seen = 0;
    return this.waitFor(SERVER_EVENTS.RACE_PROGRESS, () => (seen += 1) >= count, { ...options, after: start });
  }

  /** This client's entry in the most recent progress broadcast. */
  latestSelf(): RaceProgressPayload['players'][number] | undefined {
    const last = this.received(SERVER_EVENTS.RACE_PROGRESS).at(-1);
    return last?.payload.players.find((player) => player.playerId === this.playerId);
  }

  // ---- internals ----------------------------------------------------------------------------

  private openSocket(): Socket {
    const socket = io(this.url, { transports: ['websocket'], forceNew: true, reconnection: false });
    socket.onAny((event: string, payload: unknown) => {
      if (!isServerEvent(event)) return;
      this.seq += 1;
      this.events.push({ seq: this.seq, event, payload, receivedAt: Date.now() } as ReceivedEvent);
      for (const wake of [...this.listeners]) wake();
    });
    return socket;
  }

  private async waitForConnect(): Promise<void> {
    if (this.socket.connected) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new RaceClientError(`${this.username}: connect timed out`)), this.timeoutMs);
      this.socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      this.socket.once('connect_error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  private storeJoin(ack: unknown): JoinAck {
    const join = ack as JoinAck;
    this.playerId = join.playerId;
    this.token = join.token;
    this.roomCode = join.room.code;
    return join;
  }
}

const SERVER_EVENT_NAMES = new Set<string>(Object.values(SERVER_EVENTS));
function isServerEvent(event: string): event is ServerEventName {
  return SERVER_EVENT_NAMES.has(event);
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
