export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MAX_USERNAME_LENGTH = 24;
export const MIN_USERNAME_LENGTH = 2;
export const MAX_PLAYERS_PER_ROOM = 5;

/**
 * Nickname allow-list: letters and digits in any script, plus space, underscore, hyphen and
 * period. Applied by the shared schema on both client and server; the server additionally runs
 * a profanity check that is not shared with the client.
 */
export const NICKNAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} _.-]*$/u;

/**
 * The server accepts at most this many keystrokes per player per second (about 300 WPM).
 * Time-mode texts are generated to be longer than anyone can type in the time limit.
 */
export const MAX_KEYSTROKES_PER_SECOND = 25;

export const BOT_SPEEDS = [40, 60, 90, 120] as const;
export type BotSpeed = (typeof BOT_SPEEDS)[number];

export const TIME_MODE_SECONDS = [15, 30, 60, 120] as const;
export const WORD_MODE_COUNTS = [10, 25, 50, 100] as const;
export const QUOTE_LENGTHS = ['short', 'medium', 'long'] as const;
export type QuoteLength = (typeof QUOTE_LENGTHS)[number];
/** Quote length buckets, in characters (inclusive upper bounds). */
export const QUOTE_LENGTH_LIMITS: Readonly<Record<QuoteLength, number>> = { short: 100, medium: 250, long: 600 };
export const CUSTOM_TEXT_MAX_LENGTH = 1_000;

// ---- Quick Race matchmaking --------------------------------------------------------------------

/** A quick race starts with at least this many racers (humans + ghosts). */
export const QUICK_RACE_MIN_RACERS = 2;
/** A quick race never has more than this many racers (humans + ghosts). */
export const QUICK_RACE_MAX_RACERS = MAX_PLAYERS_PER_ROOM;
/** A lobby waits this long after its first player joins, unless it fills up with humans first. */
export const QUICK_RACE_LOBBY_WAIT_MS = 10_000;
/** A lone human is joined by this many ghost racers (never exceeding QUICK_RACE_MAX_RACERS). */
export const QUICK_RACE_GHOSTS = { min: 1, max: 3 } as const;
/** Ghost target speeds are sampled within ±this fraction of the human's average. */
export const GHOST_WPM_SPREAD = 0.1;

/** Matchmaking bands by rolling average WPM; `min` is inclusive, `max` exclusive. */
export const WPM_BANDS = [
  { id: '0-40', min: 0, max: 40, typical: 30 },
  { id: '40-70', min: 40, max: 70, typical: 55 },
  { id: '70-100', min: 70, max: 100, typical: 85 },
  { id: '100+', min: 100, max: Number.POSITIVE_INFINITY, typical: 115 },
] as const;
export type WpmBand = (typeof WPM_BANDS)[number]['id'];
export const WPM_BAND_IDS = WPM_BANDS.map((band) => band.id) as [WpmBand, ...WpmBand[]];
/** Players without a completed race yet are matched here. */
export const DEFAULT_WPM_BAND: WpmBand = '40-70';

/** The band a rolling average WPM falls into; no history means the default band. */
export function bandForWpm(averageWpm: number | undefined): WpmBand {
  if (averageWpm === undefined || !Number.isFinite(averageWpm)) return DEFAULT_WPM_BAND;
  return WPM_BANDS.find((band) => averageWpm >= band.min && averageWpm < band.max)?.id ?? WPM_BANDS[0].id;
}
