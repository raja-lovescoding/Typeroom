import { z } from 'zod';
import {
  BOT_SPEEDS,
  CUSTOM_TEXT_MAX_LENGTH,
  MAX_USERNAME_LENGTH,
  MIN_USERNAME_LENGTH,
  NICKNAME_PATTERN,
  QUICK_RACE_MAX_RACERS,
  QUOTE_LENGTHS,
  ROOM_CODE_LENGTH,
  TIME_MODE_SECONDS,
  WORD_MODE_COUNTS,
  WPM_BAND_IDS,
} from './constants.js';
import type { QueueUpdatePayload, RaceProgressPayload, RaceResultsPayload, RoomStatePayload } from './types.js';

// ---- primitives ------------------------------------------------------------------------------

export const usernameSchema = z
  .string()
  .transform((value) => value.normalize('NFC').replace(/\s+/g, ' ').trim())
  .pipe(
    z
      .string()
      .min(1, 'Enter a nickname')
      .min(MIN_USERNAME_LENGTH, `Nicknames are at least ${MIN_USERNAME_LENGTH} characters`)
      .max(MAX_USERNAME_LENGTH, `Nicknames are at most ${MAX_USERNAME_LENGTH} characters`)
      .regex(NICKNAME_PATTERN, 'Use letters, numbers, spaces, _ . or -'),
  );

/** Folds typographic punctuation to ASCII and collapses whitespace, so any keyboard can type the text. */
export function normalizeCustomText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim();
}

export const customTextSchema = z
  .string()
  .max(CUSTOM_TEXT_MAX_LENGTH * 2)
  .transform(normalizeCustomText)
  .pipe(
    z
      .string()
      .min(1, 'Enter some text to race on')
      .max(CUSTOM_TEXT_MAX_LENGTH, `Custom text is at most ${CUSTOM_TEXT_MAX_LENGTH} characters`)
      .regex(/^[\x20-\x7E]+$/, 'Custom text may only use plain keyboard characters (A–Z, digits, punctuation)'),
  );

const literalUnion = <T extends readonly [number, ...number[]]>(values: T) =>
  z.union(values.map((value) => z.literal(value)) as unknown as [z.ZodLiteral<T[number]>, z.ZodLiteral<T[number]>, ...z.ZodLiteral<T[number]>[]]);

// ---- race configuration (chosen by the host, applied by the server) -------------------------

const timeConfigSchema = z.object({ mode: z.literal('time'), seconds: literalUnion(TIME_MODE_SECONDS), punctuation: z.boolean().default(false) }).strict();
const wordsConfigSchema = z.object({ mode: z.literal('words'), count: literalUnion(WORD_MODE_COUNTS), punctuation: z.boolean().default(false) }).strict();
const quoteConfigSchema = z.object({ mode: z.literal('quote'), length: z.enum(QUOTE_LENGTHS) }).strict();

export const raceConfigSchema = z.discriminatedUnion('mode', [
  timeConfigSchema,
  wordsConfigSchema,
  quoteConfigSchema,
  z.object({ mode: z.literal('custom'), text: customTextSchema }).strict(),
]);
export type RaceConfig = z.output<typeof raceConfigSchema>;
export type RaceMode = RaceConfig['mode'];
export const DEFAULT_RACE_CONFIG: RaceConfig = { mode: 'words', count: 25, punctuation: false };

/** Quick Race modes: every built-in mode, but never custom text (strangers would race on it). */
export const quickRaceConfigSchema = z.discriminatedUnion('mode', [timeConfigSchema, wordsConfigSchema, quoteConfigSchema]);
export type QuickRaceConfig = z.output<typeof quickRaceConfigSchema>;
export const DEFAULT_QUICK_RACE_CONFIG: QuickRaceConfig = { mode: 'words', count: 25, punctuation: false };

// ---- client → server --------------------------------------------------------------------------

export const joinRoomSchema = z.object({
  code: z.string().length(ROOM_CODE_LENGTH).optional(),
  username: usernameSchema,
  token: z.string().min(16).max(128).optional(),
}).strict();

export const keystrokeSchema = z.object({
  char: z.string().length(1),
  index: z.number().int().nonnegative(),
}).strict();

export const createRoomSchema = z.object({
  username: usernameSchema,
  token: z.string().min(16).max(128).optional(),
  bot: z.object({ targetWpm: literalUnion(BOT_SPEEDS) }).strict().optional(),
  config: raceConfigSchema.optional(),
}).strict();

export const setRaceConfigSchema = z.object({ config: raceConfigSchema }).strict();
export const roomCodeSchema = z.object({ code: z.string().length(ROOM_CODE_LENGTH) }).strict();
export const startRaceSchema = z.object({}).strict();
export const raceAgainSchema = z.object({}).strict();
/** leave_room carries no payload; anything else is rejected. */
export const leaveRoomSchema = z.union([z.undefined(), z.object({}).strict()]);

