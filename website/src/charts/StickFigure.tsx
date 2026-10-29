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

import { useRef, type RefObject } from 'react';
import type { ExerciseId } from '../core/exercises';
import { frontParts, sideParts, SIDE } from '../figures/body';
import { arc, at, clamp, wedge } from '../figures/geometry';
import { FIG, Hair, InkLayer, SensorPod } from '../figures/Ink';
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

/** С какого наклона корпуса подсвечивать «помогает себе телом», ° (как в отчёте — 12°). */
const LEAN_SHOW = 10;

export function StickFigure(props: Props) {
  if (props.exercise === 'forearm_rotation') return <RotationFigure {...props} />;
  if (props.exercise === 'shoulder_abduction') return <FrontLive {...props} />;
  return <SideLive {...props} />;
}

type PathRef = RefObject<SVGPathElement | null>;
const setD = (r: PathRef, d: string) => r.current?.setAttribute('d', d);

/** Вид сбоку: подъём вперёд и локоть. */
function SideLive({ live, color, size = 200, ariaLabel }: Props) {
  const hip = { x: 70, y: 186 };
  const s = useRef({ up: 0, fo: 0, tr: 0 });
  const bodyO = useRef<SVGPathElement>(null);
  const bodyF = useRef<SVGPathElement>(null);
  const farO = useRef<SVGPathElement>(null);
  const farF = useRef<SVGPathElement>(null);
  const armO = useRef<SVGPathElement>(null);
  const armF = useRef<SVGPathElement>(null);
  const podU = useRef<SVGPathElement>(null);
  const podF = useRef<SVGPathElement>(null);
  const podT = useRef<SVGPathElement>(null);
  const strU = useRef<SVGPathElement>(null);
  const strF = useRef<SVGPathElement>(null);
  const strT = useRef<SVGPathElement>(null);
  const ledU = useRef<SVGCircleElement>(null);
  const ledF = useRef<SVGCircleElement>(null);
  const lean = useRef<SVGGElement>(null);
  const leanArc = useRef<SVGPathElement>(null);
  const leanWedge = useRef<SVGPathElement>(null);

  const draw = (up: number, fo: number, tr: number) => {
    const t = Math.max(0, tr);
    const p = sideParts(hip, t, { upper: up, fore: fo }, { legs: true, far: { upper: 3, fore: 6 } });
    setD(bodyO, p.body);
    setD(bodyF, p.body);
    setD(farO, p.far);
    setD(farF, p.far);
    setD(armO, p.arm);
    setD(armF, p.arm);
    setD(podU, p.pods.upper);
    setD(podF, p.pods.fore);
    setD(podT, p.pods.trunk);
    setD(strU, p.straps.upper);
    setD(strF, p.straps.fore);
    setD(strT, p.straps.trunk);
    ledU.current?.setAttribute('cx', p.podCenters.upper.x.toFixed(1));
    ledU.current?.setAttribute('cy', p.podCenters.upper.y.toFixed(1));
    ledF.current?.setAttribute('cx', p.podCenters.fore.x.toFixed(1));
    ledF.current?.setAttribute('cy', p.podCenters.fore.y.toFixed(1));
    // Помогает себе корпусом: дуга от прямой спины до спины сейчас
    const show = t >= LEAN_SHOW;
    lean.current?.setAttribute('visibility', show ? 'visible' : 'hidden');
    if (show) {
      setD(leanArc, arc(hip, 54, 180, 180 + t));
      setD(leanWedge, wedge(hip, 54, 180, 180 + t));
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

  const p0 = sideParts(hip, 0, { upper: 0, fore: 0 }, { legs: true, far: { upper: 3, fore: 6 } });
  const vb = [18, -8, 164, 268];
  return (
    <svg viewBox={vb.join(' ')} width={size} height={Math.round((size * vb[3]!) / vb[2]!)} role="img" aria-label={ariaLabel} className="stick">
      <InkLayer d={p0.stool} />
      <InkLayer d={p0.far} outlineRef={farO} fillRef={farF} />
      <InkLayer d={p0.body} outlineRef={bodyO} fillRef={bodyF} />
      <SensorPod d={p0.pods.trunk} strap={p0.straps.trunk} c={p0.podCenters.trunk} podRef={podT} strapRef={strT} led={false} />
      <g ref={lean} visibility="hidden">
        <Hair d={`M${hip.x},${hip.y}L${hip.x},${hip.y - SIDE.trunk - 56}`} color={FIG.ink} dash="3 3" />
        <path ref={leanWedge} fill="var(--warn)" fillOpacity={0.28} />
        <Hair pathRef={leanArc} d="" color="var(--warn-text)" width={2.5} />
      </g>
      <InkLayer d={p0.arm} fill={color} outlineRef={armO} fillRef={armF} />
      <SensorPod d={p0.pods.upper} strap={p0.straps.upper} c={p0.podCenters.upper} podRef={podU} strapRef={strU} ledRef={ledU} />
      <SensorPod d={p0.pods.fore} strap={p0.straps.fore} c={p0.podCenters.fore} podRef={podF} strapRef={strF} ledRef={ledF} />
    </svg>
  );
}

/** Вид спереди: отведение руки в сторону; правая рука пациента — слева от зрителя. */
function FrontLive({ live, side, color, size = 220, ariaLabel }: Props) {
  const center = { x: 124, y: 186 };
  const s = useRef({ up: 0, fo: 0, tr: 0 });
  const bodyO = useRef<SVGPathElement>(null);
  const bodyF = useRef<SVGPathElement>(null);
  const armO = useRef<SVGPathElement>(null);
  const armF = useRef<SVGPathElement>(null);
  const otherO = useRef<SVGPathElement>(null);
  const otherF = useRef<SVGPathElement>(null);
  // Датчики: грудь, плечо и предплечье поднятой руки, плечо и предплечье другой
  const podT = useRef<SVGPathElement>(null);
  const podU = useRef<SVGPathElement>(null);
  const podF = useRef<SVGPathElement>(null);
  const podOU = useRef<SVGPathElement>(null);
  const podOF = useRef<SVGPathElement>(null);
  const strT = useRef<SVGPathElement>(null);
  const strU = useRef<SVGPathElement>(null);
  const strF = useRef<SVGPathElement>(null);
  const strOU = useRef<SVGPathElement>(null);
  const strOF = useRef<SVGPathElement>(null);
  const ledT = useRef<SVGCircleElement>(null);
  const ledU = useRef<SVGCircleElement>(null);
  const ledF = useRef<SVGCircleElement>(null);
  const ledOU = useRef<SVGCircleElement>(null);
  const ledOF = useRef<SVGCircleElement>(null);
  const me = side === 'right' ? 'r' : 'l';
  const ot = side === 'right' ? 'l' : 'r';
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
    const p = parts(clamp(cur.up, -10, 185), clamp(cur.fo, -10, 185), clamp(cur.tr, 0, 30));
    const arm = side === 'right' ? p.arms.right : p.arms.left;
    const other = side === 'right' ? p.arms.left : p.arms.right;
    setD(bodyO, p.body);
    setD(bodyF, p.body);
    setD(armO, arm);
    setD(armF, arm);
    setD(otherO, other);
    setD(otherF, other);
    const place = (pod: PathRef, strap: PathRef, led: RefObject<SVGCircleElement | null>, q: { d: string; strap: string; c: { x: number; y: number } }) => {
      setD(pod, q.d);
      setD(strap, q.strap);
      led.current?.setAttribute('cx', q.c.x.toFixed(1));
      led.current?.setAttribute('cy', q.c.y.toFixed(1));
    };
    place(podT, strT, ledT, p.pods.trunk);
    place(podU, strU, ledU, p.pods[`upper_${me}`]);
    place(podF, strF, ledF, p.pods[`fore_${me}`]);
    place(podOU, strOU, ledOU, p.pods[`upper_${ot}`]);
    place(podOF, strOF, ledOF, p.pods[`fore_${ot}`]);
  });

  const p0 = parts(0, 0, 0);
  const arm0 = side === 'right' ? p0.arms.right : p0.arms.left;
  const other0 = side === 'right' ? p0.arms.left : p0.arms.right;
  const q = {
    t: p0.pods.trunk,
    u: p0.pods[`upper_${me}`],
    f: p0.pods[`fore_${me}`],
    ou: p0.pods[`upper_${ot}`],
    of: p0.pods[`fore_${ot}`],
  };
  const vb = [-6, 0, 260, 268];
  return (
    <svg viewBox={vb.join(' ')} width={size} height={Math.round((size * vb[3]!) / vb[2]!)} role="img" aria-label={ariaLabel} className="stick">
      <InkLayer d={p0.stool} />
      <InkLayer d={p0.body} outlineRef={bodyO} fillRef={bodyF} />
      <InkLayer d={other0} outlineRef={otherO} fillRef={otherF} />
      <InkLayer d={arm0} fill={color} outlineRef={armO} fillRef={armF} />
      <SensorPod d={q.t.d} strap={q.t.strap} c={q.t.c} podRef={podT} strapRef={strT} ledRef={ledT} />
      <SensorPod d={q.ou.d} strap={q.ou.strap} c={q.ou.c} podRef={podOU} strapRef={strOU} ledRef={ledOU} />
      <SensorPod d={q.of.d} strap={q.of.strap} c={q.of.c} podRef={podOF} strapRef={strOF} ledRef={ledOF} />
      <SensorPod d={q.u.d} strap={q.u.strap} c={q.u.c} podRef={podU} strapRef={strU} ledRef={ledU} />
      <SensorPod d={q.f.d} strap={q.f.strap} c={q.f.c} podRef={podF} strapRef={strF} ledRef={ledF} />
    </svg>
  );
}

