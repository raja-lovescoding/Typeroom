import { useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { QUOTE_LENGTHS, TIME_MODE_SECONDS, WORD_MODE_COUNTS, type QuickRaceConfig } from '@typeroom/shared';
import { CommandPalette, type Command } from '../components/CommandPalette.js';
import { Footer, Header, Toast } from '../components/Chrome.js';
import { ErrorBoundary } from '../components/ErrorBoundary.js';
import { SettingsPanel } from '../components/SettingsPanel.js';
import { useGame, type Game } from '../features/game/useGame.js';
import { Home, Lobby } from '../features/lobby/Lobby.js';
import { Queue } from '../features/queue/Queue.js';
import { FOCUS_TYPING_EVENT, Race } from '../features/race/Race.js';
import { Results } from '../features/results/Results.js';
import { describeRaceConfig, loadQuickRaceConfig, saveRaceConfig } from '../lib/raceConfig.js';
import { navigate, roomCodeFromPath, usePageTitle, usePathname } from '../lib/router.js';
import { session } from '../lib/session.js';
import { About } from '../pages/About.js';
import { Contact } from '../pages/Contact.js';
import { Privacy } from '../pages/Privacy.js';
import { SettingsPage } from '../pages/SettingsPage.js';
import { ErrorPage, NotFound } from '../pages/Status.js';
import { Terms } from '../pages/Terms.js';
import {
  CARET_STYLES, FONT_SIZE, TYPING_FONTS, getSettings, previewTheme, updateSettings, useSettings, type Settings,
} from '../settings/settings.js';
import { THEMES } from '../settings/themes.js';
import '../styles/fonts.js';
import '../styles/themes.css';
import '../styles/global.css';

const QUICK_ACTION_WINDOW_MS = 1_500;

const PAGES: Record<string, ComponentType> = {
  '/settings': SettingsPage,
  '/about': About,
  '/privacy': Privacy,
  '/terms': Terms,
  '/contact': Contact,
};

export function App() {
  const settings = useSettings();
  const pathname = usePathname();
  const [toast, setToast] = useState<string>();
  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => (current === message ? undefined : current)), 3_000);
  }, []);
  const game = useGame(notify);
  const [palette, setPalette] = useState<{ menu?: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [tabArmedAt, setTabArmedAt] = useState(0);
  const [roomOpen, setRoomOpen] = useState(false);
  const [selectedTime, setSelectedTime] = useState<(typeof TIME_MODE_SECONDS)[number]>(() => {
    const config = loadQuickRaceConfig();
    return config.mode === 'time' ? config.seconds : 30;
  });

  const routeCode = roomCodeFromPath(pathname);
  const inRoomView = Boolean(routeCode && game.room?.code === routeCode && game.screen);
  const screen = inRoomView ? game.screen : null;
  const isPlayRoute = pathname === '/' || Boolean(routeCode);

  useEffect(() => { if (screen !== 'race') setTyping(false); }, [screen]);

  const quickAction = screen === 'results' ? { label: 'exit race', run: game.leave }
    : screen === 'lobby' && game.isHost ? { label: 'start race', run: game.startRace }
    : !screen && !game.queue ? { label: 'quick race', run: () => game.quickRace(loadQuickRaceConfig()) }
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
        if (quickAction) setTabArmedAt(Date.now());
        return;
      }
      if (event.key === 'Enter' && quickAction && Date.now() - tabArmedAt < QUICK_ACTION_WINDOW_MS) {
        event.preventDefault();
        setTabArmedAt(0);
        quickAction.run();
        return;
      }
      if (event.key !== 'Shift' && tabArmedAt) setTabArmedAt(0);
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

  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const commands = useCommands(game, screen, settings, openSettings);

  // ---- render ---------------------------------------------------------------------------------

  let content: ReactNode;
  const Page = PAGES[pathname.replace(/\/+$/, '') || '/'];
  if (Page) content = <Page />;
  else if (isPlayRoute) content = <PlayView game={game} screen={screen} routeCode={routeCode} roomOpen={roomOpen} onTyping={() => setTyping(true)} />;
  else content = <NotFound />;

  return <div className={`app ${focusing ? 'focus-typing' : ''} ${isPlayRoute ? 'is-play' : 'is-page'}`}>
    <a className="skip-link" href="#main">Skip to content</a>
    <Header
      roomCode={game.room?.code}
      onPalette={() => setPalette({})}
      onQuickRace={() => game.quickRace(loadQuickRaceConfig())}
      onRoom={() => setRoomOpen((open) => !open)}
      selectedTime={selectedTime}
      onTimeChange={(seconds) => {
        const config: QuickRaceConfig = { mode: 'time', seconds, punctuation: false };
        saveRaceConfig(config);
        setSelectedTime(seconds);
      }}
    />
    <main id="main" className="stage">
      <ErrorBoundary resetKey={pathname} fallback={(props) => <ErrorPage {...props} />}>{content}</ErrorBoundary>
    </main>
    <Footer quickAction={quickAction?.label} showShortcuts={isPlayRoute} onTheme={() => setPalette({ menu: 'theme' })} />
    {palette && <CommandPalette commands={commands} initialMenu={palette.menu} onClose={closeOverlays} />}
    {settingsOpen && <SettingsPanel onClose={closeOverlays} />}
    <Toast message={toast} />
  </div>;
}

