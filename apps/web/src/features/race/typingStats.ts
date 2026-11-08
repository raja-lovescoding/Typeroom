/**
 * The local keystroke log and the derived results-screen stats.
 *
 * The server stays authoritative for ranking, net WPM and accuracy. This module only describes
 * the player's *own* keystrokes for presentation: raw WPM, consistency, the character breakdown
 * and the WPM-over-time chart. Nothing here is sent to the server.
 *
 * Typing model (matches the server): stop-on-error. A wrong key never advances the caret.
 *  - correct:   the expected character
 *  - incorrect: a wrong key where a letter/symbol was expected
 *  - extra:     a wrong key where a space was expected (typing past the end of a word)
 *  - missed:    characters never reached (race ended first)
 */

export type KeyKind = 'correct' | 'incorrect' | 'extra';

export interface KeyEntry {
  /** Milliseconds since the local race start. */
  t: number;
  kind: KeyKind;
  index: number;
}

export interface TypingLog {
  /** Local `Date.now()` at which the race started (from the countdown), or null if unknown. */
  startedAt: number | null;
  /** Local ms since start when the last character was accepted, if the player finished. */
  finishedAt: number | null;
  keys: KeyEntry[];
}

export function createTypingLog(startedAt: number | null = null): TypingLog {
  return { startedAt, finishedAt: null, keys: [] };
}

export function classifyKey(text: string, index: number, char: string): KeyKind {
  if (text[index] === char) return 'correct';
  return text[index] === ' ' ? 'extra' : 'incorrect';
}

export interface Breakdown {
  correct: number;
  incorrect: number;
  extra: number;
  missed: number;
}

export interface SecondSample {
  /** End of the bucket, in seconds since start. */
  second: number;
  /** Raw WPM for keys pressed within this bucket (all keys, right or wrong). */
  raw: number;
  /** Net WPM up to the end of this bucket (correct characters only). */
  net: number;
  /** Wrong keys pressed within this bucket. */
  errors: number;
}

export interface TypingStats {
  durationMs: number;
  rawWpm: number;
  netWpm: number;
  accuracy: number;
  /** 0–100; how even the per-second raw speed was. Null with too little data. */
  consistency: number | null;
  breakdown: Breakdown;
  series: SecondSample[];
}

const wpm = (chars: number, ms: number) => (ms <= 0 ? 0 : chars / 5 / (ms / 60_000));
const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * @param durationMs how long the player raced: their finish time, or the race length if they did not finish.
 * @param reachedPosition how many characters the player completed (the server's final position).
 */
export function computeStats(log: TypingLog, textLength: number, reachedPosition: number, durationMs: number): TypingStats {
  const breakdown: Breakdown = { correct: 0, incorrect: 0, extra: 0, missed: Math.max(0, textLength - reachedPosition) };
  for (const key of log.keys) breakdown[key.kind] += 1;
  const total = log.keys.length;
  const duration = Math.max(durationMs, log.keys.at(-1)?.t ?? 0, 1);

  const series = buildSeries(log.keys, duration);
  const raws = series.map((sample) => sample.raw);
  return {
    durationMs: duration,
    rawWpm: round1(wpm(total, duration)),
    netWpm: round1(wpm(breakdown.correct, duration)),
    accuracy: total === 0 ? 100 : Math.round((breakdown.correct / total) * 100),
    consistency: consistency(raws),
    breakdown,
    series,
  };
}

/** One-second buckets; a short final bucket (< 0.5s) is merged into the previous one to avoid a spike. */
function buildSeries(keys: KeyEntry[], durationMs: number): SecondSample[] {
  const fullSeconds = Math.max(1, Math.floor(durationMs / 1000));
  const remainder = durationMs - fullSeconds * 1000;
  const edges: number[] = [];
  for (let second = 1; second <= fullSeconds; second += 1) edges.push(second * 1000);
  if (remainder >= 500 || durationMs < 1000) edges.push(durationMs);
  else edges[edges.length - 1] = durationMs;
  if (edges.length > 1 && edges[0] === edges[1]) edges.shift();

  const samples: SecondSample[] = [];
  let cursor = 0;
  let correctSoFar = 0;
  let start = 0;
  for (const end of edges) {
    let inBucket = 0;
    let errors = 0;
    while (cursor < keys.length && (keys[cursor]?.t ?? 0) <= end) {
      const key = keys[cursor];
      cursor += 1;
      if (!key) continue;
      inBucket += 1;
      if (key.kind === 'correct') correctSoFar += 1;
      else errors += 1;
    }
    samples.push({ second: round1(end / 1000), raw: round1(wpm(inBucket, end - start)), net: round1(wpm(correctSoFar, end)), errors });
    start = end;
  }
  return samples;
}

/** 100 × (1 − coefficient of variation) of per-second raw speed, clamped to 0–100. */
export function consistency(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean === 0) return null;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.round(Math.min(100, Math.max(0, 100 * (1 - Math.sqrt(variance) / mean))));
}
