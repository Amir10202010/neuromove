// Сравнения между сеансами: прошлый, исходный, ряды для графиков динамики.
// Всё считается из сохранённых сеансов — отдельной «истории метрик» нет.

import { EXERCISES, type ExerciseId } from '../core/exercises';
import { symmetry, type StepSummary } from '../core/metrics';
import type { Side } from '../devices/types';
import type { AffectedSide, Patient, Session } from '../data/models';

export type MetricKey = 'rom' | 'symmetry' | 'sparc' | 'trunk';

export function stepOf(s: Session, exercise: ExerciseId, side: Side): StepSummary | null {
  const r = s.steps.find((x) => x.summary.exercise === exercise && x.summary.side === side && x.status !== 'skipped');
  return r && r.summary.reps.length > 0 ? r.summary : null;
}

export function patientSessions(all: readonly Session[], patientId: string): Session[] {
  return all.filter((s) => s.patientId === patientId).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/** Прошлый сеанс пациента, где было это движение этой стороной. */
export function previousWith(all: readonly Session[], s: Session, exercise: ExerciseId, side: Side): Session | null {
  const list = patientSessions(all, s.patientId).filter((x) => x.startedAt < s.startedAt && stepOf(x, exercise, side));
  return list[list.length - 1] ?? null;
}

export function previousSession(all: readonly Session[], s: Session): Session | null {
  const list = patientSessions(all, s.patientId).filter((x) => x.startedAt < s.startedAt);
  return list[list.length - 1] ?? null;
}

export function baselineWith(all: readonly Session[], patientId: string, exercise: ExerciseId, side: Side): Session | null {
  return patientSessions(all, patientId).find((x) => stepOf(x, exercise, side)) ?? null;
}

/** Главная сторона для графиков: поражённая; при поражении обеих — правая. */
export function focusSide(a: AffectedSide): Side {
  return a === 'left' ? 'left' : 'right';
}

export function otherSide(s: Side): Side {
  return s === 'left' ? 'right' : 'left';
}

export function sessionSymmetry(s: Session, exercise: ExerciseId, affected: AffectedSide): number | null {
  const l = stepOf(s, exercise, 'left');
  const r = stepOf(s, exercise, 'right');
  if (!l || !r) return null;
  return symmetry(l.rom, r.rom, affected);
}

export function metricValue(s: Session, exercise: ExerciseId, side: Side, metric: MetricKey, affected: AffectedSide): number | null {
  if (metric === 'symmetry') return sessionSymmetry(s, exercise, affected);
  const st = stepOf(s, exercise, side);
  if (!st) return null;
  const v = metric === 'rom' ? st.rom : metric === 'sparc' ? st.sparc : st.trunk;
  return v !== null && Number.isFinite(v) ? v : null;
}

export interface SeriesPoint {
  sessionId: string;
  date: string;
  value: number;
}

export function metricSeries(
  all: readonly Session[],
  patient: Patient,
  exercise: ExerciseId,
  side: Side,
  metric: MetricKey,
): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (const s of patientSessions(all, patient.id)) {
    const v = metricValue(s, exercise, side, metric, patient.affectedSide);
    if (v !== null) out.push({ sessionId: s.id, date: s.startedAt, value: v });
  }
  return out;
}

/**
 * Ожидаемый размах для порогов деления на повторы: последний измеренный у пациента,
 * иначе значение по умолчанию (для поражённой стороны — три четверти).
 */
export function expectedRomFn(all: readonly Session[], patient: Patient): (exercise: ExerciseId, side: Side) => number {
  const list = patientSessions(all, patient.id);
  return (exercise, side) => {
    for (let i = list.length - 1; i >= 0; i--) {
      const st = stepOf(list[i] as Session, exercise, side);
      if (st && Number.isFinite(st.rom)) return st.rom;
    }
    const affected = patient.affectedSide === side || patient.affectedSide === 'both';
    return EXERCISES[exercise].expectedRom * (affected ? 0.75 : 1);
  };
}

/** Стабильность повторов, %: 100 − медиана коэффициентов вариации по шагам. */
export function consistency(s: Session): number | null {
  const cvs = s.steps.map((x) => x.summary.cv).filter((v) => Number.isFinite(v));
  if (!cvs.length) return null;
  cvs.sort((a, b) => a - b);
  const m = cvs.length % 2 ? (cvs[cvs.length >> 1] as number) : ((cvs[cvs.length / 2 - 1] as number) + (cvs[cvs.length / 2] as number)) / 2;
  return Math.max(0, 100 - m);
}

export function weeksSince(fromIso: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / (7 * 86400000);
}
