import { useEffect, useRef, type ReactNode } from 'react';
import { CARET_STYLES, FONT_SIZE, TYPING_FONTS, typingFontFamily, updateSettings, useSettings, type Settings } from '../settings/settings.js';
import { THEMES } from '../settings/themes.js';

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const settings = useSettings();
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => { panelRef.current?.querySelector<HTMLElement>('button, input')?.focus(); }, []);

  return <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="settings" role="dialog" aria-modal="true" aria-labelledby="settings-title" ref={panelRef}>
      <header className="settings-head">
        <h2 id="settings-title">Settings</h2>
        <button className="icon-button" onClick={onClose} aria-label="Close settings">✕</button>
      </header>
      <p className="muted small">Saved in this browser only.</p>

      <Section title="Theme">
        <div className="theme-grid">
          {THEMES.map((theme) => <button
            key={theme.id}
            data-theme={theme.id}
            className={`theme-swatch ${settings.theme === theme.id ? 'active' : ''}`}
            onClick={() => updateSettings({ theme: theme.id })}
            aria-pressed={settings.theme === theme.id}
            title={theme.tags.join(', ')}
          >
            <span className="swatch-name">{theme.label}</span>
            <span className="swatch-dots" aria-hidden><i style={{ background: 'var(--accent)' }} /><i style={{ background: 'var(--text)' }} /><i style={{ background: 'var(--error)' }} /></span>
          </button>)}
        </div>
      </Section>

      <Section title="Typing font">
        <div className="choice-row wrap">
          {TYPING_FONTS.map((font) => <button
            key={font.id}
            className={`choice ${settings.typingFont === font.id ? 'active' : ''}`}
            style={{ fontFamily: typingFontFamily(font.id) }}
            aria-pressed={settings.typingFont === font.id}
            onClick={() => updateSettings({ typingFont: font.id })}
          >{font.label}</button>)}
        </div>
      </Section>

      <Section title="Font size">
        <div className="choice-row">
          <input
            type="range"
            min={FONT_SIZE.min}
            max={FONT_SIZE.max}
            step={FONT_SIZE.step}
            value={settings.fontSize}
            onChange={(event) => updateSettings({ fontSize: Number(event.target.value) })}
            aria-label="Typing font size"
          />
          <span className="value-pill">{settings.fontSize.toFixed(2)}rem</span>
        </div>
        <p className="font-preview" style={{ fontFamily: 'var(--typing-font)', fontSize: 'var(--typing-size)' }}>the quick brown fox</p>
      </Section>

      <Section title="Caret">
        <div className="choice-row">
          {CARET_STYLES.map((style) => <button
            key={style}
            className={`choice ${settings.caretStyle === style ? 'active' : ''}`}
            aria-pressed={settings.caretStyle === style}
            onClick={() => updateSettings({ caretStyle: style })}
          ><span className={`caret-sample caret-sample-${style}`} aria-hidden>a</span>{style}</button>)}
        </div>
        <Toggle setting="smoothCaret" label="Smooth caret" description="Glide between characters instead of jumping." />
      </Section>

      <Section title="Feedback">
        <Toggle setting="highlightErrors" label="Highlight errors" description="Keep corrected characters marked after you fix them." />
        <Toggle setting="ghostLabels" label="Racer name labels" description="Show names above other racers' carets." />
        <Toggle setting="focusMode" label="Focus mode" description="Fade everything but the text while you type; move the mouse to bring it back." />
      </Section>
    </div>
  </div>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="settings-section"><h3>{title}</h3>{children}</section>;
}

type BooleanSetting = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

function Toggle({ setting, label, description }: { setting: BooleanSetting; label: string; description: string }) {
  const settings = useSettings();
  const on = settings[setting];
  return <label className="toggle">
    <span><strong>{label}</strong><span className="muted small">{description}</span></span>
    <input type="checkbox" role="switch" checked={on} onChange={() => updateSettings({ [setting]: !on })} />
    <span className="switch" aria-hidden />
  </label>;
}
