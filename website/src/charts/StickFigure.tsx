// Живая фигурка теста: ребёнок двигается по данным датчиков — плечо, предплечье, наклон корпуса.
// Это не анимация «для красоты»: фигурка показывает ровно то, что посчитал алгоритм,
// и специалист сразу видит, если датчик надет не туда или сполз.
//
// Рисунок — из общей геометрии тела (figures/body.ts) и в общем стиле (figures/Ink.tsx):
// та же фигура, что в карточке пациента и в отчёте, только живая. Вид зависит от движения:
//  • сбоку — подъём руки вперёд и сгибание локтя;
//  • спереди — отведение руки в сторону;
//  • с торца предплечья — поворот ладонью вверх и вниз (сбоку его не видно).
// Обновляется 60 раз в секунду прямо из движка (engine.live) — без перерисовки React.

import { useRef } from 'react';
import type { ExerciseId } from '../core/exercises';
import { frontParts, handTop, sideParts, SIDE } from '../figures/body';
import { arc, at, clamp, wedge } from '../figures/geometry';
import { FIG, Hair, InkLayer } from '../figures/Ink';
import { applyLayers, armLook, FrontFigure, frontLayers, SideFigure, sideLayers } from '../figures/scenes';
import { useAnimationFrame } from '../hooks/useAnimationFrame';
import type { LiveValues } from '../session/types';

interface Props {
  live: LiveValues;
  exercise: ExerciseId;
  side: 'left' | 'right';
  color: string;
  /** Ширина рисунка, px. */
  size?: number;
  ariaLabel: string;
}

/** Дальняя рука лежит на бедре: так дети сидят на тесте, и кисть не торчит из-под сиденья. */
const FAR_REST = { upper: 14, fore: 74 };

/** С какого наклона корпуса подсвечивать «помогает себе телом», ° (как в отчёте — 12°). */
const LEAN_SHOW = 10;

export function StickFigure(props: Props) {
  if (props.exercise === 'forearm_rotation') return <RotationFigure {...props} />;
  if (props.exercise === 'shoulder_abduction') return <FrontLive {...props} />;
  return <SideLive {...props} />;
}

/** Вид сбоку: подъём вперёд и локоть. */
function SideLive({ live, color, size = 200, ariaLabel }: Props) {
  const hip = { x: 70, y: 186 };
  const s = useRef({ up: 0, fo: 0, tr: 0 });
  const root = useRef<SVGGElement>(null);
  const lean = useRef<SVGGElement>(null);
  const leanArc = useRef<SVGPathElement>(null);
  const leanWedge = useRef<SVGPathElement>(null);

  const draw = (up: number, fo: number, tr: number) => {
    const t = Math.max(0, tr);
    const p = sideParts(hip, t, { upper: up, fore: fo }, { legs: true, far: FAR_REST });
    applyLayers(root.current, sideLayers(p));
    // Помогает себе корпусом: дуга от прямой спины до спины сейчас
    const show = t >= LEAN_SHOW;
    lean.current?.setAttribute('visibility', show ? 'visible' : 'hidden');
    if (show) {
      leanArc.current?.setAttribute('d', arc(hip, 54, 180, 180 + t));
      leanWedge.current?.setAttribute('d', wedge(hip, 54, 180, 180 + t));
    }
  };

  useAnimationFrame(() => {
    const k = 0.3; // сглаживание: фигурка не дрожит от шума
    const cur = s.current;
    cur.up += ((live.upperElevation ?? 0) - cur.up) * k;
    cur.fo += ((live.foreElevation ?? 0) - cur.fo) * k;
    // При подъёме вперёд ребёнок отклоняется назад
    cur.tr += ((live.trunk ?? 0) - cur.tr) * k;
    draw(clamp(cur.up, -10, 185), clamp(cur.fo, -10, 185), clamp(cur.tr, 0, 40));
  });

  const p0 = sideParts(hip, 0, { upper: 0, fore: 0 }, { legs: true, far: FAR_REST });
  const vb = [18, -8, 164, 268];
  return (
    <svg viewBox={vb.join(' ')} width={size} height={Math.round((size * vb[3]!) / vb[2]!)} role="img" aria-label={ariaLabel} className="stick">
      <g ref={root}>
        <SideFigure
          p={p0}
          nearFill={color}
          pods={{ upper: 'on', fore: 'on', trunk: 'on', trunkLed: false }}
          between={
            <g ref={lean} visibility="hidden">
              <Hair d={`M${hip.x},${hip.y}L${hip.x},${hip.y - SIDE.trunk - 56}`} color={FIG.ink} dash="3 3" />
              <path ref={leanWedge} fill="var(--warn)" fillOpacity={0.28} />
              <Hair pathRef={leanArc} d="" color="var(--warn-text)" width={2.5} />
            </g>
          }
        />
      </g>
    </svg>
  );
}

