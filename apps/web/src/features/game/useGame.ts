import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CLIENT_EVENTS,
  errorSchema,
  queueClosedSchema,
  queueMatchedSchema,
  queueUpdateSchema,
  raceCountdownSchema,
  raceProgressSchema,
  raceResultsSchema,
  roomClosedSchema,
  roomStateSchema,
  SERVER_EVENTS,
  type BotSpeed,
  type QueueClosedReason,
  type QueueUpdate,
  type QuickRaceConfig,
  type RaceConfig,
  type RaceCountdown,
  type RaceProgressPayload,
  type RaceResultsPayload,
  type RoomClosedReason,
  type RoomStateMessage,
} from '@typeroom/shared';
import { loadQuickRaceConfig, saveRaceConfig } from '../../lib/raceConfig.js';
import { navigate, roomCodeFromPath, usePathname } from '../../lib/router.js';
import { session } from '../../lib/session.js';
import { socket } from '../../lib/socket.js';
import { createTypingLog, type TypingLog } from '../race/typingStats.js';

export type Screen = 'lobby' | 'race' | 'results';
type JoinResponse = { playerId?: string; token?: string; room?: RoomStateMessage; error?: string };
type QueueResponse = JoinResponse & { queue?: QueueUpdate };

/** Quick Race lobby as the client sees it. `deadline` is local (performance.now()), so clock skew can't matter. */
export interface QueueView {
  /** Undefined until the server has seated us in a lobby. */
  update: QueueUpdate | undefined;
  deadline: number;
  /** The lobby was handed off; the race countdown is on its way. */
  matched: boolean;
}

const QUEUE_CLOSED_MESSAGES: Partial<Record<QueueClosedReason, string>> = {
  expired: 'You lost your seat in the queue after losing connection.',
  replaced: 'You left the quick race queue.',
  shutdown: 'The server restarted. Queue again to find a race.',
};

const CLOSED_MESSAGES: Record<RoomClosedReason, string> = {
  host_left: 'The host left, so the room was closed.',
  idle: 'The room was closed after being idle.',
  shutdown: 'The server restarted and the room was closed.',
};

export interface Game {
  screen: Screen | null;
  room: RoomStateMessage | undefined;
  progress: RaceProgressPayload | undefined;
  results: RaceResultsPayload | undefined;
  countdown: RaceCountdown | undefined;
  playerId: string;
  /** Increments per race so the race view remounts with fresh local state. */
  raceSeq: number;
  raceDurationMs: number;
  /** The player's own keystroke log for the current race (mutable, read by the results screen). */
  log: TypingLog;
  isHost: boolean;
  onlyBots: boolean;
  /** Set while the player is in a Quick Race lobby (until the race countdown arrives). */
  queue: QueueView | undefined;
  quickRace(config?: QuickRaceConfig): void;
  cancelQueue(): void;
  create(options?: { bot?: BotSpeed; config?: RaceConfig }): void;
  join(code: string): void;
  startRace(): void;
  raceAgain(): void;
  leave(): void;
  setConfig(config: RaceConfig): void;
  copyLink(): void;
}

/**
 * Owns the socket wiring and the room/race state. It lives above the router, so visiting another
 * page (About, Settings…) does not leave the room; a starting race brings the player back.
 */
