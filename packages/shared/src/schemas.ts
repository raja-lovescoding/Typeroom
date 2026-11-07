import { z } from 'zod';
import { MAX_USERNAME_LENGTH } from './constants.js';

export const joinRoomSchema = z.object({
  code: z.string().length(6).optional(),
  username: z.string().trim().min(1).max(MAX_USERNAME_LENGTH),
  token: z.string().min(16).optional(),
});

export const keystrokeSchema = z.object({
  char: z.string().length(1),
  index: z.number().int().nonnegative(),
});

export const roomStateSchema = z.object({
  code: z.string().length(6),
  state: z.enum(['LOBBY', 'COUNTDOWN', 'RACING', 'RESULTS', 'CLOSED']),
  players: z.array(
    z.object({
      playerId: z.string(),
      username: z.string(),
      connected: z.boolean(),
    }),
  ),
});

export const playerDisconnectedSchema = z.object({
  playerId: z.string(),
});

export type JoinRoom = z.infer<typeof joinRoomSchema>;
export type Keystroke = z.infer<typeof keystrokeSchema>;