/** Вид спереди: отведение руки в сторону; правая рука пациента — слева от зрителя. */
function FrontLive({ live, side, color, size = 220, ariaLabel }: Props) {
  const center = { x: 124, y: 186 };
  const s = useRef({ up: 0, fo: 0, tr: 0 });
  const root = useRef<SVGGElement>(null);
  const rest = { upper: 5, fore: 7 };

  const parts = (up: number, fo: number, tr: number) => {
    const arm = { upper: up, fore: fo };
    // Наклон в сторону — от поднятой руки: правая рука вверх → корпус клонится к левой
    const lean = (side === 'right' ? 1 : -1) * tr;
    return frontParts(center, side === 'right' ? { right: arm, left: rest, lean } : { right: rest, left: arm, lean }, { legs: true });
  };

  useAnimationFrame(() => {
    const k = 0.3;
    const cur = s.current;
    cur.up += ((live.upperElevation ?? 0) - cur.up) * k;
    cur.fo += ((live.foreElevation ?? 0) - cur.fo) * k;
    cur.tr += ((live.trunk ?? 0) - cur.tr) * k;
    applyLayers(root.current, frontLayers(parts(clamp(cur.up, -10, 185), clamp(cur.fo, -10, 185), clamp(cur.tr, 0, 30))));
  });

  const p0 = parts(0, 0, 0);
  const fills = side === 'right' ? { right: color, left: FIG.fill } : { right: FIG.fill, left: color };
  const vb = [-6, 0, 260, 268];
  return (
    <svg viewBox={vb.join(' ')} width={size} height={Math.round((size * vb[3]!) / vb[2]!)} role="img" aria-label={ariaLabel} className="stick">
      <g ref={root}>
        <FrontFigure p={p0} fills={fills} pods={{ trunk: 'on', upper_r: 'on', upper_l: 'on', fore_r: 'on', fore_l: 'on' }} />
      </g>
    </svg>
  );
}

/**
 * Поворот предплечья: кисть сверху «переворачивается» по живому углу — с тыла (ладонь вниз)
 * через ребро к ладони (ладонь вверх), большой палец переходит на другую сторону. Над кистью —
 * шкала: слева ладонь вниз, сверху — кисть ребром, справа ладонь вверх.
 */
function RotationFigure({ live, color, size = 200, ariaLabel }: Props) {
  const o = { x: 80, y: 62 };
  const r = 48;
  const c = { x: 86, y: 100 };
  const S = 2.2;
  const rot = useRef(0);
  const hand = useRef<SVGGElement>(null);
  const palm = useRef<SVGPathElement>(null);
  const back = useRef<SVGPathElement>(null);
  const sweep = useRef<SVGPathElement>(null);
  const needle = useRef<SVGPathElement>(null);
  const look = armLook(color);
  useAnimationFrame(() => {
    rot.current += ((live.angle ?? 0) - rot.current) * 0.3;
    const v = clamp(rot.current, -90, 90);
    // Супинация + — ладонь вверх: кисть зеркалится по вертикали, видна ладонь
    let k = -Math.sin((v * Math.PI) / 180);
    if (Math.abs(k) < 0.14) k = v > 0 ? -0.14 : 0.14;
    hand.current?.setAttribute('transform', `translate(0 ${c.y}) scale(1 ${k.toFixed(3)}) translate(0 ${-c.y})`);
    palm.current?.setAttribute('visibility', v > 0 ? 'visible' : 'hidden');
    back.current?.setAttribute('visibility', v > 0 ? 'hidden' : 'visible');
    const deg = 180 - v;
    sweep.current?.setAttribute('d', Math.abs(v) < 0.5 ? '' : wedge(o, r - 2, Math.min(180, deg), Math.max(180, deg)));
    const tip = at(o, r - 6, deg);
    needle.current?.setAttribute('d', `M${o.x},${o.y}L${tip.x.toFixed(1)},${tip.y.toFixed(1)}`);
  });
  const h = handTop(c, S, 1, -48);
  return (
    <svg viewBox="0 0 160 136" width={size} height={Math.round((size * 136) / 160)} role="img" aria-label={ariaLabel} className="stick">
      <Hair d={arc(o, r, 90, 270)} dash="0.5 3.5" width={1.4} />
      {[90, 180, 270].map((v) => (
        <Hair key={v} d={`M${at(o, r - 5, v).x},${at(o, r - 5, v).y}L${at(o, r + 5, v).x},${at(o, r + 5, v).y}`} />
      ))}
      <path ref={sweep} fill={color} fillOpacity={0.18} />
      <Hair pathRef={needle} d={`M${o.x},${o.y}L${o.x},${o.y - r + 6}`} color={color} width={2.2} />
      <circle cx={o.x} cy={o.y} r={2.6} fill={color} />
      <InkLayer d={h.fore} fill={look.skin} ink={color} />
      <g ref={hand}>
        <InkLayer d={h.hand} fill={look.skin} ink={color} />
        <Hair d={h.fingers} color={FIG.ink} opacity={0.5} />
        <Hair pathRef={palm} d={h.palm} color={FIG.ink} opacity={0.5} />
        <Hair pathRef={back} d={h.back} color={FIG.ink} opacity={0.5} />
      </g>
      <InkLayer d={h.sleeve} fill={color} ink={color} />
    </svg>
  );
}
