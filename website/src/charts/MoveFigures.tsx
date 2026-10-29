// Картинки к цифрам простого вида: что именно измерено — видно глазами, а не только числом.
//
// «145°» без картинки ничего не говорит человеку, который видит NeuroMove впервые.
// Поэтому у каждой главной цифры — рисунок ребёнка по настоящим числам сеанса:
//  • RaiseProgress — подъём руки: шкала 0°…180°, серый сектор — начало курса,
//    цветной — прибавка, ромб — цель врача; бледная рука — как было;
//  • ArmsCompare  — обе руки в одном движении: какая выше и насколько;
//  • TrunkLean    — помощь корпусом: насколько ребёнок отклоняется телом, поднимая руку;
//  • MoveIcon     — значок движения для плана сеанса: поза, куда движется рука.
// Углы — как в приложении: 0° — рука вдоль тела, 90° — вперёд (в сторону), 180° — прямо вверх.
// Цвета сторон — как везде: левая — синяя, правая — оранжевая.
//
// Все рисунки — из одной геометрии тела (figures/body.ts) и в одном стиле (figures/Ink.tsx).
// Тело рисуется в своих единицах внутри группы с масштабом, подписи — снаружи, в единицах
// рамки: высота рамки равна высоте рисунка на экране, поэтому текст 10,5 — это 10,5 px.

import { useEffect, useState } from 'react';
import type { ExerciseId } from '../core/exercises';
import type { Side } from '../devices/types';
import { SIDE, sideShoulder } from '../figures/body';
import { arc, at, clamp, easeOut, tangent, wedge, type P } from '../figures/geometry';
import { ArrowHead, FIG, Hair, InkLayer } from '../figures/Ink';
import { FrontScene, SIDE_COLOR, SideScene, svgAttrs } from '../figures/scenes';

type Box = [number, number, number, number];

/** Рамка: тело в своих единицах → рамка высотой h. T — перевод точки тела в рамку. */
function frame(box: Box, h: number) {
  const [x0, y0, w, bh] = box;
  const k = h / bh;
  return {
    vb: [0, 0, +(w * k).toFixed(1), h] as Box,
    transform: `scale(${k.toFixed(4)}) translate(${-x0} ${-y0})`,
    T: (p: P): P => ({ x: (p.x - x0) * k, y: (p.y - y0) * k }),
  };
}

/** Длина руки от плеча до кончиков пальцев; шкала — чуть дальше. */
const REACH = SIDE.upper + SIDE.fore + SIDE.hand + SIDE.handW / 2;

/** Подпись в единицах рамки; вторая строка — под первой. */
function Label({
  p,
  text,
  line2,
  anchor = 'start',
  tone = 'muted',
  dy = 0.35,
  size = 10.5,
}: {
  p: P;
  text: string;
  line2?: string;
  anchor?: 'start' | 'middle' | 'end';
  tone?: 'muted' | 'ink' | 'left' | 'right';
  dy?: number;
  size?: number;
}) {
  return (
    <text x={p.x.toFixed(1)} y={p.y.toFixed(1)} textAnchor={anchor} fontSize={size} className={`fig-label fig-label--${tone}`}>
      <tspan x={p.x.toFixed(1)} dy={`${dy}em`}>
        {text}
      </tspan>
      {line2 && (
        <tspan x={p.x.toFixed(1)} dy="1.15em" className="fig-label__num">
          {line2}
        </tspan>
      )}
    </text>
  );
}

/** Ромб цели на шкале. */
function GoalMark({ c, s = 5.6 }: { c: P; s?: number }) {
  return <path d={`M0,${-s}L${s},0L0,${s}L${-s},0Z`} transform={`translate(${c.x.toFixed(1)},${c.y.toFixed(1)})`} fill={FIG.ink} />;
}

function prefersReduced(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/**
 * Значение «выезжает» от start до target за 700 мс — один раз, при появлении рисунка:
 * видно само движение (рука поднимается до своего угла). «Уменьшить движение» — сразу на месте.
 */
function useRise(target: number, start: number): number {
  const reduced = prefersReduced();
  const [v, setV] = useState(start);
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = easeOut((now - t0) / 700);
      setV(start + (target - start) * k);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, start, reduced]);
  return reduced ? target : v;
}

/** Шкала подъёма вокруг плеча: точечная дуга 0°…180° и риски 0°, 90°, 180°. */
function RaiseScale({ s, r, dir = 1 }: { s: P; r: number; dir?: 1 | -1 }) {
  return (
    <>
      <Hair d={arc(s, r, 0, 180, dir)} dash="0.5 3.5" width={1.4} />
      {[0, 90, 180].map((v) => {
        const a = at(s, r - 5, v, dir);
        const b = at(s, r + 5, v, dir);
        return <Hair key={v} d={`M${a.x},${a.y}L${b.x},${b.y}`} />;
      })}
    </>
  );
}

