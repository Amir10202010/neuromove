// Слои рисунков NeuroMove. Стиль — техническая иллюстрация: одна толщина контура на всех
// рисунках, тело — светлая заливка с контуром тушью, сплошной цвет — только у того, что
// измеряется (рука цветом стороны). Датчик — как корпус v3 из hardware/models/enclosure: светлая
// крышка на основании с «ушками», через которые проходит тёмный ремешок; стрелка оси X на крышке,
// светодиод говорит о состоянии.
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
  /** Волосы — тон темнее кожи, без цвета: цвет на рисунке — только у измеряемой руки. */
  hair: 'var(--fig-hair)',
  /** Дальняя рука, то, что за телом. */
  shade: 'var(--fig-shade)',
  skin: 'var(--fig-skin)',
  skinFar: 'var(--fig-skin-far)',
  shirt: 'var(--fig-shirt)',
  shirtFar: 'var(--fig-shirt-far)',
  shorts: 'var(--fig-shorts)',
  shoe: 'var(--fig-shoe)',
  floor: 'var(--fig-floor)',
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
  k,
}: {
  d: string;
  fill?: string;
  ink?: string;
  opacity?: number;
  outlineRef?: Ref<SVGPathElement>;
  fillRef?: Ref<SVGPathElement>;
  className?: string;
  /** Ключ слоя: живая фигурка находит слой по data-k и переставляет контур (scenes.applyLayers). */
  k?: string;
}) {
  return (
    <g opacity={opacity} className={className}>
      <path ref={outlineRef} data-k={k} d={d} fill={ink} stroke={ink} strokeWidth={OUTLINE * 2} strokeLinejoin="round" vectorEffect={NS} />
      <path ref={fillRef} data-k={k} d={d} fill={fill} />
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
  k,
}: {
  k?: string;
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
      data-k={k}
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
  base,
  mark,
  c,
  state = 'on',
  led = true,
  ledR = 1.25,
  pulseR = 11,
  podRef,
  strapRef,
  baseRef,
  markRef,
  ledRef,
  className,
  k,
}: {
  /** Ключ датчика для живой фигурки: слои получают data-k «k:d», «k:strap» … «k:led». */
  k?: string;
  /** Крышка корпуса. */
  d: string;
  strap: string;
  /** Основание с «ушками», через которые проходит ремешок. */
  base?: string;
  /** Стрелка оси X на крышке: к кисти, на груди — вниз. */
  mark?: string;
  c: { x: number; y: number };
  state?: PodState;
  /** false — без светодиода: в отчётах датчик просто показывает, где он надет. */
  led?: boolean;
  ledR?: number;
  pulseR?: number;
  podRef?: Ref<SVGPathElement>;
  strapRef?: Ref<SVGPathElement>;
  baseRef?: Ref<SVGPathElement>;
  markRef?: Ref<SVGPathElement>;
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
        data-k={k && `${k}:strap`}
        d={strap}
        fill={dashed || lost ? FIG.fill : 'var(--fig-strap)'}
        stroke={dashed || lost ? FIG.muted : FIG.ink}
        strokeWidth={HAIR}
        strokeDasharray={dashed || lost ? '2 2' : undefined}
        strokeLinejoin="round"
        vectorEffect={NS}
      />
      {base !== undefined && !dashed && (
        <path
          ref={baseRef}
          data-k={k && `${k}:base`}
          d={base}
          fill={dashed ? FIG.fill : 'var(--fig-pod-base)'}
          stroke={dashed ? FIG.muted : FIG.ink}
          strokeWidth={HAIR}
          strokeDasharray={dashed ? '2 2' : undefined}
          strokeLinejoin="round"
          vectorEffect={NS}
        />
      )}
      <path
        ref={podRef}
        data-k={k && `${k}:d`}
        d={d}
        fill={dashed ? FIG.fill : 'var(--fig-pod)'}
        stroke={dashed ? FIG.muted : FIG.ink}
        strokeWidth={OUTLINE}
        strokeDasharray={dashed ? '3 2' : undefined}
        strokeLinejoin="round"
        vectorEffect={NS}
      />
      {mark !== undefined && (
        <path ref={markRef} data-k={k && `${k}:mark`} d={mark} fill="none" stroke={FIG.muted} strokeWidth={HAIR} strokeLinecap="round" strokeLinejoin="round" vectorEffect={NS} />
      )}
      {color && <circle ref={ledRef} data-k={k && `${k}:led`} className="fig-pod__led" cx={c.x} cy={c.y} r={ledR} fill={color} />}
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
