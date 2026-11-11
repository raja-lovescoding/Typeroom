/**
 * Rolling average WPM per player id: the only thing matchmaking remembers about a player.
 * No keystrokes, no per-race history: one number, a race count and a timestamp.
 *
 * It's an exponential moving average, so one unusually fast or slow race moves a player's band
 * only part of the way. The first completed race sets it outright, which re-bands a newcomer
 * straight away. Kept in memory behind an interface so it can move to Redis/PostgreSQL later.
 */
export interface RatingStore {
  /** The player's rolling average, or undefined with no completed race. */
  average(playerId: string): number | undefined;
  /** Folds a completed race's net WPM into the average. */
  record(playerId: string, wpm: number, now?: number): void;
  /** Drops entries not updated within `maxAgeMs`. */
  prune(now?: number): void;
  readonly size: number;
}

export interface RatingEntry {
  average: number;
  races: number;
  updatedAt: number;
}

export interface InMemoryRatingOptions {
  /** Weight of the newest race in the average. */
  weight: number;
  /** Hard cap on remembered players; the least recently updated are evicted first. */
  maxEntries: number;
  maxAgeMs: number;
}

export const DEFAULT_RATING_OPTIONS: InMemoryRatingOptions = {
  weight: 0.3,
  maxEntries: 100_000,
  maxAgeMs: 7 * 24 * 60 * 60_000,
};

export class InMemoryRatingStore implements RatingStore {
  /** Map iteration order is insertion order; re-inserting on update keeps it LRU. */
  private readonly entries = new Map<string, RatingEntry>();
  private readonly options: InMemoryRatingOptions;

  constructor(options: Partial<InMemoryRatingOptions> = {}) {
    this.options = { ...DEFAULT_RATING_OPTIONS, ...options };
  }

  average(playerId: string): number | undefined {
    return this.entries.get(playerId)?.average;
  }

  entry(playerId: string): Readonly<RatingEntry> | undefined {
    return this.entries.get(playerId);
  }

  record(playerId: string, wpm: number, now = Date.now()): void {
    if (!Number.isFinite(wpm) || wpm < 0) return;
    const previous = this.entries.get(playerId);
    const average = previous ? previous.average + (wpm - previous.average) * this.options.weight : wpm;
    this.entries.delete(playerId);
    this.entries.set(playerId, { average: Math.round(average * 10) / 10, races: (previous?.races ?? 0) + 1, updatedAt: now });
    while (this.entries.size > this.options.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  prune(now = Date.now()): void {
    for (const [playerId, entry] of this.entries) {
      if (now - entry.updatedAt < this.options.maxAgeMs) break; // LRU order: the rest are newer
      this.entries.delete(playerId);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
