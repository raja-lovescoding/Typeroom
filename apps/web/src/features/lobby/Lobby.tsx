import { useState } from 'react';
import type { RoomStateMessage } from '@typeroom/shared';
import { session } from '../../lib/session.js';
import { Kbd } from '../../components/Kbd.js';
import { caretColor, colorFor } from '../race/colors.js';

export type BotSpeed = 40 | 60 | 90 | 120;
const BOT_SPEEDS: BotSpeed[] = [40, 60, 90, 120];

export function Home({ onCreate, onJoin, initialCode }: {
  onCreate: (bot?: BotSpeed) => void;
  onJoin: (code: string) => void;
  initialCode?: string | undefined;
}) {
  const [username, setUsername] = useState(session.getUsername());
  const [code, setCode] = useState(initialCode ?? '');
  const [speed, setSpeed] = useState<BotSpeed>(60);
  const save = () => session.setUsername(username.trim().slice(0, 24) || 'Guest');
  const validCode = /^[A-Z2-9]{6}$/.test(code);

  return <section className="home">
    <div className="home-intro">
      <h1>Race your friends, one keystroke at a time.</h1>
      <p className="muted">Create a room, share the link, and type the same text together. Or warm up against a bot.</p>
    </div>
    <label className="field">
      <span>Your name</span>
      <input value={username} maxLength={24} placeholder="Guest" onChange={(event) => setUsername(event.target.value)} autoFocus={!initialCode} />
    </label>

    <div className="card">
      <h2>Practice against a bot</h2>
      <div className="segmented" role="radiogroup" aria-label="Bot speed">
        {BOT_SPEEDS.map((value) => <button key={value} role="radio" aria-checked={speed === value} className={speed === value ? 'active' : ''} onClick={() => setSpeed(value)}>{value} wpm</button>)}
      </div>
      <button className="primary" onClick={() => { save(); onCreate(speed); }}>Race the bot</button>
    </div>

    <div className="card">
      <h2>Play with friends</h2>
      <button className="secondary" onClick={() => { save(); onCreate(); }}>Create a private room</button>
      <form className="join-row" onSubmit={(event) => { event.preventDefault(); if (validCode) { save(); onJoin(code); } }}>
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
    </div>
  </section>;
}

export function Lobby({ room, playerId, isHost, onStart, onCopyLink }: {
  room: RoomStateMessage; playerId: string; isHost: boolean; onStart: () => void; onCopyLink: () => void;
}) {
  return <section className="lobby">
    <div className="lobby-code">
      <span className="label">room code</span>
      <strong>{room.code}</strong>
      <button className="secondary small" onClick={onCopyLink}>Copy invite link</button>
    </div>
    <h2>{room.players.length === 1 ? 'Waiting for racers…' : `${room.players.length} racers ready`}</h2>
    <ul className="lobby-players">
      {room.players.map((player, index) => <li key={player.playerId} style={caretColor(colorFor(room.players, player.playerId, playerId))} className={player.connected ? '' : 'offline'}>
        <i className="dot" />
        <span>{player.username}</span>
        {index === 0 && <span className="tag">host</span>}
        {player.playerId === playerId && <span className="tag">you</span>}
        {player.isBot && <span className="tag">bot</span>}
        {!player.connected && <span className="tag">offline</span>}
      </li>)}
    </ul>
    {isHost
      ? <div className="lobby-actions"><button className="primary" onClick={onStart}>Start race</button><span className="hint"><Kbd>tab</Kbd> + <Kbd>enter</Kbd></span></div>
      : <p className="muted">The host will start the race.</p>}
  </section>;
}
