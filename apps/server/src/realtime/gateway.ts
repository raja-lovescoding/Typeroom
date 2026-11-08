import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import {
  CLIENT_EVENTS,
  createRoomSchema,
  joinRoomSchema,
  keystrokeSchema,
  raceAgainSchema,
  raceCountdownSchema,
  raceProgressSchema,
  raceResultsSchema,
  roomStateSchema,
  SERVER_EVENTS,
  startRaceSchema,
} from '@typeroom/shared';
import { env } from '../config/env.js';
import { BotPlayer } from '../domain/bot.js';
import { createGuestSession, type GuestSession } from '../domain/session.js';
import { logger } from '../lib/logger.js';
import { RateLimiter } from '../lib/rateLimiter.js';
import { RoomManager, type Room } from '../services/roomManager.js';
import { TextProvider } from '../services/textProvider.js';

interface Session extends GuestSession {
  roomCode?: string;
}

export interface RaceTextSource {
  getRaceText(): string;
}

/** Tunables for the realtime gateway. Production uses the defaults; tests and load tests shorten them. */
export interface RealtimeOptions {
  countdownMs: number;
  raceLimitMs: number;
  disconnectGraceMs: number;
  tickIntervalMs: number;
  joinRateLimit: { limit: number; windowMs: number };
  corsOrigin: string;
  textProvider: RaceTextSource;
}

/** Live counts of in-memory state, used to assert that rooms and timers are cleaned up. */
export interface RealtimeStats {
  rooms: number;
  sessions: number;
  timers: { countdown: number; tick: number; finish: number; disconnect: number; bot: number; total: number };
}

export interface RealtimeServer {
  io: Server;
  inspect(): RealtimeStats;
  /** Closes every room (clearing all of its timers) and shuts down Socket.IO and the underlying HTTP server. */
  close(): Promise<void>;
}

export const DEFAULT_REALTIME_OPTIONS: Omit<RealtimeOptions, 'textProvider' | 'corsOrigin'> = {
  countdownMs: 5_000,
  raceLimitMs: 120_000,
  disconnectGraceMs: 20_000,
  tickIntervalMs: 100,
  joinRateLimit: { limit: 10, windowMs: 60_000 },
};

