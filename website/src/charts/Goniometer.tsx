// Цифровой угломер — главный живой прибор на экране теста.
// Врачи знают гониометр: та же шкала, та же стрелка, только угол считает датчик.
//
// Рисуется 60 раз в секунду прямо из движка (engine.live) — без перерисовки React.
// Лента шкалы заливается цветом стороны до текущего угла — «насколько поднялась рука»
// видно и без числа. Отметки: прошлый сеанс (треугольник), цель (ромб), другая сторона
// в этом сеансе (пунктир поперёк ленты), пик текущего повтора (светлая заливка).

import { useRef } from 'react';
import { useAnimationFrame } from '../hooks/useAnimationFrame';
import type { LiveValues } from '../session/types';

interface Props {
  live: LiveValues;
  /** Шкала: [0, 180] для подъёма, [−90, 90] для поворота предплечья. */
  range: [number, number];
  color: string;
  softColor: string;
  previous?: number | null;
  goal?: number | null;
  other?: number | null;
  labels: { current: string; previous: string; goal: string; other: string; minLabel?: string; maxLabel?: string };
  size?: number;
  /** Экран для пациента: крупнее и без мелких подписей. */
  simple?: boolean;
}

const C = 160; // центр
const R = 118; // радиус середины ленты
const BAND = 14; // ширина ленты

