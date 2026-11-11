import { describe, expect, it } from 'vitest';
import { QUOTE_LENGTH_LIMITS, QUOTE_LENGTHS, TIME_MODE_SECONDS, WORD_MODE_COUNTS, customTextSchema } from '@typeroom/shared';
import { QUOTES, QUOTES_BY_LENGTH } from '../src/content/quotes.js';
import { WORDS } from '../src/content/words.js';
import { containsBlockedTerm } from '../src/domain/nickname.js';
import { TextProvider, timeModeLength } from '../src/services/textProvider.js';

/** Deterministic PRNG (mulberry32) so failures are reproducible. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

describe('bundled content', () => {
  it('word list is unique, lowercase a-z, and clean', () => {
    expect(WORDS.length).toBeGreaterThan(300);
    expect(new Set(WORDS).size).toBe(WORDS.length);
    for (const word of WORDS) {
      expect(word, word).toMatch(/^[a-z]+$/);
      expect(containsBlockedTerm(word), word).toBe(false);
    }
  });

  it('every quote is typeable plain ASCII, attributed, and every length bucket has variety', () => {
    for (const quote of QUOTES) {
      expect(customTextSchema.parse(quote.text), quote.text).toBe(quote.text);
      expect(quote.text.length).toBeLessThanOrEqual(QUOTE_LENGTH_LIMITS.long);
      expect(quote.source.length).toBeGreaterThan(0);
    }
    expect(new Set(QUOTES.map((quote) => quote.text)).size).toBe(QUOTES.length);
    for (const length of QUOTE_LENGTHS) expect(QUOTES_BY_LENGTH[length].length, length).toBeGreaterThanOrEqual(5);
  });
});

describe('TextProvider', () => {
  it('words mode returns exactly the requested number of words', () => {
    const provider = new TextProvider(seeded(1));
    for (const count of WORD_MODE_COUNTS) {
      const { text, source } = provider.getRaceText({ mode: 'words', count, punctuation: false });
      const words = text.split(' ');
      expect(words).toHaveLength(count);
      expect(source).toBeUndefined();
      for (const word of words) expect(WORDS).toContain(word);
      for (let index = 1; index < words.length; index += 1) expect(words[index]).not.toBe(words[index - 1]);
    }
  });

  it('punctuation mode writes capitalised sentences that end with a mark', () => {
    const provider = new TextProvider(seeded(2));
    const { text } = provider.getRaceText({ mode: 'words', count: 100, punctuation: true });
    expect(text.split(' ')).toHaveLength(100);
    expect(text).toMatch(/^[A-Z]/);
    expect(text).toMatch(/[.?!]$/);
    expect(text).toMatch(/[.?!] [A-Z]/);
    expect(customTextSchema.parse(text)).toBe(text);
    // Every sentence starts with a capital letter.
    for (const sentence of text.split(/(?<=[.?!]) /)) expect(sentence, sentence).toMatch(/^[A-Z]/);
  });

  it('time mode texts are longer than the keystroke cap allows anyone to finish', () => {
    const provider = new TextProvider(seeded(3));
    for (const seconds of TIME_MODE_SECONDS) {
      const { text } = provider.getRaceText({ mode: 'time', seconds, punctuation: false });
      expect(text.length).toBeGreaterThanOrEqual(timeModeLength(seconds));
      expect(text.length).toBeLessThan(timeModeLength(seconds) + 30);
    }
  });

  it('quote mode picks from the requested length bucket and returns its attribution', () => {
    const provider = new TextProvider(seeded(4));
    for (const length of QUOTE_LENGTHS) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const result = provider.getRaceText({ mode: 'quote', length });
        const quote = QUOTES_BY_LENGTH[length].find((item) => item.text === result.text);
        expect(quote, result.text).toBeDefined();
        expect(result.source).toBe(quote?.source);
      }
    }
  });
});
