import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  CLIENT_EVENTS,
  raceCountdownSchema,
  raceProgressSchema,
  raceResultsSchema,
  roomStateSchema,
  SERVER_EVENTS,
  type RaceProgressPayload,
  type RaceResultsPayload,
  type RoomStateMessage,
} from '@typeroom/shared';
import { session } from '../lib/session.js';
import { socket } from '../lib/socket.js';
import '../styles/global.css';

type Screen = 'home' | 'lobby' | 'race' | 'results';

export function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [room, setRoom] = useState<RoomStateMessage>();
  const [progress, setProgress] = useState<RaceProgressPayload>();
  const [results, setResults] = useState<RaceResultsPayload>();
  const [countdown, setCountdown] = useState<{ startsInMs: number; text: string }>();
  const [playerId, setPlayerId] = useState('');
  const routeCode = useMemo(() => window.location.pathname.match(/^\/r\/([A-Z2-9]{6})$/)?.[1], []);

  useEffect(() => {
    const onRoom = (raw: unknown) => {
      const parsed = roomStateSchema.safeParse(raw);
      if (!parsed.success) return;
      setRoom(parsed.data);
      if (parsed.data.state === 'LOBBY') setScreen('lobby');
    };
    const onCountdown = (raw: unknown) => {
      const parsed = raceCountdownSchema.safeParse(raw);
      if (!parsed.success) return;
      // A new race starts: drop the previous race's progress so its old text isn't shown.
      setProgress(undefined);
      setCountdown(parsed.data);
      setScreen('race');
    };
    const onProgress = (raw: unknown) => {
      const parsed = raceProgressSchema.safeParse(raw);
      if (!parsed.success) return;
      setProgress(parsed.data);
      setScreen('race');
    };
    const onResults = (raw: unknown) => {
      const parsed = raceResultsSchema.safeParse(raw);
      if (!parsed.success) return;
      setResults(parsed.data);
      setScreen('results');
    };
    const onConnect = () => { if (routeCode) join(routeCode); };
    socket.on('connect', onConnect);
    socket.on(SERVER_EVENTS.ROOM_STATE, onRoom);
    socket.on(SERVER_EVENTS.RACE_COUNTDOWN, onCountdown);
    socket.on(SERVER_EVENTS.RACE_PROGRESS, onProgress);
    socket.on(SERVER_EVENTS.RACE_RESULTS, onResults);
    if (routeCode && socket.connected) join(routeCode);
    return () => {
      socket.off(SERVER_EVENTS.ROOM_STATE, onRoom);
      socket.off('connect', onConnect);
      socket.off(SERVER_EVENTS.RACE_COUNTDOWN, onCountdown);
      socket.off(SERVER_EVENTS.RACE_PROGRESS, onProgress);
      socket.off(SERVER_EVENTS.RACE_RESULTS, onResults);
    };
  }, [routeCode]);

  const join = (code?: string) => {
    const username = session.getUsername() || 'Guest';
    socket.emit(CLIENT_EVENTS.JOIN_ROOM, { code, username, token: session.getToken() ?? undefined }, (response: { playerId?: string; token?: string; room?: RoomStateMessage }) => {
      if (response.playerId) setPlayerId(response.playerId);
      if (response.token) session.setToken(response.token);
      if (response.room) {
        setRoom(response.room);
        setScreen('lobby');
      }
    });
  };

  if (screen === 'home') return <Home onCreate={(bot) => {
    const username = session.getUsername() || 'Guest';
    socket.emit(CLIENT_EVENTS.CREATE_ROOM, { username, token: session.getToken() ?? undefined, ...(bot ? { bot: { targetWpm: bot } } : {}) }, (response: { playerId?: string; token?: string; room?: RoomStateMessage }) => {
      if (response.playerId) setPlayerId(response.playerId);
      if (response.token) session.setToken(response.token);
      if (response.room) {
        setRoom(response.room);
        setScreen('lobby');
        if (bot) socket.emit(CLIENT_EVENTS.START_RACE, {});
      }
    });
  }} onJoin={(code, username) => {
    session.setUsername(username);
    join(code);
  }} />;
  if (screen === 'lobby' && room) return <Lobby room={room} playerId={playerId} onStart={() => socket.emit(CLIENT_EVENTS.START_RACE, {})} onLeave={() => { socket.emit(CLIENT_EVENTS.LEAVE_ROOM); setScreen('home'); }} />;
  if (screen === 'race' && (progress || countdown)) return <Race key={countdown?.text ?? progress?.text} playerId={playerId} countdown={countdown} progress={progress} />;
  if (screen === 'results' && results) return <Results results={results} onAgain={() => { setResults(undefined); socket.emit(CLIENT_EVENTS.RACE_AGAIN, {}); }} onLeave={() => { socket.emit(CLIENT_EVENTS.LEAVE_ROOM); setScreen('home'); }} />;
  return <Home onCreate={() => undefined} onJoin={() => undefined} />;
}

