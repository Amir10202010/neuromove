// «Было → стало» по каждому пациенту: светлая точка — начало курса, тёмная — сейчас.

import { useWidth } from '../hooks/useSize';
import { useI18n } from '../i18n';
import { linear, niceDomain, niceTicks } from './scale';

export interface DumbbellRow {
  id: string;
  label: string;
  from: number;
  to: number;
  onClick?: () => void;
}

export function Dumbbell({ rows, unit = '°', digits = 0, better = 'up', ariaLabel, domain }: { rows: DumbbellRow[]; unit?: '°' | '%' | ''; digits?: number; better?: 'up' | 'down'; ariaLabel: string; domain?: [number, number] }) {
  const { f, t } = useI18n();
  const [ref, width] = useWidth<HTMLDivElement>();
  const fmt = (v: number) => (unit === '°' ? f.deg(v, digits) : unit === '%' ? f.pct(v, digits) : f.num(v, digits));
  const dom = domain ?? niceDomain(rows.flatMap((r) => [r.from, r.to]), 0.08, 4);
  const labelW = 64;
  const x = linear(dom, [labelW + 8, width - 64]);
  const rowH = 34;
  const height = rows.length * rowH + 26;
  return (
    <div ref={ref} className="chart">
      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        {niceTicks(dom[0], dom[1], Math.max(2, Math.floor((width - 136) / 64))).map((v) => (
          <g key={v}>
            <line x1={x(v)} x2={x(v)} y1={0} y2={height - 22} className="chart__grid" />
            <text x={x(v)} y={height - 6} textAnchor="middle" className="chart__tick">
              {fmt(v)}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const yy = i * rowH + rowH / 2;
          const up = r.to >= r.from;
          const good = better === 'up' ? up : !up;
          return (
            <g key={r.id} onClick={r.onClick} style={{ cursor: r.onClick ? 'pointer' : undefined }} className="dumbbell-row">
              <title>{`${r.label}: ${t('analytics.baseline')} ${fmt(r.from)} → ${t('analytics.latest')} ${fmt(r.to)}`}</title>
              <rect x={0} y={yy - rowH / 2} width={width} height={rowH} fill="transparent" />
              <text x={0} y={yy} dy="0.32em" className="chart__row-label">
                {r.label}
              </text>
              <line x1={x(r.from)} x2={x(r.to)} y1={yy} y2={yy} stroke={good ? 'var(--brand-200)' : '#f3c9c9'} strokeWidth={4} strokeLinecap="round" />
              <circle cx={x(r.from)} cy={yy} r={5} fill="var(--muted-series)" stroke="var(--surface)" strokeWidth={2} />
              <circle cx={x(r.to)} cy={yy} r={6} fill="var(--brand-700)" stroke="var(--surface)" strokeWidth={2} />
              <text x={Math.max(x(r.from), x(r.to)) + 10} y={yy} dy="0.32em" className="chart__value">
                {fmt(r.to)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
