// Протоколы теста: какие движения, какой рукой, сколько повторов.
// По умолчанию каждое движение — 3 раза на каждой стороне (софт.md, «Экраны»).
// Сначала менее поражённая сторона: её результат — ориентир для поражённой.

import type { Side } from '../devices/types';
import { EXERCISES, type ExerciseId } from './exercises';

export type ProtocolId = 'upper_standard' | 'upper_quick' | 'elbow_endurance' | 'custom' | 'single';

export interface ProtocolTemplate {
  id: ProtocolId;
  exercises: ExerciseId[];
  /** Обе стороны или только поражённая. */
  sides: 'both' | 'affected';
  reps: number;
  /** Для теста на выносливость: шаг длится заданное время, а не число повторов. */
  durationSec?: number;
}

export const PROTOCOLS: Record<Exclude<ProtocolId, 'custom' | 'single'>, ProtocolTemplate> = {
  upper_standard: {
    id: 'upper_standard',
    exercises: ['shoulder_flexion', 'shoulder_abduction', 'elbow_flexion', 'forearm_rotation'],
    sides: 'both',
    reps: 3,
  },
  upper_quick: {
    id: 'upper_quick',
    exercises: ['shoulder_flexion', 'elbow_flexion'],
    sides: 'both',
    reps: 3,
  },
  elbow_endurance: {
    id: 'elbow_endurance',
    exercises: ['elbow_flexion'],
    sides: 'affected',
    reps: 0,
    durationSec: 60,
  },
};

/**
 * Проверка одним датчиком: движения, угол которых один датчик считает так же, как полный комплект.
 * На плече — подъём руки вперёд и в сторону, на предплечье — поворот. Это проверка железа и одного
 * угла против гониометра, не оценка пациента: без датчика груди не видна компенсация туловищем.
 *
 * Сгибания в локте здесь нет. Одним датчиком на предплечье локоть считается только при неподвижном
 * плече, а ребёнок с ДЦП поднимает плечо. На модели пациента ошибка равна отрыву плеча:
 * 5° при лёгком поражении, 9–10° при среднем, 14° и 18–19° при тяжёлом (22 октября 2026,
 * log/2026-10-22-один-датчик.md) — больше порога точности 5°.
 */
export const SINGLE_SENSOR_EXERCISES: Record<'upper' | 'fore', ExerciseId[]> = {
  upper: ['shoulder_flexion', 'shoulder_abduction'],
  fore: ['forearm_rotation'],
};

/** Шаги теста одним датчиком: выбранные движения одной рукой, в порядке каталога. */
export function singleSensorSteps(segment: 'upper' | 'fore', side: Side, exercises: readonly ExerciseId[], reps: number): ProtocolStep[] {
  return SINGLE_SENSOR_EXERCISES[segment].filter((e) => exercises.includes(e)).map((exercise) => ({ exercise, side, reps }));
}

export interface ProtocolStep {
  exercise: ExerciseId;
  side: Side;
  /** Сколько повторов засчитать; 0 — без ограничения (шаг по времени). */
  reps: number;
  durationSec?: number;
}

/** Порядок сторон: сначала менее поражённая. При поражении обеих — левая, потом правая. */
export function sideOrder(affected: Side | 'both' | 'none'): Side[] {
  if (affected === 'left') return ['right', 'left'];
  if (affected === 'right') return ['left', 'right'];
  return ['left', 'right'];
}

export function resolveSteps(t: ProtocolTemplate, affected: Side | 'both' | 'none'): ProtocolStep[] {
  const steps: ProtocolStep[] = [];
  const sides: Side[] =
    t.sides === 'affected' ? [affected === 'left' ? 'left' : 'right'] : sideOrder(affected);
  for (const ex of t.exercises) {
    for (const side of sides) {
      steps.push({ exercise: ex, side, reps: t.reps, ...(t.durationSec ? { durationSec: t.durationSec } : {}) });
    }
  }
  return steps;
}

/** Оценка длительности, секунды: ~5 с на повтор, 6 с на переход, калибровка и надевание. */
export function estimateSeconds(steps: readonly ProtocolStep[]): number {
  let s = 20; // калибровка и подготовка
  for (const st of steps) {
    const perRep = st.exercise === 'forearm_rotation' ? 6.5 : 5;
    s += 6 + (st.durationSec ?? st.reps * perRep) + (EXERCISES[st.exercise].positioning ? 3 : 0);
  }
  return s;
}
