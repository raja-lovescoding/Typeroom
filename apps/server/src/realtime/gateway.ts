import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import {
  CLIENT_EVENTS,
  createRoomSchema,
  DEFAULT_QUICK_RACE_CONFIG,
  joinRoomSchema,
  keystrokeSchema,
  leaveRoomSchema,
  queueClosedSchema,
  queueJoinSchema,
  queueLeaveSchema,
  queueMatchedSchema,
  queueUpdateSchema,
  raceAgainSchema,
  raceCountdownSchema,
  raceProgressSchema,
  raceResultsSchema,
  roomClosedSchema,
  roomStateSchema,
  QUICK_RACE_LOBBY_WAIT_MS,
  SERVER_EVENTS,
  setRaceConfigSchema,
  startRaceSchema,
  type QueueClosedReason,
  type RaceConfig,
  type RaceResult,
  type RoomClosedReason,
  type RoomKind,
} from '@typeroom/shared';
import { env } from '../config/env.js';
import { BotPlayer, type BotRandom } from '../domain/bot.js';
import { GhostTypist, type Typist } from '../domain/ghost.js';
import { checkNickname } from '../domain/nickname.js';
import { createGuestSession, type GuestSession } from '../domain/session.js';
import { logger } from '../lib/logger.js';
import { RateLimiter } from '../lib/rateLimiter.js';
import { InMemoryMatchmakingQueue, type Lobby, type MatchmakingQueue, type QueueMember, type QueueStats, type QuickMatch } from '../services/matchmakingQueue.js';
import { InMemoryRatingStore, type RatingStore } from '../services/ratingStore.js';
import { RoomManager, type NewPlayer, type Room } from '../services/roomManager.js';
import { TextProvider, type RaceText, type RaceTextSource } from '../services/textProvider.js';

export type { RaceTextSource } from '../services/textProvider.js';

interface Session extends GuestSession {
  roomCode?: string;
}

type Ack = (value: unknown) => void;

/** A finished race that counts towards stats: no ghosts took part, and only human results are included. */
export interface RecordedRace {
  code: string;
  kind: RoomKind;
  config: RaceConfig;
  results: RaceResult[];
}

/** Tunables for the realtime gateway. Production uses the defaults; tests and load tests shorten them. */
export interface RealtimeOptions {
  countdownMs: number;
  /** Shortest time limit for a race that is not in time mode. */
  raceLimitMs: number;
  /** Untimed races get at least long enough for someone typing at this speed to finish. */
  minRaceWpm: number;
  disconnectGraceMs: number;
  tickIntervalMs: number;
  /** Applies to create_room and join_room together, per client address. */
  joinRateLimit: { limit: number; windowMs: number };
  /** Race mode changes per socket. */
  configRateLimit: { limit: number; windowMs: number };
  /** Rooms with no connected human are closed after this long. */
  roomIdleMs: number;
  /** How often idle rooms, stale sessions and rate-limit entries are swept. */
  sweepIntervalMs: number;
  /** Read the client address from X-Forwarded-For (only behind a trusted reverse proxy). */
  trustProxy: boolean;
  corsOrigin: string;
  textProvider: RaceTextSource;
  /** How long a Quick Race lobby waits after its first player joins. */
  quickRaceWaitMs: number;
  /** How long a player who drops out of a Quick Race lobby keeps their seat. */
  queueGraceMs: number;
  /** queue:join and queue:leave together, per socket and per client address. */
  queueRateLimit: { perSocket: { limit: number; windowMs: number }; perAddress: { limit: number; windowMs: number } };
  /** Rolling average WPM per player, used for matchmaking bands. Defaults to an in-memory store. */
  ratings?: RatingStore;
  /**
   * Called once per finished race that counts towards stats (persistence hooks in here). Races with
   * ghosts are never passed on, and bot results are stripped, so they can't be farmed for stats.
   */
  recordRace?: (race: RecordedRace) => void;
  /** Randomness for ghost line-ups and typing; tests pass a seeded source. */
  random?: BotRandom;
}

