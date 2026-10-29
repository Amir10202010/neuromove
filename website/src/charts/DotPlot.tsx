// Точки по сеансам с порогом: например, полнота данных и порог 95%.
// Ниже порога — точка в цвете состояния «внимание» и с обводкой, а в подсказке — пациент и значение.

import { useWidth } from '../hooks/useSize';
import { useI18n } from '../i18n';
import { linear, niceDomain, niceTicks, timeTicks } from './scale';

export interface Dot {
  id: string;
  t: number;
  v: number;
  title: string;
  onClick?: () => void;
}

export function DotPlot({ dots, threshold, thresholdLabel, height = 170, unit = '%', ariaLabel }: { dots: Dot[]; threshold: number; thresholdLabel: string; height?: number; unit?: string; ariaLabel: string }) {
  const { f } = useI18n();
  const [ref, width] = useWidth<HTMLDivElement>();
  if (!dots.length) return <div ref={ref} style={{ height }} />;
  const M = { top: 12, right: 16, bottom: 26, left: 40 };
  const ts = dots.map((d) => d.t);
  const t0 = Math.min(...ts) - 86400000;
  const t1 = Math.max(...ts) + 86400000;
  const x = linear([t0, t1], [M.left, width - M.right]);
  const dom = niceDomain([...dots.map((d) => d.v), threshold], 0.05, 3);
  const y = linear([dom[0], Math.min(100, Math.max(dom[1], threshold + 1))], [height - M.bottom, M.top]);
  const fmt = (v: number) => (unit === '%' ? f.pct(v) : f.num(v));
  return (
    <div ref={ref} className="chart">
      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        {niceTicks(y.domain[0], y.domain[1], 3).map((v) => (
          <g key={v}>
            <line x1={M.left} x2={width - M.right} y1={y(v)} y2={y(v)} className="chart__grid" />
            <text x={M.left - 6} y={y(v)} dy="0.32em" textAnchor="end" className="chart__tick">
              {fmt(v)}
            </text>
          </g>
        ))}
        {timeTicks(t0, t1, Math.max(2, Math.floor(width / 110))).map((t) => (
          <text key={t} x={x(t)} y={height - 8} textAnchor="middle" className="chart__tick">
            {f.dateShort(new Date(t))}
          </text>
        ))}
        <line x1={M.left} x2={width - M.right} y1={y(threshold)} y2={y(threshold)} className="chart__goal" />
        <text x={width - M.right} y={y(threshold) + 14} textAnchor="end" className="chart__goal-label">
          {thresholdLabel}
        </text>
        {dots.map((d) => {
          const low = d.v < threshold;
          return (
            <g key={d.id} onClick={d.onClick} style={{ cursor: d.onClick ? 'pointer' : undefined }}>
              <circle cx={x(d.t)} cy={y(d.v)} r={12} fill="transparent" />
              <circle cx={x(d.t)} cy={y(d.v)} r={low ? 5.5 : 4} fill={low ? 'var(--critical)' : 'var(--brand-500)'} stroke="var(--surface)" strokeWidth={2} />
              <title>{d.title}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