/** «правая 144°» → две строки: сторона и число. */
function splitLabel(s: string): [string, string | undefined] {
  const i = s.lastIndexOf(' ');
  return i > 0 ? [s.slice(0, i), s.slice(i + 1)] : [s, undefined];
}

/**
 * Подъём руки за курс. Шкала 0°…180° вокруг плеча: серый сектор — сколько было в начале курса,
 * цветной — на сколько прибавилось, пунктир до ромба — сколько осталось до цели врача.
 */
export function RaiseProgress({
  was,
  now,
  goal,
  side,
  labels,
  ariaLabel,
  size,
}: {
  was: number;
  now: number;
  goal?: number | null;
  side: Side;
  labels: { was: string; goal: string };
  ariaLabel: string;
  size?: number;
}) {
  const c = SIDE_COLOR[side];
  const hip = { x: 64, y: 178 };
  const s = sideShoulder(hip);
  const R = REACH + 8;
  const w0 = clamp(was, 0, 180);
  const n0 = clamp(now, 0, 180);
  const shown = useRise(n0, Math.min(w0, n0));
  const g0 = goal === null || goal === undefined ? null : clamp(goal, 0, 180);
  const lo = Math.min(w0, n0);
  const { vb, transform, T } = frame([20, -36, 200, 238], 150);
  // «было» уходит ниже луча, если рядом с целью — чтобы подписи не слиплись
  const wasAt = T(at(s, R + 11, w0 - (g0 !== null && Math.abs(g0 - w0) < 16 ? 9 : 0)));
  const goalHigh = g0 !== null && g0 > 164;
  return (
    <svg {...svgAttrs(vb, size, ariaLabel)}>
      <g transform={transform}>
        <SideScene
          hip={hip}
          near={{ upper: shown, fore: shown }}
          nearFill={c.main}
          ghost={{ upper: w0, fore: w0 }}
          pods={{ upper: 'on', fore: 'on', led: false }}
          under={() => (
            <>
              <path d={wedge(s, R, 0, lo)} fill="var(--fig-sector)" />
              {shown > w0 + 0.3 && <path d={wedge(s, R, w0, shown)} fill={c.main} fillOpacity={0.2} />}
              <RaiseScale s={s} r={R} />
            </>
          )}
          over={() => (
            <>
              {shown > w0 + 0.3 && <Hair d={arc(s, R, w0, shown)} color={c.main} width={2.5} />}
              {g0 !== null && g0 > n0 && <Hair d={arc(s, R, n0, g0)} color={FIG.ink} dash="2 3" />}
              {g0 !== null && <GoalMark c={at(s, R, g0)} />}
            </>
          )}
        />
      </g>
      {!goalHigh && <Label p={T(at(s, R + 14, 180))} text="180°" anchor="middle" />}
      <Label p={T(at(s, R + 10, 90))} text="90°" />
      {g0 !== null && <Label p={T(at(s, R + 14, g0))} text={labels.goal} anchor={goalHigh ? 'middle' : 'start'} tone="ink" dy={goalHigh ? -0.2 : 0.35} />}
      <Label p={wasAt} text={labels.was} anchor={w0 > 166 ? 'middle' : 'start'} />
    </svg>
  );
}

export interface ArmValue {
  side: Side;
  /** Главный угол движения. */
  value: number | null;
  /** Для поворота предплечья: супинация и пронация по отдельности. */
  sup?: number | null;
  pro?: number | null;
}

/** Предплечье с торца: кулак большим пальцем вверх — нейтральное положение. */
function Fist({ c, s = 1 }: { c: P; s?: number }) {
  const { x, y } = c;
  const fist =
    `M${x - 12 * s},${y - 6 * s}Q${x - 12 * s},${y - 11 * s} ${x - 7 * s},${y - 11 * s}L${x + 7 * s},${y - 11 * s}` +
    `Q${x + 12 * s},${y - 11 * s} ${x + 12 * s},${y - 6 * s}L${x + 12 * s},${y + 7 * s}Q${x + 12 * s},${y + 12 * s} ${x + 7 * s},${y + 12 * s}` +
    `L${x - 7 * s},${y + 12 * s}Q${x - 12 * s},${y + 12 * s} ${x - 12 * s},${y + 7 * s}Z`;
  const thumb =
    `M${x - 1 * s},${y - 10 * s}L${x - 1 * s},${y - 17 * s}Q${x - 1 * s},${y - 21 * s} ${x - 5 * s},${y - 21 * s}` +
    `Q${x - 9 * s},${y - 21 * s} ${x - 9 * s},${y - 17 * s}L${x - 9 * s},${y - 10 * s}Z`;
  return (
    <>
      <InkLayer d={thumb + fist} />
      {[-4, 1, 6].map((dx) => (
        <Hair key={dx} d={`M${x + dx * s},${y - 2 * s}L${x + dx * s},${y + 6 * s}`} />
      ))}
    </>
  );
}

