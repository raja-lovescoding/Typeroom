import { useEffect, useId, useState } from 'react';
import {
  CUSTOM_TEXT_MAX_LENGTH,
  customTextSchema,
  QUOTE_LENGTHS,
  TIME_MODE_SECONDS,
  WORD_MODE_COUNTS,
  type RaceConfig,
  type RaceMode,
} from '@typeroom/shared';
import { describeRaceConfig } from '../lib/raceConfig.js';

const MODES: { id: RaceMode; label: string; hint: string }[] = [
  { id: 'time', label: 'time', hint: 'Type as much as you can before the clock runs out.' },
  { id: 'words', label: 'words', hint: 'First to finish a fixed number of words wins.' },
  { id: 'quote', label: 'quote', hint: 'Race through a passage from a book or one of our own.' },
  { id: 'custom', label: 'custom', hint: 'Paste your own text for everyone to race on.' },
];

const QUOTE_HINTS: Record<(typeof QUOTE_LENGTHS)[number], string> = { short: 'up to 100 characters', medium: '100–250', long: '250+' };

function punctuationOf(config: RaceConfig): boolean {
  return 'punctuation' in config ? config.punctuation : false;
}

function defaultFor(mode: RaceMode, from: RaceConfig): RaceConfig | null {
  const punctuation = punctuationOf(from);
  switch (mode) {
    case 'time': return { mode, seconds: 30, punctuation };
    case 'words': return { mode, count: 25, punctuation };
    case 'quote': return { mode, length: 'medium' };
    case 'custom': return null; // needs text first
  }
}

/**
 * Picks a race mode. Every change is applied immediately except custom text, which only applies
 * when the player confirms it (so a host doesn't broadcast every keystroke to the room).
 */
export function ModePicker({ value, onChange, allowCustom = true }: {
  value: RaceConfig;
  onChange: (config: RaceConfig) => void;
  /** Quick Race hides custom text: strangers never race on someone else's text. */
  allowCustom?: boolean;
}) {
  const id = useId();
  const [mode, setMode] = useState<RaceMode>(value.mode);
  const [draft, setDraft] = useState(value.mode === 'custom' ? value.text : '');
  const [draftError, setDraftError] = useState<string>();
  useEffect(() => {
    setMode(value.mode);
    if (value.mode === 'custom') setDraft(value.text);
  }, [value]);

  const chooseMode = (next: RaceMode) => {
    setMode(next);
    setDraftError(undefined);
    if (next === value.mode) return;
    const config = defaultFor(next, value);
    if (config) onChange(config);
  };

  const applyDraft = () => {
    const parsed = customTextSchema.safeParse(draft);
    if (!parsed.success) {
      setDraftError(parsed.error.issues[0]?.message ?? 'That text cannot be used');
      return;
    }
    setDraftError(undefined);
    setDraft(parsed.data);
    onChange({ mode: 'custom', text: parsed.data });
  };

  const activeHint = MODES.find((item) => item.id === mode)?.hint;
  const customApplied = value.mode === 'custom' && value.text === draft;

  return <div className="mode-picker">
    <div className="segmented modes" role="radiogroup" aria-label="Race mode">
      {MODES.filter((item) => allowCustom || item.id !== 'custom').map((item) => <button
        key={item.id}
        type="button"
        role="radio"
        aria-checked={mode === item.id}
        className={mode === item.id ? 'active' : ''}
        onClick={() => chooseMode(item.id)}
      >{item.label}</button>)}
    </div>
    <p className="muted small mode-hint">{activeHint}</p>

    {value.mode === 'time' && mode === 'time' && <OptionRow label="Duration" options={TIME_MODE_SECONDS.map((seconds) => ({
      key: String(seconds), label: `${seconds}s`, active: value.seconds === seconds, pick: () => onChange({ ...value, seconds }),
    }))} />}

    {value.mode === 'words' && mode === 'words' && <OptionRow label="Word count" options={WORD_MODE_COUNTS.map((count) => ({
      key: String(count), label: String(count), active: value.count === count, pick: () => onChange({ ...value, count }),
    }))} />}

    {(value.mode === 'time' || value.mode === 'words') && mode === value.mode && <label className="inline-check">
      <input type="checkbox" checked={value.punctuation} onChange={() => onChange({ ...value, punctuation: !value.punctuation })} />
      <span>Punctuation and capitals</span>
    </label>}

    {value.mode === 'quote' && mode === 'quote' && <OptionRow label="Quote length" options={QUOTE_LENGTHS.map((length) => ({
      key: length, label: length, title: QUOTE_HINTS[length], active: value.length === length, pick: () => onChange({ ...value, length }),
    }))} />}

    {mode === 'custom' && <div className="custom-text">
      <label htmlFor={`${id}-custom`} className="sr-only">Custom text</label>
      <textarea
        id={`${id}-custom`}
        value={draft}
        rows={4}
        maxLength={CUSTOM_TEXT_MAX_LENGTH * 2}
        placeholder="Paste or type the text to race on…"
        onChange={(event) => { setDraft(event.target.value); setDraftError(undefined); }}
        aria-invalid={Boolean(draftError)}
        aria-describedby={`${id}-custom-help`}
      />
      <div className="custom-foot">
        <span id={`${id}-custom-help`} className={`small ${draftError ? 'error-text' : 'muted'}`} role={draftError ? 'alert' : undefined}>
          {draftError ?? `${draft.length}/${CUSTOM_TEXT_MAX_LENGTH} · plain keyboard characters; curly quotes and dashes are converted`}
        </span>
        <button type="button" className="secondary small" onClick={applyDraft} disabled={!draft.trim() || customApplied}>
          {customApplied ? 'In use' : 'Use this text'}
        </button>
      </div>
    </div>}
  </div>;
}

function OptionRow({ label, options }: {
  label: string;
  options: { key: string; label: string; title?: string; active: boolean; pick: () => void }[];
}) {
  return <div className="option-row" role="radiogroup" aria-label={label}>
    {options.map((option) => <button
      key={option.key}
      type="button"
      role="radio"
      aria-checked={option.active}
      title={option.title}
      className={`choice ${option.active ? 'active' : ''}`}
      onClick={option.pick}
    >{option.label}</button>)}
  </div>;
}

/** Read-only summary for players who aren't the host. */
export function ModeSummary({ config }: { config: RaceConfig }) {
  return <p className="mode-summary"><span className="muted small">mode</span> <strong>{describeRaceConfig(config)}</strong></p>;
}
