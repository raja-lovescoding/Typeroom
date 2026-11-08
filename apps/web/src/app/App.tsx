import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CLIENT_EVENTS,
  errorSchema,
  raceCountdownSchema,
  raceProgressSchema,
  raceResultsSchema,
  roomStateSchema,
  SERVER_EVENTS,
  type RaceProgressPayload,
  type RaceResultsPayload,
  type RoomStateMessage,
} from '@typeroom/shared';
import { CommandPalette, type Command } from '../components/CommandPalette.js';
import { Footer, Header, Toast } from '../components/Chrome.js';
import { SettingsPanel } from '../components/SettingsPanel.js';
import { Home, Lobby, type BotSpeed } from '../features/lobby/Lobby.js';
import { FOCUS_TYPING_EVENT, Race } from '../features/race/Race.js';
import { createTypingLog, type TypingLog } from '../features/race/typingStats.js';
import { Results } from '../features/results/Results.js';
import { session } from '../lib/session.js';
import { socket } from '../lib/socket.js';
import {
  CARET_STYLES, FONT_SIZE, TYPING_FONTS, getSettings, previewTheme, updateSettings, useSettings, type Settings,
} from '../settings/settings.js';
import { THEMES } from '../settings/themes.js';
import '../styles/fonts.js';
import '../styles/themes.css';
import '../styles/global.css';

type Screen = 'home' | 'lobby' | 'race' | 'results';
type JoinResponse = { playerId?: string; token?: string; room?: RoomStateMessage; error?: string };

const QUICK_ACTION_WINDOW_MS = 1_500;

