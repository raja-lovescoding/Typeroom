import { MAX_KEYSTROKES_PER_SECOND, type RaceConfig } from '@typeroom/shared';
import { QUOTES_BY_LENGTH } from '../content/quotes.js';
import { WORDS } from '../content/words.js';

export interface RaceText {
  text: string;
  /** Attribution shown to racers (quote mode). */
  source?: string;
}

/** Produces the text for a race. Custom texts never reach a source: the gateway uses them as-is. */
export interface RaceTextSource {
  getRaceText(config: Exclude<RaceConfig, { mode: 'custom' }>): RaceText;
}

/**
 * Minimum length of a time-mode text. The server accepts at most MAX_KEYSTROKES_PER_SECOND
 * keystrokes per second, so nobody can reach the end of a text this long before time runs out.
 */
export function timeModeLength(seconds: number): number {
  return seconds * MAX_KEYSTROKES_PER_SECOND + 1;
}

export class TextProvider implements RaceTextSource {
  constructor(private readonly random: () => number = Math.random) {}

  getRaceText(config: Exclude<RaceConfig, { mode: 'custom' }>): RaceText {
    switch (config.mode) {
      case 'words':
        return { text: this.words({ count: config.count }, config.punctuation) };
      case 'time':
        return { text: this.words({ minLength: timeModeLength(config.seconds) }, config.punctuation) };
      case 'quote': {
        const quote = this.pick(QUOTES_BY_LENGTH[config.length]);
        return { text: quote.text, source: quote.source };
      }
    }
  }

  /** Random words until `count` words or `minLength` characters, never repeating a word twice in a row. */
  private words(limit: { count: number } | { minLength: number }, punctuation: boolean): string {
    const done = (words: string[], length: number) => ('count' in limit ? words.length >= limit.count : length >= limit.minLength);
    const sentence = new SentenceShaper(this.random, punctuation);
    const words: string[] = [];
    let length = -1;
    let previous = '';
    while (!done(words, length)) {
      let word = this.pick(WORDS);
      while (word === previous) word = this.pick(WORDS);
      previous = word;
      const shaped = sentence.next(word);
      words.push(shaped);
      length += shaped.length + 1;
    }
    sentence.close(words);
    return words.join(' ');
  }

  private pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.random() * items.length)] ?? items[0];
    if (item === undefined) throw new Error('Cannot pick from an empty list');
    return item;
  }
}

/** Turns a stream of lowercase words into sentences: capitals, the odd comma, and end marks. */
class SentenceShaper {
  private remaining = 0;

  constructor(
    private readonly random: () => number,
    private readonly enabled: boolean,
  ) {}

  next(word: string): string {
    if (!this.enabled) return word;
    const starts = this.remaining === 0;
    if (starts) this.remaining = 4 + Math.floor(this.random() * 8);
    this.remaining -= 1;
    let shaped = starts || word === 'i' ? capitalize(word) : word;
    if (this.remaining === 0) shaped += this.endMark();
    else if (!starts && this.random() < 0.1) shaped += ',';
    return shaped;
  }

  /** Ends the text on a full stop when it stopped mid-sentence. */
  close(words: string[]): void {
    if (!this.enabled || this.remaining === 0 || words.length === 0) return;
    const last = words.length - 1;
    words[last] = `${(words[last] ?? '').replace(/,$/, '')}.`;
  }

  private endMark(): string {
    const roll = this.random();
    return roll < 0.75 ? '.' : roll < 0.88 ? '?' : '!';
  }
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
