// Соглашения об осях (docs/ENGINEERING_10H/COORDINATES.md): одно и то же крепление описано в трёх
// местах — правило из документов, симулятор приложения и независимый эталон. Здесь проверяется, что все
// три говорят одно: в позе «руки вдоль тела» каждая ось датчика смотрит в одну и ту же сторону тела.
// Миры у симулятора и эталона разные (x вперёд, y влево / X вправо, Y вперёд) — сравниваются стороны тела.

import { describe, expect, it } from 'vitest';
import type { Placement } from '../devices/types';
import { bodyKinematics, restingPose } from '../simulation/kinematics';
import { sensorKinematics, uprightPose } from './body';
import { qRot, type V } from './quat';

type Side = 'вниз' | 'вверх' | 'вперёд' | 'назад' | 'вправо' | 'влево';

/** Правило крепления: прототип.md, раздел 3; hardware/models/enclosure/korpus_v3.py. */
const RULE: Record<Placement, [Side, Side, Side]> = {
  trunk: ['вниз', 'влево', 'вперёд'],
  upper_r: ['вниз', 'вперёд', 'вправо'],
  fore_r: ['вниз', 'вперёд', 'вправо'],
  upper_l: ['вниз', 'назад', 'влево'],
  fore_l: ['вниз', 'назад', 'влево'],
};

function label(v: V, dirs: Record<Side, V>): Side {
  let best: Side = 'вниз';
  let bestDot = -Infinity;
  for (const [name, d] of Object.entries(dirs) as [Side, V][]) {
    const dot = v[0] * d[0] + v[1] * d[1] + v[2] * d[2];
    if (dot > bestDot) {
      bestDot = dot;
      best = name;
    }
  }
  expect(bestDot).toBeGreaterThan(0.999);
  return best;
}

const SIM_DIRS: Record<Side, V> = { вниз: [0, 0, -1], вверх: [0, 0, 1], вперёд: [1, 0, 0], назад: [-1, 0, 0], вправо: [0, -1, 0], влево: [0, 1, 0] };
const REF_DIRS: Record<Side, V> = { вниз: [0, 0, -1], вверх: [0, 0, 1], вперёд: [0, 1, 0], назад: [0, -1, 0], вправо: [1, 0, 0], влево: [-1, 0, 0] };

describe('оси датчиков: документы, симулятор приложения и независимый эталон говорят одно', () => {
  const sim = bodyKinematics(restingPose());
  const ref = sensorKinematics(uprightPose());
  for (const p of Object.keys(RULE) as Placement[]) {
    it(`${p}: X — ${RULE[p][0]}, Y — ${RULE[p][1]}, Z — ${RULE[p][2]}`, () => {
      const R = sim[p].R;
      const simAxes = [0, 1, 2].map((c) => label([R[c] as number, R[3 + c] as number, R[6 + c] as number], SIM_DIRS));
      const refAxes = ([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as V[]).map((a) => label(qRot(ref[p].q, a), REF_DIRS));
      expect(simAxes).toEqual(RULE[p]);
      expect(refAxes).toEqual(RULE[p]);
    });
  }
});
