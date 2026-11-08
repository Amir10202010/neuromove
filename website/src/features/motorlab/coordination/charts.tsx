// Charts of the coordination workspace: phase-normalised curves with SD bands, a component-space scatter with
// selectable repetitions, and a strategy-sequence strip. One y-axis per chart, real units, every mark from the
// engine result. Series colours: strategy / repetition A = --left, B = --right, C = --good, D = --warn,
// uncertain = --muted-series. Colour is never the only carrier: labels and legends name every series.

import type { ReactNode } from 'react';

const W = 640;
const PAD = { l: 52, r: 14, t: 14, b: 38 };

export const SERIES = ['var(--left)', 'var(--right)', 'var(--good)', 'var(--warn)'] as const;
export const UNCERTAIN = 'var(--muted-series)';

function ticks(lo: number, hi: number, n = 5): number[] {
  const span = hi - lo || 1;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

function extent(vs: number[]): [number, number] {
  const f = vs.filter(Number.isFinite);
  if (!f.length) return [0, 1];
  let lo = Math.min(...f);
  let hi = Math.max(...f);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const p = (hi - lo) * 0.06;
  return [lo - p, hi + p];
}

const pathOf = (pts: [number, number][]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');

export interface CurveSeries {
  name: string;
  y: number[];
  color: string;
  band?: { lo: number[]; hi: number[] };
  dashed?: boolean;
  thin?: boolean;
}

export function CurveChart({ title, xLabel, yLabel, x, series, markers = [], regions = [], height = 190, fmt }: { title: string; xLabel: string; yLabel: string; x: number[]; series: CurveSeries[]; markers?: { x: number; label: string; lo?: number; hi?: number }[]; regions?: { a: number; b: number }[]; height?: number; fmt: (v: number) => string }): ReactNode {
  const ys = series.flatMap((s) => [...s.y, ...(s.band ? [...s.band.lo, ...s.band.hi] : [])]);
  if (!x.length || !ys.some(Number.isFinite))
    return (
      <figure className="rchart">
        <figcaption className="rchart__title">{title}</figcaption>
        <div className="rchart__empty">—</div>
      </figure>
    );
  const [x0, x1] = [Math.min(...x), Math.max(...x)];
  const [y0, y1] = extent(ys);
  const sx = (v: number) => PAD.l + ((v - x0) / (x1 - x0 || 1)) * (W - PAD.l - PAD.r);
  const sy = (v: number) => height - PAD.b - ((v - y0) / (y1 - y0)) * (height - PAD.t - PAD.b);
  const seg = (y: number[]) => {
    // break the line at NaN (missing samples are never bridged)
    const parts: [number, number][][] = [];
    let cur: [number, number][] = [];
    y.forEach((v, i) => {
      if (Number.isFinite(v)) cur.push([sx(x[i] as number), sy(v)]);
      else if (cur.length) {
        parts.push(cur);
        cur = [];
      }
    });
    if (cur.length) parts.push(cur);
    return parts;
  };
  return (
    <figure className="rchart">
      <figcaption className="rchart__title">{title}</figcaption>
      <svg className="rchart__svg" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={`${title}: ${series.map((s) => s.name).join(', ')}`}>
        {regions.map((r, i) => (
          <rect key={`r${i}`} className="cochart__region" x={sx(r.a)} y={PAD.t} width={Math.max(1, sx(r.b) - sx(r.a))} height={height - PAD.t - PAD.b} />
        ))}
        {ticks(y0, y1, 4).map((v) => (
          <g key={v}>
            <line className="rchart__grid" x1={PAD.l} x2={W - PAD.r} y1={sy(v)} y2={sy(v)} />
            <text className="rchart__tick" x={PAD.l - 6} y={sy(v) + 4} textAnchor="end">{fmt(v)}</text>
          </g>
        ))}
        {ticks(x0, x1, 6).map((v) => (
          <text key={v} className="rchart__tick" x={sx(v)} y={height - PAD.b + 15} textAnchor="middle">{v}</text>
        ))}
        {markers.map((m, i) => (
          <g key={`m${i}`}>
            {m.lo !== undefined && m.hi !== undefined && <rect className="cochart__uncert" x={sx(m.lo)} y={PAD.t} width={Math.max(1, sx(m.hi) - sx(m.lo))} height={height - PAD.t - PAD.b} />}
            <line className="cochart__marker" x1={sx(m.x)} x2={sx(m.x)} y1={PAD.t} y2={height - PAD.b} />
            <text className="rchart__tick" x={sx(m.x) + 3} y={PAD.t + 10 + (i % 2) * 11}>{m.label}</text>
          </g>
        ))}
        {series.map((s, i) =>
          s.band ? (
            <path
              key={`b${i}`}
              d={`${pathOf(x.map((xv, k) => [sx(xv), sy(Number.isFinite(s.band!.hi[k] as number) ? (s.band!.hi[k] as number) : (s.y[k] as number))]))}${x
                .map((xv, k) => [sx(xv), sy(Number.isFinite(s.band!.lo[k] as number) ? (s.band!.lo[k] as number) : (s.y[k] as number))] as [number, number])
                .reverse()
                .map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`)
                .join('')}Z`}
              style={{ fill: s.color, opacity: 0.13 }}
            />
          ) : null,
        )}
        {series.map((s, i) => seg(s.y).map((pts, k) => <path key={`l${i}-${k}`} d={pathOf(pts)} style={{ fill: 'none', stroke: s.color, strokeWidth: s.thin ? 1 : 2, strokeDasharray: s.dashed ? '5 4' : undefined, opacity: s.thin ? 0.55 : 1 }} />))}
        <text className="rchart__axislabel" x={(PAD.l + W - PAD.r) / 2} y={height - 5} textAnchor="middle">{xLabel}</text>
        <text className="rchart__axislabel" transform={`translate(13 ${(PAD.t + height - PAD.b) / 2}) rotate(-90)`} textAnchor="middle">{yLabel}</text>
      </svg>
      <div className="cochart__legend">
        {series
          .filter((s) => !s.thin)
          .map((s) => (
            <span key={s.name}>
              <i style={{ background: s.color }} aria-hidden /> {s.name}
            </span>
          ))}
      </div>
    </figure>
  );
}

export interface ScatterPoint {
  id: string;
  x: number;
  y: number;
  color: string;
  /** Marker shape per session (cycles), so session is not encoded by colour. */
  shape: number;
  title: string;
}

export function ScatterChart({ title, xLabel, yLabel, points, selected, onPick, fmt, height = 300 }: { title: string; xLabel: string; yLabel: string; points: ScatterPoint[]; selected: readonly string[]; onPick: (id: string) => void; fmt: (v: number) => string; height?: number }): ReactNode {
  if (!points.length)
    return (
      <figure className="rchart">
        <figcaption className="rchart__title">{title}</figcaption>
        <div className="rchart__empty">—</div>
      </figure>
    );
  const [x0, x1] = extent(points.map((p) => p.x));
  const [y0, y1] = extent(points.map((p) => p.y));
  const sx = (v: number) => PAD.l + ((v - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
  const sy = (v: number) => height - PAD.b - ((v - y0) / (y1 - y0)) * (height - PAD.t - PAD.b);
  const mark = (p: ScatterPoint) => {
    const cx = sx(p.x);
    const cy = sy(p.y);
    const r = 5;
    const common = { style: { fill: p.color, stroke: 'var(--surface)', strokeWidth: 1 } };
    switch (p.shape % 4) {
      case 1:
        return <rect x={cx - r} y={cy - r} width={2 * r} height={2 * r} {...common} />;
      case 2:
        return <path d={`M${cx},${cy - r - 1}L${cx + r + 1},${cy + r}L${cx - r - 1},${cy + r}Z`} {...common} />;
      case 3:
        return <path d={`M${cx},${cy - r - 1}L${cx + r + 1},${cy}L${cx},${cy + r + 1}L${cx - r - 1},${cy}Z`} {...common} />;
      default:
        return <circle cx={cx} cy={cy} r={r} {...common} />;
    }
  };
  return (
    <figure className="rchart">
      <figcaption className="rchart__title">{title}</figcaption>
      <svg className="rchart__svg" viewBox={`0 0 ${W} ${height}`} role="group" aria-label={title}>
        {ticks(y0, y1, 5).map((v) => (
          <g key={v}>
            <line className="rchart__grid" x1={PAD.l} x2={W - PAD.r} y1={sy(v)} y2={sy(v)} />
            <text className="rchart__tick" x={PAD.l - 6} y={sy(v) + 4} textAnchor="end">{fmt(v)}</text>
          </g>
        ))}
        {ticks(x0, x1, 6).map((v) => (
          <text key={v} className="rchart__tick" x={sx(v)} y={height - PAD.b + 15} textAnchor="middle">{fmt(v)}</text>
        ))}
        {points.map((p) => (
          <g key={p.id} className="cochart__point" role="button" tabIndex={0} aria-label={p.title} aria-pressed={selected.includes(p.id)} onClick={() => onPick(p.id)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onPick(p.id)}>
            <title>{p.title}</title>
            {mark(p)}
            {selected.includes(p.id) && <circle cx={sx(p.x)} cy={sy(p.y)} r={9} className="cochart__selected" />}
            {selected.includes(p.id) && (
              <text className="cochart__pick" x={sx(p.x) + 10} y={sy(p.y) - 8}>
                {selected.indexOf(p.id) === 0 ? '1' : '2'}
              </text>
            )}
          </g>
        ))}
        <text className="rchart__axislabel" x={(PAD.l + W - PAD.r) / 2} y={height - 5} textAnchor="middle">{xLabel}</text>
        <text className="rchart__axislabel" transform={`translate(13 ${(PAD.t + height - PAD.b) / 2}) rotate(-90)`} textAnchor="middle">{yLabel}</text>
      </svg>
    </figure>
  );
}

export function SequenceStrip({ items, label, onPick, selected }: { items: { id: string; label: string | null; posterior: number; session: number; color: string; title: string }[]; label: string; onPick: (id: string) => void; selected: readonly string[] }): ReactNode {
  return (
    <div className="costrip" role="list" aria-label={label}>
      {items.map((it, i) => (
        <button
          key={it.id}
          type="button"
          role="listitem"
          className={`costrip__cell${i > 0 && items[i - 1]!.session !== it.session ? ' is-newsession' : ''}${selected.includes(it.id) ? ' is-selected' : ''}`}
          style={{ background: it.color, opacity: it.label ? 0.35 + 0.65 * Math.max(0, Math.min(1, it.posterior)) : 0.5 }}
          title={it.title}
          aria-label={it.title}
          onClick={() => onPick(it.id)}
        >
          {it.label ?? '?'}
        </button>
      ))}
    </div>
  );
}