/** Поворот предплечья: предплечье с торца, кулак поворачивается — ладонь вниз … ладонь вверх. */
function RotationFigure({ live, side, color, size = 200, ariaLabel }: Props) {
  const o = { x: 80, y: 74 };
  const r = 58;
  const rot = useRef(0);
  const hand = useRef<SVGGElement>(null);
  const sweep = useRef<SVGPathElement>(null);
  useAnimationFrame(() => {
    rot.current += ((live.angle ?? 0) - rot.current) * 0.3;
    const v = clamp(rot.current, -90, 90);
    // Супинация (ладонь вверх) — по часовой у правой руки, если смотреть ребёнку в кулак
    const screen = side === 'right' ? v : -v;
    hand.current?.setAttribute('transform', `rotate(${screen.toFixed(1)} ${o.x} ${o.y + 6})`);
    sweep.current?.setAttribute('d', Math.abs(v) < 0.5 ? '' : wedge(o, r - 2, 180, 180 - screen));
  });
  const fist =
    `M${o.x - 17},${o.y - 2}Q${o.x - 17},${o.y - 10} ${o.x - 9},${o.y - 10}L${o.x + 9},${o.y - 10}` +
    `Q${o.x + 17},${o.y - 10} ${o.x + 17},${o.y - 2}L${o.x + 17},${o.y + 15}Q${o.x + 17},${o.y + 23} ${o.x + 9},${o.y + 23}` +
    `L${o.x - 9},${o.y + 23}Q${o.x - 17},${o.y + 23} ${o.x - 17},${o.y + 15}Z`;
  const thumb =
    `M${o.x - 1},${o.y - 8}L${o.x - 1},${o.y - 19}Q${o.x - 1},${o.y - 25} ${o.x - 6.5},${o.y - 25}` +
    `Q${o.x - 12},${o.y - 25} ${o.x - 12},${o.y - 19}L${o.x - 12},${o.y - 8}Z`;
  return (
    <svg viewBox="0 0 160 136" width={size} height={Math.round((size * 136) / 160)} role="img" aria-label={ariaLabel} className="stick">
      <Hair d={arc(o, r, 90, 270)} dash="0.5 3.5" width={1.4} />
      {[90, 180, 270].map((v) => (
        <Hair key={v} d={`M${at(o, r - 5, v).x},${at(o, r - 5, v).y}L${at(o, r + 5, v).x},${at(o, r + 5, v).y}`} />
      ))}
      <path ref={sweep} fill={color} fillOpacity={0.18} />
      <circle cx={o.x} cy={o.y + 6} r={26} fill="none" stroke={FIG.muted} strokeWidth={1} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
      <g ref={hand}>
        <InkLayer d={thumb + fist} fill={color} />
        {[-6, 1, 8].map((dx) => (
          <Hair key={dx} d={`M${o.x + dx},${o.y + 2}L${o.x + dx},${o.y + 13}`} color={FIG.ink} opacity={0.5} />
        ))}
      </g>
    </svg>
  );
}
