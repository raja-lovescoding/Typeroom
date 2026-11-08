export interface BotRandom {
  next(): number;
}

export class BotPlayer {
  readonly isBot = true;
  private position = 0;

  constructor(
    readonly targetWpm: number,
    private readonly random: BotRandom = { next: Math.random },
  ) {}

  nextDelay(char: string): number {
    const base = 60_000 / (this.targetWpm * 5);
    const variation = 0.65 + this.random.next() * 0.7;
    return Math.max(10, Math.round(base * variation + (char === ' ' ? 35 : 0)));
  }

  nextChar(text: string): { char: string; index: number } | null {
    if (this.position >= text.length) return null;
    const index = this.position;
    if (this.random.next() < 0.02) return { char: text[index] === 'a' ? 'b' : 'a', index };
    this.position += 1;
    return { char: text[index] ?? '', index };
  }
}