function PlayView({ game, screen, routeCode, roomOpen, onTyping }: {
  game: Game; screen: Game['screen']; routeCode: string | undefined; roomOpen: boolean; onTyping: () => void;
}) {
  const { room, progress, results, countdown, playerId } = game;
  usePageTitle(game.queue ? 'Finding a race' : screen === 'race' ? 'Racing' : screen === 'results' ? 'Results' : screen === 'lobby' && room ? `Room ${room.code}` : undefined);

  // Quick Race lobby, until the race countdown takes over.
  if (game.queue) return <Queue queue={game.queue} playerId={playerId} onCancel={game.cancelQueue} />;

  if (screen === 'lobby' && room) {
    return <Lobby room={room} playerId={playerId} isHost={game.isHost} onStart={game.startRace} onCopyLink={game.copyLink} onConfig={game.setConfig} />;
  }
  if (screen === 'race' && (progress || countdown)) {
    return <Race key={game.raceSeq} playerId={playerId} countdown={countdown} progress={progress} log={game.log} onTyping={onTyping} onExit={game.leave} />;
  }
  if (screen === 'results' && results) {
    const me = progress?.players.find((player) => player.playerId === playerId);
    return <Results
      results={results}
      playerId={playerId}
      log={game.log}
      textLength={progress?.text.length ?? countdown?.text.length ?? 0}
      finalPosition={me?.position ?? 0}
      raceDurationMs={game.raceDurationMs}
      roster={room?.players ?? results.results}
      config={countdown?.config}
      source={countdown?.source}
      onAgain={game.raceAgain}
      onLeave={game.leave}
      quick={room?.kind === 'quick'}
    />;
  }
  // A room link with a saved nickname joins straight away; show a holding state meanwhile.
  if (routeCode && session.getUsername() && game.room?.code !== routeCode) {
    return <p className="muted joining" role="status">Joining room {routeCode}…</p>;
  }
  return <Home
    onCreate={game.create}
    onJoin={game.join}
    onQuickRace={game.quickRace}
    initialCode={routeCode}
    currentRoom={game.room && game.room.code !== routeCode ? game.room.code : undefined}
    roomOpen={roomOpen}
  />;
}

// ---- command palette ----------------------------------------------------------------------------

