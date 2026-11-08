import { useMemo } from 'react';
import type { RaceResultsPayload } from '@typeroom/shared';
import { Kbd } from '../../components/Kbd.js';
import { caretColor, colorFor } from '../race/colors.js';
import { formatClock } from '../race/Race.js';
import { computeStats, type TypingLog } from '../race/typingStats.js';
import { WpmChart } from './WpmChart.js';

interface Props {
  results: RaceResultsPayload;
  playerId: string;
  log: TypingLog;
  textLength: number;
  /** The server's final position for this player (from the last progress tick). */
  finalPosition: number;
  raceDurationMs: number;
  /** Players in join order, so colours match the race (colour follows the player, never the rank). */
  roster: ReadonlyArray<{ playerId: string }>;
  onAgain: () => void;
  onLeave: () => void;
}

export function Results({ results, playerId, log, textLength, finalPosition, raceDurationMs, roster, onAgain, onLeave }: Props) {
  const mine = results.results.find((result) => result.playerId === playerId);
  const durationMs = mine?.finishTimeMs ?? raceDurationMs;
  const reached = mine?.finishTimeMs != null ? textLength : finalPosition;
  const stats = useMemo(() => computeStats(log, textLength, reached, durationMs), [log, textLength, reached, durationMs]);
  const { breakdown } = stats;

  return <section className="results">
    <div className="results-top">
      <div className="hero-stats">
        {/* Net WPM and accuracy are the server's authoritative numbers; the rest is computed locally. */}
        <BigStat label="wpm" value={mine ? Math.round(mine.wpm) : '—'} accent />
        <BigStat label="acc" value={mine ? `${mine.accuracy}%` : '—'} />
      </div>
      <div className="sub-stats">
        <SmallStat label="raw" value={Math.round(stats.rawWpm)} />
        <SmallStat label="consistency" value={stats.consistency === null ? '—' : `${stats.consistency}%`} />
        <SmallStat label="time" value={mine?.finishTimeMs != null ? `${(mine.finishTimeMs / 1000).toFixed(1)}s` : formatClock(durationMs)} />
        <SmallStat
          label="characters"
          title="correct / incorrect / extra / missed"
          value={<span className="breakdown">
            <span className="b-correct">{breakdown.correct}</span>/<span className="b-incorrect">{breakdown.incorrect}</span>/<span className="b-extra">{breakdown.extra}</span>/<span className="b-missed">{breakdown.missed}</span>
          </span>}
        />
        <SmallStat label="rank" value={mine ? `${mine.rank}/${results.results.length}` : '—'} />
      </div>
    </div>

    <WpmChart series={stats.series} />

    <table className="standings-table">
      <caption className="sr-only">Final standings</caption>
      <thead><tr><th>#</th><th>racer</th><th>wpm</th><th>acc</th><th>time</th></tr></thead>
      <tbody>
        {results.results.map((result) => <tr key={result.playerId} className={result.playerId === playerId ? 'is-me' : ''} style={caretColor(colorFor(roster, result.playerId, playerId))}>
          <td>{result.rank}</td>
          <td><i className="dot" />{result.username}{result.playerId === playerId ? ' (you)' : ''}{result.isBot ? ' · bot' : ''}</td>
          <td>{result.finishTimeMs === null ? '—' : result.wpm.toFixed(1)}</td>
          <td>{result.finishTimeMs === null ? '—' : `${result.accuracy}%`}</td>
          <td>{result.finishTimeMs === null ? 'dnf' : `${(result.finishTimeMs / 1000).toFixed(1)}s`}</td>
        </tr>)}
      </tbody>
    </table>

    <div className="results-actions">
      <button className="primary" onClick={onAgain}>Race again</button>
      <button className="ghost-button" onClick={onLeave}>Leave room</button>
      <span className="hint"><Kbd>tab</Kbd> + <Kbd>enter</Kbd> race again</span>
    </div>
  </section>;
}

function BigStat({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return <div className={`big-stat ${accent ? 'accent' : ''}`}><span className="label">{label}</span><span className="value">{value}</span></div>;
}

function SmallStat({ label, value, title }: { label: string; value: React.ReactNode; title?: string }) {
  return <div className="small-stat" title={title}><span className="label">{label}</span><span className="value">{value}</span></div>;
}