/**
 * queue:join. Strict, so a client can't claim a band, a rating or a role: the server derives the
 * band from its own rolling average and decides who is a ghost.
 */
export const queueJoinSchema = z.object({
  username: usernameSchema,
  token: z.string().min(16).max(128).optional(),
  config: quickRaceConfigSchema.optional(),
}).strict();
export const queueLeaveSchema = leaveRoomSchema;

// ---- server → client --------------------------------------------------------------------------

export const roomStateSchema = z.object({
  code: z.string().length(ROOM_CODE_LENGTH),
  state: z.enum(['LOBBY', 'COUNTDOWN', 'RACING', 'RESULTS', 'CLOSED']),
  kind: z.enum(['private', 'quick']),
  hostPlayerId: z.string(),
  config: raceConfigSchema,
  players: z.array(
    z.object({
      playerId: z.string(),
      username: z.string(),
      connected: z.boolean(),
      isBot: z.boolean(),
      isGhost: z.boolean(),
    }),
  ),
}) satisfies z.ZodType<RoomStatePayload, z.ZodTypeDef, unknown>;

export const roomClosedSchema = z.object({
  code: z.string().length(ROOM_CODE_LENGTH),
  reason: z.enum(['host_left', 'idle', 'shutdown']),
}).strict();
export type RoomClosedReason = z.infer<typeof roomClosedSchema>['reason'];

export const raceCountdownSchema = z.object({
  startsInMs: z.number().int().positive(),
  text: z.string().min(1),
  config: raceConfigSchema,
  /** Attribution for quote mode. */
  source: z.string().optional(),
  /** Hard time limit of this race; in time mode it is the mode's duration. */
  timeLimitMs: z.number().int().positive(),
}).strict();

const racePlayerSchema = z.object({
  playerId: z.string(),
  username: z.string(),
  connected: z.boolean(),
  isBot: z.boolean(),
  isGhost: z.boolean(),
  position: z.number().int().nonnegative(),
  wpm: z.number().nonnegative(),
  accuracy: z.number().min(0).max(100),
  status: z.enum(['racing', 'finished', 'disconnected', 'dnf', 'exited']),
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
    isGhost: z.boolean(),
    series: z.array(z.object({
      second: z.number().nonnegative(),
      raw: z.number().nonnegative(),
      net: z.number().nonnegative(),
      errors: z.number().int().nonnegative(),
    })),
  })),
}).strict() satisfies z.ZodType<RaceResultsPayload>;

export const queueUpdateSchema = z.object({
  lobbyId: z.string().min(1),
  band: z.enum(WPM_BAND_IDS),
  config: quickRaceConfigSchema,
  racers: z.array(z.object({ playerId: z.string(), username: z.string(), connected: z.boolean() }).strict()).max(QUICK_RACE_MAX_RACERS),
  seatsFilled: z.number().int().nonnegative().max(QUICK_RACE_MAX_RACERS),
  maxSeats: z.number().int().positive(),
  msLeft: z.number().int().nonnegative(),
  secondsLeft: z.number().int().nonnegative(),
}).strict() satisfies z.ZodType<QueueUpdatePayload, z.ZodTypeDef, unknown>;

/** The lobby was handed off to a race room; the race countdown follows immediately. */
export const queueMatchedSchema = z.object({
  lobbyId: z.string().min(1),
  playerId: z.string(),
  room: roomStateSchema,
}).strict();

/**
 * The player is no longer queued: `left` (they cancelled), `expired` (disconnected past the grace
 * window, or the lobby they came back to is gone), `replaced` (they queued from another tab or
 * joined a room instead), `shutdown` (server restart).
 */
export const queueClosedSchema = z.object({
  reason: z.enum(['left', 'expired', 'replaced', 'shutdown']),
}).strict();
export type QueueClosedReason = z.infer<typeof queueClosedSchema>['reason'];

export const errorSchema = z.object({ error: z.string() }).strict();

export type JoinRoom = z.infer<typeof joinRoomSchema>;
export type Keystroke = z.infer<typeof keystrokeSchema>;
export type CreateRoom = z.infer<typeof createRoomSchema>;
export type RaceCountdown = z.infer<typeof raceCountdownSchema>;
export type RoomStateMessage = z.infer<typeof roomStateSchema>;
export type RoomClosed = z.infer<typeof roomClosedSchema>;
export type QueueJoin = z.infer<typeof queueJoinSchema>;
export type QueueUpdate = z.infer<typeof queueUpdateSchema>;
export type QueueMatched = z.infer<typeof queueMatchedSchema>;
