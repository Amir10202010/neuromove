// Каталог движений теста. Список по умолчанию — из софт.md и вопросов
// врачам (трекер.md): подъём руки вперёд, отведение в сторону,
// сгибание в локте с прижатым плечом, поворот предплечья. Утверждается с врачом.

export type ExerciseId = 'shoulder_flexion' | 'shoulder_abduction' | 'elbow_flexion' | 'forearm_rotation';

export const EXERCISE_IDS: readonly ExerciseId[] = [
  'shoulder_flexion',
  'shoulder_abduction',
  'elbow_flexion',
  'forearm_rotation',
];

export interface ExerciseDef {
  id: ExerciseId;
  /**
   * Как считается главный угол:
   *  - elevation — подъём плеча от положения «висит вниз» (датчик на плече);
   *  - elbow     — сгибание в плоскости шарнира локтя со знаком (pipeline.ts, elbowFlexion);
   *  - rotation  — поворот предплечья вокруг своей оси (супинация +, пронация −).
   */
  angle: 'elevation' | 'elbow' | 'rotation';
  /** Повтор: угол ушёл вверх и вернулся (single) или побывал по обе стороны от нуля (bidirectional). */
  reps: 'single' | 'bidirectional';
  /** Считаем ли наклон туловища — компенсацию. */
  trunk: boolean;
  /** Контроль условий теста: плечо прижато (локоть) или предплечье горизонтально (поворот). */
  check: 'none' | 'upper_lift' | 'forearm_level';
  /** Нужна ли установка перед записью: для поворота предплечье сначала выводят в горизонталь. */
  positioning: boolean;
  /** Ожидаемый размах, если прошлых тестов нет. Нужен для порогов деления на повторы. */
  expectedRom: number;
  /** Шкала угломера на экране. */
  gauge: { min: number; max: number };
}

export const EXERCISES: Record<ExerciseId, ExerciseDef> = {
  shoulder_flexion: {
    id: 'shoulder_flexion',
    angle: 'elevation',
    reps: 'single',
    trunk: true,
    check: 'none',
    positioning: false,
    expectedRom: 140,
    gauge: { min: 0, max: 180 },
  },
  shoulder_abduction: {
    id: 'shoulder_abduction',
    angle: 'elevation',
    reps: 'single',
    trunk: true,
    check: 'none',
    positioning: false,
    expectedRom: 130,
    gauge: { min: 0, max: 180 },
  },
  elbow_flexion: {
    id: 'elbow_flexion',
    angle: 'elbow',
    reps: 'single',
    trunk: false,
    check: 'upper_lift',
    positioning: false,
    expectedRom: 125,
    gauge: { min: 0, max: 160 },
  },
  forearm_rotation: {
    id: 'forearm_rotation',
    angle: 'rotation',
    reps: 'bidirectional',
    trunk: false,
    check: 'forearm_level',
    positioning: true,
    expectedRom: 120,
    gauge: { min: -90, max: 90 },
  },
};

/**
 * Пороги деления на повторы — доли ожидаемого размаха (как в reps.py: low 20%, high 80%),
 * но с запасом вниз: ребёнок может не дотянуть до прошлого результата, и тогда повтор
 * с порогом 80% не засчитался бы вовсе. Поэтому high — 45% ожидаемого, не меньше 25°.
 */
export function repThresholds(def: ExerciseDef, expectedRom: number): { low: number; high: number } {
  if (def.reps === 'bidirectional') {
    // Для поворота размах делится на две стороны: супинацию и пронацию
    const high = Math.max(12, 0.2 * expectedRom);
    return { low: high * 0.5, high };
  }
  const high = Math.max(25, 0.45 * expectedRom);
  return { low: Math.max(10, 0.2 * expectedRom), high };
}
