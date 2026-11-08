import type { ReactNode } from 'react';
import { useSettings } from '../settings/settings.js';
import { themeLabel } from '../settings/themes.js';
import { Kbd } from './Kbd.js';

export function Header({ roomCode, onHome, onPalette, onSettings }: {
  roomCode: string | undefined; onHome: () => void; onPalette: () => void; onSettings: () => void;
}) {
  return <header className="app-header chrome">
    <button className="brand" onClick={onHome} aria-label="Typeroom home">
      <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden>
        <rect x="2" y="6" width="28" height="20" rx="5" fill="none" stroke="currentColor" strokeWidth="2.5" />
        <rect x="9" y="11" width="2.5" height="10" rx="1.25" fill="var(--accent)" />
        <rect x="15" y="16" width="9" height="2.5" rx="1.25" fill="currentColor" opacity=".5" />
      </svg>
      <span>typeroom</span>
    </button>
    {roomCode && <span className="room-chip" title="Room code">room <strong>{roomCode}</strong></span>}
    <nav className="header-actions">
      <button className="icon-button" onClick={onPalette} aria-label="Command palette (Esc)" title="Command palette (esc)">⌘</button>
      <button className="icon-button" onClick={onSettings} aria-label="Settings" title="Settings">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></svg>
      </button>
    </nav>
  </header>;
}

export function Footer({ quickAction, onTheme }: { quickAction: string | undefined; onTheme: () => void }) {
  const settings = useSettings();
  return <footer className="app-footer chrome">
    <div className="shortcuts">
      {quickAction && <Shortcut keys={[<Kbd key="t">tab</Kbd>, ' + ', <Kbd key="e">enter</Kbd>]} label={quickAction} />}
      <Shortcut keys={[<Kbd key="esc">esc</Kbd>]} label="command palette" />
    </div>
    <button className="footer-theme" onClick={onTheme} title="Change theme">
      <span className="theme-dot" aria-hidden />{themeLabel(settings.theme)}
    </button>
  </footer>;
}

function Shortcut({ keys, label }: { keys: ReactNode[]; label: string }) {
  return <span className="shortcut">{keys}<span>{label}</span></span>;
}

export function Toast({ message }: { message: string | undefined }) {
  return <div className={`toast ${message ? 'show' : ''}`} role="status" aria-live="polite">{message}</div>;
}
