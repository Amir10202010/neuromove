// Проверка точности по записи с отметками эталона (софт.md, «Проверка точности»;
// SMART v2, пункт M1). На станке или гониометром выставляют угол — 0°, 30°, 60°, 90°, 120°,
// человек держит его около 3 с, и в запись ложится строка `# mark seq=1234 ref=90`.
//
// Здесь — те же формулы, что в живом тесте (`pipeline.ts`): калибровка по первым секундам
// записи, руки вдоль тела, затем угол движения. У каждой отметки берём медиану угла в окне
// вокруг неё и сравниваем с эталоном. Итог — средняя и наибольшая ошибка и пределы
// согласия Бланда — Альтмана. Порог записывается до замера и передаётся сюда, а не подбирается.

import type { Placement, RawFrame, Side } from '../devices/types';
import { mean, median, sd } from '../lib/stats';
import { EXERCISES, type ExerciseId } from './exercises';
import type { AccCalibration } from './imu';
import { Calibrator, MotionPipeline, exerciseSample, newElbowTrack, referenceFrom, type AngleReference } from './pipeline';

export interface ReferenceMark {
  seq: number;
  /** Угол эталона, градусы. */
  ref: number;
}

export interface MarkComparison extends ReferenceMark {
  /** Медиана угла прибора в окне вокруг отметки; null — в окне нет отсчётов. */
  measured: number | null;
  /** Прибор минус эталон, градусы. */
  error: number | null;
}

export interface ValidationResult {
  /** Почему проверка невозможна; null — посчитано. */
  problem: 'no_calibration' | 'rotation_unsupported' | 'no_marks' | null;
  marks: MarkComparison[];
  /** Сколько отметок сравнено. */
  n: number;
  /** Средняя абсолютная ошибка, градусы. */
  mae: number | null;
  maxAbs: number | null;
  /** Средняя разница «прибор − эталон» (систематическая ошибка). */
  bias: number | null;
  /** Пределы согласия Бланда — Альтмана: bias ± 1.96 SD. Нужно хотя бы 3 отметки. */
  limits: [number, number] | null;
  thresholdDeg: number;
  /** Средняя ошибка не больше порога. null — не посчитано. */
  passed: boolean | null;
}

export interface ValidationInput {
  frames: readonly RawFrame[];
  marks: readonly ReferenceMark[];
  rateHz: number;
  exercise: ExerciseId;
  side: Side;
  /** Порог средней ошибки из критериев, записанных до замера. SMART v2: 5°. */
  thresholdDeg?: number;
  /** Окно вокруг отметки, секунды: человек держит угол ~3 с, берём середину. */
  windowSec?: number;
  calibrationSec?: number;
  /** Поправки акселерометра из паспорта записи (`# cal_<место>=…`). Без них — как есть */
  accCal?: Partial<Record<Placement, AccCalibration>>;
}

export function validateRecording(input: ValidationInput): ValidationResult {
  const { frames, rateHz, exercise, side } = input;
  const thresholdDeg = input.thresholdDeg ?? 5;
  const half = Math.round(((input.windowSec ?? 1) * rateHz) / 2);
  const empty = (problem: ValidationResult['problem']): ValidationResult => ({
    problem,
    marks: input.marks.map((m) => ({ ...m, measured: null, error: null })),
    n: 0,
    mae: null,
    maxAbs: null,
    bias: null,
    limits: null,
    thresholdDeg,
    passed: null,
  });

  const def = EXERCISES[exercise];
  // Поворот предплечья требует установки «локоть 90°, нейтраль» — по одной записи её не поймать
  if (def.angle === 'rotation') return empty('rotation_unsupported');
  if (!input.marks.length) return empty('no_marks');

  // 1. Калибровка: неподвижная поза в начале записи; пошевелились — начинаем с этого места заново
  const accCal = input.accCal ?? {};
  const pipe = new MotionPipeline();
  pipe.setAccCal(accCal);
  let cal = new Calibrator(input.calibrationSec ?? 3).withAccCal(accCal);
  let ref: AngleReference | null = null;
  let i = 0;
  for (; i < frames.length && !ref; i++) {
    const f = frames[i] as RawFrame;
    pipe.process(f, rateHz);
    const r = cal.push(f);
    if (r === 'moved') cal = new Calibrator(input.calibrationSec ?? 3).withAccCal(accCal);
    if (r === 'done') {
      const res = cal.result();
      pipe.setBias(res.bias);
      pipe.seedUp(res.up);
      ref = referenceFrom(res);
    }
  }
  if (!ref) return empty('no_calibration');

  // 2. Угол движения на каждом отсчёте после калибровки
  const angleAt = new Map<number, number>();
  const elbowTrack = newElbowTrack();
  for (; i < frames.length; i++) {
    const f = frames[i] as RawFrame;
    pipe.process(f, rateHz);
    const s = exerciseSample(def, side, pipe, ref, 0, elbowTrack);
    if (s) angleAt.set(f.seq, s.angle);
  }

  // 3. Отметки: медиана угла в окне ±half отсчётов
  const marks: MarkComparison[] = input.marks.map((m) => {
    const window: number[] = [];
    for (let s = m.seq - half; s <= m.seq + half; s++) {
      const a = angleAt.get(s);
      if (a !== undefined) window.push(a);
    }
    if (!window.length) return { ...m, measured: null, error: null };
    const measured = median(window);
    return { ...m, measured, error: measured - m.ref };
  });

  const errors = marks.flatMap((m) => (m.error === null ? [] : [m.error]));
  if (!errors.length) return { ...empty(null), marks };
  const bias = mean(errors);
  const spread = errors.length >= 3 ? sd(errors) : null;
  const mae = mean(errors.map(Math.abs));
  return {
    problem: null,
    marks,
    n: errors.length,
    mae,
    maxAbs: Math.max(...errors.map(Math.abs)),
    bias,
    limits: spread === null ? null : [bias - 1.96 * spread, bias + 1.96 * spread],
    thresholdDeg,
    passed: mae <= thresholdDeg,
  };
}
