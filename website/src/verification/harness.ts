// Обвязка эталона: запись от генератора → настоящий движок сеанса приложения → ошибки.
//
// Угол берётся ровно там, где его видит специалист: `SessionEngine.live.angle` после каждого
// отсчёта (калибровка, установка для поворота, повторы — всё как в живом тесте). Объём движения —
// из итога движка по каждому повтору. Сравнение — с эталоном, посчитанным по положению костей.

import type { ExerciseId } from '../core/exercises';
import type { AccCalibration } from '../core/imu';
import type { Placement, RawFrame, Side } from '../devices/types';
import { SessionEngine } from '../session/SessionEngine';
import type { BodyTruth } from './body';
import type { Generated } from './gen';

export interface ErrStats {
  /** Сколько отсчётов сравнено. */
  n: number;
  /** Доля отсчётов окна, где прибор дал угол, %. */
  coverage: number;
  /** Средняя ошибка со знаком: прибор − эталон. */
  bias: number;
  mae: number;
  rmse: number;
  p95: number;
  max: number;
}

export function errStats(errors: readonly number[], expected: number): ErrStats {
  const n = errors.length;
  if (!n) return { n: 0, coverage: 0, bias: NaN, mae: NaN, rmse: NaN, p95: NaN, max: NaN };
  const abs = errors.map(Math.abs).sort((a, b) => a - b);
  const sum = errors.reduce((s, x) => s + x, 0);
  const sq = errors.reduce((s, x) => s + x * x, 0);
  return {
    n,
    coverage: (100 * n) / Math.max(1, expected),
    bias: sum / n,
    mae: abs.reduce((s, x) => s + x, 0) / n,
    rmse: Math.sqrt(sq / n),
    p95: abs[Math.min(n - 1, Math.floor(0.95 * (n - 1)))] as number,
    max: abs[n - 1] as number,
  };
}

export interface RepCheck {
  index: number;
  tStart: number;
  tEnd: number;
  rom: number;
  romTruth: number;
  error: number;
}

export interface EngineRun {
  /** Время отсчёта, угол прибора (null — прибор угла не дал) и эталон. */
  t: number[];
  angle: (number | null)[];
  truth: number[];
  trunk: (number | null)[];
  trunkTruth: number[];
  /** Когда движок начал записывать угол (после калибровки и установки). */
  recordingFrom: number | null;
  reps: RepCheck[];
  flags: string[];
  saturated: number;
  calibrationAttempts: number;
  /** Ошибка угла на отсчётах из окна `window` (по умолчанию — вся запись после начала). */
  stats: ErrStats;
  trunkStats: ErrStats;
}

export interface EngineRunOptions {
  exercise: ExerciseId;
  side: Side;
  /** Какой угол эталона сравнивать с прибором. */
  truthOf: (b: BodyTruth) => number;
  accCal?: Partial<Record<Placement, AccCalibration>>;
  /** Окна времени для статистики, [от, до], секунды; по умолчанию — всё после начала записи + 0,5 с. */
  windows?: readonly (readonly [number, number])[];
  /** Что дошло до движка вместо кадра: null — кадр потерян, несколько кадров — повтор или вставка. */
  deliver?: (f: RawFrame, i: number) => RawFrame[] | null;
  expectedRom?: number;
}

/** Прогон записи через `SessionEngine` — тот же путь, что живой тест. */
export function runEngine(gen: Generated, o: EngineRunOptions): EngineRun {
  const engine = new SessionEngine({
    steps: [{ exercise: o.exercise, side: o.side, reps: 0, durationSec: 1e9 }],
    rateHz: gen.rateHz,
    autoAdvance: false,
    ...(o.accCal ? { accCal: o.accCal } : {}),
    ...(o.expectedRom ? { expectedRom: () => o.expectedRom as number } : {}),
  });
  engine.start();
  const t: number[] = [];
  const angle: (number | null)[] = [];
  const truthA: number[] = [];
  const trunk: (number | null)[] = [];
  const trunkTruth: number[] = [];
  let recordingFrom: number | null = null;
  gen.frames.forEach((f, i) => {
    const batch = o.deliver ? o.deliver(f, i) : [f];
    if (batch === null) return;
    for (const fr of batch) engine.process([fr]);
    const phase = engine.currentPhase;
    const recording = phase === 'recording';
    if (recording && recordingFrom === null) recordingFrom = f.t;
    t.push(f.t);
    angle.push(recording ? engine.live.angle : null);
    truthA.push(o.truthOf(gen.truth[i] as BodyTruth));
    trunk.push(recording ? engine.live.trunk : null);
    trunkTruth.push((gen.truth[i] as BodyTruth).trunkTilt);
  });
  engine.stop();
  const res = engine.result();
  const step = res.steps[0];
  const reps: RepCheck[] = (step?.summary.reps ?? []).map((r) => {
    let romTruth = -Infinity;
    for (let i = 0; i < t.length; i++) {
      const ti = t[i] as number;
      if (ti >= r.tStart - 1e-9 && ti <= r.tEnd + 1e-9) romTruth = Math.max(romTruth, truthA[i] as number);
    }
    return { index: r.index, tStart: r.tStart, tEnd: r.tEnd, rom: r.rom, romTruth, error: r.rom - romTruth };
  });

  const from = (recordingFrom ?? Infinity) + 0.5;
  const windows = o.windows ?? [[from, Infinity]];
  const inWindow = (x: number) => windows.some(([a, b]) => x >= a && x <= b && x >= from);
  const errs: number[] = [];
  const trunkErrs: number[] = [];
  let expected = 0;
  for (let i = 0; i < t.length; i++) {
    if (!inWindow(t[i] as number)) continue;
    expected += 1;
    const a = angle[i];
    if (a !== null && a !== undefined) errs.push(a - (truthA[i] as number));
    const tr = trunk[i];
    if (tr !== null && tr !== undefined) trunkErrs.push(tr - (trunkTruth[i] as number));
  }
  return {
    t,
    angle,
    truth: truthA,
    trunk,
    trunkTruth,
    recordingFrom,
    reps,
    flags: step?.summary.flags ?? [],
    saturated: res.quality.saturated,
    calibrationAttempts: res.calibrationAttempts,
    stats: errStats(errs, expected),
    trunkStats: errStats(trunkErrs, expected),
  };
}

/** Короткая запись числа для таблиц: 2 знака. */
export function r2(x: number): number {
  return Math.round(x * 100) / 100;
}
