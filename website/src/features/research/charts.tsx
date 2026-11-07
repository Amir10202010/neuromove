// Agreement charts for validation sessions. One small SVG primitive (XYChart) and the six analytical
// views built on it. Every mark comes from a stored trial; with no data a chart says so instead of
// drawing placeholder points.

import type { ReactNode } from 'react';
import type { BlandAltman } from '../../research/stats';

export interface Series {
  kind: 'points' | 'line' | 'bars';
  points: { x: number; y: number; label?: string; flagged?: boolean }[];
  color: string;
  name: string;
}

export interface Rule {
  y: number;
  label: string;
  dashed?: boolean;
}

interface XYProps {
  title: string;
  xLabel: string;
  yLabel: string;
  series: Series[];
  rules?: Rule[];
  band?: [number, number];
  /** Straight line y = a + b·x drawn across the x range. */
  trend?: { intercept: number; slope: number; label: string };
  empty: string;
  height?: number;
  xInteger?: boolean;
}

const W = 560;
const PAD = { l: 48, r: 16, t: 14, b: 38 };

function ticks(lo: number, hi: number, n = 5): number[] {
  const span = hi - lo || 1;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

export function XYChart({ title, xLabel, yLabel, series, rules = [], band, trend, empty, height = 240, xInteger }: XYProps): ReactNode {
  const pts = series.flatMap((s) => s.points);
  if (!pts.length)
    return (
      <figure className="rchart">
        <figcaption className="rchart__title">{title}</figcaption>
        <div className="rchart__empty">{empty}</div>
      </figure>
    );
  const xs = pts.map((p) => p.x);
  const ys = [...pts.map((p) => p.y), ...rules.map((r) => r.y), ...(band ?? []), ...(series.some((s) => s.kind === 'bars') ? [0] : [])];
  let [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  let [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  if (x0 === x1) [x0, x1] = [x0 - 1, x1 + 1];
  if (y0 === y1) [y0, y1] = [y0 - 1, y1 + 1];
  const padY = (y1 - y0) * 0.08;
  y0 -= padY;
  y1 += padY;
  const padX = xInteger ? 0.6 : (x1 - x0) * 0.04;
  x0 -= padX;
  x1 += padX;
  const H = height;
  const sx = (x: number) => PAD.l + ((x - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
  const sy = (y: number) => PAD.t + (1 - (y - y0) / (y1 - y0)) * (H - PAD.t - PAD.b);
  const xt = xInteger ? ticks(Math.ceil(x0), Math.floor(x1), Math.min(10, Math.floor(x1) - Math.ceil(x0) + 1)).filter((v) => Number.isInteger(v)) : ticks(x0, x1);
  const yt = ticks(y0, y1);
  const barW = Math.max(2, Math.min(18, ((W - PAD.l - PAD.r) / Math.max(1, x1 - x0)) * 0.6));
  return (
    <figure className="rchart">
      <figcaption className="rchart__title">{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="rchart__svg">
        {yt.map((v) => (
          <g key={`y${v}`}>
            <line x1={PAD.l} x2={W - PAD.r} y1={sy(v)} y2={sy(v)} className="rchart__grid" />
            <text x={PAD.l - 6} y={sy(v)} className="rchart__tick" textAnchor="end" dominantBaseline="middle">
              {v}
            </text>
          </g>
        ))}
        {xt.map((v) => (
          <text key={`x${v}`} x={sx(v)} y={H - PAD.b + 14} className="rchart__tick" textAnchor="middle">
            {v}
          </text>
        ))}
        {band && <rect x={PAD.l} width={W - PAD.l - PAD.r} y={sy(band[1])} height={Math.max(0, sy(band[0]) - sy(band[1]))} className="rchart__band" />}
        {rules.map((r) => (
          <g key={r.label}>
            <line x1={PAD.l} x2={W - PAD.r} y1={sy(r.y)} y2={sy(r.y)} className={`rchart__rule${r.dashed ? ' is-dashed' : ''}`} />
            <text x={W - PAD.r - 2} y={sy(r.y) - 4} className="rchart__rulelabel" textAnchor="end">
              {r.label}
            </text>
          </g>
        ))}
        {trend && <line x1={sx(x0)} x2={sx(x1)} y1={sy(trend.intercept + trend.slope * x0)} y2={sy(trend.intercept + trend.slope * x1)} className="rchart__trend" />}
        {series.map((s) =>
          s.kind === 'bars' ? (
            s.points.map((p, i) => (
              <rect key={`${s.name}${i}`} x={sx(p.x) - barW / 2} width={barW} y={Math.min(sy(p.y), sy(0))} height={Math.abs(sy(p.y) - sy(0))} fill={s.color} className={p.flagged ? 'is-flagged' : undefined}>
                <title>{p.label ?? `${p.x}: ${p.y}`}</title>
              </rect>
            ))
          ) : (
            <g key={s.name}>
              {s.kind === 'line' && s.points.length > 1 && <polyline fill="none" stroke={s.color} strokeWidth={1.5} points={s.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')} />}
              {s.points.map((p, i) => (
                <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={p.flagged ? 5 : 3.5} fill={s.color} className={p.flagged ? 'is-flagged' : undefined}>
                  <title>{p.label ?? `${p.x}, ${p.y}`}</title>
                </circle>
              ))}
            </g>
          ),
        )}
        <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={H - PAD.b} className="rchart__axis" />
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} className="rchart__axis" />
        <text x={(PAD.l + W - PAD.r) / 2} y={H - 4} className="rchart__axislabel" textAnchor="middle">
          {xLabel}
        </text>
        <text x={12} y={(PAD.t + H - PAD.b) / 2} className="rchart__axislabel" textAnchor="middle" transform={`rotate(-90 12 ${(PAD.t + H - PAD.b) / 2})`}>
          {yLabel}
        </text>
      </svg>
      {series.length > 1 && (
        <div className="rchart__legend">
          {series.map((s) => (
            <span key={s.name}>
              <i style={{ background: s.color }} aria-hidden />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </figure>
  );
}

/** Histogram counts of values in fixed-width bins. */
export function histogram(values: readonly number[], width: number): { x: number; y: number }[] {
  if (!values.length) return [];
  const bins = new Map<number, number>();
  for (const v of values) {
    const b = Math.floor(v / width);
    bins.set(b, (bins.get(b) ?? 0) + 1);
  }
  return [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([b, n]) => ({ x: (b + 0.5) * width, y: n }));
}

export function baRules(ba: BlandAltman | null, labels: { bias: string; lower: string; upper: string }): Rule[] {
  if (!ba) return [];
  return [
    { y: ba.bias, label: `${labels.bias} ${ba.bias.toFixed(2)}°` },
    { y: ba.loa[0], label: `${labels.lower} ${ba.loa[0].toFixed(2)}°`, dashed: true },
    { y: ba.loa[1], label: `${labels.upper} ${ba.loa[1].toFixed(2)}°`, dashed: true },
  ];
}
