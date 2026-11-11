import { useState } from 'react';
import {
  usernameSchema, type QuickRaceConfig, type RaceConfig, type RoomStateMessage,
} from '@typeroom/shared';
import { Kbd } from '../../components/Kbd.js';
import { ModePicker, ModeSummary } from '../../components/ModePicker.js';
import { RacerTag } from '../../components/RacerTag.js';
import { loadQuickRaceConfig, loadRaceConfig, saveRaceConfig } from '../../lib/raceConfig.js';
import { Link } from '../../lib/router.js';
import { session } from '../../lib/session.js';
import { caretColor, colorFor } from '../race/colors.js';

export function Home({ onCreate, onJoin, onQuickRace, initialCode, currentRoom, roomOpen }: {
  onCreate: (options?: { config?: RaceConfig }) => void;
  onJoin: (code: string) => void;
  onQuickRace: (config: QuickRaceConfig) => void;
  initialCode?: string | undefined;
  /** The room the player is already in, if they navigated back to the home page. */
  currentRoom?: string | undefined;
  roomOpen: boolean;
}) {
  const [nameError, setNameError] = useState<string>();
  const [code, setCode] = useState(initialCode ?? '');
  const [quickConfig, setQuickConfig] = useState<QuickRaceConfig>(loadQuickRaceConfig);
  const [quickOptions, setQuickOptions] = useState(false);
  const validCode = /^[A-Z2-9]{6}$/.test(code);

  /** Validates and saves the nickname; the server re-checks it and also applies a profanity filter. */
  const saveName = (): boolean => {
    const parsed = usernameSchema.safeParse(session.getUsername() || 'Guest');
    if (!parsed.success) {
      setNameError(parsed.error.issues[0]?.message);
      document.getElementById('header-nickname')?.focus();
      return false;
    }
    setNameError(undefined);
    session.setUsername(parsed.data);
    return true;
  };

  return <section className="home">
    <div className="home-intro">
      <h1>New age of type race begins ...</h1>
    </div>

    {currentRoom && <p className="notice-banner">
      You're still in room <strong>{currentRoom}</strong>. <Link to={`/r/${currentRoom}`}>Back to the room</Link>
    </p>}

    {initialCode && !currentRoom && <p className="notice-banner">Pick a nickname, then join room <strong>{initialCode}</strong>.</p>}
    {nameError && <p className="error-text small" role="alert">{nameError}</p>}

    <div className="card quick-race-card">
      <h2>Quick race</h2>
      {quickOptions && <ModePicker value={quickConfig} allowCustom={false} onChange={(config) => {
        if (config.mode === 'custom') return;
        setQuickConfig(config);
        saveRaceConfig(config);
      }} />}
      <div className="quick-race-actions">
        <button className="primary" onClick={() => { if (saveName()) onQuickRace(loadQuickRaceConfig()); }}>Quick race</button>
        <button type="button" className="ghost-button small" aria-expanded={quickOptions} onClick={() => setQuickOptions((open) => !open)}>
          {quickOptions ? 'hide mode' : 'mode'}
        </button>
      </div>
    </div>

    {roomOpen && <div className="card room-options">
      <h2>Play with friends</h2>
      <button className="secondary" onClick={() => { if (saveName()) onCreate({ config: loadRaceConfig() }); }}>Create a private room</button>
      <form className="join-row" onSubmit={(event) => { event.preventDefault(); if (validCode && saveName()) onJoin(code); }}>
        <input
          aria-label="Room code"
          placeholder="ROOM CODE"
          value={code}
          maxLength={6}
          autoFocus={Boolean(initialCode)}
          onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
        />
        <button className="secondary" type="submit" disabled={!validCode}>Join</button>
      </form>
    </div>}
  </section>;
}

export function Lobby({ room, playerId, isHost, onStart, onCopyLink, onConfig }: {
  room: RoomStateMessage;
  playerId: string;
  isHost: boolean;
  onStart: () => void;
  onCopyLink: () => void;
  onConfig: (config: RaceConfig) => void;
}) {
  return <section className="lobby">
    <div className="lobby-code">
      <span className="label">room code</span>
      <strong>{room.code}</strong>
      <button className="secondary small" onClick={onCopyLink}>Copy invite link</button>
    </div>
    <h2>{room.players.length === 1 ? 'Waiting for racers…' : `${room.players.length} racers ready`}</h2>
    <ul className="lobby-players">
      {room.players.map((player) => <li key={player.playerId} style={caretColor(colorFor(room.players, player.playerId, playerId))} className={player.connected ? '' : 'offline'}>
        <i className="dot" />
        <span>{player.username}</span>
        {player.playerId === room.hostPlayerId && <span className="tag">host</span>}
        {player.playerId === playerId && <span className="tag">you</span>}
        <RacerTag racer={player} />
        {!player.connected && <span className="tag">offline</span>}
      </li>)}
    </ul>

    <div className="card">
      <h2>Race mode</h2>
      {isHost ? <ModePicker value={room.config} onChange={onConfig} /> : <ModeSummary config={room.config} />}
    </div>

    {isHost
      ? <div className="lobby-actions"><button className="primary" onClick={onStart}>Start race</button><span className="hint"><Kbd>tab</Kbd> + <Kbd>enter</Kbd></span></div>
      : <p className="muted">The host picks the mode and starts the race.</p>}
  </section>;
}
