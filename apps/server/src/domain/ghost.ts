import { GHOST_WPM_SPREAD, QUICK_RACE_GHOSTS, QUICK_RACE_MAX_RACERS, WPM_BANDS, type WpmBand } from '@typeroom/shared';
import type { BotRandom } from './bot.js';

/**
 * Ghost racers for Quick Race. A ghost is an in-memory typist, like the practice `BotPlayer`: the
 * gateway asks it for the next keystroke and the delay before the one after, and submits every
 * keystroke through the same room-manager handler as a human (same index, burst and scoring rules).
 *
 * Its rhythm is deliberately uneven: each word gets its own speed, longer words are slower, there
 * are short pauses between words and the odd longer hesitation, a warm-up at the start and fatigue
 * towards the end, and occasional wrong keys followed by a correction. The average still lands on
 * the target net WPM, because the overheads are budgeted out of the per-character time.
 */

const MIN_GHOST_WPM = 15;
const MAX_GHOST_WPM = 180;
const MIN_DELAY_MS = 12;

/** Probability of a wrong key per character, and how long noticing and fixing it takes. */
const MISTAKE_RATE = 0.025;
const CORRECTION_MS = { min: 180, max: 420 };
/** Pause after each space, and the rarer longer hesitation before a word. */
const WORD_GAP_MS = { min: 30, max: 130 };
const HESITATION = { chance: 0.04, minMs: 220, maxMs: 650 };
/** Assumed average word length (including the space) for budgeting per-word overheads. */
const CHARS_PER_WORD = 6;

const KEYBOARD_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

export interface Typist {
  nextChar(text: string): { char: string; index: number } | null;
  nextDelay(char: string): number;
}

export const clampGhostWpm = (wpm: number): number => Math.min(MAX_GHOST_WPM, Math.max(MIN_GHOST_WPM, wpm));

/** The WPM ghosts are built around: the human's own rolling average, or their band's typical speed. */
export function ghostBaseWpm(band: WpmBand, averageWpm: number | undefined): number {
  if (averageWpm !== undefined && Number.isFinite(averageWpm) && averageWpm > 0) return averageWpm;
  return WPM_BANDS.find((item) => item.id === band)?.typical ?? 55;
}

/** A ghost target within ±GHOST_WPM_SPREAD of the base. */
export function sampleGhostWpm(baseWpm: number, random: BotRandom = { next: Math.random }): number {
  const factor = 1 - GHOST_WPM_SPREAD + random.next() * GHOST_WPM_SPREAD * 2;
  return Math.round(clampGhostWpm(baseWpm * factor));
}

/** How many ghosts join `humans` racers: 1–3 for a lone human, none otherwise, never past the cap. */
export function ghostCountFor(humans: number, random: BotRandom = { next: Math.random }): number {
  if (humans !== 1) return 0;
  const span = QUICK_RACE_GHOSTS.max - QUICK_RACE_GHOSTS.min + 1;
  const wanted = QUICK_RACE_GHOSTS.min + Math.min(span - 1, Math.floor(random.next() * span));
  return Math.min(wanted, QUICK_RACE_MAX_RACERS - humans);
}

const GHOST_NAMES = [
  'Wisp', 'Echo', 'Shade', 'Mist', 'Flicker', 'Haze', 'Drift', 'Glimmer', 'Vapor', 'Murmur',
  'Lumen', 'Hollow', 'Phantom', 'Whisper', 'Gloam', 'Pallor', 'Rime', 'Ember', 'Nimbus', 'Quill',
] as const;

/** Bot-style names (e.g. "Wisp-42"), distinct from each other and from `taken`. */
export function ghostNames(count: number, taken: ReadonlySet<string> = new Set(), random: BotRandom = { next: Math.random }): string[] {
  const names: string[] = [];
  const used = new Set([...taken].map((name) => name.toLowerCase()));
  for (let attempt = 0; names.length < count && attempt < 200; attempt += 1) {
    const noun = GHOST_NAMES[Math.floor(random.next() * GHOST_NAMES.length)] ?? 'Wisp';
    const name = `${noun}-${10 + Math.floor(random.next() * 90)}`;
    if (used.has(name.toLowerCase())) continue;
    used.add(name.toLowerCase());
    names.push(name);
  }
  while (names.length < count) names.push(`Ghost-${names.length + 1}`);
  return names;
}

