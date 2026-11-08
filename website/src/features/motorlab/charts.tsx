// Charts of the motor-learning lab. One y-axis per chart, real units on every axis, every mark from stored data or
// from a named model output. Observed values are ink, model estimates blue (--info), predictions / hypothetical
// scenarios orange (--right) and dashed; excluded sessions are hollow. Hover shows every layer at the nearest
// session; a table view lists the same numbers (no value is reachable only by hovering).

import { useId, useMemo, useState, type ReactNode } from 'react';

export interface TrajectoryPoint {
  /** x in days since the first included session. */
  x: number;
  reps: number[];
  mean: number;
  lo: number;
  hi: number;
  included: boolean;
  label: string;
  /** Tooltip extra lines (exclusion reasons, dose). */
  notes: string[];
}

export interface TrajectoryProps {
  title: string;
  xLabel: string;
  yLabel: string;
  points: TrajectoryPoint[];
  model?: { t: number; mean: number; lo: number; hi: number }[];
  modelName?: string;
  forecast?: { t: number; mean: number; lo: number; hi: number }[];
  forecastName?: string;
  scenarios?: { name: string; t: number[]; mid: number[]; lo: number[]; hi: number[] }[];
  legend: { observed: string; reps: string; excluded: string };
  empty: string;
  fmt: (v: number) => string;
  height?: number;
}

const W = 720;
const PAD = { l: 56, r: 18, t: 16, b: 42 };