export function createRealtimeServer(httpServer: HttpServer, overrides: Partial<RealtimeOptions> = {}): RealtimeServer {
  const options: RealtimeOptions = {
    ...DEFAULT_REALTIME_OPTIONS,
    corsOrigin: env.CLIENT_ORIGIN,
    textProvider: new TextProvider(),
    ...overrides,
  };
  const { countdownMs: COUNTDOWN_MS, raceLimitMs: RACE_LIMIT_MS, disconnectGraceMs: DISCONNECT_GRACE_MS, textProvider } = options;
  const io = new Server(httpServer, { cors: { origin: options.corsOrigin } });
  const rooms = new RoomManager();
  const joinLimiter = new RateLimiter(options.joinRateLimit.limit, options.joinRateLimit.windowMs);
  const sessions = new Map<string, Session>();
  const bots = new Map<string, BotPlayer>();
  const botTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const clearBotTimers = (code: string) => {
    for (const [key, timer] of botTimers) {
      if (key.startsWith(`${code}:`)) {
        clearTimeout(timer);
        botTimers.delete(key);
      }
    }
    for (const key of bots.keys()) {
      if (key.startsWith(`${code}:`)) bots.delete(key);
    }
  };

  const clearDisconnectTimers = (room: Room) => {
    for (const timer of room.disconnectTimers.values()) clearTimeout(timer);
    room.disconnectTimers.clear();
  };

  const closeRoom = (code: string) => {
    clearBotTimers(code);
    rooms.close(code);
  };

  const sendError = (socket: Socket, message: string, acknowledge?: (value: unknown) => void) => {
    acknowledge?.({ error: message });
    socket.emit(SERVER_EVENTS.ERROR, { error: message });
  };

  const emitRoomState = (room: Room) => {
    const payload = roomStateSchema.parse(rooms.snapshot(room));
    io.to(room.code).emit(SERVER_EVENTS.ROOM_STATE, payload);
  };

  const finishRace = (room: Room) => {
    if (room.state !== 'RACING') return;
    for (const player of room.players.values()) {
      if (player.status === 'disconnected') rooms.markDnf(room, player.playerId);
    }
    rooms.transition(room, 'RESULTS');
    const payload = raceResultsSchema.parse({ code: room.code, results: rooms.results(room, Date.now()) });
    io.to(room.code).emit(SERVER_EVENTS.RACE_RESULTS, payload);
    if (room.tickTimer) clearInterval(room.tickTimer);
    if (room.finishTimer) clearTimeout(room.finishTimer);
    delete room.tickTimer;
    delete room.finishTimer;
    clearDisconnectTimers(room);
    clearBotTimers(room.code);
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

  const scheduleBot = (room: Room, playerId: string, targetWpm: number) => {
    const bot = new BotPlayer(targetWpm);
    bots.set(`${room.code}:${playerId}`, bot);
    const sendNext = () => {
      if (room.state !== 'RACING' || !room.text) return;
      const next = bot.nextChar(room.text);
      if (!next) return;
      rooms.handleKeystroke(room, playerId, next.char, next.index, Date.now());
      if (rooms.allDone(room)) {
        finishRace(room);
        return;
      }
      const expected = room.text[next.index] ?? ' ';
      const key = `${room.code}:${playerId}`;
      const timer = setTimeout(() => {
        botTimers.delete(key);
        sendNext();
      }, bot.nextDelay(expected));
      botTimers.set(key, timer);
    };
    const key = `${room.code}:${playerId}`;
    botTimers.set(key, setTimeout(() => {
      botTimers.delete(key);
      sendNext();
    }, 0));
  };

  const startRace = (room: Room) => {
    const startsAt = room.startsAt ?? Date.now() + COUNTDOWN_MS;
    room.countdownTimer = setTimeout(() => {
      delete room.countdownTimer;
      if (room.state !== 'COUNTDOWN') return;
      rooms.beginRace(room, startsAt);
      room.tickTimer = setInterval(() => tick(room), options.tickIntervalMs);
      room.finishTimer = setTimeout(() => {
        delete room.finishTimer;
        for (const player of room.players.values()) {
          if (player.status === 'racing' || player.status === 'disconnected') rooms.markDnf(room, player.playerId);
        }
        finishRace(room);
      }, RACE_LIMIT_MS);
      for (const player of room.players.values()) {
        if (player.isBot) scheduleBot(room, player.playerId, Number(player.username.match(/\d+/)?.[0] ?? 60));
      }
      tick(room);
    }, Math.max(0, startsAt - Date.now()));
  };

  const attach = (socket: Socket, session: Session, code: string): Room => {
    const existing = rooms.get(code);
    if (!existing) throw new Error('Room not found');
    const existingPlayer = existing?.players.get(session.playerId);
    const room = existing
      ? existingPlayer
        ? (rooms.reconnect(existing, session.playerId, socket.id), existing)
        : rooms.joinRoom(code, {
        playerId: session.playerId,
        username: session.username,
        token: session.token,
        connected: true,
        isBot: false,
        socketId: socket.id,
      })
      : existing;
    session.roomCode = room.code;
    void socket.join(room.code);
    emitRoomState(room);
    return room;
  };

  io.on('connection', (socket) => {
    socket.on(CLIENT_EVENTS.CREATE_ROOM, (raw: unknown, acknowledge?: (value: unknown) => void) => {
      const parsed = createRoomSchema.safeParse(raw);
      if (!parsed.success) return sendError(socket, 'Invalid create room payload', acknowledge);
      const session = parsed.data.token ? sessions.get(parsed.data.token) : undefined;
      const guest = session ?? createGuestSession(parsed.data.username);
      const current: Session = session ?? guest;
      sessions.set(current.token, current);
      try {
        const room = rooms.createRoom({
          playerId: current.playerId,
          username: current.username,
          token: current.token,
          connected: true,
          isBot: false,
          socketId: socket.id,
        }, parsed.data.bot?.targetWpm);
        current.roomCode = room.code;
        void socket.join(room.code);
        acknowledge?.({ playerId: current.playerId, token: current.token, room: roomStateSchema.parse(rooms.snapshot(room)) });
        emitRoomState(room);
      } catch (error) {
        logger.error({ error }, 'Unable to create room');
        sendError(socket, 'Unable to create room', acknowledge);
      }
    });

    socket.on(CLIENT_EVENTS.JOIN_ROOM, (raw: unknown, acknowledge?: (value: unknown) => void) => {
      if (!joinLimiter.allow(socket.handshake.address)) return sendError(socket, 'Too many join attempts', acknowledge);
      const parsed = joinRoomSchema.safeParse(raw);
      if (!parsed.success) return sendError(socket, 'Invalid join payload', acknowledge);
      const session = parsed.data.token ? sessions.get(parsed.data.token) : undefined;
      const guest = session ?? createGuestSession(parsed.data.username);
      const current: Session = session ?? guest;
      sessions.set(current.token, current);
      const code = parsed.data.code ?? current.roomCode;
      if (!code) return sendError(socket, 'Room code is required', acknowledge);
      try {
        const room = attach(socket, current, code);
        acknowledge?.({ playerId: current.playerId, token: current.token, room: roomStateSchema.parse(rooms.snapshot(room)) });
      } catch (error) {
        sendError(socket, error instanceof Error ? error.message : 'Unable to join room', acknowledge);
      }
    });

    socket.on(CLIENT_EVENTS.START_RACE, (raw: unknown, acknowledge?: (value: unknown) => void) => {
      const parsed = startRaceSchema.safeParse(raw);
      if (!parsed.success) return sendError(socket, 'Invalid start payload', acknowledge);
      const session = [...sessions.values()].find((item) => item.roomCode && rooms.get(item.roomCode)?.players.get(item.playerId)?.socketId === socket.id);
      const room = session?.roomCode ? rooms.get(session.roomCode) : undefined;
      if (!session || !room || room.hostPlayerId !== session.playerId || room.state !== 'LOBBY') return sendError(socket, 'Only the host can start a lobby race', acknowledge);
      rooms.startRace(room, textProvider.getRaceText(), Date.now(), COUNTDOWN_MS);
      const countdown = raceCountdownSchema.parse({ startsInMs: COUNTDOWN_MS, text: room.text });
      io.to(room.code).emit(SERVER_EVENTS.RACE_COUNTDOWN, countdown);
      emitRoomState(room);
      startRace(room);
      acknowledge?.({ ok: true });
    });

    socket.on(CLIENT_EVENTS.KEYSTROKE, (raw: unknown) => {
      const parsed = keystrokeSchema.safeParse(raw);
      if (!parsed.success) return logger.warn({ socketId: socket.id }, 'Invalid keystroke payload');
      const session = [...sessions.values()].find((item) => item.roomCode && rooms.get(item.roomCode)?.players.get(item.playerId)?.socketId === socket.id);
      const room = session?.roomCode ? rooms.get(session.roomCode) : undefined;
      if (session && room) rooms.handleKeystroke(room, session.playerId, parsed.data.char, parsed.data.index, Date.now());
    });

    socket.on(CLIENT_EVENTS.RACE_AGAIN, (raw: unknown, acknowledge?: (value: unknown) => void) => {
      if (!raceAgainSchema.safeParse(raw).success) return sendError(socket, 'Invalid race again payload', acknowledge);
      const session = [...sessions.values()].find((item) => item.roomCode && rooms.get(item.roomCode)?.players.get(item.playerId)?.socketId === socket.id);
      const room = session?.roomCode ? rooms.get(session.roomCode) : undefined;
      if (!room || room.state !== 'RESULTS') return sendError(socket, 'Race is not finished', acknowledge);
      rooms.transition(room, 'LOBBY');
      emitRoomState(room);
      acknowledge?.({ ok: true });
    });

    socket.on(CLIENT_EVENTS.LEAVE_ROOM, () => {
      const session = [...sessions.values()].find((item) => item.roomCode && rooms.get(item.roomCode)?.players.get(item.playerId)?.socketId === socket.id);
      if (session?.roomCode) {
        const room = rooms.get(session.roomCode);
        if (room) {
          const closed = rooms.leaveRoom(room.code, session.playerId);
          if (closed) clearBotTimers(room.code);
        }
        delete session.roomCode;
      }
    });

    socket.on('disconnect', () => {
      const session = [...sessions.values()].find((item) => item.roomCode && rooms.get(item.roomCode)?.players.get(item.playerId)?.socketId === socket.id);
      const room = session?.roomCode ? rooms.get(session.roomCode) : undefined;
      if (!session || !room || room.state !== 'RACING') return;
      rooms.markDisconnected(room, session.playerId);
      emitRoomState(room);
      const previous = room.disconnectTimers.get(session.playerId);
      if (previous) clearTimeout(previous);
      room.disconnectTimers.set(session.playerId, setTimeout(() => {
        room.disconnectTimers.delete(session.playerId);
        if (room.state !== 'RACING') return;
        rooms.markDnf(room, session.playerId);
        tick(room);
      }, DISCONNECT_GRACE_MS));
    });
  });

  const inspect = (): RealtimeStats => {
    const timers = { countdown: 0, tick: 0, finish: 0, disconnect: 0, bot: botTimers.size, total: 0 };
    let roomCount = 0;
    for (const room of rooms.list()) {
      roomCount += 1;
      if (room.countdownTimer) timers.countdown += 1;
      if (room.tickTimer) timers.tick += 1;
      if (room.finishTimer) timers.finish += 1;
      timers.disconnect += room.disconnectTimers.size;
    }
    timers.total = timers.countdown + timers.tick + timers.finish + timers.disconnect + timers.bot;
    return { rooms: roomCount, sessions: sessions.size, timers };
  };

  const close = async (): Promise<void> => {
    for (const room of [...rooms.list()]) closeRoom(room.code);
    sessions.clear();
    await new Promise<void>((resolve) => {
      void io.close(() => resolve());
    });
  };

  return { io, inspect, close };
}
