import { useEffect, useRef } from 'react';
import { Link } from '../lib/router.js';
import { SettingsForm } from './SettingsForm.js';

/** Settings as an overlay, so they can be changed mid-room without leaving the race screen. */
export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => { panelRef.current?.querySelector<HTMLElement>('button, input')?.focus(); }, []);

  return <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="settings" role="dialog" aria-modal="true" aria-labelledby="settings-title" ref={panelRef}>
      <header className="settings-head">
        <h2 id="settings-title">Settings</h2>
        <button className="icon-button" onClick={onClose} aria-label="Close settings">✕</button>
      </header>
      <p className="muted small">Saved in this browser only. Also available on the <Link to="/settings" onClick={onClose}>settings page</Link>.</p>
      <SettingsForm />
    </div>
  </div>;
}