function ticks(lo: number, hi: number, n = 5): number[] {
  const span = hi - lo || 1;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

function scales(xs: number[], ys: number[], height: number) {
  let [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  let [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  if (x0 === x1) [x0, x1] = [x0 - 1, x1 + 1];
  if (y0 === y1) [y0, y1] = [y0 - 1, y1 + 1];
  const px = (x1 - x0) * 0.04;
  const py = (y1 - y0) * 0.08;
  x0 -= px;
  x1 += px;
  y0 -= py;
  y1 += py;
  const sx = (x: number) => PAD.l + ((x - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
  const sy = (y: number) => height - PAD.b - ((y - y0) / (y1 - y0)) * (height - PAD.t - PAD.b);
  return { x0, x1, y0, y1, sx, sy };
}

const path = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
const area = (top: [number, number][], bottom: [number, number][]) => `${path(top)}L${[...bottom].reverse().map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}Z`;

export function TrajectoryChart(p: TrajectoryProps): ReactNode {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const height = p.height ?? 300;
  const geo = useMemo(() => {
    if (!p.points.length) return null;
    const xs = [...p.points.map((q) => q.x), ...(p.forecast ?? []).map((f) => f.t), ...(p.scenarios ?? []).flatMap((s) => s.t)];
    const ys = [
      ...p.points.flatMap((q) => [...q.reps, q.lo, q.hi].filter(Number.isFinite)),
      ...(p.model ?? []).flatMap((m) => [m.lo, m.hi]),
      ...(p.forecast ?? []).flatMap((f) => [f.lo, f.hi]),
      ...(p.scenarios ?? []).flatMap((s) => [...s.lo, ...s.hi]),
    ].filter(Number.isFinite);
    return scales(xs, ys, height);
  }, [p.points, p.model, p.forecast, p.scenarios, height]);
  if (!geo)
    return (
      <figure className="rchart">
        <figcaption className="rchart__title">{p.title}</figcaption>
        <div className="rchart__empty">{p.empty}</div>
      </figure>
    );
  const { sx, sy, x0, x1, y0, y1 } = geo;
  const xt = ticks(x0, x1, 6);
  const yt = ticks(y0, y1, 5);
  const targets = [...p.points.map((q, i) => ({ x: q.x, i, kind: 'obs' as const })), ...(p.forecast ?? []).map((f, i) => ({ x: f.t, i, kind: 'fc' as const }))];
  const nearest = (px: number) => {
    let best = 0;
    let bd = Infinity;
    targets.forEach((t, k) => {
      const d = Math.abs(sx(t.x) - px);
      if (d < bd) {
        bd = d;
        best = k;
      }
    });
    return best;
  };
  const h = hover !== null ? targets[hover] : null;
  const modelAt = (x: number) => {
    if (!p.model?.length) return null;
    let best = p.model[0]!;
    for (const m of p.model) if (Math.abs(m.t - x) < Math.abs(best.t - x)) best = m;
    return best;
  };
  return (
    <figure className="rchart mlchart">
      <figcaption className="rchart__title">{p.title}</figcaption>
      <div className="mlchart__legend" aria-hidden>
        <span><i className="mlkey mlkey--dot" />{p.legend.observed}</span>
        <span><i className="mlkey mlkey--rep" />{p.legend.reps}</span>
        <span><i className="mlkey mlkey--hollow" />{p.legend.excluded}</span>
        {p.model?.length ? <span><i className="mlkey mlkey--model" />{p.modelName}</span> : null}
        {p.forecast?.length ? <span><i className="mlkey mlkey--forecast" />{p.forecastName}</span> : null}
        {(p.scenarios ?? []).map((s, i) => (
          <span key={s.name}><i className={`mlkey mlkey--scenario${i ? ' is-alt' : ''}`} />{s.name}</span>
        ))}
      </div>
      <svg
        className="rchart__svg"
        viewBox={`0 0 ${W} ${height}`}
        role="img"
        aria-labelledby={`${id}-d`}
        onPointerMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          setHover(nearest(((e.clientX - r.left) / r.width) * W));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <desc id={`${id}-d`}>{p.title}</desc>
        {yt.map((v) => (
          <g key={`y${v}`}>
            <line className="rchart__grid" x1={PAD.l} x2={W - PAD.r} y1={sy(v)} y2={sy(v)} />
            <text className="rchart__tick" x={PAD.l - 6} y={sy(v) + 4} textAnchor="end">{p.fmt(v)}</text>
          </g>
        ))}
        {xt.map((v) => (
          <text key={`x${v}`} className="rchart__tick" x={sx(v)} y={height - PAD.b + 16} textAnchor="middle">{v}</text>
        ))}
        <line className="rchart__axis" x1={PAD.l} x2={W - PAD.r} y1={height - PAD.b} y2={height - PAD.b} />
        <text className="rchart__axislabel" x={(PAD.l + W - PAD.r) / 2} y={height - 6} textAnchor="middle">{p.xLabel}</text>
        <text className="rchart__axislabel" transform={`translate(14 ${(PAD.t + height - PAD.b) / 2}) rotate(-90)`} textAnchor="middle">{p.yLabel}</text>
        {p.model && p.model.length > 1 && (
          <>
            <path className="mlband" d={area(p.model.map((m) => [sx(m.t), sy(m.hi)]), p.model.map((m) => [sx(m.t), sy(m.lo)]))} />
            <path className="mlline" d={path(p.model.map((m) => [sx(m.t), sy(m.mean)]))} />
          </>
        )}
        {(p.scenarios ?? []).map((s, si) => {
          const last = p.points.filter((q) => q.included).at(-1);
          const head: [number, number][] = last ? [[sx(last.x), sy(last.mean)]] : [];
          return (
            <g key={s.name}>
              <path className={`mlband mlband--scenario${si ? ' is-alt' : ''}`} d={area(s.t.map((t, i) => [sx(t), sy(s.hi[i] as number)]), s.t.map((t, i) => [sx(t), sy(s.lo[i] as number)]))} />
              <path className={`mlline mlline--scenario${si ? ' is-alt' : ''}`} d={path([...head, ...s.t.map((t, i): [number, number] => [sx(t), sy(s.mid[i] as number)])])} />
            </g>
          );
        })}
        {p.points.map((q, i) => (
          <g key={`p${i}`} opacity={hover !== null && h?.kind === 'obs' && h.i !== i ? 0.55 : 1}>
            {q.reps.map((v, k) => (
              <circle key={k} className="mlrep" cx={sx(q.x) + (k - (q.reps.length - 1) / 2) * 3} cy={sy(v)} r={2.2} />
            ))}
            {Number.isFinite(q.lo) && Number.isFinite(q.hi) && <line className={q.included ? 'mlci' : 'mlci is-excluded'} x1={sx(q.x)} x2={sx(q.x)} y1={sy(q.lo)} y2={sy(q.hi)} />}
            <circle className={q.included ? 'mlmean' : 'mlmean is-excluded'} cx={sx(q.x)} cy={sy(q.mean)} r={4.5} />
          </g>
        ))}
        {(p.forecast ?? []).map((f, i) => (
          <g key={`f${i}`}>
            <line className="mlci mlci--forecast" x1={sx(f.t)} x2={sx(f.t)} y1={sy(f.lo)} y2={sy(f.hi)} />
            <rect className="mlforecast" x={sx(f.t) - 4} y={sy(f.mean) - 4} width={8} height={8} rx={1.5} />
          </g>
        ))}
        {h && <line className="mlcross" x1={sx(h.x)} x2={sx(h.x)} y1={PAD.t} y2={height - PAD.b} />}
      </svg>
      {h && (
        <div className="mltip" role="status" style={{ left: `${(sx(h.x) / W) * 100}%` }}>
          {h.kind === 'obs' ? (
            <>
              <strong>{p.fmt(p.points[h.i]!.mean)}</strong> <span>{p.points[h.i]!.label}</span>
              <div className="mltip__sub">{p.points[h.i]!.reps.map(p.fmt).join(' · ')}</div>
              {(() => {
                const m = modelAt(p.points[h.i]!.x);
                return m ? <div className="mltip__sub"><i className="mlkey mlkey--model" />{p.modelName}: {p.fmt(m.mean)}</div> : null;
              })()}
              {p.points[h.i]!.notes.map((n) => (
                <div key={n} className="mltip__sub">{n}</div>
              ))}
            </>
          ) : (
            <>
              <strong>{p.fmt(p.forecast![h.i]!.mean)}</strong> <span>{p.forecastName}</span>
              <div className="mltip__sub">[{p.fmt(p.forecast![h.i]!.lo)}; {p.fmt(p.forecast![h.i]!.hi)}]</div>
            </>
          )}
        </div>
      )}
    </figure>
  );
}

/** Standardised residuals per session with ±2 reference lines. */
export function ResidualChart({ title, xLabel, values, labels, empty }: { title: string; xLabel: string; values: number[]; labels: string[]; empty: string }): ReactNode {
  const height = 170;
  if (!values.length)
    return (
      <figure className="rchart">
        <figcaption className="rchart__title">{title}</figcaption>
        <div className="rchart__empty">{empty}</div>
      </figure>
    );
  const lim = Math.max(3, ...values.map((v) => Math.abs(v)));
  const sx = (i: number) => PAD.l + ((i + 0.5) / values.length) * (W - PAD.l - PAD.r);
  const sy = (y: number) => PAD.t + ((lim - y) / (2 * lim)) * (height - PAD.t - PAD.b);
  return (
    <figure className="rchart">
      <figcaption className="rchart__title">{title}</figcaption>
      <svg className="rchart__svg" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={title}>
        {[-2, 0, 2].map((v) => (
          <g key={v}>
            <line className={v === 0 ? 'rchart__axis' : 'rchart__rule is-dashed'} x1={PAD.l} x2={W - PAD.r} y1={sy(v)} y2={sy(v)} />
            <text className="rchart__tick" x={PAD.l - 6} y={sy(v) + 4} textAnchor="end">{v}</text>
          </g>
        ))}
        {values.map((v, i) => (
          <g key={i}>
            <line className="mlci" x1={sx(i)} x2={sx(i)} y1={sy(0)} y2={sy(v)} />
            <circle className={Math.abs(v) > 2 ? 'mlmean is-flag' : 'mlmean'} cx={sx(i)} cy={sy(v)} r={4}>
              <title>{`${labels[i] ?? ''}: ${v.toFixed(2)}`}</title>
            </circle>
          </g>
        ))}
        <text className="rchart__axislabel" x={(PAD.l + W - PAD.r) / 2} y={height - 8} textAnchor="middle">{xLabel}</text>
      </svg>
    </figure>
  );
}

/** One signal over time (one axis) with shaded event spans and a threshold line. */
export function SignalChart({
  title,
  yLabel,
  xLabel,
  t,
  y,
  spans,
  threshold,
  window,
  fmt,
}: {
  title: string;
  yLabel: string;
  xLabel: string;
  t: number[];
  y: number[];
  spans: { a: number; b: number; kind: 'raise' | 'lower' | 'other'; incomplete: boolean }[];
  threshold?: number;
  window: [number, number];
  fmt: (v: number) => string;
}): ReactNode {
  const height = 200;
  const [w0, w1] = window;
  // Decimate for drawing only (≤ 1500 points); the analysis uses every sample
  const idx: number[] = [];
  for (let i = 0; i < t.length; i++) if ((t[i] as number) >= w0 && (t[i] as number) <= w1) idx.push(i);
  const stride = Math.max(1, Math.ceil(idx.length / 1500));
  const pts = idx.filter((_, k) => k % stride === 0).filter((i) => Number.isFinite(y[i] as number));
  if (pts.length < 2)
    return (
      <figure className="rchart">
        <figcaption className="rchart__title">{title}</figcaption>
        <div className="rchart__empty">—</div>
      </figure>
    );
  const ys = pts.map((i) => y[i] as number);
  const { sx, sy, y0, y1 } = scales([w0, w1], [...ys, ...(threshold !== undefined ? [threshold] : [])], height);
  const yt = ticks(y0, y1, 4);
  const xt = ticks(w0, w1, 8);
  return (
    <figure className="rchart">
      <figcaption className="rchart__title">{title}</figcaption>
      <svg className="rchart__svg" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={title}>
        {spans
          .filter((s) => s.b >= w0 && s.a <= w1)
          .map((s, i) => (
            <rect key={i} className={`mlspan mlspan--${s.kind}${s.incomplete ? ' is-incomplete' : ''}`} x={sx(Math.max(w0, s.a))} y={PAD.t} width={Math.max(1, sx(Math.min(w1, s.b)) - sx(Math.max(w0, s.a)))} height={height - PAD.t - PAD.b} />
          ))}
        {yt.map((v) => (
          <g key={v}>
            <line className="rchart__grid" x1={PAD.l} x2={W - PAD.r} y1={sy(v)} y2={sy(v)} />
            <text className="rchart__tick" x={PAD.l - 6} y={sy(v) + 4} textAnchor="end">{fmt(v)}</text>
          </g>
        ))}
        {xt.map((v) => (
          <text key={v} className="rchart__tick" x={sx(v)} y={height - PAD.b + 16} textAnchor="middle">{v}</text>
        ))}
        {threshold !== undefined && <line className="rchart__rule is-dashed" x1={PAD.l} x2={W - PAD.r} y1={sy(threshold)} y2={sy(threshold)} />}
        <path className="mlsignal" d={path(pts.map((i) => [sx(t[i] as number), sy(y[i] as number)]))} />
        <text className="rchart__axislabel" x={(PAD.l + W - PAD.r) / 2} y={height - 6} textAnchor="middle">{xLabel}</text>
        <text className="rchart__axislabel" transform={`translate(14 ${(PAD.t + height - PAD.b) / 2}) rotate(-90)`} textAnchor="middle">{yLabel}</text>
      </svg>
    </figure>
  );
}
