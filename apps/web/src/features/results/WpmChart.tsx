import { useEffect, useRef, useState } from 'react';
import type { SecondSample } from '../race/typingStats.js';
import type { RaceSample } from '@typeroom/shared';

/**
 * WPM over time, hand-rolled SVG. One WPM axis for both series (never two scales).
 * Net = accent, solid; raw = muted, dashed (identity is not colour-alone); errors are ✕ markers.
 * Colours come from theme tokens, so every theme restyles it.
 */

const HEIGHT = 220;
const PAD = { top: 16, right: 44, bottom: 28, left: 40 };

export function WpmChart({ series, comparisons = [] }: {
  series: SecondSample[];
  comparisons?: { name: string; color: string; series: RaceSample[] }[];
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(Math.max(280, entry.contentRect.width)));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  if (series.length === 0) return <p className="muted">No keystrokes recorded for this race.</p>;

  const allSeries = [series, ...comparisons.map((comparison) => comparison.series)];
  const maxSecond = Math.max(1, ...allSeries.map((line) => line.at(-1)?.second ?? 0));
  const maxWpm = niceCeil(Math.max(10, ...allSeries.flatMap((line) => line.flatMap((sample) => [sample.raw, sample.net]))));
  const innerW = width - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (second: number) => PAD.left + (maxSecond === 0 ? 0 : (second / maxSecond) * innerW);
  const y = (wpm: number) => PAD.top + innerH - (wpm / maxWpm) * innerH;
  const path = (key: 'raw' | 'net') => smoothPath(series.map((sample) => ({ x: x(sample.second), y: y(sample[key]) })));
  const yTicks = [0, maxWpm / 4, maxWpm / 2, (maxWpm * 3) / 4, maxWpm];
  const xStep = niceStep(maxSecond / 6);
  const xTicks: number[] = [];
  for (let second = 0; second <= maxSecond + 1e-6; second += xStep) xTicks.push(Math.round(second * 10) / 10);
  const last = series.at(-1)!;
  const hovered = hover === null ? null : series[hover];

  const onMove = (event: React.PointerEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const second = ((event.clientX - rect.left) / rect.width) * maxSecond;
    let best = 0;
    series.forEach((sample, index) => { if (Math.abs(sample.second - second) < Math.abs((series[best]?.second ?? 0) - second)) best = index; });
    setHover(best);
  };

  return <figure className="chart" ref={boxRef}>
    <div className="chart-legend" aria-hidden>
      <span><i className="key key-net" />you</span>
      {comparisons.map((comparison) => <span key={comparison.name}><i className="key" style={{ background: comparison.color }} />{comparison.name}</span>)}
      <span><i className="key key-err">✕</i>errors</span>
    </div>
    <svg width={width} height={HEIGHT} role="img" aria-label={`WPM over ${Math.round(maxSecond)} seconds, finishing at ${Math.round(last.net)} WPM`}>
      {yTicks.map((tick) => <g key={tick}>
        <line className="grid" x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} />
        <text className="tick" x={PAD.left - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle">{Math.round(tick)}</text>
      </g>)}
      {xTicks.map((tick) => <text key={tick} className="tick" x={x(tick)} y={HEIGHT - 8} textAnchor="middle">{tick}s</text>)}
      <path className="line-raw" d={path('raw')} />
      <path className="line-net" d={path('net')} />
      {comparisons.map((comparison) => <path
        key={comparison.name}
        className="line-net"
        style={{ stroke: comparison.color, strokeWidth: 1.5, opacity: .8 }}
        d={smoothPath(comparison.series.map((sample) => ({ x: x(sample.second), y: y(sample.net) })))}
      />)}
      {series.filter((sample) => sample.errors > 0).map((sample) => (
        <text key={sample.second} className="err-mark" x={x(sample.second)} y={y(sample.raw)} textAnchor="middle" dominantBaseline="middle">✕</text>
      ))}
      <text className="direct-label net" x={x(last.second) + 6} y={y(last.net)} dominantBaseline="middle">{Math.round(last.net)}</text>
      {hovered && <g>
        <line className="crosshair" x1={x(hovered.second)} x2={x(hovered.second)} y1={PAD.top} y2={PAD.top + innerH} />
        <circle className="dot-net" cx={x(hovered.second)} cy={y(hovered.net)} r={4} />
        <circle className="dot-raw" cx={x(hovered.second)} cy={y(hovered.raw)} r={4} />
      </g>}
      <rect className="hit" x={PAD.left} y={PAD.top} width={innerW} height={innerH} onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
    </svg>
    {hovered && <div className="chart-tip" style={{ left: Math.min(width - 150, Math.max(0, x(hovered.second) + 10)) }}>
      <strong>{hovered.second}s</strong>
      <span>wpm <b>{Math.round(hovered.net)}</b></span>
      <span>raw <b>{Math.round(hovered.raw)}</b></span>
      <span>errors <b>{hovered.errors}</b></span>
    </div>}
    <table className="sr-only">
      <caption>WPM per second</caption>
      <thead><tr><th>Second</th><th>WPM</th><th>Raw</th><th>Errors</th></tr></thead>
      <tbody>{series.map((sample) => <tr key={sample.second}><td>{sample.second}</td><td>{sample.net}</td><td>{sample.raw}</td><td>{sample.errors}</td></tr>)}</tbody>
    </table>
  </figure>;
}

function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
}

function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 1) return `M${points[0]!.x.toFixed(1)},${points[0]!.y.toFixed(1)}`;
  return points.map((point, index) => {
    if (index === 0) return `M${point.x.toFixed(1)},${point.y.toFixed(1)}`;
    const previous = points[index - 1]!;
    const before = points[index - 2] ?? previous;
    const after = points[index + 1] ?? point;
    const control1 = {
      x: previous.x + (point.x - before.x) / 6,
      y: previous.y + (point.y - before.y) / 6,
    };
    const control2 = {
      x: point.x - (after.x - previous.x) / 6,
      y: point.y - (after.y - previous.y) / 6,
    };
    return `C${control1.x.toFixed(1)},${control1.y.toFixed(1)} ${control2.x.toFixed(1)},${control2.y.toFixed(1)} ${point.x.toFixed(1)},${point.y.toFixed(1)}`;
  }).join(' ');
}

function niceCeil(value: number): number {
  const step = niceStep(value / 4);
  return Math.ceil(value / step) * step;
}
