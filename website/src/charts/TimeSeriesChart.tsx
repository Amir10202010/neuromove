// Динамика во времени: линии сторон, точки сеансов, цель пунктиром.
// Наведение (и стрелки с клавиатуры) — перекрестие по ближайшему сеансу
// и подсказка со значениями всех линий.

import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useWidth } from '../hooks/useSize';
import { useI18n } from '../i18n';
import { linear, niceDomain, niceTicks, timeTicks } from './scale';

export interface TsPoint {
  t: number;
  v: number;
  id?: string;
}

export interface TsSeries {
  id: string;
  label: string;
  color: string;
  points: TsPoint[];
  /** Второстепенная линия — тоньше и светлее (контекст, а не главное). */
  muted?: boolean;
}

interface Props {
  series: TsSeries[];
  height?: number;
  unit?: string;
  digits?: number;
  goal?: { value: number; label: string } | null;
  yDomain?: [number, number];
  ariaLabel: string;
  onPointClick?: (seriesId: string, p: TsPoint) => void;
  /** Подпись у последней точки: значение или имя ряда (для графиков с выделением одного ряда). */
  endLabels?: boolean;
  endLabelMode?: 'value' | 'label';
  /** Ось X не по датам (например, недели курса): подписи и деления задаёт вызывающий. */
  xFormat?: (x: number) => string;
  /** Подпись деления оси X — короче, чем в подсказке (например, «4» вместо «Неделя 4»). */
  xTickFormat?: (x: number) => string;
  xTicks?: number[];
  xPad?: number;
}

const M = { top: 14, right: 52, bottom: 28, left: 40 };