function Home({ onCreate, onJoin }: { onCreate: (bot?: 40 | 60 | 90 | 120) => void; onJoin: (code: string, username: string) => void }) {
  const [username, setUsername] = useState(session.getUsername());
  const [code, setCode] = useState('');
  const [speed, setSpeed] = useState<40 | 60 | 90 | 120>(60);
  const save = () => { const name = username.trim() || 'Guest'; session.setUsername(name); return name; };
  return <main className="shell home"><h1>Typeroom</h1><p className="muted">A focused typing race for friends and rivals.</p>
    <label>Username<input value={username} maxLength={24} onChange={(event) => setUsername(event.target.value)} /></label>
    <div className="actions"><button onClick={() => { save(); onCreate(speed); }}>Race a bot</button><select value={speed} onChange={(event) => setSpeed(Number(event.target.value) as typeof speed)}><option value={40}>40 WPM</option><option value={60}>60 WPM</option><option value={90}>90 WPM</option><option value={120}>120 WPM</option></select></div>
    <button className="secondary" onClick={() => { save(); onCreate(); }}>Create room</button>
    <div className="join"><input placeholder="ROOM CODE" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} /><button className="secondary" onClick={() => onJoin(code, save())}>Join by code</button></div>
  </main>;
}

function Lobby({ room, playerId, onStart, onLeave }: { room: RoomStateMessage; playerId: string; onStart: () => void; onLeave: () => void }) {
  const link = `${window.location.origin}/r/${room.code}`;
  return <main className="shell"><div className="topline"><span>ROOM</span><strong>{room.code}</strong><button className="small" onClick={() => void navigator.clipboard.writeText(link)}>Copy link</button></div><h2>Waiting for racers</h2><ul className="players">{room.players.map((player) => <li key={player.playerId}>{player.username}{player.playerId === room.players[0]?.playerId ? ' (host)' : ''}{player.playerId === playerId ? ' (you)' : ''}{player.isBot ? ' 🤖' : ''}</li>)}</ul>{room.players[0]?.playerId === playerId && <button onClick={onStart}>Start race</button>}<button className="link" onClick={onLeave}>Leave</button></main>;
}

