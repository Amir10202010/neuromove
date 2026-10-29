// Калибровка: ребёнок сидит прямо, руки вдоль тела, три секунды не двигается.
// Вокруг — шкала из 60 рисок, как безель часов: риски заполняются за три секунды —
// видно, сколько осталось. Отвесная линия — «сидим прямо». Пошевелился — риски желтеют,
// фигура вздрагивает, шкала начинает заново: причина и следствие на глазах.

import { frontParts, type FrontPodKey } from './body';
import { FIG, Hair, InkLayer, SensorPod, type PodState } from './Ink';

const TICKS = 60;

export function CalibrationFigure({
  progress,
  moved,
  pods,
  size = 260,
  attempt = 0,
}: {
  /** 0…1 — доля трёх секунд неподвижности. */
  progress: number;
  /** Пациент пошевелился — калибровка повторяется. */
  moved: boolean;
  /** Какие датчики показать и в каком состоянии; по умолчанию все на связи. */
  pods?: Partial<Record<FrontPodKey, PodState>>;
  size?: number;
  /** Номер попытки: при каждой новой фигура вздрагивает заново. */
  attempt?: number;
}) {
  const center = { x: 132, y: 178 };
  const p = frontParts(center, { right: { upper: 4, fore: 6 }, left: { upper: 4, fore: 6 } }, { legs: true });
  const o = { x: 132, y: 142 };
  const R = 128;
  const done = Math.round(Math.max(0, Math.min(1, progress)) * TICKS);
  const states: Record<FrontPodKey, PodState> = { trunk: 'on', upper_r: 'on', upper_l: 'on', fore_r: 'on', fore_l: 'on', ...pods };
  return (
    <svg viewBox={`0 6 264 272`} width={size} height={Math.round((size * 272) / 264)} className={`calib${moved ? ' is-moved' : ''}${progress >= 1 ? ' is-done' : ''}`} aria-hidden>
      {Array.from({ length: TICKS }, (_, i) => {
        const a = (i / TICKS) * 2 * Math.PI;
        const major = i % 5 === 0;
        const r0 = R - (major ? 9 : 6);
        const x0 = o.x + r0 * Math.sin(a);
        const y0 = o.y - r0 * Math.cos(a);
        const x1 = o.x + R * Math.sin(a);
        const y1 = o.y - R * Math.cos(a);
        return (
          <line
            key={i}
            x1={x0.toFixed(1)}
            y1={y0.toFixed(1)}
            x2={x1.toFixed(1)}
            y2={y1.toFixed(1)}
            className={i < done ? 'calib__tick is-on' : 'calib__tick'}
            strokeWidth={major ? 2 : 1.4}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      {/* Отвесная линия — «сидим прямо» */}
      <Hair d={`M${o.x},${o.y - R + 16}L${o.x},${center.y + 74}`} color={FIG.muted} dash="2 4" />
      <g key={attempt} className="calib__body">
        <InkLayer d={p.stool} />
        <InkLayer d={p.body} />
        <InkLayer d={p.arms.right} />
        <InkLayer d={p.arms.left} />
        {(Object.keys(p.pods) as FrontPodKey[]).map((k) => {
          const q = p.pods[k];
          return <SensorPod key={k} d={q.d} strap={q.strap} c={q.c} state={states[k]} ledR={2} pulseR={13} />;
        })}
      </g>
    </svg>
  );
}
