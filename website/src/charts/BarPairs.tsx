// Объём движения по сторонам: для каждого движения — пара горизонтальных полос Л и П.
// Отметка на полосе — значение прошлого сеанса. Подписи — цветом текста, у конца полосы.

import { useWidth } from '../hooks/useSize';
import { useI18n } from '../i18n';
import { linear } from './scale';

export interface BarPairRow {
  id: string;
  label: string;
  left: number | null;
  right: number | null;
  prevLeft?: number | null;
  prevRight?: number | null;
  affected?: 'left' | 'right' | 'both' | 'none';
}

const BAR = 12;
const GAP = 3;

export function BarPairs({ rows, max = 180, ariaLabel }: { rows: BarPairRow[]; max?: number; ariaLabel: string }) {
  const { f, t } = useI18n();
  const [ref, width] = useWidth<HTMLDivElement>();
  const labelW = width < 480 ? 96 : 160;
  const valueW = 44;
  const x = linear([0, max], [labelW, Math.max(labelW + 40, width - valueW)]);
  const rowH = BAR * 2 + GAP + 22;
  const height = rows.length * rowH + 22;
  const ticks = [0, 30, 60, 90, 120, 150, 180].filter((v) => v <= max);

  const bar = (v: number | null, prev: number | null | undefined, yy: number, color: string, side: string) => {
    if (v === null || !Number.isFinite(v)) {
      return (
        <text x={x(0) + 4} y={yy + BAR / 2} dy="0.32em" className="chart__tick">
          {t('common.noData')}
        </text>
      );
    }
    const w = Math.max(2, x(v) - x(0));
    // Скругление 4 px только у конца полосы, у основания — прямой угол
    const r = Math.min(4, w / 2);
    const x0 = x(0);
    const d = `M${x0},${yy}H${x0 + w - r}Q${x0 + w},${yy} ${x0 + w},${yy + r}V${yy + BAR - r}Q${x0 + w},${yy + BAR} ${x0 + w - r},${yy + BAR}H${x0}Z`;
    return (
      <g>
        <path d={d} fill={color}>
          <title>{`${side}: ${f.deg(v)}`}</title>
        </path>
        {prev !== null && prev !== undefined && Number.isFinite(prev) && (
          <line x1={x(prev)} x2={x(prev)} y1={yy - 2} y2={yy + BAR + 2} className="chart__prev-mark">
            <title>{`${t('run.previous')}: ${f.deg(prev)}`}</title>
          </line>
        )}
        <text x={x0 + w + 6} y={yy + BAR / 2} dy="0.32em" className="chart__value">
          {f.deg(v)}
        </text>
      </g>
    );
  };

  return (
    <div ref={ref} className="chart">
      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={x(v)} x2={x(v)} y1={0} y2={height - 20} className="chart__grid" />
            <text x={x(v)} y={height - 6} textAnchor="middle" className="chart__tick">
              {v}°
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const y0 = i * rowH + 8;
          return (
            <g key={r.id}>
              <text x={0} y={y0 + BAR + GAP / 2} dy="0.32em" className="chart__row-label">
                {r.label}
              </text>
              {bar(r.left, r.prevLeft, y0, 'var(--left)', t('side.left'))}
              {bar(r.right, r.prevRight, y0 + BAR + GAP, 'var(--right)', t('side.right'))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
