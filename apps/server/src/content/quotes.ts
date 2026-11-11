import { QUOTE_LENGTH_LIMITS, QUOTE_LENGTHS, type QuoteLength } from '@typeroom/shared';

/**
 * Quote mode texts. Two kinds only, so the set stays licence-clean:
 *
 *  - Public domain: published before 1900 by authors who died more than a century ago. Typographic
 *    punctuation (curly quotes, em dashes) is adapted to plain ASCII so any keyboard can type it.
 *  - Typeroom originals: written for this project; same licence as the Typeroom source.
 *
 * The length bucket (short/medium/long) is derived from the character count, never hand-labelled,
 * so a quote can't land in the wrong bucket when it is edited.
 */
export interface Quote {
  text: string;
  source: string;
}

const ORIGINAL = 'Typeroom original';

export const QUOTES: readonly Quote[] = [
  // ---- public domain -------------------------------------------------------------------------
  { text: "Why, sometimes I've believed as many as six impossible things before breakfast.", source: 'Lewis Carroll, Through the Looking-Glass (1871)' },
  { text: 'The truth is rarely pure and never simple.', source: 'Oscar Wilde, The Importance of Being Earnest (1895)' },
  { text: 'Nothing is so painful to the human mind as a great and sudden change.', source: 'Mary Shelley, Frankenstein (1818)' },
  { text: 'I am no bird; and no net ensnares me: I am a free human being with an independent will.', source: 'Charlotte Brontë, Jane Eyre (1847)' },
  { text: '"Begin at the beginning," the King said, very gravely, "and go on till you come to the end: then stop."', source: "Lewis Carroll, Alice's Adventures in Wonderland (1865)" },
  { text: 'A foolish consistency is the hobgoblin of little minds, adored by little statesmen and philosophers and divines.', source: 'Ralph Waldo Emerson, Self-Reliance (1841)' },
  { text: 'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.', source: 'Jane Austen, Pride and Prejudice (1813)' },
  { text: 'This above all: to thine own self be true, And it must follow, as the night the day, Thou canst not then be false to any man.', source: 'William Shakespeare, Hamlet (c. 1600)' },
  { text: 'Four score and seven years ago our fathers brought forth on this continent, a new nation, conceived in Liberty, and dedicated to the proposition that all men are created equal.', source: 'Abraham Lincoln, Gettysburg Address (1863)' },
  { text: 'I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what it had to teach, and not, when I came to die, discover that I had not lived.', source: 'Henry David Thoreau, Walden (1854)' },
  { text: 'Call me Ishmael. Some years ago - never mind how long precisely - having little or no money in my purse, and nothing particular to interest me on shore, I thought I would sail about a little and see the watery part of the world.', source: 'Herman Melville, Moby-Dick (1851)' },
  { text: 'It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity, it was the season of Light, it was the season of Darkness, it was the spring of hope, it was the winter of despair.', source: 'Charles Dickens, A Tale of Two Cities (1859)' },
  { text: 'There is grandeur in this view of life, with its several powers, having been originally breathed into a few forms or into one; and that, whilst this planet has gone cycling on according to the fixed law of gravity, from so simple a beginning endless forms most beautiful and most wonderful have been, and are being, evolved.', source: 'Charles Darwin, On the Origin of Species (1859)' },

  // ---- Typeroom originals --------------------------------------------------------------------
  { text: 'Speed is just accuracy that has stopped hesitating.', source: ORIGINAL },
  { text: 'The keyboard forgives every mistake you are willing to fix.', source: ORIGINAL },
  { text: 'Rhythm beats rush: steady hands finish first.', source: ORIGINAL },
  { text: 'A typo is only a pause between two correct letters.', source: ORIGINAL },
  { text: 'Quiet practice today becomes loud progress next month.', source: ORIGINAL },
  { text: 'Look at the next word, not the last mistake.', source: ORIGINAL },
  { text: 'Fast fingers start with a calm breath and a straight back.', source: ORIGINAL },
  { text: 'Racing a friend turns practice into play. You stop counting mistakes and start chasing the caret ahead of you, and somehow the mistakes fade on their own.', source: ORIGINAL },
  { text: 'The best way to type faster is to type slower for a while. Accuracy builds the paths your fingers will later travel at speed without thinking.', source: ORIGINAL },
  { text: 'Some days the words flow and some days every key feels heavy. Both kinds of day count, as long as you sit down and type the next line.', source: ORIGINAL },
  { text: 'A good tool disappears while you use it. You stop noticing the keys, the screen and the room, and only the idea you are trying to write remains.', source: ORIGINAL },
  { text: 'Learning to touch type feels strange at first. Your hands want to look for help, your eyes keep drifting down to the keys, and every word takes longer than it did before you started. Then one evening you notice that a whole sentence appeared on the screen while you were thinking about something else, and you realize the slow weeks were not wasted at all.', source: ORIGINAL },
  { text: 'The lighthouse keeper wrote one page every night, whatever the weather. Some pages were about storms and some were about nothing at all, just the color of the water and the sound of the gulls. Years later the pages filled a shelf, and the keeper understood that the habit had mattered far more than any single page.', source: ORIGINAL },
  { text: 'A race is a strange kind of conversation. Nobody speaks, yet everyone is listening: you can feel the other carets moving beside yours, pulling you forward when you slow down and reminding you to breathe when you rush. When it ends, the numbers matter less than the shared few seconds of focus.', source: ORIGINAL },
  { text: 'Good software is rarely built in one heroic night. It grows from small, careful changes, each one tested, each one easy to undo. The teams that move fastest are usually the ones that refuse to rush: they write things down, they ask questions early, and they leave the code a little clearer than they found it.', source: ORIGINAL },
  { text: 'Morning in the old market starts before the sun. Bakers stack warm bread in wooden crates, the fruit seller arranges apples into neat red hills, and a radio somewhere plays a song nobody remembers the name of. By the time the first customers arrive, the whole street smells of coffee and the day already feels well under way.', source: ORIGINAL },
];

export function quoteLength(quote: Quote): QuoteLength {
  return QUOTE_LENGTHS.find((length) => quote.text.length <= QUOTE_LENGTH_LIMITS[length]) ?? 'long';
}

export const QUOTES_BY_LENGTH: Readonly<Record<QuoteLength, readonly Quote[]>> = {
  short: QUOTES.filter((quote) => quoteLength(quote) === 'short'),
  medium: QUOTES.filter((quote) => quoteLength(quote) === 'medium'),
  long: QUOTES.filter((quote) => quoteLength(quote) === 'long'),
};
