const TEXTS = [
  'Small habits become strong skills when practice is steady and patient.',
  'The quick brown fox jumps over the lazy dog near the quiet river.',
  'Clear goals and calm focus make difficult work feel much more manageable.',
  'Every careful keystroke is a small step toward faster and more accurate typing.',
  'Good software grows from simple ideas that are tested and improved over time.',
  'A friendly challenge can turn an ordinary evening into a memorable learning session.',
  'Keep your hands relaxed, watch the text, and let your rhythm do the work.',
  'Progress is rarely dramatic, but consistent effort adds up sooner than expected.',
  'Great teams communicate clearly, share context, and help each other succeed.',
  'A room full of racers is more fun when everyone gets a fair start.',
  'The best tools stay out of the way and make the important work feel natural.',
  'Learning to type well gives your thoughts a shorter path from mind to screen.',
  'When a mistake happens, pause briefly, correct it, and continue with confidence.',
  'Curiosity makes practice interesting because every attempt reveals something new.',
  'A useful routine begins with a small promise that you can keep every day.',
  'Strong foundations make future changes safer, faster, and easier to understand.',
  'The quietest progress is often the kind that lasts for many years.',
  'Write what you mean, review what you wrote, and improve one detail at a time.',
  'A good race rewards accuracy first, then speed built on reliable movement.',
  'Shared experiences are better when the rules are visible and the feedback is honest.',
  'Focus on the next character rather than worrying about the whole paragraph.',
  'Simple designs create space for people to concentrate on their real goals.',
  'The fastest route is usually the one that avoids unnecessary complexity.',
  'Practice turns unfamiliar motions into comfortable patterns that require less thought.',
  'A little patience today can prevent a great deal of frustration tomorrow.',
  'Good results come from showing up, paying attention, and trying again.',
  'The screen is only a surface; the real progress happens in your hands.',
  'A clear signal and a steady connection keep every friendly race enjoyable.',
  'Build something useful, learn from its edges, and keep moving forward.',
  'Careful work does not have to be slow when the process is well designed.',
] as const;

export class TextProvider {
  constructor(private readonly random: () => number = Math.random) {}

  getRaceText(): string {
    return `${TEXTS[Math.floor(this.random() * TEXTS.length)] ?? TEXTS[0]} Take a breath, trust the process, and keep moving one careful character at a time today.`;
  }
}

export { TEXTS };