/** Live counts of in-memory state, used to assert that rooms and timers are cleaned up. */
export interface RealtimeStats {
  rooms: number;
  sessions: number;
  timers: { countdown: number; tick: number; finish: number; disconnect: number; bot: number; lobby: number; queueGrace: number; total: number };
  queue: QueueStats;
}

export interface RealtimeServer {
  io: Server;
  inspect(): RealtimeStats;
  /** Runs one idle sweep immediately (tests use this instead of waiting for the interval). */
  sweep(now?: number): void;
  /** Closes every room (clearing all of its timers) and shuts down Socket.IO and the underlying HTTP server. */
  close(): Promise<void>;
}

export const DEFAULT_REALTIME_OPTIONS: Omit<RealtimeOptions, 'textProvider' | 'corsOrigin' | 'trustProxy'> = {
  countdownMs: 5_000,
  raceLimitMs: 120_000,
  minRaceWpm: 20,
  disconnectGraceMs: 20_000,
  tickIntervalMs: 100,
  joinRateLimit: { limit: 20, windowMs: 60_000 },
  configRateLimit: { limit: 20, windowMs: 10_000 },
  roomIdleMs: 10 * 60_000,
  sweepIntervalMs: 60_000,
  quickRaceWaitMs: QUICK_RACE_LOBBY_WAIT_MS,
  queueGraceMs: 5_000,
  queueRateLimit: { perSocket: { limit: 12, windowMs: 10_000 }, perAddress: { limit: 60, windowMs: 60_000 } },
};

