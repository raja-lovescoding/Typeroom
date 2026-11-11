import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings } from './settings.js';

describe('sanitizeSettings', () => {
  it('returns defaults for missing, corrupt or hostile input', () => {
    for (const raw of [undefined, null, 'nope', 42, [], {}]) expect(sanitizeSettings(raw)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toMatchObject({ sound: false, liveStats: true, motion: 'system' });
  });

  it('keeps valid new options and repairs invalid ones', () => {
    expect(sanitizeSettings({ sound: true, soundVolume: 80, liveStats: false, motion: 'reduce' })).toMatchObject({
      sound: true, soundVolume: 80, liveStats: false, motion: 'reduce',
    });
    expect(sanitizeSettings({ sound: 'yes', soundVolume: 999, motion: 'warp', liveStats: 1 })).toMatchObject({
      sound: false, soundVolume: 100, motion: 'system', liveStats: true,
    });
    expect(sanitizeSettings({ soundVolume: -4 }).soundVolume).toBe(0);
    expect(sanitizeSettings({ soundVolume: 52 }).soundVolume).toBe(50);
    expect(sanitizeSettings({ soundVolume: Number.NaN }).soundVolume).toBe(DEFAULT_SETTINGS.soundVolume);
  });
});