export function useGame(notify: (message: string) => void): Game {
  const pathname = usePathname();
  const routeCode = roomCodeFromPath(pathname);
  const [screen, setScreen] = useState<Screen | null>(null);
  const [room, setRoom] = useState<RoomStateMessage>();
  const [progress, setProgress] = useState<RaceProgressPayload>();
  const [results, setResults] = useState<RaceResultsPayload>();
  const [countdown, setCountdown] = useState<RaceCountdown>();
  const [playerId, setPlayerId] = useState('');
  const [raceSeq, setRaceSeq] = useState(0);
  const [raceDurationMs, setRaceDurationMs] = useState(0);
  const logRef = useRef<TypingLog>(createTypingLog());
  const autoStartRef = useRef(false);
  const roomRef = useRef(room);
  roomRef.current = room;
  const attemptedRef = useRef<string | undefined>(undefined);
  const [queue, setQueue] = useState<QueueView>();
  const queueRef = useRef(queue);
  queueRef.current = queue;
  /** The mode last queued for, so a reconnect (or "find another race") asks for the same race. */
  const queueConfigRef = useRef<QuickRaceConfig | undefined>(undefined);

  const isHost = Boolean(room && playerId && room.hostPlayerId === playerId);
  const onlyBots = Boolean(room && room.players.every((player) => player.playerId === playerId || player.isBot));

  const reset = useCallback(() => {
    setRoom(undefined);
    setProgress(undefined);
    setResults(undefined);
    setCountdown(undefined);
    setScreen(null);
    autoStartRef.current = false;
  }, []);

  const goToRoom = (code: string) => {
    const target = `/r/${code}`;
    if (window.location.pathname !== target) navigate(target, { replace: Boolean(roomCodeFromPath(window.location.pathname)) });
  };

  const applyQueueUpdate = useCallback((update: QueueUpdate) => {
    setQueue((current) => (current?.matched ? current : { update, deadline: performance.now() + update.msLeft, matched: false }));
  }, []);

  /** queue:join, also used to retake a seat after a reconnect. Errors arrive as SERVER_EVENTS.ERROR. */
  const sendQueueJoin = useCallback((config: QuickRaceConfig) => {
    const payload = { username: session.getUsername() || 'Guest', token: session.getToken() ?? undefined, config };
    socket.emit(CLIENT_EVENTS.QUEUE_JOIN, payload, (response: QueueResponse) => {
      if (response.error) {
        // "Already queued" means our seat is safe; anything else ends the queue attempt.
        if (!/already in the queue/i.test(response.error)) setQueue(undefined);
        return;
      }
      if (response.playerId) setPlayerId(response.playerId);
      if (response.token) session.setToken(response.token);
      if (response.queue) applyQueueUpdate(response.queue);
      if (response.room) {
        // Our lobby started while we were offline: we're already in that race.
        setQueue(undefined);
        roomRef.current = response.room;
        setRoom(response.room);
        attemptedRef.current = response.room.code;
        goToRoom(response.room.code);
      }
    });
  }, [applyQueueUpdate]);

  const enterRoom = useCallback((response: JoinResponse): boolean => {
    // The reason is shown by the SERVER_EVENTS.ERROR handler, which every failed request also gets.
    if (response.error) return false;
    if (response.playerId) setPlayerId(response.playerId);
    if (response.token) session.setToken(response.token);
    if (response.room) {
      setRoom(response.room);
      attemptedRef.current = response.room.code;
      goToRoom(response.room.code);
      if (response.room.state === 'LOBBY') setScreen('lobby');
    }
    return true;
  }, []);

  const join = useCallback((code: string) => {
    attemptedRef.current = code;
    socket.emit(CLIENT_EVENTS.JOIN_ROOM, { code, username: session.getUsername() || 'Guest', token: session.getToken() ?? undefined }, (response: JoinResponse) => {
      if (enterRoom(response)) return;
      // Couldn't (re)join: stop pointing at a room we're not in.
      if (!roomRef.current || roomRef.current.code === code) {
        reset();
        if (roomCodeFromPath(window.location.pathname) === code) navigate('/', { replace: true });
      }
    });
  }, [enterRoom, reset]);

  // Opening /r/CODE joins that room, once the player has a name (otherwise Home asks for one first).
  useEffect(() => {
    if (!routeCode || room?.code === routeCode || attemptedRef.current === routeCode || !session.getUsername()) return;
    if (socket.connected) join(routeCode);
  }, [routeCode, room?.code, join]);

  useEffect(() => {
    const onRoom = (raw: unknown) => {
      const parsed = roomStateSchema.safeParse(raw);
      if (!parsed.success) return;
      if (queueRef.current && !queueRef.current.matched) return;
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
    const onClosed = (raw: unknown) => {
      const parsed = roomClosedSchema.safeParse(raw);
      if (!parsed.success || parsed.data.code !== roomRef.current?.code) return;
      reset();
      notify(CLOSED_MESSAGES[parsed.data.reason]);
      if (roomCodeFromPath(window.location.pathname)) navigate('/', { replace: true });
    };
    const onCountdown = (raw: unknown) => {
      const parsed = raceCountdownSchema.safeParse(raw);
      if (!parsed.success) return;
      // A new race starts: drop the previous race's progress so its old text isn't shown.
      logRef.current = createTypingLog(Date.now() + parsed.data.startsInMs);
      setQueue(undefined);
      setProgress(undefined);
      setResults(undefined);
      setCountdown(parsed.data);
      setRaceSeq((value) => value + 1);
      setScreen('race');
      if (roomRef.current) goToRoom(roomRef.current.code);
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
      setScreen('results');
    };
    const onError = (raw: unknown) => {
      const parsed = errorSchema.safeParse(raw);
      if (!parsed.success) return;
      // A reconnect can resend queue:join while the first one is still in flight; our seat is safe.
      if (queueRef.current && /already in the queue/i.test(parsed.data.error)) return;
      notify(parsed.data.error);
    };
    const onQueueUpdate = (raw: unknown) => {
      const parsed = queueUpdateSchema.safeParse(raw);
      if (parsed.success && queueRef.current) applyQueueUpdate(parsed.data);
    };
    const onQueueMatched = (raw: unknown) => {
      const parsed = queueMatchedSchema.safeParse(raw);
      if (!parsed.success) return;
      const { room: matchedRoom, playerId: me } = parsed.data;
      setPlayerId(me);
      roomRef.current = matchedRoom;
      setRoom(matchedRoom);
      attemptedRef.current = matchedRoom.code;
      // Keep the queue screen ("starting…") up until the countdown replaces it: no flash of a lobby.
      setQueue((current) => (current ? { ...current, matched: true } : current));
      goToRoom(matchedRoom.code);
    };
    const onQueueClosed = (raw: unknown) => {
      const parsed = queueClosedSchema.safeParse(raw);
      if (!parsed.success || !queueRef.current || queueRef.current.matched) return;
      setQueue(undefined);
      const message = QUEUE_CLOSED_MESSAGES[parsed.data.reason];
      if (message) notify(message);
    };
    // After a dropped connection, retake our queue seat, or reattach to the room we were in (or the one in the URL).
    const onConnect = () => {
      const queued = queueRef.current;
      if (queued && !queued.matched && queueConfigRef.current && session.getUsername()) {
        sendQueueJoin(queueConfigRef.current);
        return;
      }
      const code = roomRef.current?.code ?? roomCodeFromPath(window.location.pathname);
      if (code && session.getUsername()) join(code);
    };
    socket.on('connect', onConnect);
    socket.on(SERVER_EVENTS.ROOM_STATE, onRoom);
    socket.on(SERVER_EVENTS.ROOM_CLOSED, onClosed);
    socket.on(SERVER_EVENTS.RACE_COUNTDOWN, onCountdown);
    socket.on(SERVER_EVENTS.RACE_PROGRESS, onProgress);
    socket.on(SERVER_EVENTS.RACE_RESULTS, onResults);
    socket.on(SERVER_EVENTS.ERROR, onError);
    socket.on(SERVER_EVENTS.QUEUE_UPDATE, onQueueUpdate);
    socket.on(SERVER_EVENTS.QUEUE_MATCHED, onQueueMatched);
    socket.on(SERVER_EVENTS.QUEUE_CLOSED, onQueueClosed);
    return () => {
      socket.off(SERVER_EVENTS.QUEUE_UPDATE, onQueueUpdate);
      socket.off(SERVER_EVENTS.QUEUE_MATCHED, onQueueMatched);
      socket.off(SERVER_EVENTS.QUEUE_CLOSED, onQueueClosed);
      socket.off('connect', onConnect);
      socket.off(SERVER_EVENTS.ROOM_STATE, onRoom);
      socket.off(SERVER_EVENTS.ROOM_CLOSED, onClosed);
      socket.off(SERVER_EVENTS.RACE_COUNTDOWN, onCountdown);
      socket.off(SERVER_EVENTS.RACE_PROGRESS, onProgress);
      socket.off(SERVER_EVENTS.RACE_RESULTS, onResults);
      socket.off(SERVER_EVENTS.ERROR, onError);
    };
  }, [join, notify, reset, applyQueueUpdate, sendQueueJoin]);

  // ---- actions --------------------------------------------------------------------------------

  const create: Game['create'] = ({ bot, config } = {}) => {
    if (config) saveRaceConfig(config);
    const payload = {
      username: session.getUsername() || 'Guest',
      token: session.getToken() ?? undefined,
      ...(bot ? { bot: { targetWpm: bot } } : {}),
      ...(config ? { config } : {}),
    };
    socket.emit(CLIENT_EVENTS.CREATE_ROOM, payload, (response: JoinResponse) => {
      if (enterRoom(response) && response.room && bot) socket.emit(CLIENT_EVENTS.START_RACE, {});
    });
  };

  const quickRace: Game['quickRace'] = (config) => {
    const chosen = config ?? queueConfigRef.current ?? loadQuickRaceConfig();
    queueConfigRef.current = chosen;
    if (config) saveRaceConfig(config);
    // The server leaves any finished room for us when we queue; mirror that locally.
    reset();
    attemptedRef.current = undefined;
    setQueue({ update: undefined, deadline: performance.now(), matched: false });
    if (roomCodeFromPath(window.location.pathname)) navigate('/', { replace: true });
    sendQueueJoin(chosen);
  };
  const cancelQueue = () => {
    socket.emit(CLIENT_EVENTS.QUEUE_LEAVE, {});
    setQueue(undefined);
  };

  // Failures arrive as SERVER_EVENTS.ERROR (shown by onError), so these need no ack handling.
  const startRace = () => socket.emit(CLIENT_EVENTS.START_RACE, {});
  const raceAgain = () => {
    if (room?.kind === 'quick') {
      quickRace();
      return;
    }
    autoStartRef.current = isHost && onlyBots;
    setResults(undefined);
    socket.emit(CLIENT_EVENTS.RACE_AGAIN, {});
  };
  const setConfig = (config: RaceConfig) => {
    saveRaceConfig(config);
    socket.emit(CLIENT_EVENTS.SET_RACE_CONFIG, { config });
  };
  const leave = () => {
    socket.emit(CLIENT_EVENTS.LEAVE_ROOM);
    attemptedRef.current = undefined;
    reset();
    navigate('/');
  };
  const copyLink = () => {
    if (!room) return;
    const link = `${window.location.origin}/r/${room.code}`;
    navigator.clipboard.writeText(link).then(() => notify('Invite link copied'), () => notify(link));
  };

  return {
    screen: room ? screen : null,
    room,
    progress,
    results,
    countdown,
    playerId,
    raceSeq,
    raceDurationMs,
    log: logRef.current,
    isHost,
    onlyBots,
    queue,
    quickRace,
    cancelQueue,
    create,
    join,
    startRace,
    raceAgain,
    leave,
    setConfig,
    copyLink,
  };
}
