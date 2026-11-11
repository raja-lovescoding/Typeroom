import { DEFAULT_QUICK_RACE_CONFIG, DEFAULT_RACE_CONFIG, quickRaceConfigSchema, raceConfigSchema, type QuickRaceConfig, type RaceConfig } from '@typeroom/shared';

/**
 * The race mode the player last picked, so the bot card and new rooms start where they left off.
 * Stored in localStorage only and validated on load like every other client setting.
 */
const STORAGE_KEY = 'typeroom.raceConfig';

export function loadRaceConfig(): RaceConfig {
  try {
    const parsed = raceConfigSchema.safeParse(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
    return parsed.success ? parsed.data : DEFAULT_RACE_CONFIG;
  } catch {
    return DEFAULT_RACE_CONFIG;
  }
}

/** The last picked mode if Quick Race allows it (custom text never goes to strangers). */
export function loadQuickRaceConfig(): QuickRaceConfig {
  const parsed = quickRaceConfigSchema.safeParse(loadRaceConfig());
  return parsed.success ? parsed.data : DEFAULT_QUICK_RACE_CONFIG;
}

export function saveRaceConfig(config: RaceConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Storage unavailable: the choice still applies to this visit.
  }
}

/** Short human label, e.g. "time 30s", "words 25 · punctuation", "quote · long", "custom · 42 words". */
export function describeRaceConfig(config: RaceConfig): string {
  switch (config.mode) {
    case 'time':
      return `time ${config.seconds}s${config.punctuation ? ' · punctuation' : ''}`;
    case 'words':
      return `${config.count} words${config.punctuation ? ' · punctuation' : ''}`;
    case 'quote':
      return `quote · ${config.length}`;
    case 'custom': {
      const words = config.text.split(' ').length;
      return `custom text · ${words} word${words === 1 ? '' : 's'}`;
    }
  }
}