/**
 * Обе руки в одном движении — по настоящим углам. Подъём вперёд и локоть — вид сбоку
 * (руки из одного плеча, видно, какая выше), отведение — вид спереди, поворот — дуга
 * «ладонь вниз … ладонь вверх» над кулаком.
 */
export function ArmsCompare({
  exercise,
  main,
  other,
  labels,
  ariaLabel,
  size,
}: {
  exercise: ExerciseId;
  main: ArmValue;
  other?: ArmValue | null;
  /** Подписи у кистей — только на крупной картинке. */
  labels?: { main: string; other: string };
  ariaLabel: string;
  size?: number;
}) {
  const arms = [other, main].filter((a): a is ArmValue => Boolean(a && (a.value !== null || a.sup != null)));
  const second = arms.find((a) => a !== main) ?? null;

  if (exercise === 'forearm_rotation') {
    // Дуга сверху: слева — ладонь вниз (пронация), справа — ладонь вверх (супинация)
    const o = { x: 60, y: 62 };
    const r = 42;
    const deg = (v: number) => 180 - clamp(v, -90, 90);
    const span = (a: ArmValue): [number, number] => {
      const sup = a.sup ?? (a.value ?? 0) / 2;
      const pro = a.pro ?? (a.value ?? 0) / 2;
      return [Math.min(deg(sup), deg(-pro)), Math.max(deg(sup), deg(-pro))];
    };
    return (
      <svg {...svgAttrs([0, 0, 120, 92], size, ariaLabel)}>
        <Hair d={arc(o, r, 90, 270)} dash="0.5 3.5" width={1.4} />
        {[90, 180, 270].map((v) => (
          <Hair key={v} d={`M${at(o, r - 4, v).x},${at(o, r - 4, v).y}L${at(o, r + 4, v).x},${at(o, r + 4, v).y}`} />
        ))}
        {arms.map((a, i) => {
          const [from, to] = span(a);
          const isMain = a === main;
          return (
            <g key={i}>
              {isMain && <path d={wedge(o, r - 1, from, to)} fill={SIDE_COLOR[a.side].main} fillOpacity={0.14} />}
              <Hair d={arc(o, isMain ? r - 1 : r + 6, from, to)} color={SIDE_COLOR[a.side].main} width={isMain ? 4 : 2.5} />
            </g>
          );
        })}
        <Fist c={{ x: o.x, y: o.y + 8 }} s={0.95} />
      </svg>
    );
  }

  if (exercise === 'shoulder_abduction') {
    // Вид спереди: правая рука пациента — слева от зрителя
    const center = { x: 124, y: 178 };
    const value = (sd: Side) => arms.find((a) => a.side === sd)?.value ?? null;
    const pose = (sd: Side) => {
      const v = value(sd);
      return v === null ? { upper: 6, fore: 8 } : { upper: clamp(v, 0, 180), fore: clamp(v, 0, 180) };
    };
    const fill = (sd: Side) => (value(sd) === null ? FIG.fill : SIDE_COLOR[sd].main);
    const { vb, transform } = frame([-10, -12, 268, 214], 150);
    return (
      <svg {...svgAttrs(vb, size, ariaLabel)}>
        <g transform={transform}>
          <FrontScene
            center={center}
            pose={{ right: pose('right'), left: pose('left') }}
            fills={{ right: fill('right'), left: fill('left') }}
            under={(p) => (
              <>
                <RaiseScale s={p.shoulders.right} r={REACH + 6} dir={-1} />
                <RaiseScale s={p.shoulders.left} r={REACH + 6} dir={1} />
              </>
            )}
          />
        </g>
      </svg>
    );
  }

  if (exercise === 'elbow_flexion') {
    // Вид сбоку: плечо прижато вдоль тела, предплечье сгибается от «вниз» к плечу
    const hip = { x: 60, y: 178 };
    // Рука не измерена — опущена и без цвета: не изображаем «0°»
    const near = main.value === null ? { upper: 3, fore: 5 } : { upper: 3, fore: clamp(main.value, 0, 165) };
    const far = second && second.value !== null ? { upper: 3, fore: clamp(second.value, 0, 165) } : null;
    const { vb, transform } = frame([24, 30, 114, 170], 150);
    return (
      <svg {...svgAttrs(vb, size, ariaLabel)}>
        <g transform={transform}>
          <SideScene
            hip={hip}
            near={near}
            nearFill={main.value === null ? FIG.fill : SIDE_COLOR[main.side].main}
            far={far}
            farFill={second ? SIDE_COLOR[second.side].main : FIG.fill}
            under={(p) => <Hair d={arc(p.elbow, SIDE.fore + SIDE.hand + 10, 0, 165)} dash="0.5 3.5" width={1.4} />}
          />
        </g>
      </svg>
    );
  }

  // Подъём вперёд — вид сбоку, обе руки из одного плеча
  const hip = { x: 64, y: 178 };
  const s = sideShoulder(hip);
  const R = REACH + 8;
  // Рука не измерена — опущена и без цвета: не изображаем «0°»
  const mainMissing = main.value === null;
  const mv = mainMissing ? 4 : clamp(main.value as number, 0, 180);
  const ov = second && second.value !== null ? clamp(second.value, 0, 180) : null;
  const { vb, transform, T } = frame(labels ? [20, -40, 214, 242] : [24, -20, 176, 222], 150);
  const lo = ov === null || mainMissing ? null : Math.min(mv, ov);
  const hi = ov === null || mainMissing ? null : Math.max(mv, ov);
  return (
    <svg {...svgAttrs(vb, size, ariaLabel)}>
      <g transform={transform}>
        <SideScene
          hip={hip}
          near={{ upper: mv, fore: mainMissing ? 6 : mv }}
          nearFill={mainMissing ? FIG.fill : SIDE_COLOR[main.side].main}
          far={ov === null ? null : { upper: ov, fore: ov }}
          farFill={second ? SIDE_COLOR[second.side].main : FIG.fill}
          pods={labels ? { upper: 'on', fore: 'on', led: false } : null}
          under={() => (
            <>
              {lo !== null && hi !== null && hi - lo > 0.5 && <path d={wedge(s, R, lo, hi)} fill="var(--fig-sector)" />}
              <RaiseScale s={s} r={R} />
            </>
          )}
        />
      </g>
      {labels &&
        arms.map((a) => {
          if (a.value === null) return null;
          const v = clamp(a.value, 0, 180);
          const [name, num] = splitLabel(a === main ? labels.main : labels.other);
          // Нижняя из двух близких рук подписана под своим лучом, верхняя — над своим
          const close = lo !== null && hi !== null && hi - lo < 26;
          const lower = close && v === lo;
          const p = T(at(s, R + 12, v - (lower ? 8 : 0)));
          return <Label key={a.side} p={p} text={name} line2={num} tone={a.side} dy={lower ? 0.6 : -0.45} />;
        })}
    </svg>
  );
}

