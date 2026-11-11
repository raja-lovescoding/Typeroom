import { useSyncExternalStore } from 'react';
import { DEFAULT_THEME, isThemeId, type ThemeId } from './themes.js';

/**
 * Purely visual, per-browser preferences. They never affect the race, so they live only in
 * localStorage and never reach the server. index.html applies `theme` before first paint.
 */

export const TYPING_FONTS = [
  { id: 'roboto-mono', label: 'Roboto Mono', family: "'Roboto Mono'" },
  { id: 'jetbrains-mono', label: 'JetBrains Mono', family: "'JetBrains Mono'" },
  { id: 'fira-code', label: 'Fira Code', family: "'Fira Code'" },
  { id: 'source-code-pro', label: 'Source Code Pro', family: "'Source Code Pro'" },
  { id: 'ibm-plex-mono', label: 'IBM Plex Mono', family: "'IBM Plex Mono'" },
] as const;
export type TypingFontId = (typeof TYPING_FONTS)[number]['id'];

export const CARET_STYLES = ['line', 'block', 'outline', 'underline'] as const;
export type CaretStyle = (typeof CARET_STYLES)[number];

export const FONT_SIZE = { min: 1.25, max: 3, step: 0.25 } as const;

/** `system` follows the operating system's "reduce motion" preference. */
export const MOTION_PREFERENCES = ['system', 'reduce', 'full'] as const;
export type MotionPreference = (typeof MOTION_PREFERENCES)[number];

export const SOUND_VOLUME = { min: 0, max: 100, step: 5 } as const;

export interface Settings {
  theme: ThemeId;
  typingFont: TypingFontId;
  /** Typing-area font size in rem. */
  fontSize: number;
  caretStyle: CaretStyle;
  smoothCaret: boolean;
  ghostLabels: boolean;
  highlightErrors: boolean;
  focusMode: boolean;
  /** Show live WPM and accuracy while racing (the timer and word count always show). */
  liveStats: boolean;
  /** Key click sounds, synthesised in the browser. */
  sound: boolean;
  /** 0-100. */
  soundVolume: number;
  motion: MotionPreference;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: DEFAULT_THEME,
  typingFont: 'roboto-mono',
  fontSize: 1.75,
  caretStyle: 'line',
  smoothCaret: true,
  ghostLabels: true,
  highlightErrors: true,
  focusMode: true,
  liveStats: true,
  sound: false,
  soundVolume: 50,
  motion: 'system',
};

export const SETTINGS_STORAGE_KEY = 'typeroom.settings';

/** Accepts anything (corrupt or old localStorage) and returns valid settings. */
export function sanitizeSettings(raw: unknown): Settings {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const bool = (key: keyof Settings): boolean =>
    typeof input[key] === 'boolean' ? (input[key] as boolean) : (DEFAULT_SETTINGS[key] as boolean);
  const size = typeof input.fontSize === 'number' && Number.isFinite(input.fontSize) ? input.fontSize : DEFAULT_SETTINGS.fontSize;
  return {
    theme: isThemeId(input.theme) ? input.theme : DEFAULT_SETTINGS.theme,
    typingFont: TYPING_FONTS.some((font) => font.id === input.typingFont) ? (input.typingFont as TypingFontId) : DEFAULT_SETTINGS.typingFont,
    fontSize: clampFontSize(size),
    caretStyle: CARET_STYLES.includes(input.caretStyle as CaretStyle) ? (input.caretStyle as CaretStyle) : DEFAULT_SETTINGS.caretStyle,
    smoothCaret: bool('smoothCaret'),
    ghostLabels: bool('ghostLabels'),
    highlightErrors: bool('highlightErrors'),
    focusMode: bool('focusMode'),
    liveStats: bool('liveStats'),
    sound: bool('sound'),
    soundVolume: clampVolume(typeof input.soundVolume === 'number' && Number.isFinite(input.soundVolume) ? input.soundVolume : DEFAULT_SETTINGS.soundVolume),
    motion: MOTION_PREFERENCES.includes(input.motion as MotionPreference) ? (input.motion as MotionPreference) : DEFAULT_SETTINGS.motion,
  };
}

export function clampVolume(value: number): number {
  const stepped = Math.round(value / SOUND_VOLUME.step) * SOUND_VOLUME.step;
  return Math.min(SOUND_VOLUME.max, Math.max(SOUND_VOLUME.min, stepped));
}

export function clampFontSize(value: number): number {
  const stepped = Math.round(value / FONT_SIZE.step) * FONT_SIZE.step;
  return Math.min(FONT_SIZE.max, Math.max(FONT_SIZE.min, stepped));
}

function load(): Settings {
  try {
    return sanitizeSettings(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}'));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function save(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable (private mode, quota); settings still apply for this visit.
  }
}

export function typingFontFamily(id: TypingFontId): string {
  return TYPING_FONTS.find((font) => font.id === id)?.family ?? "'Roboto Mono'";
}

function apply(settings: Settings): void {
  if (typeof document === 'undefined') return; // unit tests run without a DOM
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  // themes.css/global.css read this: `reduce` always strips motion, `full` ignores the OS setting.
  root.dataset.motion = settings.motion;
  root.style.setProperty('--typing-font', `${typingFontFamily(settings.typingFont)}, ui-monospace, monospace`);
  root.style.setProperty('--typing-size', `${settings.fontSize}rem`);
}

let current = load();
const listeners = new Set<() => void>();
apply(current);

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = sanitizeSettings({ ...current, ...patch });
  save(current);
  apply(current);
  for (const listener of listeners) listener();
}

/** Temporarily shows a theme (palette hover) without saving it; `null` restores the saved one. */
export function previewTheme(id: ThemeId | null): void {
  document.documentElement.dataset.theme = id ?? current.theme;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings);
}
