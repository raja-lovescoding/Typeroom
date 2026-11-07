import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import {
  CLIENT_EVENTS,
  joinRoomSchema,
  keystrokeSchema,
  SERVER_EVENTS,
} from '@typeroom/shared';
import { env } from '../config/env.js';
import { createGuestSession } from '../domain/session.js';
import { logger } from '../lib/logger.js';
import { RateLimiter } from '../lib/rateLimiter.js';
import { RoomManager } from '../services/roomManager.js';

export function createRealtimeServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, { cors: { origin: env.CLIENT_ORIGIN } });
  const rooms = new RoomManager();
  const joinLimiter = new RateLimiter(10, 60_000);
  const sessions = new Map<string, ReturnType<typeof createGuestSession>>();

  io.on('connection', (socket) => {
    socket.on(CLIENT_EVENTS.JOIN_ROOM, (raw: unknown, acknowledge?: (value: unknown) => void) => {
      if (!joinLimiter.allow(socket.handshake.address)) {
        acknowledge?.({ error: 'Too many join attempts' });
        return;
      }
      const parsed = joinRoomSchema.safeParse(raw);
      if (!parsed.success) {
        acknowledge?.({ error: 'Invalid join payload' });
        return;
      }
      const session = parsed.data.token ? sessions.get(parsed.data.token) : undefined;
      const guest = session ?? createGuestSession(parsed.data.username);
      sessions.set(guest.token, guest);
      const code = parsed.data.code ?? rooms.getOrCreate().code;
      rooms.addPlayer(code, { playerId: guest.playerId, username: guest.username, connected: true });
      void socket.join(code);
      acknowledge?.({ playerId: guest.playerId, token: guest.token, room: rooms.snapshot(code) });
      io.to(code).emit(SERVER_EVENTS.ROOM_STATE, rooms.snapshot(code));
    });

    socket.on(CLIENT_EVENTS.KEYSTROKE, (raw: unknown) => {
      const parsed = keystrokeSchema.safeParse(raw);
      if (!parsed.success) logger.warn({ socketId: socket.id }, 'Invalid keystroke payload');
    });
  });
  return io;
}