function Race({ playerId, countdown, progress }: { playerId: string; countdown: { startsInMs: number; text: string } | undefined; progress: RaceProgressPayload | undefined }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const charRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const lastTypedAt = useRef(0);
  const [localIndex, setLocalIndex] = useState(0);
  // Number of wrong presses at the current index; each press re-triggers the red blink.
  const [errorPulse, setErrorPulse] = useState(0);
  const [seconds, setSeconds] = useState(Math.ceil((countdown?.startsInMs ?? 0) / 1000));
  const [layoutTick, setLayoutTick] = useState(0);
  const [caretSpots, setCaretSpots] = useState<Record<string, CaretSpot>>({});
  const text = progress?.text ?? countdown?.text ?? '';
  const me = progress?.players.find((player) => player.playerId === playerId);
  const others = progress?.players.filter((player) => player.playerId !== playerId) ?? [];
  // Progress only arrives once the race is live, so typing is blocked during the countdown.
  const live = Boolean(progress) && localIndex < text.length;

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { if (!countdown) return; setSeconds(Math.ceil(countdown.startsInMs / 1000)); const timer = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000); return () => window.clearInterval(timer); }, [countdown]);
  // Own position is tracked locally so the caret never lags behind the keyboard.
  // Only adopt the server position when it is ahead (e.g. after reconnect) or the player has paused.
  useEffect(() => {
    if (!me) return;
    setLocalIndex((current) => (me.position > current || Date.now() - lastTypedAt.current > 750 ? me.position : current));
  }, [me?.position]);
  useEffect(() => {
    const onResize = () => setLayoutTick((value) => value + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const otherKey = others.map((player) => `${player.playerId}:${player.position}`).join('|');
  useLayoutEffect(() => {
    const spotAt = (index: number): CaretSpot | undefined => {
      const span = charRefs.current[Math.min(index, text.length - 1)];
      if (!span) return undefined;
      const atEnd = index >= text.length;
      return { x: span.offsetLeft + (atEnd ? span.offsetWidth : 0), y: span.offsetTop, h: span.offsetHeight };
    };
    const next: Record<string, CaretSpot> = {};
    const mine = spotAt(localIndex);
    if (mine) next[playerId || 'me'] = mine;
    for (const player of others) {
      const spot = spotAt(player.position);
      if (spot) next[player.playerId] = spot;
    }
    setCaretSpots(next);
  }, [text, localIndex, otherKey, layoutTick, playerId]);

  const submit = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    event.target.value = '';
    if (!value || !live) return;
    const char = value[value.length - 1] ?? '';
    const index = localIndex;
    lastTypedAt.current = Date.now();
    socket.emit(CLIENT_EVENTS.KEYSTROKE, { char, index });
    if (char === text[index]) {
      setErrorPulse(0);
      setLocalIndex(index + 1);
    } else {
      setErrorPulse((count) => count + 1);
    }
  };

  const myColor = '#f7c948';
  const mySpot = caretSpots[playerId || 'me'];
  return <main className="shell race" onClick={() => inputRef.current?.focus()}>
    <div className="race-header"><span>{me?.wpm.toFixed(1) ?? '0.0'} WPM</span><span>{me?.accuracy ?? 100}% accuracy</span></div>
    {countdown && seconds > 0 && <div className="countdown">{seconds}</div>}
    <div className="track" ref={trackRef}>
      {text.split('').map((char, index) => {
        const isWrong = index === localIndex && errorPulse > 0;
        return <span
          key={isWrong ? `${index}-err-${errorPulse}` : `${index}`}
          ref={(node) => { charRefs.current[index] = node; }}
          className={index < localIndex ? 'correct' : isWrong ? 'incorrect' : index === localIndex ? 'current' : ''}
        >{char}</span>;
      })}
      {others.map((player, order) => {
        const spot = caretSpots[player.playerId];
        if (!spot) return null;
        const color = OPPONENT_COLORS[order % OPPONENT_COLORS.length];
        return <div key={player.playerId} className={`caret opponent ${player.status === 'disconnected' ? 'offline' : ''}`} style={{ transform: `translate(${spot.x}px, ${spot.y}px)`, height: spot.h, '--caret-color': color } as React.CSSProperties}>
          <span className="caret-name">{player.username}</span>
        </div>;
      })}
      {mySpot && <div className="caret mine" style={{ transform: `translate(${mySpot.x}px, ${mySpot.y}px)`, height: mySpot.h, '--caret-color': myColor } as React.CSSProperties} />}
    </div>
    <input ref={inputRef} className="capture" autoFocus onChange={submit} />
  </main>;
}

interface CaretSpot { x: number; y: number; h: number }
const OPPONENT_COLORS = ['#72b7ff', '#ff7ab6', '#7ee787', '#c39bff'];

function Results({ results, onAgain, onLeave }: { results: RaceResultsPayload; onAgain: () => void; onLeave: () => void }) {
  return <main className="shell"><h2>Results</h2><table><thead><tr><th>#</th><th>Name</th><th>WPM</th><th>Accuracy</th></tr></thead><tbody>{results.results.map((result) => <tr key={result.playerId}><td>{result.rank}</td><td>{result.username}</td><td>{result.wpm.toFixed(1)}</td><td>{result.accuracy}%</td></tr>)}</tbody></table><button onClick={onAgain}>Race again</button><button className="link" onClick={onLeave}>Leave</button></main>;
}
