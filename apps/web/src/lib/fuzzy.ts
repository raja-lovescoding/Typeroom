/**
 * Small fuzzy matcher for the command palette. Query characters must appear in order;
 * matches at word starts and consecutive runs score higher, long gaps score lower.
 * Returns null when the query does not match.
 */
export function fuzzyScore(query: string, target: string): number | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;
  const haystack = target.toLowerCase();
  let score = 0;
  let from = 0;
  let previous = -2;
  for (const char of needle) {
    if (char === ' ') continue;
    const at = haystack.indexOf(char, from);
    if (at === -1) return null;
    score += 1;
    if (at === previous + 1) score += 4;
    if (at === 0 || /[\s\-/:·]/.test(haystack[at - 1] ?? '')) score += 6;
    score -= Math.min(3, (at - from) * 0.25);
    previous = at;
    from = at + 1;
  }
  return score - haystack.length * 0.01;
}

export function fuzzyFilter<T>(items: readonly T[], query: string, text: (item: T) => string): T[] {
  if (!query.trim()) return [...items];
  return items
    .map((item, order) => ({ item, order, score: fuzzyScore(query, text(item)) }))
    .filter((entry): entry is { item: T; order: number; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((entry) => entry.item);
}
