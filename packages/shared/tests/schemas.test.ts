import { describe, expect, it } from 'vitest';
import {
  CUSTOM_TEXT_MAX_LENGTH,
  createRoomSchema,
  customTextSchema,
  DEFAULT_QUICK_RACE_CONFIG,
  normalizeCustomText,
  QUICK_RACE_GHOSTS,
  QUICK_RACE_LOBBY_WAIT_MS,
  QUICK_RACE_MAX_RACERS,
  QUICK_RACE_MIN_RACERS,
  queueJoinSchema,
  queueUpdateSchema,
  raceConfigSchema,
  roomStateSchema,
  setRaceConfigSchema,
  usernameSchema,
  WPM_BANDS,
} from '../src/index.js';

describe('usernameSchema', () => {
  it('normalises whitespace and accepts letters in any script', () => {
    expect(usernameSchema.parse('  Ada   Lovelace ')).toBe('Ada Lovelace');
    expect(usernameSchema.parse('Zoë_99')).toBe('Zoë_99');
    expect(usernameSchema.parse('Ana-María.dev')).toBe('Ana-María.dev');
    expect(usernameSchema.parse('タイピスト')).toBe('タイピスト');
    expect(usernameSchema.parse('tab\tname')).toBe('tab name');
  });

  it('rejects names that are too short, too long, or use characters outside the allow-list', () => {
    for (const bad of ['', ' ', 'a', 'x'.repeat(25), '<script>', 'name@host', 'a​b', '_leading', 'emoji🙂']) {
      expect(usernameSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('raceConfigSchema', () => {
  it('accepts every supported mode and fills defaults', () => {
    expect(raceConfigSchema.parse({ mode: 'time', seconds: 30 })).toEqual({ mode: 'time', seconds: 30, punctuation: false });
    expect(raceConfigSchema.parse({ mode: 'words', count: 100, punctuation: true })).toEqual({ mode: 'words', count: 100, punctuation: true });
    expect(raceConfigSchema.parse({ mode: 'quote', length: 'long' })).toEqual({ mode: 'quote', length: 'long' });
    expect(raceConfigSchema.parse({ mode: 'custom', text: 'hello there' })).toEqual({ mode: 'custom', text: 'hello there' });
  });

  it('rejects unsupported values and unknown fields', () => {
    for (const bad of [
      { mode: 'time', seconds: 45 },
      { mode: 'words', count: 0 },
      { mode: 'quote', length: 'epic' },
      { mode: 'zen' },
      { mode: 'words', count: 25, extra: true },
      { mode: 'custom', text: '' },
    ]) {
      expect(raceConfigSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(setRaceConfigSchema.safeParse({ config: { mode: 'time', seconds: 15 }, sneaky: 1 }).success).toBe(false);
    expect(createRoomSchema.safeParse({ username: 'Host', bot: { targetWpm: 1000 } }).success).toBe(false);
  });
});

describe('custom text', () => {
  it('folds typographic punctuation to plain keyboard characters', () => {
    expect(normalizeCustomText('“Don’t” — stop…\n\n  now')).toBe('"Don\'t" - stop... now');
  });

  it('enforces the length limit after normalisation and rejects untypeable characters', () => {
    expect(customTextSchema.safeParse('a'.repeat(CUSTOM_TEXT_MAX_LENGTH)).success).toBe(true);
    expect(customTextSchema.safeParse('a'.repeat(CUSTOM_TEXT_MAX_LENGTH + 1)).success).toBe(false);
    expect(customTextSchema.safeParse('   \n  ').success).toBe(false);
    expect(customTextSchema.safeParse('naïve café').success).toBe(false);
    expect(customTextSchema.safeParse('emoji 🙂').success).toBe(false);
  });
});

describe('quick race contracts', () => {
  it('pins the race size and lobby timing in one place', () => {
    expect(QUICK_RACE_MIN_RACERS).toBe(2);
    expect(QUICK_RACE_MAX_RACERS).toBe(5);
    expect(QUICK_RACE_LOBBY_WAIT_MS).toBe(10_000);
    expect(QUICK_RACE_GHOSTS).toEqual({ min: 1, max: 3 });
    expect(WPM_BANDS.map((band) => band.id)).toEqual(['0-40', '40-70', '70-100', '100+']);
  });

  it('queue:join is strict and never accepts custom text', () => {
    expect(queueJoinSchema.parse({ username: '  Ada  ', config: { mode: 'time', seconds: 30 } })).toEqual({
      username: 'Ada', config: { mode: 'time', seconds: 30, punctuation: false },
    });
    expect(queueJoinSchema.safeParse({ username: 'Ada', role: 'ghost' }).success).toBe(false);
    expect(queueJoinSchema.safeParse({ username: 'Ada', config: { mode: 'custom', text: 'hello world' } }).success).toBe(false);
  });

  it('every racer carries isGhost, and queue updates cap seats at five', () => {
    const racer = { playerId: 'p', username: 'Wisp-42', connected: true, isBot: true };
    expect(roomStateSchema.safeParse({ code: 'ABCDEF', state: 'LOBBY', kind: 'quick', hostPlayerId: 'p', config: DEFAULT_QUICK_RACE_CONFIG, players: [racer] }).success).toBe(false);
    expect(roomStateSchema.safeParse({ code: 'ABCDEF', state: 'LOBBY', kind: 'quick', hostPlayerId: 'p', config: DEFAULT_QUICK_RACE_CONFIG, players: [{ ...racer, isGhost: true }] }).success).toBe(true);
    const update = { lobbyId: 'l', band: '40-70', config: DEFAULT_QUICK_RACE_CONFIG, racers: [], seatsFilled: 6, maxSeats: 5, msLeft: 0, secondsLeft: 0 };
    expect(queueUpdateSchema.safeParse(update).success).toBe(false);
    expect(queueUpdateSchema.safeParse({ ...update, seatsFilled: 5 }).success).toBe(true);
    expect(queueUpdateSchema.safeParse({ ...update, seatsFilled: 1, band: '200+' }).success).toBe(false);
  });
});
