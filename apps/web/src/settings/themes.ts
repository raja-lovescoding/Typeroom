/** Theme catalogue. Colours live in styles/themes.css; this list drives pickers and validation. */
export const THEMES = [
  { id: 'ember', label: 'Ember', tags: ['dark', 'warm'] },
  { id: 'paper', label: 'Paper', tags: ['light', 'warm'] },
  { id: 'midnight', label: 'Midnight', tags: ['dark', 'cool'] },
  { id: 'dune', label: 'Dune', tags: ['dark', 'warm'] },
  { id: 'glacier', label: 'Glacier', tags: ['light', 'cool'] },
  { id: 'contrast', label: 'Contrast', tags: ['dark', 'high contrast'] },
  { id: 'fog', label: 'Fog', tags: ['dark', 'low contrast'] },
  { id: 'moss', label: 'Moss', tags: ['dark', 'green'] },
  { id: 'rosewater', label: 'Rosewater', tags: ['light', 'pink'] },
  { id: 'harbor', label: 'Harbor', tags: ['dark', 'cool', 'teal'] },
  { id: 'phosphor', label: 'Phosphor', tags: ['dark', 'green', 'terminal'] },
  { id: 'plum', label: 'Plum', tags: ['dark', 'purple'] },
  { id: 'sunset', label: 'Sunset', tags: ['dark', 'warm', 'coloured'] },
  { id: 'chalk', label: 'Chalk', tags: ['light', 'neutral'] },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];
export const DEFAULT_THEME: ThemeId = 'ember';

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}

export function themeLabel(id: ThemeId): string {
  return THEMES.find((theme) => theme.id === id)?.label ?? id;
}