/**
 * Помощь корпусом: ребёнок отклоняется назад, чтобы рука поднялась выше.
 * Пунктир — прямая спина, сплошная линия — спина сейчас, дуга между ними — угол наклона.
 * Меньше — лучше.
 */
export function TrunkLean({ now, side, label, ariaLabel, size }: { now: number; side: Side; label: string; ariaLabel: string; size?: number }) {
  const c = SIDE_COLOR[side];
  const lean = clamp(now, 0, 40);
  const shown = useRise(lean, 0);
  const hip = { x: 112, y: 178 };
  const r = 50;
  const { vb, transform, T } = frame([10, -10, 196, 214], 150);
  // Подпись — за спиной, на высоте дуги: не наезжает ни на корпус, ни на руку
  const d = 46;
  const back = {
    x: hip.x - d * Math.sin((lean * Math.PI) / 180) - 15 * Math.cos((lean * Math.PI) / 180) - 7,
    y: hip.y - d * Math.cos((lean * Math.PI) / 180),
  };
  return (
    <svg {...svgAttrs(vb, size, ariaLabel)}>
      <g transform={transform}>
        <SideScene
          hip={hip}
          lean={shown}
          near={{ upper: 150, fore: 150 }}
          nearFill={c.main}
          pods={{ trunk: 'on', led: false }}
          over={() => (
            <>
              <Hair d={`M${hip.x},${hip.y}L${hip.x},${hip.y - SIDE.trunk - 64}`} color={FIG.ink} dash="3 3" />
              <Hair d={`M${hip.x},${hip.y}L${at(hip, SIDE.trunk, 180 + shown).x},${at(hip, SIDE.trunk, 180 + shown).y}`} color={FIG.ink} width={1.25} />
              {shown > 0.5 && <path d={wedge(hip, r, 180, 180 + shown)} fill={c.main} fillOpacity={0.24} />}
              {shown > 0.5 && <Hair d={arc(hip, r, 180, 180 + shown)} color={c.main} width={2.5} />}
              <circle cx={hip.x} cy={hip.y} r={2.6} fill={FIG.ink} />
            </>
          )}
        />
      </g>
      <Label p={T(back)} text={label} anchor="end" tone="ink" size={12} />
    </svg>
  );
}

