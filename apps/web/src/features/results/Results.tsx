import { useMemo } from 'react';
import type { RaceConfig, RaceResultsPayload } from '@typeroom/shared';
import { Kbd } from '../../components/Kbd.js';
import { RacerTag } from '../../components/RacerTag.js';
import { describeRaceConfig } from '../../lib/raceConfig.js';
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
  /** The mode this race was run in, and the quote attribution if any. */
  config: RaceConfig | undefined;
  source: string | undefined;
  onAgain: () => void;
  onLeave: () => void;
  /** Quick races are one-offs: "again" means queueing for a new race. */
  quick?: boolean;
}

export function Results({ results, playerId, log, textLength, finalPosition, raceDurationMs, roster, config, source, onAgain, onLeave, quick = false }: Props) {
  const mine = results.results.find((result) => result.playerId === playerId);
  const durationMs = mine?.finishTimeMs ?? raceDurationMs;
  // A time-mode text is longer than anyone can type, so the untyped rest is not "missed".
  const timed = config?.mode === 'time';
  const reached = timed ? finalPosition : mine?.finishTimeMs != null ? textLength : finalPosition;
  const effectiveLength = timed ? finalPosition : textLength;
  const stats = useMemo(() => computeStats(log, effectiveLength, reached, durationMs), [log, effectiveLength, reached, durationMs]);
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
        {config && <SmallStat label="mode" value={describeRaceConfig(config)} />}
      </div>
    </div>

    {source && <p className="race-source">— {source}</p>}

    <WpmChart
      series={stats.series}
      comparisons={results.results
        .filter((result) => result.playerId !== playerId)
        .map((result) => ({ name: result.username, color: colorFor(roster, result.playerId, playerId), series: result.series }))}
    />

    <table className="standings-table">
      <caption className="sr-only">Final standings</caption>
      <thead><tr><th>#</th><th>racer</th><th>wpm</th><th>acc</th><th>time</th></tr></thead>
      <tbody>
        {results.results.map((result) => <tr key={result.playerId} className={result.playerId === playerId ? 'is-me' : ''} style={caretColor(colorFor(roster, result.playerId, playerId))}>
          <td>{result.rank}</td>
          <td><i className="dot" />{result.username}{result.playerId === playerId ? ' (you)' : ''} <RacerTag racer={result} /></td>
          <td>{result.finishTimeMs === null ? '—' : result.wpm.toFixed(1)}</td>
          <td>{result.finishTimeMs === null ? '—' : `${result.accuracy}%`}</td>
          <td>{result.finishTimeMs === null ? 'dnf' : `${(result.finishTimeMs / 1000).toFixed(1)}s`}</td>
        </tr>)}
      </tbody>
    </table>

    <div className="results-actions">
      <button className="primary" onClick={onLeave}>Exit race</button>
      <button className="ghost-button" onClick={onAgain}>{quick ? 'Find another race' : 'Race again'}</button>
      <span className="hint"><Kbd>tab</Kbd> + <Kbd>enter</Kbd> exit race</span>
    </div>
  </section>;
}

function BigStat({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return <div className={`big-stat ${accent ? 'accent' : ''}`}><span className="label">{label}</span><span className="value">{value}</span></div>;
}

function SmallStat({ label, value, title }: { label: string; value: React.ReactNode; title?: string }) {
  return <div className="small-stat" title={title}><span className="label">{label}</span><span className="value">{value}</span></div>;
}