export function TimeSeriesChart({
  series,
  height = 240,
  unit = '°',
  digits = 0,
  goal,
  yDomain,
  ariaLabel,
  onPointClick,
  endLabels = true,
  endLabelMode = 'value',
  xFormat,
  xTickFormat,
  xTicks: xTicksProp,
  xPad,
}: Props) {
  const { f } = useI18n();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const all = useMemo(() => series.flatMap((s) => s.points), [series]);
  const times = useMemo(() => [...new Set(all.map((p) => p.t))].sort((a, b) => a - b), [all]);

  if (!all.length) return <div ref={ref} style={{ height }} />;

  const innerW = Math.max(60, width - M.left - M.right);
  const innerH = height - M.top - M.bottom;
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const padT = xPad ?? Math.max(86400000 * 0.8, (tMax - tMin) * 0.04);
  const x = linear([tMin - padT, tMax + padT], [M.left, M.left + innerW]);
  const dom = yDomain ?? niceDomain(all.map((p) => p.v), 0.12, 4, goal ? [goal.value] : []);
  const y = linear(dom, [M.top + innerH, M.top]);
  const yTicks = niceTicks(dom[0], dom[1], 4);
  const xTicks = xTicksProp ?? timeTicks(tMin - padT, tMax + padT, Math.max(2, Math.floor(innerW / 90)));
  const fmtX = (v: number) => (xTickFormat ? xTickFormat(v) : xFormat ? xFormat(v) : f.dateShort(new Date(v)));
  const fmt = (v: number) => (unit === '°' ? f.deg(v, digits) : unit === '%' ? f.pct(v, digits) : f.num(v, digits));

  const hoverT = hover !== null ? times[hover] : undefined;

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    let bd = Infinity;
    times.forEach((t, i) => {
      const d = Math.abs(x(t) - px);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    setHover(best);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') setHover((h) => (h === null ? 0 : Math.min(times.length - 1, h + 1)));
    else if (e.key === 'ArrowLeft') setHover((h) => (h === null ? times.length - 1 : Math.max(0, h - 1)));
    else if (e.key === 'Escape') setHover(null);
    else return;
    e.preventDefault();
  };

  // Подписи на концах линий: если две рядом — разводим по вертикали
  const ends = series
    .filter((s) => s.points.length)
    .map((s) => {
      const p = s.points[s.points.length - 1] as TsPoint;
      return { s, p, yy: y(p.v) };
    })
    .sort((a, b) => a.yy - b.yy);
  for (let i = 1; i < ends.length; i++) {
    const prev = ends[i - 1] as (typeof ends)[number];
    const cur = ends[i] as (typeof ends)[number];
    if (cur.yy - prev.yy < 14) cur.yy = prev.yy + 14;
  }

  const tipX = hoverT !== undefined ? x(hoverT) : 0;
  const tipLeft = tipX > width - 190;

  return (
    <div ref={ref} className="chart" style={{ position: 'relative' }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
        className="chart__svg"
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={M.left} x2={M.left + innerW} y1={y(v)} y2={y(v)} className="chart__grid" />
            <text x={M.left - 8} y={y(v)} dy="0.32em" textAnchor="end" className="chart__tick">
              {fmt(v)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={x(t)} y={M.top + innerH + 18} textAnchor="middle" className="chart__tick">
            {fmtX(t)}
          </text>
        ))}

        {goal && (
          <g>
            <line x1={M.left} x2={M.left + innerW} y1={y(goal.value)} y2={y(goal.value)} className="chart__goal" />
            <text x={M.left + innerW} y={y(goal.value) - 6} textAnchor="end" className="chart__goal-label">
              {goal.label}
            </text>
          </g>
        )}

        {series.map((s) => (
          <g key={s.id} className={s.muted ? 'chart__series chart__series--muted' : 'chart__series'}>
            <path
              d={s.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('')}
              fill="none"
              stroke={s.color}
              strokeWidth={s.muted ? 1.5 : 2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {s.points.map((p) => (
              <circle
                key={p.t}
                cx={x(p.t)}
                cy={y(p.v)}
                r={hoverT === p.t ? 5 : 3.5}
                fill={s.color}
                stroke="var(--surface)"
                strokeWidth={2}
                style={{ cursor: onPointClick ? 'pointer' : undefined }}
                onClick={onPointClick ? () => onPointClick(s.id, p) : undefined}
              />
            ))}
          </g>
        ))}

        {endLabels &&
          ends.map(({ s, p, yy }) => (
            <text key={s.id} x={x(p.t) + 9} y={yy} dy="0.32em" className={`chart__end-label${s.muted ? ' chart__end-label--muted' : ''}`}>
              {endLabelMode === 'label' ? s.label : fmt(p.v)}
            </text>
          ))}

        {hoverT !== undefined && <line x1={tipX} x2={tipX} y1={M.top} y2={M.top + innerH} className="chart__crosshair" />}

        <rect
          x={M.left}
          y={M.top}
          width={innerW}
          height={innerH}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          onClick={() => {
            if (!onPointClick || hoverT === undefined) return;
            for (const s of series) {
              const p = s.points.find((q) => q.t === hoverT);
              if (p) {
                onPointClick(s.id, p);
                break;
              }
            }
          }}
          style={{ cursor: onPointClick ? 'pointer' : 'crosshair' }}
        />
      </svg>

      {hoverT !== undefined && (
        <div
          className="chart__tooltip"
          style={{ left: tipLeft ? undefined : tipX + 12, right: tipLeft ? width - tipX + 12 : undefined, top: M.top }}
          role="status"
        >
          <div className="chart__tooltip-title">{xFormat ? xFormat(hoverT) : f.date(new Date(hoverT))}</div>
          {series.map((s) => {
            const p = s.points.find((q) => q.t === hoverT);
            if (!p) return null;
            return (
              <div key={s.id} className="chart__tooltip-row">
                <span className="chart__tooltip-key" style={{ background: s.color }} />
                <span className="chart__tooltip-value">{fmt(p.v)}</span>
                <span className="chart__tooltip-label">{s.label}</span>
              </div>
            );
          })}
          {goal && (
            <div className="chart__tooltip-row">
              <span className="chart__tooltip-key chart__tooltip-key--goal" />
              <span className="chart__tooltip-value">{fmt(goal.value)}</span>
              <span className="chart__tooltip-label">{goal.label}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