export function createRealtimeServer(httpServer: HttpServer, overrides: Partial<RealtimeOptions> = {}): RealtimeServer {
  const options: RealtimeOptions = {
    ...DEFAULT_REALTIME_OPTIONS,
    disconnectGraceMs: env.DISCONNECT_GRACE_MS,
    roomIdleMs: env.ROOM_IDLE_MS,
    trustProxy: env.TRUST_PROXY,
    corsOrigin: env.CLIENT_ORIGIN,
    textProvider: new TextProvider(),
    ...overrides,
  };
  const { countdownMs: COUNTDOWN_MS, disconnectGraceMs: DISCONNECT_GRACE_MS, textProvider } = options;
  const io = new Server(httpServer, { cors: { origin: options.corsOrigin } });
  const rooms = new RoomManager();
  const joinLimiter = new RateLimiter(options.joinRateLimit.limit, options.joinRateLimit.windowMs);
  const configLimiter = new RateLimiter(options.configRateLimit.limit, options.configRateLimit.windowMs);
  /** token -> session */
  const sessions = new Map<string, Session>();
  /** socket.id -> the session that socket speaks for */
  const socketSessions = new Map<string, Session>();
  const botTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const ratings = options.ratings ?? new InMemoryRatingStore();
  const random: BotRandom = options.random ?? { next: Math.random };
  const queueSocketLimiter = new RateLimiter(options.queueRateLimit.perSocket.limit, options.queueRateLimit.perSocket.windowMs);
  const queueAddressLimiter = new RateLimiter(options.queueRateLimit.perAddress.limit, options.queueRateLimit.perAddress.windowMs);

  // ---- helpers ------------------------------------------------------------------------------

  const clientAddress = (socket: Socket): string => {
    if (options.trustProxy) {
      const forwarded = socket.handshake.headers['x-forwarded-for'];
      const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
      if (first) return first;
    }
    return socket.handshake.address;
  };

  const sendError = (socket: Socket, message: string, acknowledge?: Ack) => {
    acknowledge?.({ error: message });
    socket.emit(SERVER_EVENTS.ERROR, { error: message });
  };

  /** The session and room for a socket, if the socket's player is (still) the room's live connection. */
  const currentRoom = (socket: Socket): { session: Session; room: Room } | undefined => {
    const session = socketSessions.get(socket.id);
    const room = session?.roomCode ? rooms.get(session.roomCode) : undefined;
    if (!session || !room || room.players.get(session.playerId)?.socketId !== socket.id) return undefined;
    return { session, room };
  };

  const clearBotTimers = (code: string) => {
    for (const [key, timer] of botTimers) {
      if (key.startsWith(`${code}:`)) {
        clearTimeout(timer);
        botTimers.delete(key);
      }
    }
  };

  const clearDisconnectTimers = (room: Room) => {
    for (const timer of room.disconnectTimers.values()) clearTimeout(timer);
    room.disconnectTimers.clear();
  };

  const emitRoomState = (room: Room) => {
    io.to(room.code).emit(SERVER_EVENTS.ROOM_STATE, roomStateSchema.parse(rooms.snapshot(room)));
  };

  const closeRoom = (room: Room, reason: RoomClosedReason) => {
    io.to(room.code).emit(SERVER_EVENTS.ROOM_CLOSED, roomClosedSchema.parse({ code: room.code, reason }));
    io.in(room.code).socketsLeave(room.code);
    for (const player of room.players.values()) {
      const session = player.token ? sessions.get(player.token) : undefined;
      if (session?.roomCode === room.code) delete session.roomCode;
    }
    clearBotTimers(room.code);
    rooms.close(room.code);
  };

  const timeLimitFor = (config: RaceConfig, text: string): number => {
    if (config.mode === 'time') return config.seconds * 1_000;
    const minutesAtMinSpeed = text.length / 5 / options.minRaceWpm;
    return Math.max(options.raceLimitMs, Math.ceil(minutesAtMinSpeed * 60_000));
  };

  const raceTextFor = (config: RaceConfig): RaceText =>
    config.mode === 'custom' ? { text: config.text } : textProvider.getRaceText(config);

  // ---- race lifecycle -----------------------------------------------------------------------

  const finishRace = (room: Room) => {
    if (room.state !== 'RACING') return;
    for (const player of room.players.values()) {
      if (player.status === 'disconnected') rooms.markDnf(room, player.playerId);
    }
    rooms.transition(room, 'RESULTS');
    const payload = raceResultsSchema.parse({ code: room.code, results: rooms.results(room, Date.now()) });
    io.to(room.code).emit(SERVER_EVENTS.RACE_RESULTS, payload);
    recordResults(room, payload.results);
    if (room.tickTimer) clearInterval(room.tickTimer);
    if (room.finishTimer) clearTimeout(room.finishTimer);
    delete room.tickTimer;
    delete room.finishTimer;
    clearDisconnectTimers(room);
    clearBotTimers(room.code);
  };

  /**
   * Feeds finishers' WPM into the matchmaking average (so a newcomer is re-banded after one race),
   * and passes races without ghosts on to `recordRace`. Ghost races never count towards stats.
   */
  const recordResults = (room: Room, results: RaceResult[]) => {
    if (room.config.mode !== 'custom') {
      for (const result of results) {
        if (!result.isBot && result.finishTimeMs !== null) ratings.record(result.playerId, result.wpm);
      }
    }
    if (rooms.hasGhosts(room) || !options.recordRace) return;
    try {
      options.recordRace({ code: room.code, kind: room.kind, config: room.config, results: results.filter((result) => !result.isBot) });
    } catch (error) {
      logger.error({ err: error, code: room.code }, 'Unable to record race');
    }
  };

  const tick = (room: Room) => {
    const payload = raceProgressSchema.parse({
      code: room.code,
      text: room.text,
      startsAt: room.startsAt,
      players: rooms.progress(room, Date.now()),
    });
    io.to(room.code).emit(SERVER_EVENTS.RACE_PROGRESS, payload);
    if (rooms.allDone(room)) finishRace(room);
  };

  /** Starts (or restarts) the grace window after which a disconnected racer is DNF. */
  const scheduleDisconnect = (room: Room, playerId: string) => {
    const previous = room.disconnectTimers.get(playerId);
    if (previous) clearTimeout(previous);
    room.disconnectTimers.set(playerId, setTimeout(() => {
      room.disconnectTimers.delete(playerId);
      if (room.state !== 'RACING') return;
      rooms.markDnf(room, playerId);
      tick(room);
    }, DISCONNECT_GRACE_MS));
  };

  /** Drives a practice bot or a ghost through the same keystroke handler humans use. */
  const scheduleBot = (room: Room, playerId: string, bot: Typist) => {
    const key = `${room.code}:${playerId}`;
    const sendNext = () => {
      botTimers.delete(key);
      if (room.state !== 'RACING' || !room.text) return;
      const next = bot.nextChar(room.text);
      if (!next) return;
      rooms.handleKeystroke(room, playerId, next.char, next.index, Date.now());
      if (rooms.allDone(room)) {
        finishRace(room);
        return;
      }
      botTimers.set(key, setTimeout(sendNext, bot.nextDelay(room.text[next.index] ?? ' ')));
    };
    botTimers.set(key, setTimeout(sendNext, 0));
  };

  const runRace = (room: Room) => {
    const startsAt = room.startsAt ?? Date.now() + COUNTDOWN_MS;
    room.countdownTimer = setTimeout(() => {
      delete room.countdownTimer;
      if (room.state !== 'COUNTDOWN') return;
      rooms.beginRace(room, startsAt);
      room.tickTimer = setInterval(() => tick(room), options.tickIntervalMs);
      room.finishTimer = setTimeout(() => {
        delete room.finishTimer;
        rooms.expire(room);
        tick(room);
        finishRace(room);
      }, room.timeLimitMs ?? options.raceLimitMs);
      for (const player of room.players.values()) {
        if (!player.isBot || player.botWpm === undefined) continue;
        scheduleBot(room, player.playerId, player.isGhost ? new GhostTypist(player.botWpm, random) : new BotPlayer(player.botWpm));
      }
      tick(room);
    }, Math.max(0, startsAt - Date.now()));
  };

  /** LOBBY -> COUNTDOWN for a room: pick the text, broadcast the countdown, and run the race loop. */
  const startRoomRace = (room: Room) => {
    const race = raceTextFor(room.config);
    const timeLimitMs = timeLimitFor(room.config, race.text);
    rooms.startRace(room, race, Date.now(), COUNTDOWN_MS, timeLimitMs);
    const countdown = raceCountdownSchema.parse({
      startsInMs: COUNTDOWN_MS,
      text: race.text,
      config: room.config,
      timeLimitMs,
      ...(race.source ? { source: race.source } : {}),
    });
    io.to(room.code).emit(SERVER_EVENTS.RACE_COUNTDOWN, countdown);
    emitRoomState(room);
    // Anyone already offline when the race starts gets the same grace window as a mid-race drop.
    for (const player of room.players.values()) {
      if (player.status === 'disconnected') scheduleDisconnect(room, player.playerId);
    }
    runRace(room);
  };

  // ---- quick race matchmaking ----------------------------------------------------------------

  const socketAlive = (socketId: string | undefined): boolean => socketId !== undefined && io.sockets.sockets.has(socketId);

  const emitQueueUpdate = (lobby: Lobby) => {
    const targets = [...lobby.members.values()].flatMap((member) => (member.connected && member.socketId ? [member.socketId] : []));
    if (targets.length > 0) io.to(targets).emit(SERVER_EVENTS.QUEUE_UPDATE, queueUpdateSchema.parse(queue.view(lobby)));
  };

  const emitQueueClosed = (socketId: string | undefined, reason: QueueClosedReason) => {
    if (socketId) io.to(socketId).emit(SERVER_EVENTS.QUEUE_CLOSED, queueClosedSchema.parse({ reason }));
  };

  /**
   * Hands a locked lobby to the normal race machinery: a `quick` room with the humans (and any
   * ghosts), then the same countdown, race loop, scoring, results and disconnect grace as any room.
   */
  const launchQuickRace = (match: QuickMatch) => {
    const asPlayer = (member: QueueMember): NewPlayer => ({
      playerId: member.playerId,
      username: member.username,
      token: member.token,
      connected: member.connected,
      isBot: false,
      ...(member.socketId ? { socketId: member.socketId } : {}),
    });
    const [lead, ...others] = match.humans;
    if (!lead) return;
    const room = rooms.createRoom(asPlayer(lead), { config: match.config, kind: 'quick' });
    for (const member of others) rooms.joinRoom(room.code, asPlayer(member));
    for (const ghost of match.ghosts) rooms.addGhost(room, ghost);
    const snapshot = roomStateSchema.parse(rooms.snapshot(room));
    for (const member of match.humans) {
      const session = sessions.get(member.token);
      if (session) session.roomCode = room.code;
      const socket = member.socketId ? io.sockets.sockets.get(member.socketId) : undefined;
      if (!socket) continue;
      void socket.join(room.code);
      socket.emit(SERVER_EVENTS.QUEUE_MATCHED, queueMatchedSchema.parse({ lobbyId: match.lobbyId, playerId: member.playerId, room: snapshot }));
    }
    logger.debug({ code: room.code, band: match.band, humans: match.humans.length, ghosts: match.ghosts.length }, 'Quick race matched');
    startRoomRace(room);
  };

  const queue: MatchmakingQueue = new InMemoryMatchmakingQueue({
    onUpdate: (lobby) => emitQueueUpdate(lobby),
    onMatch: (match) => {
      try {
        launchQuickRace(match);
      } catch (error) {
        logger.error({ err: error }, 'Unable to start quick race');
        for (const member of match.humans) emitQueueClosed(member.socketId, 'expired');
      }
    },
    onExpired: (member) => emitQueueClosed(member.socketId, 'expired'),
  }, { waitMs: options.quickRaceWaitMs, graceMs: options.queueGraceMs, random });

  /** Takes the session out of matchmaking (it is joining a room some other way). */
  const dropFromQueue = (session: Session, reason: QueueClosedReason) => {
    const member = queue.lobbyOf(session.playerId)?.members.get(session.playerId);
    if (!member || !queue.leave(session.playerId)) return;
    emitQueueClosed(member.socketId, reason);
  };

  // ---- membership ---------------------------------------------------------------------------

  /** Removes the session's player from its current room, closing the room if the host left. */
  const leaveCurrentRoom = (session: Session, socket: Socket) => {
    const code = session.roomCode;
    delete session.roomCode;
    if (!code) return;
    void socket.leave(code);
    const room = rooms.get(code);
    if (!room) return;
    if (rooms.leaveRoom(code, session.playerId)) {
      closeRoom(room, 'host_left');
      return;
    }
    emitRoomState(room);
    if (room.state === 'RACING' && rooms.allDone(room)) finishRace(room);
  };

  /** Resolves (or creates) the guest session for a create/join request and binds it to this socket. */
  const bindSession = (socket: Socket, username: string, token: string | undefined): Session => {
    const existing = token ? sessions.get(token) : undefined;
    const session: Session = existing ?? createGuestSession(username);
    session.username = username;
    sessions.set(session.token, session);
    socketSessions.set(socket.id, session);
    return session;
  };

  const attach = (socket: Socket, session: Session, code: string): Room => {
    const room = rooms.get(code);
    if (!room) throw new Error('Room not found');
    if (session.roomCode && session.roomCode !== code) leaveCurrentRoom(session, socket);
    if (room.players.has(session.playerId)) {
      rooms.reconnect(room, session.playerId, socket.id);
    } else {
      rooms.joinRoom(code, {
        playerId: session.playerId,
        username: session.username,
        token: session.token,
        connected: true,
        isBot: false,
        socketId: socket.id,
      });
    }
    session.roomCode = room.code;
    delete room.idleSince;
    void socket.join(room.code);
    emitRoomState(room);
    return room;
  };

  /** Validates the nickname separately so the player gets a specific reason. */
  const nicknameFrom = (raw: unknown): ReturnType<typeof checkNickname> =>
    checkNickname(raw && typeof raw === 'object' ? (raw as { username?: unknown }).username : undefined);

  // ---- events -------------------------------------------------------------------------------

  io.on('connection', (socket) => {
    socket.on(CLIENT_EVENTS.CREATE_ROOM, (raw: unknown, acknowledge?: Ack) => {
      if (!joinLimiter.allow(clientAddress(socket))) return sendError(socket, 'Too many attempts. Wait a minute and try again.', acknowledge);
      const nickname = nicknameFrom(raw);
      if (!nickname.ok) return sendError(socket, nickname.message, acknowledge);
      const parsed = createRoomSchema.safeParse(raw);
      if (!parsed.success) return sendError(socket, 'Invalid create room payload', acknowledge);
      const session = bindSession(socket, nickname.value, parsed.data.token);
      dropFromQueue(session, 'replaced');
      if (session.roomCode) leaveCurrentRoom(session, socket);
      try {
        const room = rooms.createRoom({
          playerId: session.playerId,
          username: session.username,
          token: session.token,
          connected: true,
          isBot: false,
          socketId: socket.id,
        }, { botTargetWpm: parsed.data.bot?.targetWpm, config: parsed.data.config });
        session.roomCode = room.code;
        void socket.join(room.code);
        acknowledge?.({ playerId: session.playerId, token: session.token, room: roomStateSchema.parse(rooms.snapshot(room)) });
        emitRoomState(room);
      } catch (error) {
        logger.error({ err: error }, 'Unable to create room');
        sendError(socket, 'Unable to create room', acknowledge);
      }
    });

    socket.on(CLIENT_EVENTS.JOIN_ROOM, (raw: unknown, acknowledge?: Ack) => {
      if (!joinLimiter.allow(clientAddress(socket))) return sendError(socket, 'Too many attempts. Wait a minute and try again.', acknowledge);
      const nickname = nicknameFrom(raw);
      if (!nickname.ok) return sendError(socket, nickname.message, acknowledge);
      const parsed = joinRoomSchema.safeParse(raw);
      if (!parsed.success) return sendError(socket, 'Invalid join payload', acknowledge);
      const session = bindSession(socket, nickname.value, parsed.data.token);
      dropFromQueue(session, 'replaced');
      const code = parsed.data.code ?? session.roomCode;
      if (!code) return sendError(socket, 'Room code is required', acknowledge);
      try {
        const room = attach(socket, session, code);
        acknowledge?.({ playerId: session.playerId, token: session.token, room: roomStateSchema.parse(rooms.snapshot(room)) });
      } catch (error) {
        sendError(socket, error instanceof Error ? error.message : 'Unable to join room', acknowledge);
      }
    });

    socket.on(CLIENT_EVENTS.SET_RACE_CONFIG, (raw: unknown, acknowledge?: Ack) => {
      if (!configLimiter.allow(socket.id)) return sendError(socket, 'Slow down: too many mode changes', acknowledge);
      const parsed = setRaceConfigSchema.safeParse(raw);
      if (!parsed.success) return sendError(socket, 'Invalid race mode', acknowledge);
      const current = currentRoom(socket);
      if (!current || current.room.hostPlayerId !== current.session.playerId) return sendError(socket, 'Only the host can change the race mode', acknowledge);
      if (current.room.state !== 'LOBBY') return sendError(socket, 'The race mode can only be changed in the lobby', acknowledge);
      rooms.setConfig(current.room, parsed.data.config);
      emitRoomState(current.room);
      acknowledge?.({ ok: true });
    });

    socket.on(CLIENT_EVENTS.START_RACE, (raw: unknown, acknowledge?: Ack) => {
      if (!startRaceSchema.safeParse(raw).success) return sendError(socket, 'Invalid start payload', acknowledge);
      const current = currentRoom(socket);
      if (!current || current.room.hostPlayerId !== current.session.playerId || current.room.state !== 'LOBBY') {
        return sendError(socket, 'Only the host can start a lobby race', acknowledge);
      }
      startRoomRace(current.room);
      acknowledge?.({ ok: true });
    });

    socket.on(CLIENT_EVENTS.KEYSTROKE, (raw: unknown) => {
      const parsed = keystrokeSchema.safeParse(raw);
      if (!parsed.success) return logger.debug({ socketId: socket.id }, 'Invalid keystroke payload');
      const current = currentRoom(socket);
      if (current) rooms.handleKeystroke(current.room, current.session.playerId, parsed.data.char, parsed.data.index, Date.now());
    });

    socket.on(CLIENT_EVENTS.RACE_AGAIN, (raw: unknown, acknowledge?: Ack) => {
      if (!raceAgainSchema.safeParse(raw).success) return sendError(socket, 'Invalid race again payload', acknowledge);
      const current = currentRoom(socket);
      if (!current || current.room.state !== 'RESULTS') return sendError(socket, 'Race is not finished', acknowledge);
      if (current.room.kind === 'quick') return sendError(socket, 'Quick races are one-offs: find a new race instead', acknowledge);
      rooms.transition(current.room, 'LOBBY');
      emitRoomState(current.room);
      acknowledge?.({ ok: true });
    });

    socket.on(CLIENT_EVENTS.LEAVE_ROOM, (raw: unknown) => {
      if (!leaveRoomSchema.safeParse(raw).success) return;
      const current = currentRoom(socket);
      if (!current) return;
      if (current.room.state === 'COUNTDOWN' || current.room.state === 'RACING') {
        if (current.room.kind === 'private' && current.room.hostPlayerId === current.session.playerId) {
          leaveCurrentRoom(current.session, socket);
          return;
        }
        rooms.exitRace(current.room, current.session.playerId);
        emitRoomState(current.room);
        tick(current.room);
        if (rooms.allDone(current.room)) finishRace(current.room);
        return;
      }
      leaveCurrentRoom(current.session, socket);
    });

    socket.on(CLIENT_EVENTS.QUEUE_JOIN, (raw: unknown, acknowledge?: Ack) => {
      if (!queueSocketLimiter.allow(socket.id) || !queueAddressLimiter.allow(clientAddress(socket))) {
        return sendError(socket, 'Slow down: too many queue requests', acknowledge);
      }
      const nickname = nicknameFrom(raw);
      if (!nickname.ok) return sendError(socket, nickname.message, acknowledge);
      const parsed = queueJoinSchema.safeParse(raw);
      if (!parsed.success) return sendError(socket, 'Invalid queue payload', acknowledge);
      const session = bindSession(socket, nickname.value, parsed.data.token);

      // One queue or race at a time. A client coming back mid-race (its lobby started while it was
      // offline) is put back into that race rather than queued again.
      const room = session.roomCode ? rooms.get(session.roomCode) : undefined;
      if (room && (room.state === 'COUNTDOWN' || room.state === 'RACING')) {
        const player = room.players.get(session.playerId);
        if (player && player.socketId !== socket.id && socketAlive(player.socketId)) {
          return sendError(socket, 'You are already in a race', acknowledge);
        }
        attach(socket, session, room.code);
        return acknowledge?.({ playerId: session.playerId, token: session.token, room: roomStateSchema.parse(rooms.snapshot(room)) });
      }
      if (room) leaveCurrentRoom(session, socket);

      // A seat held by a socket that is gone (closed tab, dropped network) is taken over, not duplicated.
      const seat = queue.lobbyOf(session.playerId)?.members.get(session.playerId);
      if (seat?.connected && seat.socketId && seat.socketId !== socket.id && !socketAlive(seat.socketId)) {
        queue.disconnect(session.playerId, seat.socketId);
      }
      const outcome = queue.join({
        playerId: session.playerId,
        username: session.username,
        token: session.token,
        socketId: socket.id,
        averageWpm: ratings.average(session.playerId),
        config: parsed.data.config ?? DEFAULT_QUICK_RACE_CONFIG,
      });
      if (outcome.status === 'rejected') return sendError(socket, 'You are already in the queue', acknowledge);
      acknowledge?.({ playerId: session.playerId, token: session.token, queue: queueUpdateSchema.parse(queue.view(outcome.lobby)) });
    });

    socket.on(CLIENT_EVENTS.QUEUE_LEAVE, (raw: unknown, acknowledge?: Ack) => {
      if (!queueSocketLimiter.allow(socket.id) || !queueAddressLimiter.allow(clientAddress(socket))) {
        return sendError(socket, 'Slow down: too many queue requests', acknowledge);
      }
      if (!queueLeaveSchema.safeParse(raw).success) return sendError(socket, 'Invalid queue payload', acknowledge);
      const session = socketSessions.get(socket.id);
      const seat = session ? queue.lobbyOf(session.playerId)?.members.get(session.playerId) : undefined;
      if (!session || seat?.socketId !== socket.id) return acknowledge?.({ ok: false });
      queue.leave(session.playerId);
      emitQueueClosed(socket.id, 'left');
      acknowledge?.({ ok: true });
    });

    socket.on('disconnect', () => {
      configLimiter.forget(socket.id);
      queueSocketLimiter.forget(socket.id);
      const bound = socketSessions.get(socket.id);
      if (bound) queue.disconnect(bound.playerId, socket.id);
      const current = currentRoom(socket);
      socketSessions.delete(socket.id);
      if (!current) return;
      const { session, room } = current;
      rooms.markDisconnected(room, session.playerId);
      emitRoomState(room);
      if (room.state === 'RACING' || room.state === 'COUNTDOWN') scheduleDisconnect(room, session.playerId);
    });
  });

  // ---- housekeeping -------------------------------------------------------------------------

  /** Closes abandoned rooms, forgets sessions nobody can use any more, and prunes rate limiters. */
  const sweep = (now = Date.now()) => {
    for (const room of [...rooms.list()]) {
      const anyoneHere = [...room.players.values()].some((player) => !player.isBot && player.connected);
      if (anyoneHere) {
        delete room.idleSince;
      } else {
        room.idleSince ??= now;
        if (now - room.idleSince >= options.roomIdleMs) closeRoom(room, 'idle');
      }
    }
    const bound = new Set(socketSessions.values());
    for (const [token, session] of sessions) {
      const inRoom = session.roomCode !== undefined && rooms.get(session.roomCode) !== undefined;
      const queued = queue.lobbyOf(session.playerId) !== undefined;
      if (!inRoom && !queued && !bound.has(session)) sessions.delete(token);
    }
    joinLimiter.prune(now);
    configLimiter.prune(now);
    queueSocketLimiter.prune(now);
    queueAddressLimiter.prune(now);
    ratings.prune(now);
  };
  const sweepTimer = setInterval(() => sweep(), options.sweepIntervalMs);
  sweepTimer.unref();

  const inspect = (): RealtimeStats => {
    const queueStats = queue.stats();
    const timers = { countdown: 0, tick: 0, finish: 0, disconnect: 0, bot: botTimers.size, lobby: queueStats.timers.lobby, queueGrace: queueStats.timers.grace, total: 0 };
    let roomCount = 0;
    for (const room of rooms.list()) {
      roomCount += 1;
      if (room.countdownTimer) timers.countdown += 1;
      if (room.tickTimer) timers.tick += 1;
      if (room.finishTimer) timers.finish += 1;
      timers.disconnect += room.disconnectTimers.size;
    }
    timers.total = timers.countdown + timers.tick + timers.finish + timers.disconnect + timers.bot + timers.lobby + timers.queueGrace;
    return { rooms: roomCount, sessions: sessions.size, timers, queue: queueStats };
  };

  const close = async (): Promise<void> => {
    clearInterval(sweepTimer);
    for (const member of queue.close()) emitQueueClosed(member.socketId, 'shutdown');
    for (const room of [...rooms.list()]) closeRoom(room, 'shutdown');
    sessions.clear();
    socketSessions.clear();
    await new Promise<void>((resolve) => {
      void io.close(() => resolve());
    });
  };

  return { io, inspect, sweep, close };
}
