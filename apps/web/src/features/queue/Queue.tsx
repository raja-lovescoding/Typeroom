import { useEffect, useState } from 'react';
import { QUICK_RACE_LOBBY_WAIT_MS, QUICK_RACE_MAX_RACERS } from '@typeroom/shared';
import { describeRaceConfig } from '../../lib/raceConfig.js';
import type { QueueView } from '../game/useGame.js';
import { caretColor, colorFor } from '../race/colors.js';

/**
 * Quick Race lobby: who's here, seats filled, and the countdown to the start. The countdown runs
 * locally from the server's `msLeft` (no per-second traffic); every membership change re-syncs it.
 */
export function Queue({ queue, playerId, onCancel }: { queue: QueueView; playerId: string; onCancel: () => void }) {
  const now = useNow(queue.matched ? 0 : 250);
  const { update, matched } = queue;
  const msLeft = update ? Math.max(0, queue.deadline - now) : QUICK_RACE_LOBBY_WAIT_MS;
  const secondsLeft = Math.ceil(msLeft / 1_000);
  const maxSeats = update?.maxSeats ?? QUICK_RACE_MAX_RACERS;
  const racers = update?.racers ?? [];
  const filled = update?.seatsFilled ?? 0;
  const humansOnly = filled >= 2;

  const status = !update ? 'Finding a race…'
    : matched ? 'Starting…'
    : filled === 1 ? 'Waiting for racers…'
    : `${filled} racers ready`;

  return <section className="queue" aria-labelledby="queue-title">
    <div className="queue-head">
      <div>
        <span className="label">quick race</span>
        <h2 id="queue-title">{status}</h2>
      </div>
      <div className="queue-timer" role="timer" aria-live="off" aria-label={`${secondsLeft} seconds until the race starts`}>
        <strong>{matched ? 'go' : update ? secondsLeft : '…'}</strong>
        {!matched && update && <span className="label">sec</span>}
      </div>
    </div>

    <div className="queue-bar" aria-hidden="true"><span style={{ width: `${matched ? 100 : Math.min(100, 100 - (msLeft / QUICK_RACE_LOBBY_WAIT_MS) * 100)}%` }} /></div>

    <p className="queue-meta" aria-live="polite">
      <strong>{filled}/{maxSeats}</strong> seats filled
      {update && <> · <span title="Matched by your rolling average speed">{update.band} wpm</span> · {describeRaceConfig(update.config)}</>}
    </p>

    <ul className="lobby-players queue-seats">
      {racers.map((racer) => <li key={racer.playerId} style={caretColor(colorFor(racers, racer.playerId, playerId))} className={racer.connected ? '' : 'offline'}>
        <i className="dot" />
        <span>{racer.username}</span>
        {racer.playerId === playerId && <span className="tag">you</span>}
        {!racer.connected && <span className="tag">reconnecting</span>}
      </li>)}
      {Array.from({ length: Math.max(0, maxSeats - racers.length) }, (_, index) => <li key={`open-${index}`} className="open-seat">
        <i className="dot" />
        <span>open seat</span>
      </li>)}
    </ul>

    <p className="muted small">
      {matched ? 'Get ready to type.'
        : humansOnly ? 'You\'ll race the people here when the timer ends (or as soon as the lobby is full).'
        : 'Finding the best match for you…'}
    </p>

    <div className="lobby-actions">
      <button className="secondary" onClick={onCancel} disabled={matched}>Cancel</button>
    </div>
  </section>;
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (intervalMs <= 0) return;
    const id = window.setInterval(() => setNow(performance.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
