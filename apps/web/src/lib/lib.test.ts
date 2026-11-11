import { describe, expect, it } from 'vitest';
import { isPlaceholder, SITE } from '../config/site.js';
import { describeRaceConfig } from './raceConfig.js';
import { roomCodeFromPath } from './router.js';
import { gainFor } from './sound.js';

describe('describeRaceConfig', () => {
  it('labels every mode', () => {
    expect(describeRaceConfig({ mode: 'time', seconds: 30, punctuation: false })).toBe('time 30s');
    expect(describeRaceConfig({ mode: 'words', count: 50, punctuation: true })).toBe('50 words · punctuation');
    expect(describeRaceConfig({ mode: 'quote', length: 'long' })).toBe('quote · long');
    expect(describeRaceConfig({ mode: 'custom', text: 'one' })).toBe('custom text · 1 word');
    expect(describeRaceConfig({ mode: 'custom', text: 'one two three' })).toBe('custom text · 3 words');
  });
});

describe('roomCodeFromPath', () => {
  it('only matches valid room links', () => {
    expect(roomCodeFromPath('/r/ABC234')).toBe('ABC234');
    expect(roomCodeFromPath('/r/ABC234/')).toBe('ABC234');
    expect(roomCodeFromPath('/r/abc234')).toBeUndefined();
    expect(roomCodeFromPath('/r/ABC10O')).toBeUndefined(); // ambiguous characters are never in codes
    expect(roomCodeFromPath('/r/ABC2345')).toBeUndefined();
    expect(roomCodeFromPath('/about')).toBeUndefined();
  });
});

describe('site config', () => {
  it('marks unconfigured operator details as placeholders', () => {
    expect(isPlaceholder('[[CONTACT_EMAIL]]')).toBe(true);
    expect(isPlaceholder('hello@example.com')).toBe(false);
    expect(isPlaceholder('see [[X]] here')).toBe(false);
    expect(SITE.issuesUrl).toBe(`${SITE.repoUrl}/issues`);
    expect(SITE.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('sound volume curve', () => {
  it('is silent at zero, gentle at the top, and clamps', () => {
    expect(gainFor(0)).toBe(0);
    expect(gainFor(100)).toBe(0.5);
    expect(gainFor(50)).toBeCloseTo(0.125);
    expect(gainFor(500)).toBe(0.5);
    expect(gainFor(-5)).toBe(0);
  });
});