export function App() {
  const settings = useSettings();
  const [screen, setScreen] = useState<Screen>('home');
  const [room, setRoom] = useState<RoomStateMessage>();
  const [progress, setProgress] = useState<RaceProgressPayload>();
  const [results, setResults] = useState<RaceResultsPayload>();
  const [countdown, setCountdown] = useState<{ startsInMs: number; text: string }>();
  const [playerId, setPlayerId] = useState('');
  const [raceSeq, setRaceSeq] = useState(0);
  const [raceDurationMs, setRaceDurationMs] = useState(0);
  const [palette, setPalette] = useState<{ menu?: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [toast, setToast] = useState<string>();
  const logRef = useRef<TypingLog>(createTypingLog());
  const autoStartRef = useRef(false);
  const tabArmedAt = useRef(0);
  const routeCode = useMemo(() => window.location.pathname.match(/^\/r\/([A-Z2-9]{6})$/)?.[1], []);

  const isHost = Boolean(room && playerId && room.players[0]?.playerId === playerId);
  const onlyBots = Boolean(room && room.players.every((player) => player.playerId === playerId || player.isBot));

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => (current === message ? undefined : current)), 2_400);
  }, []);

  const enterRoom = useCallback((response: JoinResponse) => {
    if (response.error) return notify(response.error);
    if (response.playerId) setPlayerId(response.playerId);
    if (response.token) session.setToken(response.token);
    if (response.room) {
      setRoom(response.room);
      window.history.replaceState(null, '', `/r/${response.room.code}`);
      if (response.room.state === 'LOBBY') setScreen('lobby');
    }
  }, [notify]);

  const join = useCallback((code?: string) => {
    const username = session.getUsername() || 'Guest';
    socket.emit(CLIENT_EVENTS.JOIN_ROOM, { code, username, token: session.getToken() ?? undefined }, enterRoom);
  }, [enterRoom]);

  useEffect(() => {
    const onRoom = (raw: unknown) => {
      const parsed = roomStateSchema.safeParse(raw);
      if (!parsed.success) return;
      setRoom(parsed.data);
      if (parsed.data.state === 'LOBBY') {
        setScreen('lobby');
        // Quick restart against bots: race-again goes straight into the next countdown.
        if (autoStartRef.current) {
          autoStartRef.current = false;
          socket.emit(CLIENT_EVENTS.START_RACE, {});
        }
      }
    };
    const onCountdown = (raw: unknown) => {
      const parsed = raceCountdownSchema.safeParse(raw);
      if (!parsed.success) return;
      // A new race starts: drop the previous race's progress so its old text isn't shown.
      logRef.current = createTypingLog(Date.now() + parsed.data.startsInMs);
      setProgress(undefined);
      setResults(undefined);
      setCountdown(parsed.data);
      setRaceSeq((value) => value + 1);
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
      const startedAt = logRef.current.startedAt;
      setRaceDurationMs(startedAt === null ? 0 : Date.now() - startedAt);
      setResults(parsed.data);
      setTyping(false);
      setScreen('results');
    };
    const onError = (raw: unknown) => {
      const parsed = errorSchema.safeParse(raw);
      if (parsed.success) notify(parsed.data.error);
    };
    const onConnect = () => { if (routeCode) join(routeCode); };
    socket.on('connect', onConnect);
    socket.on(SERVER_EVENTS.ROOM_STATE, onRoom);
    socket.on(SERVER_EVENTS.RACE_COUNTDOWN, onCountdown);
    socket.on(SERVER_EVENTS.RACE_PROGRESS, onProgress);
    socket.on(SERVER_EVENTS.RACE_RESULTS, onResults);
    socket.on(SERVER_EVENTS.ERROR, onError);
    if (routeCode && socket.connected) join(routeCode);
    return () => {
      socket.off('connect', onConnect);
      socket.off(SERVER_EVENTS.ROOM_STATE, onRoom);
      socket.off(SERVER_EVENTS.RACE_COUNTDOWN, onCountdown);
      socket.off(SERVER_EVENTS.RACE_PROGRESS, onProgress);
      socket.off(SERVER_EVENTS.RACE_RESULTS, onResults);
      socket.off(SERVER_EVENTS.ERROR, onError);
    };
  }, [routeCode, join, notify]);

  // ---- actions --------------------------------------------------------------------------------

  const create = (bot?: BotSpeed) => {
    const username = session.getUsername() || 'Guest';
    socket.emit(CLIENT_EVENTS.CREATE_ROOM, { username, token: session.getToken() ?? undefined, ...(bot ? { bot: { targetWpm: bot } } : {}) }, (response: JoinResponse) => {
      enterRoom(response);
      if (response.room && bot) socket.emit(CLIENT_EVENTS.START_RACE, {});
    });
  };
  const startRace = () => socket.emit(CLIENT_EVENTS.START_RACE, {});
  const raceAgain = () => {
    autoStartRef.current = isHost && onlyBots;
    setResults(undefined);
    socket.emit(CLIENT_EVENTS.RACE_AGAIN, {});
  };
  const leave = () => {
    socket.emit(CLIENT_EVENTS.LEAVE_ROOM);
    setRoom(undefined);
    setProgress(undefined);
    setResults(undefined);
    setCountdown(undefined);
    setScreen('home');
    window.history.replaceState(null, '', '/');
  };
  const copyLink = () => {
    if (!room) return;
    const link = `${window.location.origin}/r/${room.code}`;
    navigator.clipboard.writeText(link).then(() => notify('Invite link copied'), () => notify(link));
  };

  const quickAction = screen === 'results' ? { label: 'race again', run: raceAgain }
    : screen === 'lobby' && isHost ? { label: 'start race', run: startRace }
    : undefined;

  const closeOverlays = () => {
    setPalette(null);
    setSettingsOpen(false);
    previewTheme(null);
    window.setTimeout(() => window.dispatchEvent(new Event(FOCUS_TYPING_EVENT)), 0);
  };

  // ---- keyboard-first flow --------------------------------------------------------------------

  const overlayOpen = palette !== null || settingsOpen;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (overlayOpen) closeOverlays();
        else setPalette({});
        return;
      }
      if (overlayOpen) return;
      if (event.key === 'Tab') {
        // In a race Tab must never move focus off the text; elsewhere it arms the quick action.
        if (screen === 'race' || quickAction) event.preventDefault();
        if (quickAction) tabArmedAt.current = Date.now();
        return;
      }
      if (event.key === 'Enter' && quickAction && Date.now() - tabArmedAt.current < QUICK_ACTION_WINDOW_MS) {
        event.preventDefault();
        tabArmedAt.current = 0;
        quickAction.run();
        return;
      }
      if (event.key !== 'Shift') tabArmedAt.current = 0;
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // Focus mode: fade the chrome while typing, bring it back on mouse movement.
  useEffect(() => {
    if (!typing) return;
    const wake = () => setTyping(false);
    window.addEventListener('mousemove', wake);
    return () => window.removeEventListener('mousemove', wake);
  }, [typing]);
  const focusing = settings.focusMode && screen === 'race' && typing && !overlayOpen;

  // ---- command palette ------------------------------------------------------------------------

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];
    if (screen === 'lobby' && isHost) list.push({ id: 'start', label: 'Start race', hint: 'tab + enter', run: startRace });
    if (screen === 'results') list.push({ id: 'again', label: 'Race again', hint: 'tab + enter', run: raceAgain });
    if (room) {
      list.push({ id: 'copy-link', label: 'Copy room link', keywords: 'invite share url', run: copyLink });
      list.push({ id: 'leave', label: 'Leave room', keywords: 'exit quit home', run: leave });
    }
    const current = getSettings();
    const toggle = (key: keyof Settings & ('smoothCaret' | 'ghostLabels' | 'highlightErrors' | 'focusMode'), label: string): Command => ({
      id: `toggle-${key}`, label, group: 'toggle', hint: current[key] ? 'on' : 'off', run: () => updateSettings({ [key]: !current[key] }),
    });
    list.push(
      {
        id: 'theme', label: 'Change theme…', keywords: 'colour color appearance dark light',
        hint: THEMES.find((theme) => theme.id === current.theme)?.label,
        children: () => THEMES.map((theme) => ({
          id: `theme-${theme.id}`, label: theme.label, keywords: theme.tags.join(' '), hint: theme.tags.join(' · '),
          active: theme.id === getSettings().theme,
          onHighlight: () => previewTheme(theme.id),
          run: () => updateSettings({ theme: theme.id }),
        })),
      },
      {
        id: 'font', label: 'Change typing font…', keywords: 'typeface monospace',
        hint: TYPING_FONTS.find((font) => font.id === current.typingFont)?.label,
        children: () => TYPING_FONTS.map((font) => ({
          id: `font-${font.id}`, label: font.label, active: font.id === getSettings().typingFont, run: () => updateSettings({ typingFont: font.id }),
        })),
      },
      {
        id: 'font-size', label: 'Change font size…', keywords: 'bigger smaller zoom', hint: `${current.fontSize}rem`,
        children: () => {
          const sizes: number[] = [];
          for (let size = FONT_SIZE.min; size <= FONT_SIZE.max; size += FONT_SIZE.step) sizes.push(size);
          return sizes.map((size) => ({ id: `size-${size}`, label: `${size.toFixed(2)}rem`, active: size === getSettings().fontSize, run: () => updateSettings({ fontSize: size }) }));
        },
      },
      {
        id: 'caret', label: 'Change caret style…', keywords: 'cursor', hint: current.caretStyle,
        children: () => CARET_STYLES.map((style) => ({ id: `caret-${style}`, label: style, active: style === getSettings().caretStyle, run: () => updateSettings({ caretStyle: style }) })),
      },
      toggle('smoothCaret', 'Smooth caret'),
      toggle('ghostLabels', 'Racer name labels'),
      toggle('highlightErrors', 'Highlight errors'),
      toggle('focusMode', 'Focus mode'),
      { id: 'settings', label: 'Open settings', keywords: 'preferences options', run: () => setSettingsOpen(true) },
    );
    return list;
    // `settings` is a dependency so hints reflect the latest values.
  }, [screen, isHost, room, settings, onlyBots]);

  // ---- render ---------------------------------------------------------------------------------

  const me = progress?.players.find((player) => player.playerId === playerId);
  let content;
  if (screen === 'lobby' && room) {
    content = <Lobby room={room} playerId={playerId} isHost={isHost} onStart={startRace} onCopyLink={copyLink} />;
  } else if (screen === 'race' && (progress || countdown)) {
    content = <Race key={raceSeq} playerId={playerId} countdown={countdown} progress={progress} log={logRef.current} onTyping={() => setTyping(true)} />;
  } else if (screen === 'results' && results) {
    content = <Results
      results={results}
      playerId={playerId}
      log={logRef.current}
      textLength={progress?.text.length ?? countdown?.text.length ?? 0}
      finalPosition={me?.position ?? 0}
      raceDurationMs={raceDurationMs}
      roster={room?.players ?? results.results}
      onAgain={raceAgain}
      onLeave={leave}
    />;
  } else {
    content = <Home onCreate={create} onJoin={join} initialCode={routeCode} />;
  }

  return <div className={`app ${focusing ? 'focus-typing' : ''}`}>
    <Header roomCode={room?.code} onHome={() => { if (!room) setScreen('home'); }} onPalette={() => setPalette({})} onSettings={() => setSettingsOpen(true)} />
    <main className="stage">{content}</main>
    <Footer quickAction={quickAction?.label} onTheme={() => setPalette({ menu: 'theme' })} />
    {palette && <CommandPalette commands={commands} initialMenu={palette.menu} onClose={closeOverlays} />}
    {settingsOpen && <SettingsPanel onClose={closeOverlays} />}
    <Toast message={toast} />
  </div>;
}
