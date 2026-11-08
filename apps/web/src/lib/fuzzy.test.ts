import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyScore } from './fuzzy.js';

describe('fuzzyScore', () => {
  it('requires query characters in order', () => {
    expect(fuzzyScore('thm', 'Change theme')).not.toBeNull();
    expect(fuzzyScore('mht', 'Change theme')).toBeNull();
    expect(fuzzyScore('', 'anything')).toBe(0);
  });

  it('prefers word starts and consecutive runs', () => {
    expect(fuzzyScore('cl', 'Copy room link')!).toBeLessThan(fuzzyScore('cl', 'Clear')!);
    expect(fuzzyScore('font', 'Change font')!).toBeGreaterThan(fuzzyScore('font', 'Leave room for nothing today')!);
  });
});

describe('fuzzyFilter', () => {
  const items = ['Change theme', 'Change typing font', 'Copy room link', 'Leave room', 'Open settings'];
  it('returns everything for an empty query and ranks matches', () => {
    expect(fuzzyFilter(items, '', (item) => item)).toEqual(items);
    expect(fuzzyFilter(items, 'leave', (item) => item)).toEqual(['Leave room']);
    expect(fuzzyFilter(items, 'room', (item) => item).slice(0, 2).sort()).toEqual(['Copy room link', 'Leave room']);
    expect(fuzzyFilter(items, 'font', (item) => item)[0]).toBe('Change typing font');
  });
});