export class GhostTypist implements Typist {
  readonly isBot = true;
  private position = 0;
  /** Set after a wrong key: the next keystroke is the correction at the same index. */
  private correcting = false;
  /** Speed multiplier for the current word (>1 is slower). */
  private wordPace = 1;
  /** Text length, learnt on the first call; drives warm-up and fatigue. */
  private length = 0;
  /** A per-ghost bias so two ghosts at the same target don't move in lockstep. */
  private readonly form: number;
  private readonly msPerChar: number;

  constructor(
    readonly targetWpm: number,
    private readonly random: BotRandom = { next: Math.random },
  ) {
    const wpm = clampGhostWpm(targetWpm);
    const budget = 60_000 / (wpm * 5);
    const correctionMean = (CORRECTION_MS.min + CORRECTION_MS.max) / 2;
    const perWordOverhead = (WORD_GAP_MS.min + WORD_GAP_MS.max) / 2 + HESITATION.chance * (HESITATION.minMs + HESITATION.maxMs) / 2;
    // Each correct character costs its own keystroke plus, on average, a share of the word gaps
    // and of the wrong-key detours. Solve for the keystroke time that keeps the mean on target.
    this.msPerChar = Math.max(MIN_DELAY_MS, (budget - perWordOverhead / CHARS_PER_WORD - MISTAKE_RATE * correctionMean) / (1 + MISTAKE_RATE));
    this.form = 0.97 + random.next() * 0.06;
  }

  nextChar(text: string): { char: string; index: number } | null {
    this.length = text.length;
    if (this.position >= text.length) return null;
    const index = this.position;
    const expected = text[index] ?? '';
    if (index === 0 || text[index - 1] === ' ') {
      if (!this.correcting) this.startWord(text, index);
    }
    if (this.correcting) {
      this.correcting = false;
      this.position += 1;
      return { char: expected, index };
    }
    if (expected !== ' ' && this.random.next() < MISTAKE_RATE) {
      this.correcting = true;
      return { char: typoFor(expected, this.random), index };
    }
    this.position += 1;
    return { char: expected, index };
  }

  /** Delay before the next keystroke, given the character just typed. */
  nextDelay(char: string): number {
    if (this.correcting) return Math.round(between(this.random, CORRECTION_MS.min, CORRECTION_MS.max));
    const jitter = 0.75 + this.random.next() * 0.5;
    let delay = this.msPerChar * this.wordPace * this.drift() * this.form * jitter;
    if (char === ' ') {
      delay += between(this.random, WORD_GAP_MS.min, WORD_GAP_MS.max);
      if (this.random.next() < HESITATION.chance) delay += between(this.random, HESITATION.minMs, HESITATION.maxMs);
    }
    return Math.max(MIN_DELAY_MS, Math.round(delay));
  }

  private startWord(text: string, index: number): void {
    const end = text.indexOf(' ', index);
    const wordLength = (end === -1 ? text.length : end) - index;
    // Familiar short words fly, long ones drag; centred on 1 so the average is preserved.
    const lengthFactor = 1 + Math.max(-0.12, Math.min(0.2, (wordLength - 5) * 0.03));
    this.wordPace = (0.8 + this.random.next() * 0.4) * lengthFactor;
  }

  /** Warm-up over the first ~10% of the text, fatigue creeping in over the last half. */
  private drift(): number {
    if (this.length === 0) return 1;
    const progress = this.position / this.length;
    const warmUp = progress < 0.1 ? 0.08 * (1 - progress / 0.1) : 0;
    const fatigue = progress > 0.5 ? 0.08 * ((progress - 0.5) / 0.5) : 0;
    // Slightly quicker in the middle so warm-up and fatigue roughly cancel over a whole race.
    return 0.975 + warmUp + fatigue;
  }
}

function between(random: BotRandom, min: number, max: number): number {
  return min + random.next() * (max - min);
}

/** A plausible wrong key: a keyboard neighbour of the expected letter, never the letter itself. */
function typoFor(expected: string, random: BotRandom): string {
  const lower = expected.toLowerCase();
  for (const row of KEYBOARD_ROWS) {
    const at = row.indexOf(lower);
    if (at === -1) continue;
    const neighbours = [row[at - 1], row[at + 1]].filter((item): item is string => item !== undefined);
    const pick = neighbours[Math.floor(random.next() * neighbours.length)] ?? (lower === 'a' ? 's' : 'a');
    return expected === lower ? pick : pick.toUpperCase();
  }
  return expected === 'a' ? 's' : 'a';
}
