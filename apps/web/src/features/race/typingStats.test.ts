import { describe, expect, it } from 'vitest';
import { classifyKey, computeStats, consistency, createTypingLog, type KeyEntry } from './typingStats.js';

describe('classifyKey', () => {
  it('separates incorrect letters from extra characters typed where a space was expected', () => {
    expect(classifyKey('ab cd', 0, 'a')).toBe('correct');
    expect(classifyKey('ab cd', 1, 'x')).toBe('incorrect');
    expect(classifyKey('ab cd', 2, 'x')).toBe('extra');
    expect(classifyKey('ab cd', 2, ' ')).toBe('correct');
  });
});

describe('computeStats', () => {
  const log = (keys: Array<[number, KeyEntry['kind']]>) => ({ ...createTypingLog(0), keys: keys.map(([t, kind], index) => ({ t, kind, index })) });

  it('computes raw and net WPM, accuracy and the character breakdown', () => {
    // 10 correct + 2 wrong keys over 6 seconds on a 12-character text, finished.
    const keys: Array<[number, KeyEntry['kind']]> = [];
    for (let i = 0; i < 10; i += 1) keys.push([(i + 1) * 500, 'correct']);
    keys.push([5_200, 'incorrect'], [5_400, 'extra']);
    keys.sort((a, b) => a[0] - b[0]);
    const stats = computeStats(log(keys), 12, 10, 6_000);
    expect(stats.breakdown).toEqual({ correct: 10, incorrect: 1, extra: 1, missed: 2 });
    expect(stats.rawWpm).toBe(24); // 12 keys / 5 / 0.1 min
    expect(stats.netWpm).toBe(20); // 10 keys / 5 / 0.1 min
    expect(stats.accuracy).toBe(83);
    expect(stats.series).toHaveLength(6);
    expect(stats.series.at(-1)).toMatchObject({ second: 6, net: 20 });
    expect(stats.series.reduce((sum, sample) => sum + sample.errors, 0)).toBe(2);
  });

  it('merges a short trailing bucket instead of reporting a speed spike', () => {
    const stats = computeStats(log([[400, 'correct'], [900, 'correct'], [1_400, 'correct'], [2_100, 'correct']]), 4, 4, 2_100);
    expect(stats.series.map((sample) => sample.second)).toEqual([1, 2.1]);
    expect(Math.max(...stats.series.map((sample) => sample.raw))).toBeLessThan(30);
  });

  it('handles an empty log', () => {
    const stats = computeStats(createTypingLog(0), 10, 0, 3_000);
    expect(stats).toMatchObject({ rawWpm: 0, netWpm: 0, accuracy: 100, consistency: null });
    expect(stats.breakdown.missed).toBe(10);
  });
});

describe('consistency', () => {
  it('is 100 for perfectly even speed and lower for uneven speed', () => {
    expect(consistency([60, 60, 60])).toBe(100);
    expect(consistency([30, 90, 30, 90])).toBe(50);
    expect(consistency([0, 200, 0, 0])).toBe(0);
    expect(consistency([60])).toBeNull();
  });
});
