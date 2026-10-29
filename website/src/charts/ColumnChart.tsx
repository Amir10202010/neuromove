// Столбцы по неделям: число сеансов. Столбец не шире 24 px, скругление только сверху.

import { useState } from 'react';
import { useWidth } from '../hooks/useSize';
import { linear, niceTicks } from './scale';

export interface Column {
  id: string;
  label: string;
  value: number;
  title: string;
}

export function ColumnChart({ columns, height = 180, ariaLabel }: { columns: Column[]; height?: number; ariaLabel: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const M = { top: 18, bottom: 26, left: 28, right: 8 };
  const maxV = Math.max(1, ...columns.map((c) => c.value));
  const top = niceTicks(0, maxV, 3).at(-1) ?? maxV;
  const y = linear([0, Math.max(top, maxV)], [height - M.bottom, M.top]);
  const slot = (width - M.left - M.right) / Math.max(1, columns.length);
  const bw = Math.min(24, slot * 0.6);
  return (
    <div ref={ref} className="chart">
      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        {niceTicks(0, Math.max(top, maxV), 3).map((v) => (
          <g key={v}>
            <line x1={M.left} x2={width - M.right} y1={y(v)} y2={y(v)} className="chart__grid" />
            <text x={M.left - 6} y={y(v)} dy="0.32em" textAnchor="end" className="chart__tick">
              {v}
            </text>
          </g>
        ))}
        {columns.map((c, i) => {
          const cx = M.left + slot * i + slot / 2;
          const h = y(0) - y(c.value);
          const r = Math.min(4, h / 2, bw / 2);
          const x0 = cx - bw / 2;
          const y0 = y(c.value);
          const d = h > 0 ? `M${x0},${y(0)}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + bw - r}Q${x0 + bw},${y0} ${x0 + bw},${y0 + r}V${y(0)}Z` : '';
          const showLabel = i % Math.ceil(columns.length / Math.max(1, Math.floor(width / 56))) === 0;
          return (
            <g key={c.id} onPointerEnter={() => setHover(c.id)} onPointerLeave={() => setHover(null)}>
              <rect x={cx - slot / 2} y={M.top} width={slot} height={height - M.top - M.bottom} fill="transparent" />
              {d && <path d={d} fill={hover === c.id ? 'var(--brand-600)' : 'var(--brand-500)'} />}
              {c.value > 0 && (
                <text x={cx} y={y0 - 5} textAnchor="middle" className="chart__value chart__value--sm">
                  {c.value}
                </text>
              )}
              {showLabel && (
                <text x={cx} y={height - 8} textAnchor="middle" className="chart__tick">
                  {c.label}
                </text>
              )}
              <title>{c.title}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
