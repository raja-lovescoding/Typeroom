import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { CLIENT_EVENTS, type RacePlayer, type RaceProgressPayload } from '@typeroom/shared';
import { socket } from '../../lib/socket.js';
import { useSettings, type CaretStyle } from '../../settings/settings.js';
import { caretColor, colorFor } from './colors.js';
import { classifyKey, type TypingLog } from './typingStats.js';

export const FOCUS_TYPING_EVENT = 'typeroom:focus-typing';
const MAX_SHOWN_EXTRA = 12;

interface Props {
  playerId: string;
  countdown: { startsInMs: number; text: string } | undefined;
  progress: RaceProgressPayload | undefined;
  /** Mutable log owned by the app so the results screen can read it. */
  log: TypingLog;
  onTyping: () => void;
}

interface Spot { x: number; y: number; w: number; h: number }
interface Segment { kind: 'word' | 'space'; start: number; end: number }

export function Race({ playerId, countdown, progress, log, onTyping }: Props) {
  const settings = useSettings();
  const inputRef = useRef<HTMLInputElement>(null);
  const charRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const extraRef = useRef<HTMLSpanElement | null>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const lastTypedAt = useRef(0);
  const [localIndex, setLocalIndex] = useState(0);
  /** Wrong keys typed at the current index since the last accepted character (display only). */
  const [missed, setMissed] = useState('');
  const [errorIndices, setErrorIndices] = useState<ReadonlySet<number>>(() => new Set());
  const [seconds, setSeconds] = useState(Math.ceil((countdown?.startsInMs ?? 0) / 1000));
  const [layoutTick, setLayoutTick] = useState(0);
  const [spots, setSpots] = useState<Record<string, Spot>>({});
  const [scroll, setScroll] = useState(0);
  const [capsLock, setCapsLock] = useState(false);
  const [focused, setFocused] = useState(true);
  const [idle, setIdle] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const text = progress?.text ?? countdown?.text ?? '';
  const players = progress?.players ?? [];
  const me = players.find((player) => player.playerId === playerId);
  const others = players.filter((player) => player.playerId !== playerId);
  const finished = localIndex >= text.length && text.length > 0;
  // Progress only arrives once the race is live, so typing is blocked during the countdown.
  const live = Boolean(progress) && !finished && me?.status !== 'dnf';
  const extraActive = missed.length > 0 && text[localIndex] === ' ';
  const segments = useMemo(() => segment(text), [text]);
  const currentWord = useMemo(() => {
    const at = text[localIndex] === ' ' ? localIndex - 1 : localIndex;
    return segments.find((item) => item.kind === 'word' && at >= item.start && at < item.end);
  }, [segments, localIndex, text]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    window.addEventListener(FOCUS_TYPING_EVENT, focus);
    return () => window.removeEventListener(FOCUS_TYPING_EVENT, focus);
  }, []);
  useEffect(() => {
    if (!countdown) return;
    setSeconds(Math.ceil(countdown.startsInMs / 1000));
    const timer = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [countdown]);
  // Joined mid-race (e.g. reconnect) without a countdown: start the local clock at the first tick.
  useEffect(() => { if (progress && log.startedAt === null) log.startedAt = Date.now(); }, [progress, log]);
  useEffect(() => {
    if (!progress || finished) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [Boolean(progress), finished]);
  // Own position is tracked locally so the caret never lags behind the keyboard.
  // Only adopt the server position when it is ahead (e.g. after reconnect) or the player has paused.
  useEffect(() => {
    if (!me) return;
    setLocalIndex((current) => (me.position > current || Date.now() - lastTypedAt.current > 750 ? me.position : current));
  }, [me?.position]);
  useEffect(() => {
    const onResize = () => setLayoutTick((value) => value + 1);
    window.addEventListener('resize', onResize);
    void document.fonts?.ready.then(onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => {
    setIdle(false);
    const timer = window.setTimeout(() => setIdle(true), 900);
    return () => window.clearTimeout(timer);
  }, [localIndex, missed]);

  const otherKey = others.map((player) => `${player.playerId}:${player.position}`).join('|');
  useLayoutEffect(() => {
    const spotAt = (index: number): Spot | undefined => {
      const span = charRefs.current[Math.min(index, text.length - 1)];
      if (!span) return undefined;
      const atEnd = index >= text.length;
      return { x: span.offsetLeft + (atEnd ? span.offsetWidth : 0), y: span.offsetTop, w: span.offsetWidth, h: span.offsetHeight };
    };
    const next: Record<string, Spot> = {};
    const extra = extraActive ? extraRef.current : null;
    const mine = extra
      ? { x: extra.offsetLeft + extra.offsetWidth, y: extra.offsetTop, w: extra.offsetWidth, h: extra.offsetHeight }
      : spotAt(localIndex);
    if (mine) next.self = mine;
    for (const player of others) {
      const spot = spotAt(player.position);
      if (spot) next[player.playerId] = spot;
    }
    setSpots(next);
    // Keep the caret on the first or second visible line; older lines scroll up out of view.
    // Inline spans are shorter than the line box, so use the computed line height, not span height.
    const lineHeight = innerRef.current ? parseFloat(getComputedStyle(innerRef.current).lineHeight) : 0;
    if (mine && lineHeight > 0) setScroll(Math.max(0, Math.floor((mine.y + mine.h / 2) / lineHeight) - 1) * lineHeight);
  }, [text, localIndex, extraActive, missed, otherKey, layoutTick, settings.fontSize, settings.typingFont]);

  const typeChar = (char: string) => {
    const index = localIndex;
    const kind = classifyKey(text, index, char);
    const t = Date.now() - (log.startedAt ?? Date.now());
    lastTypedAt.current = Date.now();
    socket.emit(CLIENT_EVENTS.KEYSTROKE, { char, index });
    log.keys.push({ t, kind, index });
    onTyping();
    if (kind === 'correct') {
      setMissed('');
      setLocalIndex(index + 1);
      if (index + 1 === text.length) log.finishedAt = t;
    } else {
      setMissed((value) => value + char);
      setErrorIndices((current) => new Set(current).add(index));
    }
  };

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    event.target.value = '';
    if (!value || !live) return;
    typeChar(value[value.length - 1] ?? '');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    setCapsLock(event.getModifierState('CapsLock'));
    // Backspace only clears the local display of wrong keys; the server never moves backwards.
    if (event.key === 'Backspace') {
      event.preventDefault();
      setMissed((value) => (event.ctrlKey || event.altKey ? '' : value.slice(0, -1)));
    }
  };

  const elapsed = log.startedAt === null ? 0 : Math.max(0, (finished && log.finishedAt !== null ? log.startedAt + log.finishedAt : now) - log.startedAt);
  const totalWords = segments.filter((item) => item.kind === 'word').length;
  const doneWords = segments.filter((item) => item.kind === 'word' && item.end <= localIndex && (text[item.end] === ' ' ? localIndex > item.end : true)).length;
  const mySpot = spots.self;
  const showErrors = settings.highlightErrors;

  return <section className="race" onClick={() => inputRef.current?.focus()}>
    <div className="stats-bar" aria-live="off">
      <Stat label="wpm" value={Math.round(me?.wpm ?? 0)} accent />
      <Stat label="acc" value={`${me?.accuracy ?? 100}%`} />
      <Stat label="time" value={formatClock(elapsed)} />
      <Stat label="words" value={`${doneWords}/${totalWords}`} />
    </div>

    <div className="race-notices">
      {capsLock && <span className="notice warn" role="status">Caps Lock is on</span>}
      {me?.status === 'dnf' && <span className="notice">You did not finish this race</span>}
      {finished && <span className="notice">Finished. Waiting for the others…</span>}
    </div>

    {countdown && seconds > 0 && !progress && <div className="countdown" aria-live="assertive">{seconds}</div>}

    <div
      className={`track ${settings.smoothCaret ? 'smooth' : ''} ${focused ? '' : 'blurred'}`}
      style={{ '--scroll': `${-scroll}px` } as React.CSSProperties}
    >
      <div className="track-inner" ref={innerRef}>
        {segments.map((item) => {
          if (item.kind === 'space') return renderChar(item.start);
          const isCurrent = item === currentWord && live;
          return <span key={`w${item.start}`} className={`word ${isCurrent ? 'current-word' : ''}`}>
            {range(item.start, item.end).map(renderChar)}
            {extraActive && item.end === localIndex && [...missed.slice(-MAX_SHOWN_EXTRA)].map((char, order, all) => (
              <span key={`x${order}`} className="char extra" ref={order === all.length - 1 ? extraRef : undefined}>{char}</span>
            ))}
          </span>;
        })}
        {others.map((player) => {
          const spot = spots[player.playerId];
          if (!spot) return null;
          return <Caret key={player.playerId} spot={spot} style="line" color={colorFor(players, player.playerId, playerId)} ghost
            offline={player.status === 'disconnected'} label={settings.ghostLabels ? player.username : undefined} />;
        })}
        {mySpot && <Caret spot={mySpot} style={settings.caretStyle} color="var(--accent)" idle={idle} />}
      </div>
      {!focused && <div className="focus-hint">Click here to keep typing</div>}
    </div>

    <input
      ref={inputRef}
      className="capture"
      aria-label="Type the text"
      autoFocus
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      onChange={onChange}
      onKeyDown={onKeyDown}
      onKeyUp={(event) => setCapsLock(event.getModifierState('CapsLock'))}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />

    <Standings players={players} playerId={playerId} textLength={text.length} />
  </section>;

  function renderChar(index: number) {
    const char = text[index] ?? '';
    let className = 'char';
    if (index < localIndex) className += showErrors && errorIndices.has(index) ? ' typed corrected' : ' typed';
    else if (index === localIndex && missed && !extraActive) className += ' wrong';
    if (char === ' ') className += ' space';
    // A new key per wrong press restarts the blink animation.
    const key = className.includes('wrong') ? `${index}-e${missed.length}` : `${index}`;
    return <span key={key} className={className} ref={(node) => { charRefs.current[index] = node; }}>{char}</span>;
  }
}

function Caret({ spot, style, color, ghost, offline, label, idle }: {
  spot: Spot; style: CaretStyle; color: string; ghost?: boolean; offline?: boolean; label?: string | undefined; idle?: boolean;
}) {
  const y = style === 'underline' ? spot.y + spot.h - 3 : spot.y;
  const width = style === 'line' ? undefined : spot.w;
  const height = style === 'underline' ? undefined : spot.h;
  return <div
    className={`caret caret-${style} ${ghost ? 'ghost' : 'mine'} ${offline ? 'offline' : ''} ${idle ? 'idle' : ''}`}
    style={{ ...caretColor(color), transform: `translate(${spot.x}px, ${y}px)`, width, height }}
    aria-hidden
  >
    {label && <span className="caret-name">{label}{offline ? ' · offline' : ''}</span>}
  </div>;
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return <div className={`stat ${accent ? 'accent' : ''}`}><span className="stat-value">{value}</span><span className="stat-label">{label}</span></div>;
}

function Standings({ players, playerId, textLength }: { players: RacePlayer[]; playerId: string; textLength: number }) {
  if (players.length === 0) return null;
  const ranked = [...players].sort((a, b) => b.position - a.position);
  return <ol className="standings" aria-label="Live positions">
    {ranked.map((player) => {
      const percent = textLength === 0 ? 0 : Math.round((player.position / textLength) * 100);
      return <li key={player.playerId} className={`standing status-${player.status}`} style={caretColor(colorFor(players, player.playerId, playerId))}>
        <span className="standing-name">{player.username}{player.playerId === playerId ? ' (you)' : ''}{player.isBot ? ' · bot' : ''}</span>
        <span className="standing-bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${percent}%` }} /></span>
        <span className="standing-wpm">{Math.round(player.wpm)} wpm</span>
        <span className="standing-status">{statusLabel(player.status)}</span>
      </li>;
    })}
  </ol>;
}

function statusLabel(status: RacePlayer['status']): string {
  return { racing: '', finished: 'done', disconnected: 'offline', dnf: 'dnf' }[status];
}

function segment(text: string): Segment[] {
  const result: Segment[] = [];
  let start = 0;
  for (let index = 0; index <= text.length; index += 1) {
    if (index === text.length || text[index] === ' ') {
      if (index > start) result.push({ kind: 'word', start, end: index });
      if (index < text.length) result.push({ kind: 'space', start: index, end: index + 1 });
      start = index + 1;
    }
  }
  return result;
}

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start }, (_, offset) => start + offset);
}

export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