/** Значок движения для плана сеанса: поза в конце движения, бледная — в начале, дуга — куда. */
export function MoveIcon({ exercise, side, size = 44, ariaLabel }: { exercise: ExerciseId; side: Side; size?: number; ariaLabel: string }) {
  const c = SIDE_COLOR[side];
  if (exercise === 'forearm_rotation') {
    const o = { x: 30, y: 30 };
    const r = 21;
    const a0 = 122;
    const a1 = 238;
    return (
      <svg {...svgAttrs([0, 0, 60, 60], size, ariaLabel)}>
        <Hair d={arc(o, r, a0 + 6, a1 - 6)} color={c.main} width={2} />
        <ArrowHead at={at(o, r, a0 + 4)} angle={tangent(a0 + 4, 1, false)} size={4.5} color={c.main} />
        <ArrowHead at={at(o, r, a1 - 4)} angle={tangent(a1 - 4)} size={4.5} color={c.main} />
        <Fist c={{ x: o.x, y: o.y + 9 }} s={0.78} />
      </svg>
    );
  }
  if (exercise === 'shoulder_abduction') {
    const center = { x: 60, y: 150 };
    const up = { upper: 132, fore: 132 };
    const down = { upper: 5, fore: 7 };
    const right = side === 'right';
    const dir = right ? -1 : 1;
    const { vb, transform } = frame(right ? [-84, -22, 196, 150] : [12, -22, 196, 150], size);
    return (
      <svg {...svgAttrs(vb, size, ariaLabel)}>
        <g transform={transform}>
          <FrontScene
            center={center}
            pose={{ right: right ? up : down, left: right ? down : up }}
            fills={{ right: right ? c.main : FIG.fill, left: right ? FIG.fill : c.main }}
            over={(p) => {
              const sh = right ? p.shoulders.right : p.shoulders.left;
              const rr = REACH + 6;
              return (
                <>
                  <Hair d={arc(sh, rr, 64, 120, dir)} color={c.main} width={1.8} dash="3 3" />
                  <ArrowHead at={at(sh, rr, 124, dir)} angle={tangent(124, dir)} size={11} color={c.main} />
                </>
              );
            }}
          />
        </g>
      </svg>
    );
  }
  if (exercise === 'elbow_flexion') {
    const hip = { x: 50, y: 150 };
    const { vb, transform } = frame([22, 10, 110, 160], size);
    return (
      <svg {...svgAttrs(vb, size, ariaLabel)}>
        <g transform={transform}>
          <SideScene
            hip={hip}
            near={{ upper: 3, fore: 126 }}
            nearFill={c.main}
            ghost={{ upper: 3, fore: 4 }}
            over={(p) => {
              const rr = SIDE.fore + SIDE.hand + 12;
              return (
                <>
                  <Hair d={arc(p.elbow, rr, 40, 104)} color={c.main} width={1.8} dash="3 3" />
                  <ArrowHead at={at(p.elbow, rr, 108)} angle={tangent(108)} size={11} color={c.main} />
                </>
              );
            }}
          />
        </g>
      </svg>
    );
  }
  // Подъём вперёд
  const hip = { x: 48, y: 150 };
  const s = sideShoulder(hip);
  const { vb, transform } = frame([18, -30, 140, 150], size);
  const rr = REACH + 10;
  return (
    <svg {...svgAttrs(vb, size, ariaLabel)}>
      <g transform={transform}>
        <SideScene
          hip={hip}
          near={{ upper: 150, fore: 150 }}
          nearFill={c.main}
          ghost={{ upper: 4, fore: 4 }}
          over={() => (
            <>
              <Hair d={arc(s, rr, 62, 128)} color={c.main} width={1.8} dash="3 3" />
              <ArrowHead at={at(s, rr, 132)} angle={tangent(132)} size={11} color={c.main} />
            </>
          )}
        />
      </g>
    </svg>
  );
}
