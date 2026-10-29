// Метрики — перенос metrics.py. Формулы открытые: врач первым делом спросит «как посчитано?».
//
// | Метрика            | Формула                                                        |
// |--------------------|----------------------------------------------------------------|
// | ROM (объём)        | максимум угла в каждом повторе, в отчёт — медиана повторов      |
// | Плавность (SPARC)  | по профилю угловой скорости с гироскопа, фаза подъёма повтора   |
// | Компенсация        | максимальный наклон туловища за повтор, медиана повторов        |
// | Стабильность       | коэффициент вариации ROM между повторами, %                    |
// | Симметрия          | ROM поражённой стороны / ROM менее поражённой × 100%            |
// Медиана, а не среднее: один неудачный повтор не портит число.

import type { Side } from '../devices/types';
import { cvPercent, max, median } from '../lib/stats';
import type { ExerciseDef, ExerciseId } from './exercises';
import type { RepWindow } from './reps';
import { sparc } from './sparc';

/** Отсчёты одного шага теста (одно движение одной рукой). */
export interface StepBuffers {
  t: number[];
  angle: number[];
  speed: number[];
  trunk: (number | null)[];
  check: (number | null)[];
}

export function emptyBuffers(): StepBuffers {
  return { t: [], angle: [], speed: [], trunk: [], check: [] };
}

export interface RepMetrics {
  index: number;
  tStart: number;
  tEnd: number;
  /** Объём движения, градусы. Для поворота — дуга супинация + пронация. */
  rom: number;
  /** Только для поворота предплечья. */
  supination: number | null;
  pronation: number | null;
  sparc: number;
  /** Пиковая угловая скорость, °/с. */
  peakVelocity: number;
  duration: number;
  /** Максимальный наклон туловища за повтор, градусы. */
  trunk: number | null;
  /** Контроль условий теста за повтор (см. ExerciseSample.check). */
  check: number | null;
}

export function repMetrics(def: ExerciseDef, b: StepBuffers, w: RepWindow, index: number, fs: number): RepMetrics {
  const s = w.start;
  const e = Math.max(w.end, s + 1);
  let peakIdx = s;
  let maxA = -Infinity;
  let minA = Infinity;
  for (let k = s; k <= e && k < b.angle.length; k++) {
    const a = b.angle[k] as number;
    if (a > maxA) {
      maxA = a;
      peakIdx = k;
    }
    if (a < minA) minA = a;
  }
  // Плавность считаем на фазе подъёма — это одно законченное движение против силы тяжести.
  // Начало повтора по порогу угла приходится уже на движение, поэтому начало подъёма
  // ищем назад по скорости: пока скорость выше 5% пиковой (так размечают движение в статье SPARC).
  let peakSpeed = 0;
  for (let k = s; k <= peakIdx; k++) peakSpeed = Math.max(peakSpeed, b.speed[k] as number);
  let onset = s;
  const lookback = Math.max(0, s - Math.round(fs * 2));
  while (onset > lookback && (b.speed[onset - 1] as number) > 0.05 * peakSpeed) onset -= 1;
  const rise = b.speed.slice(onset, peakIdx + 1);
  const trunkVals = b.trunk.slice(s, e + 1).filter((x): x is number => x !== null);
  const checkVals = b.check.slice(s, e + 1).filter((x): x is number => x !== null);
  const bidirectional = def.reps === 'bidirectional';

  let check: number | null = null;
  if (checkVals.length) {
    if (def.check === 'forearm_level') {
      // Насколько предплечье ушло от горизонтали (90°) — худший момент повтора
      check = max(checkVals.map((v) => Math.abs(v - 90)));
    } else {
      check = max(checkVals);
    }
  }

  return {
    index,
    tStart: b.t[s] ?? 0,
    tEnd: b.t[Math.min(e, b.t.length - 1)] ?? 0,
    rom: bidirectional ? maxA + Math.max(0, -minA) : maxA,
    supination: bidirectional ? maxA : null,
    pronation: bidirectional ? Math.max(0, -minA) : null,
    sparc: rise.length >= 8 ? sparc(rise, fs) : NaN,
    peakVelocity: max(b.speed.slice(s, e + 1)),
    duration: (b.t[Math.min(e, b.t.length - 1)] ?? 0) - (b.t[s] ?? 0),
    trunk: trunkVals.length ? max(trunkVals) : null,
    check,
  };
}

