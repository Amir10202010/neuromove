// Сцены: тело сбоку и спереди из общих частей (body.ts) в общем стиле (Ink.tsx).
// Конкретные рисунки — картинки к цифрам, живая фигурка, схема датчиков — собираются из них
// и добавляют своё: шкалы, дуги, подписи.

import type { ReactNode } from 'react';
import { frontParts, sideParts, type ArmPose, type FrontParts, type FrontPodKey, type FrontPose, type SideParts } from './body';
import { FIG, InkLayer, SensorPod, type PodState } from './Ink';

export const SIDE_COLOR = {
  left: { main: 'var(--left)', soft: 'var(--left-soft)' },
  right: { main: 'var(--right)', soft: 'var(--right-soft)' },
} as const;

/**
 * Атрибуты <svg>. Размер на экране задаёт CSS контейнера (.mfig и правила вроде
 * «.fig__pic .mfig { height: 100% }»), поэтому без инлайн-стилей: раньше инлайн «height: auto»
 * перебивал CSS, и рисунок вылезал из своей рамки. size — ширина, если контейнер её не задаёт.
 * Пустая подпись — картинка повторяет числа рядом, читалке экрана она не нужна.
 */
export function svgAttrs(vb: [number, number, number, number], size: number | undefined, label: string, className = 'mfig') {
  const w = size ?? vb[2];
  return {
    viewBox: vb.join(' '),
    width: w,
    height: +((w * vb[3]) / vb[2]).toFixed(1),
    ...(label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const }),
    className,
  };
}

/**
 * Тело сбоку: табурет, дальняя рука (за корпусом), корпус, «призрак» прошлого положения,
 * ближняя рука цветом стороны, датчики. under — то, что лежит под телом (секторы шкалы),
 * over — поверх (дуги, подписи).
 */
export function SideScene({
  hip,
  lean = 0,
  near,
  nearFill,
  far = null,
  farFill = FIG.fill,
  ghost = null,
  legs = false,
  pods,
  under,
  over,
}: {
  hip: { x: number; y: number };
  lean?: number;
  near: ArmPose;
  nearFill: string;
  far?: ArmPose | null;
  farFill?: string;
  ghost?: ArmPose | null;
  legs?: boolean;
  /** Какие датчики показать и в каком состоянии; без светодиода — для картинок в отчётах. */
  pods?: { upper?: PodState; fore?: PodState; trunk?: PodState; led?: boolean } | null;
  under?: (p: SideParts) => ReactNode;
  over?: (p: SideParts) => ReactNode;
}) {
  const p = sideParts(hip, lean, near, { legs, far });
  const g = ghost ? sideParts(hip, lean, ghost, { legs: false }) : null;
  const led = pods?.led ?? true;
  return (
    <>
      {under?.(p)}
      <InkLayer d={p.stool} />
      {far && <InkLayer d={p.far} fill={farFill} />}
      <InkLayer d={p.body} />
      {pods?.trunk && <SensorPod d={p.pods.trunk} strap={p.straps.trunk} c={p.podCenters.trunk} state={pods.trunk} led={led} ledR={1.4} />}
      {g && <path d={g.arm} fill={FIG.ghost} />}
      <InkLayer d={p.arm} fill={nearFill} />
      {pods?.upper && <SensorPod d={p.pods.upper} strap={p.straps.upper} c={p.podCenters.upper} state={pods.upper} led={led} />}
      {pods?.fore && <SensorPod d={p.pods.fore} strap={p.straps.fore} c={p.podCenters.fore} state={pods.fore} led={led} />}
      {over?.(p)}
    </>
  );
}

/** Тело спереди: правая рука пациента — слева от зрителя. */
export function FrontScene({
  center,
  pose,
  fills,
  legs = false,
  pods,
  under,
  over,
}: {
  center: { x: number; y: number };
  pose: FrontPose;
  fills: { right: string; left: string };
  legs?: boolean;
  pods?: Partial<Record<FrontPodKey, PodState>> | null;
  under?: (p: FrontParts) => ReactNode;
  over?: (p: FrontParts) => ReactNode;
}) {
  const p = frontParts(center, pose, { legs });
  return (
    <>
      {under?.(p)}
      <InkLayer d={p.stool} />
      <InkLayer d={p.body} />
      <InkLayer d={p.arms.right} fill={fills.right} />
      <InkLayer d={p.arms.left} fill={fills.left} />
      {pods &&
        (Object.keys(p.pods) as FrontPodKey[]).map((k) => {
          const st = pods[k];
          if (!st) return null;
          const q = p.pods[k];
          return <SensorPod key={k} d={q.d} strap={q.strap} c={q.c} state={st} />;
        })}
      {over?.(p)}
    </>
  );
}
