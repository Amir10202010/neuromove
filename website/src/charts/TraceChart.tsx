// Запись угла одного шага в отчёте: кривая, пики повторов с подписями.

import { useWidth } from '../hooks/useSize';
import { useI18n } from '../i18n';
import type { RepMetrics } from '../core/metrics';
import type { StepTrace } from '../session/types';
import { linear, niceTicks } from './scale';

export function TraceChart({ trace, reps, color, range, height = 150, ariaLabel }: { trace: StepTrace; reps: RepMetrics[]; color: string; range: [number, number]; height?: number; ariaLabel: string }) {
  const { f, t } = useI18n();
  const [ref, width] = useWidth<HTMLDivElement>();
  if (trace.t.length < 2) return <div ref={ref} className="muted" style={{ height }}>{t('common.noData')}</div>;
  const M = { top: 18, right: 12, bottom: 22, left: 38 };
  const t0 = trace.t[0] as number;
  const t1 = trace.t[trace.t.length - 1] as number;
  const x = linear([t0, t1], [M.left, width - M.right]);
  const y = linear(range, [height - M.bottom, M.top]);
  const d = trace.t.map((tt, i) => `${i ? 'L' : 'M'}${x(tt).toFixed(1)},${y(Math.max(range[0], Math.min(range[1], trace.angle[i] as number))).toFixed(1)}`).join('');
  return (
    <div ref={ref} className="chart">
      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        {niceTicks(range[0], range[1], 5)
          .map((v) => (
            <g key={v}>
              <line x1={M.left} x2={width - M.right} y1={y(v)} y2={y(v)} className="chart__grid" />
              <text x={M.left - 6} y={y(v)} dy="0.32em" textAnchor="end" className="chart__tick">
                {v}°
              </text>
            </g>
          ))}
        {reps.map((r) => (
          <rect key={r.index} x={x(r.tStart)} y={M.top} width={Math.max(1, x(r.tEnd) - x(r.tStart))} height={height - M.top - M.bottom} fill={color} opacity={0.07} rx={3} />
        ))}
        <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {reps.map((r) => {
          // Пик повтора — ищем точку записи с максимальным углом в окне повтора
          let best = -Infinity;
          let bt = r.tStart;
          trace.t.forEach((tt, i) => {
            if (tt >= r.tStart && tt <= r.tEnd && (trace.angle[i] as number) > best) {
              best = trace.angle[i] as number;
              bt = tt;
            }
          });
          if (!Number.isFinite(best)) return null;
          return (
            <g key={`p${r.index}`}>
              <circle cx={x(bt)} cy={y(Math.min(range[1], best))} r={3.5} fill={color} stroke="var(--surface)" strokeWidth={2} />
              <text x={x(bt)} y={y(Math.min(range[1], best)) - 8} textAnchor="middle" className="chart__value chart__value--sm">
                {f.deg(r.rom)}
              </text>
            </g>
          );
        })}
        <text x={width - M.right} y={height - 6} textAnchor="end" className="chart__tick">
          {f.num(t1 - t0, 0)} {t('common.sec')}
        </text>
      </svg>
    </div>
  );
}
