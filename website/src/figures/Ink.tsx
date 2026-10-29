// Слои рисунков NeuroMove. Стиль — техническая иллюстрация: одна толщина контура на всех
// рисунках, тело — светлая заливка с контуром тушью, сплошной цвет — только у того, что
// измеряется (рука цветом стороны). Датчик — светлый корпус на тёмном ремешке, как на фото
// концепта; светодиод говорит о состоянии.
//
// Контуры не масштабируются (vector-effect: non-scaling-stroke): 1,5 px на экране и у значка
// 32 px в плане сеанса, и у фигуры на весь планшет. Поэтому рисунки разного размера выглядят
// частями одной системы, а не увеличенными копиями.

import type { Ref } from 'react';

export const FIG = {
  ink: 'var(--fig-ink)',
  fill: 'var(--fig-fill)',
  muted: 'var(--fig-muted)',
  ghost: 'var(--fig-ghost)',
};

/** Толщина контура на экране, px. */
export const OUTLINE = 1.5;
/** Тонкие линии — шкалы, выноски, направляющие, px. */
export const HAIR = 1;

const NS = 'non-scaling-stroke' as const;

/**
 * Слой: все части лежат в одном пути. Сначала — силуэт тушью с обводкой в две толщины,
 * поверх — заливка: снаружи остаётся ровно одна толщина контура, а перекрытия (плечо
 * и предплечье, шея и голова) сливаются в один контур без швов.
 */
export function InkLayer({
  d,
  fill = FIG.fill,
  ink = FIG.ink,
  opacity,
  outlineRef,
  fillRef,
  className,
}: {
  d: string;
  fill?: string;
  ink?: string;
  opacity?: number;
  outlineRef?: Ref<SVGPathElement>;
  fillRef?: Ref<SVGPathElement>;
  className?: string;
}) {
  return (
    <g opacity={opacity} className={className}>
      <path ref={outlineRef} d={d} fill={ink} stroke={ink} strokeWidth={OUTLINE * 2} strokeLinejoin="round" vectorEffect={NS} />
      <path ref={fillRef} d={d} fill={fill} />
    </g>
  );
}

/** Линия без масштабирования толщины: шкалы, направляющие, пунктиры. */
export function Hair({
  d,
  color = FIG.muted,
  width = HAIR,
  dash,
  cap = 'round',
  pathRef,
  className,
  opacity,
}: {
  d: string;
  color?: string;
  width?: number;
  dash?: string;
  cap?: 'round' | 'butt';
  pathRef?: Ref<SVGPathElement>;
  className?: string;
  opacity?: number;
}) {
  return (
    <path
      ref={pathRef}
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeDasharray={dash}
      strokeLinecap={cap}
      strokeLinejoin="round"
      vectorEffect={NS}
      className={className}
      opacity={opacity}
    />
  );
}

/**
 * Состояние датчика на рисунке:
 *  on   — на связи (зелёный светодиод);
 *  low  — на связи, мало заряда (жёлтый);
 *  wait — ищем, подключаем (контур пунктиром и мягкий импульс, пока ждём);
 *  off  — нужен, но не на связи (пунктир);
 *  lost — связь пропала во время теста (красный светодиод, ремешок пунктиром);
 *  idle — не нужен в этом тесте (бледный).
 */
export type PodState = 'on' | 'low' | 'wait' | 'off' | 'lost' | 'idle';

const LED: Partial<Record<PodState, string>> = {
  on: 'var(--good)',
  low: 'var(--warn)',
  lost: 'var(--critical)',
};

export function SensorPod({
  d,
  strap,
  c,
  state = 'on',
  led = true,
  ledR = 1.7,
  pulseR = 11,
  podRef,
  strapRef,
  ledRef,
  className,
}: {
  d: string;
  strap: string;
  c: { x: number; y: number };
  state?: PodState;
  /** false — без светодиода: в отчётах датчик просто показывает, где он надет. */
  led?: boolean;
  ledR?: number;
  pulseR?: number;
  podRef?: Ref<SVGPathElement>;
  strapRef?: Ref<SVGPathElement>;
  ledRef?: Ref<SVGCircleElement>;
  className?: string;
}) {
  const dashed = state === 'wait' || state === 'off';
  const lost = state === 'lost';
  const color = led ? LED[state] : undefined;
  return (
    <g className={`fig-pod fig-pod--${state}${className ? ` ${className}` : ''}`} opacity={state === 'idle' ? 0.4 : undefined}>
      {state === 'wait' && (
        <circle className="fig-pod__pulse" cx={c.x} cy={c.y} r={pulseR} fill="none" stroke={FIG.ink} strokeWidth={HAIR} vectorEffect={NS} />
      )}
      <path
        ref={strapRef}
        d={strap}
        fill={dashed || lost ? FIG.fill : FIG.ink}
        stroke={dashed || lost ? FIG.muted : 'none'}
        strokeWidth={HAIR}
        strokeDasharray={dashed || lost ? '2 2' : undefined}
        vectorEffect={NS}
      />
      <path
        ref={podRef}
        d={d}
        fill={dashed ? FIG.fill : 'var(--fig-pod)'}
        stroke={dashed ? FIG.muted : FIG.ink}
        strokeWidth={OUTLINE}
        strokeDasharray={dashed ? '3 2' : undefined}
        strokeLinejoin="round"
        vectorEffect={NS}
      />
      {color && <circle ref={ledRef} className="fig-pod__led" cx={c.x} cy={c.y} r={ledR} fill={color} />}
    </g>
  );
}

/** Подпись-выноска в стиле технического рисунка: тонкая линия от точки к тексту. */
export function Callout({
  from,
  via,
  to,
  text,
  anchor,
  sub,
  className,
  dot = 1.6,
}: {
  from: { x: number; y: number };
  /** Излом выноски — чтобы линия обошла то, что пересекать нельзя. */
  via?: { x: number; y: number };
  to: { x: number; y: number };
  text: string;
  anchor: 'start' | 'end';
  sub?: string;
  className?: string;
  dot?: number;
}) {
  const tx = to.x + (anchor === 'start' ? 4 : -4);
  const pts = [from, ...(via ? [via] : []), to].map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`);
  return (
    <g className={`fig-callout${className ? ` ${className}` : ''}`}>
      <Hair d={`M${pts.join('L')}`} />
      <circle cx={from.x} cy={from.y} r={dot} fill={FIG.ink} />
      <text x={tx} y={to.y} dy="0.35em" textAnchor={anchor} className="fig-callout__text">
        {text}
      </text>
      {sub && (
        <text x={tx} y={to.y} dy="1.6em" textAnchor={anchor} className="fig-callout__sub">
          {sub}
        </text>
      )}
    </g>
  );
}

/** Наконечник стрелки движения — маленький треугольник по касательной к дуге. */
export function ArrowHead({ at, angle, size = 5, color = FIG.ink }: { at: { x: number; y: number }; angle: number; size?: number; color?: string }) {
  return (
    <path
      d={`M${size},0L${-size * 0.7},${-size * 0.62}L${-size * 0.7},${size * 0.62}Z`}
      transform={`translate(${at.x.toFixed(2)},${at.y.toFixed(2)}) rotate(${angle.toFixed(1)})`}
      fill={color}
    />
  );
}
