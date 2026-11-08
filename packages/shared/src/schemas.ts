import { z } from 'zod';
import { MAX_USERNAME_LENGTH, ROOM_CODE_LENGTH } from './constants.js';
import type { RaceProgressPayload, RaceResultsPayload } from './types.js';

export const joinRoomSchema = z.object({
  code: z.string().length(ROOM_CODE_LENGTH).optional(),
  username: z.string().trim().min(1).max(MAX_USERNAME_LENGTH),
  token: z.string().min(16).optional(),
});

export const keystrokeSchema = z.object({
  char: z.string().length(1),
  index: z.number().int().nonnegative(),
}).strict();

export const createRoomSchema = z.object({
  username: z.string().trim().min(1).max(MAX_USERNAME_LENGTH),
  token: z.string().min(16).optional(),
  bot: z.object({ targetWpm: z.union([z.literal(40), z.literal(60), z.literal(90), z.literal(120)]) }).optional(),
}).strict();

export const roomCodeSchema = z.object({ code: z.string().length(ROOM_CODE_LENGTH) }).strict();
export const startRaceSchema = z.object({}).strict();
export const raceAgainSchema = z.object({}).strict();

export const roomStateSchema = z.object({
  code: z.string().length(ROOM_CODE_LENGTH),
  state: z.enum(['LOBBY', 'COUNTDOWN', 'RACING', 'RESULTS', 'CLOSED']),
  players: z.array(
    z.object({
      playerId: z.string(),
      username: z.string(),
      connected: z.boolean(),
      isBot: z.boolean(),
    }),
  ),
});

export const raceCountdownSchema = z.object({
  startsInMs: z.number().int().positive(),
  text: z.string().min(1),
}).strict();

const racePlayerSchema = z.object({
  playerId: z.string(),
  username: z.string(),
  connected: z.boolean(),
  isBot: z.boolean(),
  position: z.number().int().nonnegative(),
  wpm: z.number().nonnegative(),
  accuracy: z.number().min(0).max(100),
  status: z.enum(['racing', 'finished', 'disconnected', 'dnf']),
});

export const raceProgressSchema = z.object({
  code: z.string().length(ROOM_CODE_LENGTH),
  text: z.string().min(1),
  startsAt: z.number().int(),
  players: z.array(racePlayerSchema),
}).strict() satisfies z.ZodType<RaceProgressPayload>;

export const raceResultsSchema = z.object({
  code: z.string().length(ROOM_CODE_LENGTH),
  results: z.array(z.object({
    playerId: z.string(),
    rank: z.number().int().positive(),
    username: z.string(),
    wpm: z.number().nonnegative(),
    accuracy: z.number().min(0).max(100),
    finishTimeMs: z.number().int().nonnegative().nullable(),
    isBot: z.boolean(),
  })),
}).strict() satisfies z.ZodType<RaceResultsPayload>;

export const errorSchema = z.object({ error: z.string() }).strict();

export type JoinRoom = z.infer<typeof joinRoomSchema>;
export type Keystroke = z.infer<typeof keystrokeSchema>;
export type CreateRoom = z.infer<typeof createRoomSchema>;
export type RaceCountdown = z.infer<typeof raceCountdownSchema>;
export type RoomStateMessage = z.infer<typeof roomStateSchema>;