/** Все пометки шага — один список: по нему же проверяется архив (data/backup.ts), иначе новая пометка сделала бы архив «испорченным». */
export const STEP_FLAGS = ['few_reps', 'upper_not_pinned', 'forearm_not_level', 'saturation', 'data_gap', 'sensor_lost', 'calibration_moved', 'mount_flipped', 'skipped'] as const;
export type StepFlag = (typeof STEP_FLAGS)[number];

export interface StepSummary {
  exercise: ExerciseId;
  side: Side;
  targetReps: number;
  reps: RepMetrics[];
  rom: number;
  romBest: number;
  supination: number | null;
  pronation: number | null;
  sparc: number;
  peakVelocity: number;
  repDuration: number;
  trunk: number | null;
  check: number | null;
  /** Коэффициент вариации ROM между повторами, %. */
  cv: number;
  flags: StepFlag[];
}

/** Пороги для пометок качества — не клинические нормы, а условия корректного замера. */
export const QUALITY_LIMITS = {
  upperLift: 20, // плечо оторвалось больше чем на 20° — угол локтя может быть неточен
  forearmLevel: 25, // предплечье ушло от горизонтали больше чем на 25° — поворот неточен
};

export function summarizeStep(
  def: ExerciseDef,
  side: Side,
  reps: RepMetrics[],
  targetReps: number,
  extraFlags: StepFlag[] = [],
): StepSummary {
  const med = (f: (r: RepMetrics) => number | null) => {
    const v = reps.map(f).filter((x): x is number => x !== null && Number.isFinite(x));
    return v.length ? median(v) : NaN;
  };
  const trunk = med((r) => r.trunk);
  const check = med((r) => r.check);
  const flags: StepFlag[] = [...extraFlags];
  if (reps.length < targetReps && !flags.includes('skipped')) flags.push('few_reps');
  if (def.check === 'upper_lift' && check > QUALITY_LIMITS.upperLift) flags.push('upper_not_pinned');
  if (def.check === 'forearm_level' && check > QUALITY_LIMITS.forearmLevel) flags.push('forearm_not_level');
  return {
    exercise: def.id,
    side,
    targetReps,
    reps,
    rom: med((r) => r.rom),
    romBest: reps.length ? max(reps.map((r) => r.rom)) : NaN,
    supination: def.reps === 'bidirectional' ? med((r) => r.supination) : null,
    pronation: def.reps === 'bidirectional' ? med((r) => r.pronation) : null,
    sparc: med((r) => r.sparc),
    peakVelocity: med((r) => r.peakVelocity),
    repDuration: med((r) => r.duration),
    trunk: Number.isFinite(trunk) ? trunk : null,
    check: Number.isFinite(check) ? check : null,
    cv: cvPercent(reps.map((r) => r.rom)),
    flags: [...new Set(flags)],
  };
}

/**
 * Симметрия, %: ROM поражённой стороны / ROM менее поражённой × 100.
 * «Правая — 80% от левой». Если поражены обе стороны — меньшая к большей.
 */
export function symmetry(left: number, right: number, affected: Side | 'both' | 'none'): number | null {
  if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) return null;
  if (affected === 'left') return (left / right) * 100;
  if (affected === 'right') return (right / left) * 100;
  return (Math.min(left, right) / Math.max(left, right)) * 100;
}

/** Полнота данных, %: сколько отсчётов дошло из ожидаемых. */
export function signalQuality(received: number, lost: number, saturated: number): number {
  const total = received + lost;
  if (total === 0) return NaN;
  return Math.max(0, ((received - saturated) / total) * 100);
}
