/**
 * Sliding-window rate limiter keyed by an arbitrary string (an IP address or a socket id).
 * Keys are held in memory only for the length of the window; `prune()` drops idle keys so the
 * map never grows with every client ever seen.
 */
export class RateLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string, now = Date.now()): boolean {
    const recent = (this.attempts.get(key) ?? []).filter((timestamp) => now - timestamp < this.windowMs);
    if (recent.length >= this.limit) {
      this.attempts.set(key, recent);
      return false;
    }
    recent.push(now);
    this.attempts.set(key, recent);
    return true;
  }

  /** Forgets keys with no attempts inside the window. */
  prune(now = Date.now()): void {
    for (const [key, timestamps] of this.attempts) {
      if (timestamps.every((timestamp) => now - timestamp >= this.windowMs)) this.attempts.delete(key);
    }
  }

  forget(key: string): void {
    this.attempts.delete(key);
  }

  get size(): number {
    return this.attempts.size;
  }
}
