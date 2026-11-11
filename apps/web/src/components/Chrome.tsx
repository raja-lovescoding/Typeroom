import type { ReactNode } from 'react';
import { SITE } from '../config/site.js';
import { Link, usePathname } from '../lib/router.js';
import { useSettings } from '../settings/settings.js';
import { themeLabel } from '../settings/themes.js';
import { Kbd } from './Kbd.js';
import { session } from '../lib/session.js';
import { TIME_MODE_SECONDS } from '@typeroom/shared';
type TimeSeconds = (typeof TIME_MODE_SECONDS)[number];

export function Logo() {
  return <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden>
    <path d="M16 3 27 9.5v13L16 29 5 22.5v-13L16 3Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    <path d="M5 9.5 16 16l11-6.5M16 16v13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
  </svg>;
}

export function Header({ roomCode, onPalette, onQuickRace, onRoom, selectedTime, onTimeChange }: {
  roomCode: string | undefined;
  onPalette: () => void;
  onQuickRace: () => void;
  onRoom: () => void;
  selectedTime: TimeSeconds;
  onTimeChange: (seconds: TimeSeconds) => void;
}) {
  const pathname = usePathname();
  return <header className="app-header chrome">
    <div className="brand-column">
      <Link to="/" className="brand" aria-label="Typeroom home"><Logo /><span>typeroom</span></Link>
      <button className="quick-race-top" onClick={onQuickRace}>Quick race</button>
    </div>
    {roomCode && <Link to={`/r/${roomCode}`} className="room-chip" title="Back to your room">room <strong>{roomCode}</strong></Link>}
    <nav className="header-nav" aria-label="Main">
      <div className="time-controls" role="radiogroup" aria-label="Race duration">
        {TIME_MODE_SECONDS.map((seconds) => <button
          key={seconds}
          type="button"
          role="radio"
          aria-checked={selectedTime === seconds}
          className={selectedTime === seconds ? 'active' : ''}
          onClick={() => onTimeChange(seconds)}
        >{seconds}s</button>)}
      </div>
      <button className="header-room" onClick={onRoom}>ROOM</button>
      <Link to="/settings" className={pathname === '/settings' ? 'active' : ''}>settings</Link>
      <Link to="/about" className={pathname === '/about' ? 'active' : ''}>about</Link>
      <label className="header-nickname">
        <span className="sr-only">Your nickname</span>
        <input
          id="header-nickname"
          defaultValue={session.getUsername()}
          placeholder="nickname"
          maxLength={24}
          autoComplete="nickname"
          onChange={(event) => session.setUsername(event.target.value)}
        />
      </label>
      <button className="icon-button" onClick={onPalette} aria-label="Command palette (Esc)" title="Command palette (esc)">⌘</button>
    </nav>
  </header>;
}

export function Footer({ quickAction, showShortcuts, onTheme }: { quickAction: string | undefined; showShortcuts: boolean; onTheme: () => void }) {
  const settings = useSettings();
  return <footer className="app-footer chrome">
    {showShortcuts && <div className="shortcuts">
      {quickAction && <Shortcut keys={[<Kbd key="t">tab</Kbd>, ' + ', <Kbd key="e">enter</Kbd>]} label={quickAction} />}
      <Shortcut keys={[<Kbd key="esc">esc</Kbd>]} label="command palette" />
    </div>}
    <div className="footer-bar">
      <nav className="footer-links" aria-label="Site">
        <Link to="/about">About</Link>
        <Link to="/privacy">Privacy</Link>
        <Link to="/terms">Terms</Link>
        <Link to="/contact">Contact</Link>
        <a href={SITE.repoUrl} target="_blank" rel="noreferrer">GitHub</a>
      </nav>
      <div className="footer-meta">
        <span className="version" title="Version">v{SITE.version}</span>
        <button className="footer-theme" onClick={onTheme} title="Change theme">
          <span className="theme-dot" aria-hidden />{themeLabel(settings.theme)}
        </button>
      </div>
    </div>
  </footer>;
}

function Shortcut({ keys, label }: { keys: ReactNode[]; label: string }) {
  return <span className="shortcut">{keys}<span>{label}</span></span>;
}

export function Toast({ message }: { message: string | undefined }) {
  return <div className={`toast ${message ? 'show' : ''}`} role="status" aria-live="polite">{message}</div>;
}