function useCommands(game: Game, screen: Game['screen'], settings: Settings, openSettings: () => void): Command[] {
  return useMemo<Command[]>(() => {
    const list: Command[] = [];
    if (game.queue && !game.queue.matched) {
      list.push({ id: 'cancel-queue', label: 'Cancel quick race', keywords: 'leave queue matchmaking stop', run: game.cancelQueue });
    } else if (!game.queue && (!game.room || screen === 'results')) {
      list.push({ id: 'quick-race', label: game.room?.kind === 'quick' ? 'Find another race' : 'Quick race', keywords: 'matchmaking play random public', run: () => game.quickRace() });
    }
    if (screen === 'lobby' && game.isHost) {
      list.push({ id: 'start', label: 'Start race', hint: 'tab + enter', run: game.startRace });
      if (game.room) {
        const current = game.room.config;
        list.push({
          id: 'mode', label: 'Change race mode…', keywords: 'time words quote length duration', hint: describeRaceConfig(current),
          children: () => [
            ...TIME_MODE_SECONDS.map((seconds) => ({
              id: `time-${seconds}`, label: `time ${seconds}s`, group: 'time', active: current.mode === 'time' && current.seconds === seconds,
              run: () => game.setConfig({ mode: 'time', seconds, punctuation: 'punctuation' in current ? current.punctuation : false }),
            })),
            ...WORD_MODE_COUNTS.map((count) => ({
              id: `words-${count}`, label: `${count} words`, group: 'words', active: current.mode === 'words' && current.count === count,
              run: () => game.setConfig({ mode: 'words', count, punctuation: 'punctuation' in current ? current.punctuation : false }),
            })),
            ...QUOTE_LENGTHS.map((length) => ({
              id: `quote-${length}`, label: `${length} quote`, group: 'quote', active: current.mode === 'quote' && current.length === length,
              run: () => game.setConfig({ mode: 'quote', length }),
            })),
          ],
        });
      }
    }
    if (screen === 'results' && game.room?.kind !== 'quick') list.push({ id: 'again', label: 'Race again', hint: 'tab + enter', run: game.raceAgain });
    if (game.room) {
      if (game.room.kind !== 'quick') list.push({ id: 'copy-link', label: 'Copy room link', keywords: 'invite share url', run: game.copyLink });
      list.push({ id: 'leave', label: 'Leave room', keywords: 'exit quit home', run: game.leave });
    }
    const current = getSettings();
    const toggle = (key: keyof Settings & ('smoothCaret' | 'ghostLabels' | 'highlightErrors' | 'focusMode' | 'liveStats' | 'sound'), label: string, keywords?: string): Command => ({
      id: `toggle-${key}`, label, group: 'toggle', hint: current[key] ? 'on' : 'off', ...(keywords ? { keywords } : {}), run: () => updateSettings({ [key]: !current[key] }),
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
      toggle('liveStats', 'Live stats', 'wpm accuracy hide show'),
      toggle('sound', 'Typing sounds', 'audio click mute'),
      toggle('ghostLabels', 'Racer name labels'),
      toggle('highlightErrors', 'Highlight errors'),
      toggle('focusMode', 'Focus mode'),
      { id: 'settings', label: 'Open settings', keywords: 'preferences options', run: openSettings },
      { id: 'go-home', label: 'Go to home', group: 'go', keywords: 'play start', run: () => navigate(game.room ? `/r/${game.room.code}` : '/') },
      { id: 'go-settings', label: 'Go to settings page', group: 'go', run: () => navigate('/settings') },
      { id: 'go-about', label: 'Go to about', group: 'go', keywords: 'credits help', run: () => navigate('/about') },
      { id: 'go-privacy', label: 'Go to privacy policy', group: 'go', run: () => navigate('/privacy') },
      { id: 'go-terms', label: 'Go to terms of use', group: 'go', run: () => navigate('/terms') },
      { id: 'go-contact', label: 'Go to contact', group: 'go', keywords: 'email bug report', run: () => navigate('/contact') },
    );
    return list;
    // `settings` is a dependency so hints reflect the latest values.
  }, [screen, game, settings, openSettings]);
}