export function Goniometer({ live, range, color, softColor, previous, goal, other, labels, size = 320, simple }: Props) {
  const rotation = range[0] < 0;
  // Значение → экранный угол (градусы, математически: 0 — вправо, 90 — вверх)
  const toAngle = (v: number) => {
    const clamped = Math.max(range[0], Math.min(range[1], v));
    return rotation ? 90 - clamped : -90 + clamped;
  };
  const pt = (v: number, r: number) => {
    const a = (toAngle(v) * Math.PI) / 180;
    return [C + r * Math.cos(a), C - r * Math.sin(a)] as const;
  };
  const arc = (from: number, to: number, r: number) => {
    if (Math.abs(to - from) < 0.01) return '';
    const [x0, y0] = pt(from, r);
    const [x1, y1] = pt(to, r);
    const large = Math.abs(toAngle(to) - toAngle(from)) > 180 ? 1 : 0;
    // В SVG ось y вниз: рост угла против часовой стрелки = sweep 0
    const sweep = toAngle(to) > toAngle(from) ? 0 : 1;
    return `M${x0.toFixed(2)},${y0.toFixed(2)}A${r},${r} 0 ${large} ${sweep} ${x1.toFixed(2)},${y1.toFixed(2)}`;
  };
  const zero = rotation ? 0 : range[0];

  const valueArc = useRef<SVGPathElement>(null);
  const peakArc = useRef<SVGPathElement>(null);
  const needle = useRef<SVGLineElement>(null);
  const tip = useRef<SVGCircleElement>(null);
  const text = useRef<SVGTSpanElement>(null);
  const shown = useRef<number | null>(null);

  useAnimationFrame(() => {
    const target = live.angle;
    if (target === null) {
      // Угла нет (датчик не на связи, установка ещё не поймана): стрелка и дуга не должны стоять
      // на последнем значении — иначе прибор выглядит живым (FINDINGS.md, F5)
      text.current?.replaceChildren('–');
      needle.current?.setAttribute('visibility', 'hidden');
      tip.current?.setAttribute('visibility', 'hidden');
      valueArc.current?.setAttribute('d', '');
      peakArc.current?.setAttribute('d', '');
      shown.current = null;
      return;
    }
    needle.current?.setAttribute('visibility', 'visible');
    tip.current?.setAttribute('visibility', 'visible');
    // Плавное следование за значением: стрелка не дёргается от шума
    shown.current = shown.current === null ? target : shown.current + (target - shown.current) * 0.35;
    const v = shown.current;
    const peak = live.inRep && live.repPeak !== null ? live.repPeak : null;
    valueArc.current?.setAttribute('d', arc(zero, v, R));
    peakArc.current?.setAttribute('d', peak !== null ? arc(zero, peak, R) : '');
    const [nx, ny] = pt(v, R - BAND / 2 - 6);
    needle.current?.setAttribute('x2', nx.toFixed(2));
    needle.current?.setAttribute('y2', ny.toFixed(2));
    tip.current?.setAttribute('cx', nx.toFixed(2));
    tip.current?.setAttribute('cy', ny.toFixed(2));
    text.current?.replaceChildren(`${Math.round(target)}`);
  });

  // Деления шкалы: каждые 5° — мелкие, 10° — средние, 30° — крупные с подписью
  const ticks: number[] = [];
  for (let v = range[0]; v <= range[1] + 0.01; v += 5) ticks.push(v);
  const kind = (v: number) => (v % 30 === 0 ? 3 : v % 10 === 0 ? 2 : 1);

  const marker = (v: number | null | undefined, k: 'prev' | 'goal' | 'other') => {
    if (v === null || v === undefined || !Number.isFinite(v)) return null;
    const a = toAngle(v);
    if (k === 'other') {
      const [ix, iy] = pt(v, R - BAND / 2 - 2);
      const [ox, oy] = pt(v, R + BAND / 2 + 2);
      return <line x1={ix} y1={iy} x2={ox} y2={oy} stroke="var(--text-2)" strokeWidth={2} strokeDasharray="2.5 2.5" />;
    }
    const [x, y] = pt(v, R + BAND / 2 + 9);
    if (k === 'prev') {
      // Треугольник снаружи ленты, остриём к шкале
      return <path d="M5,0 L-5,-5.5 L-5,5.5 Z" transform={`translate(${x.toFixed(2)},${y.toFixed(2)}) rotate(${(-a + 180).toFixed(1)})`} fill="var(--text-2)" />;
    }
    return <path d="M0,-6.5 L6.5,0 L0,6.5 L-6.5,0 Z" transform={`translate(${x.toFixed(2)},${y.toFixed(2)})`} fill="var(--goal)" />;
  };

  // Область рисунка: подъём — полукруг справа, число слева; поворот — полукруг сверху, число под центром
  const vb = rotation ? '10 14 300 212' : '30 14 282 294';

  return (
    <svg viewBox={vb} width={size} height={Math.round((size * +vb.split(' ')[3]!) / +vb.split(' ')[2]!)} className="goniometer" aria-hidden>
      {/* Лента шкалы */}
      <path d={arc(range[0], range[1], R)} fill="none" className="goniometer__band" strokeWidth={BAND} strokeLinecap="butt" />
      <path ref={peakArc} fill="none" stroke={softColor} strokeWidth={BAND} strokeLinecap="butt" />
      <path ref={valueArc} fill="none" stroke={color} strokeWidth={BAND} strokeLinecap="butt" />
      {/* Риски — поверх ленты: видны и на заливке */}
      {ticks.map((v) => {
        const k = kind(v);
        const inner = R - BAND / 2 - (k === 3 ? 9 : k === 2 ? 5 : 2.5);
        const [x0, y0] = pt(v, inner);
        const [x1, y1] = pt(v, R - BAND / 2);
        const [lx, ly] = pt(v, R - BAND / 2 - 22);
        return (
          <g key={v}>
            <line x1={x0} y1={y0} x2={x1} y2={y1} className={`goniometer__tickline is-${k}`} />
            {k === 3 && !simple && (
              <text x={lx} y={ly} dy="0.35em" textAnchor="middle" className="goniometer__tick">
                {v}°
              </text>
            )}
          </g>
        );
      })}
      {marker(other, 'other')}
      {marker(previous, 'prev')}
      {marker(goal, 'goal')}
      <line ref={needle} x1={C} y1={C} x2={C} y2={C + R - 22} stroke="var(--text)" strokeWidth={2} strokeLinecap="round" />
      <circle ref={tip} r={3.5} fill={color} stroke="var(--surface)" strokeWidth={1.5} />
      <circle cx={C} cy={C} r={7.5} fill="var(--surface)" stroke="var(--text)" strokeWidth={2.5} />
      <circle cx={C} cy={C} r={2.2} fill="var(--text)" />
      {rotation ? (
        <>
          <text x={C} y={C + 40} textAnchor="middle" className="goniometer__value">
            <tspan ref={text}>–</tspan>
            <tspan className="goniometer__deg">°</tspan>
          </text>
          {!simple && labels.minLabel && (
            <text x={C - R} y={C + 26} textAnchor="middle" className="goniometer__side">
              {labels.minLabel}
            </text>
          )}
          {!simple && labels.maxLabel && (
            <text x={C + R} y={C + 26} textAnchor="middle" className="goniometer__side">
              {labels.maxLabel}
            </text>
          )}
        </>
      ) : (
        <text x={C - 20} y={C + 14} textAnchor="end" className="goniometer__value">
          <tspan ref={text}>–</tspan>
          <tspan className="goniometer__deg">°</tspan>
        </text>
      )}
    </svg>
  );
}
