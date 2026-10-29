// Наблюдения после сеанса — правила на измерениях, не диагноз и не рекомендация.
// Пороги — условия внимания для специалиста, а не клинические нормы:
//   • объём упал на 10° и больше к прошлому сеансу;
//   • наклон туловища 12° и больше и вырос на 4° и больше;
//   • полнота данных ниже 95% — метрики трактовать осторожно;
//   • достигнута цель, поставленная специалистом;
//   • сеанс прерван досрочно;
//   • условия замера нарушены (плечо не прижато, предплечье не горизонтально);
//   • плато: 4 сеанса подряд размах объёма не больше 6° и тренд меньше 1° за сеанс.

import { EXERCISES, type ExerciseId } from '../core/exercises';
import type { Side } from '../devices/types';
import type { Alert, Goal, Patient, Session, Workspace } from '../data/models';
import { newId } from '../lib/ids';
import { slope } from '../lib/stats';
import { focusSide, patientSessions, previousWith, stepOf } from './compare';

export const ALERT_RULES = {
  romDrop: 10,
  trunkLevel: 12,
  trunkRise: 4,
  quality: 95,
  plateauSessions: 4,
  plateauRange: 6,
  plateauSlope: 1,
};

/**
 * Плато: последние 4 значения в пределах 6° и тренд меньше 1° за сеанс.
 * Одного размаха мало: при ровном росте на 2–3° шум измерения иногда сужает его до 6°.
 * Общее правило для наблюдений и для списка «как идут дела» (session/story.ts).
 */
export function isPlateau(w: readonly number[]): boolean {
  return (
    w.length === ALERT_RULES.plateauSessions &&
    Math.max(...w) - Math.min(...w) <= ALERT_RULES.plateauRange &&
    Math.abs(slope(w.map((_, i) => i), [...w])) < ALERT_RULES.plateauSlope
  );
}

export interface AlertOutcome {
  alerts: Alert[];
  /** Цели, достигнутые в этом сеансе. */
  achievedGoals: Goal[];
}

export function evaluateSession(session: Session, patient: Patient, all: readonly Session[], ws: Workspace): AlertOutcome {
  const alerts: Alert[] = [];
  const make = (kind: Alert['kind'], severity: Alert['severity'], params: Alert['params']): Alert => ({
    id: newId('al'),
    workspace: ws,
    patientId: patient.id,
    sessionId: session.id,
    kind,
    severity,
    createdAt: session.endedAt,
    params,
    acknowledged: false,
  });

  const sides: Side[] = patient.affectedSide === 'both' ? ['left', 'right'] : [focusSide(patient.affectedSide)];
  // Падение объёма: одно наблюдение на сеанс — самое большое падение, остальные в счётчике
  let worstDrop: { exercise: ExerciseId; side: Side; delta: number; prev: number; cur: number } | null = null;
  let drops = 0;

  for (const step of session.steps) {
    const sum = step.summary;
    if (!sides.includes(sum.side) || !sum.reps.length) continue;
    const ex = sum.exercise;

    const prev = previousWith(all, session, ex, sum.side);
    const prevStep = prev ? stepOf(prev, ex, sum.side) : null;
    if (prevStep && prevStep.rom - sum.rom >= ALERT_RULES.romDrop) {
      drops += 1;
      const delta = Math.round(prevStep.rom - sum.rom);
      if (!worstDrop || delta > worstDrop.delta)
        worstDrop = { exercise: ex, side: sum.side, delta, prev: Math.round(prevStep.rom), cur: Math.round(sum.rom) };
    }
    if (EXERCISES[ex].trunk && sum.trunk !== null && sum.trunk >= ALERT_RULES.trunkLevel) {
      const rise = prevStep?.trunk != null ? sum.trunk - prevStep.trunk : Infinity;
      if (rise >= ALERT_RULES.trunkRise) {
        alerts.push(make('trunk_compensation', 'attention', { exercise: ex, side: sum.side, value: Math.round(sum.trunk) }));
      }
    }
    // Нарушение условий замера — только когда оно новое: повторяющееся уже известно специалисту
    const cond = sum.flags.find((f) => f === 'upper_not_pinned' || f === 'forearm_not_level');
    if (cond && !prevStep?.flags.includes(cond)) {
      alerts.push(make('measurement_conditions', 'info', { exercise: ex, side: sum.side, flag: cond }));
    }
  }

  if (worstDrop) alerts.push(make('rom_drop', 'attention', { ...worstDrop, more: drops - 1 }));

  // Плато по главному движению — подъём руки вперёд на поражённой стороне
  const main: ExerciseId = 'shoulder_flexion';
  const fs = focusSide(patient.affectedSide);
  const history = [...patientSessions(all, patient.id).filter((s) => s.startedAt < session.startedAt), session]
    .map((s) => stepOf(s, main, fs)?.rom)
    .filter((v): v is number => v !== undefined && Number.isFinite(v));
  const lastN = history.slice(-ALERT_RULES.plateauSessions);
  const prevWindow = history.slice(-ALERT_RULES.plateauSessions - 1, -1);
  if (isPlateau(lastN) && !isPlateau(prevWindow)) alerts.push(make('plateau', 'info', { exercise: main, side: fs }));

  if (session.quality.percent < ALERT_RULES.quality) {
    alerts.push(make('signal_quality', 'warning', { value: Math.round(session.quality.percent * 10) / 10 }));
  }

  if (session.status === 'incomplete') {
    const done = session.steps.filter((s) => s.status !== 'skipped').length;
    alerts.push(make('incomplete_session', 'info', { done, total: session.steps.length }));
  }

  const achievedGoals: Goal[] = [];
  for (const g of patient.goals) {
    if (g.achievedAt) continue;
    const st = stepOf(session, g.exercise, g.side);
    if (st && st.rom >= g.targetRom) {
      achievedGoals.push({ ...g, achievedAt: session.endedAt });
      alerts.push(make('goal_reached', 'info', { exercise: g.exercise, side: g.side, value: Math.round(st.rom), target: g.targetRom }));
    }
  }

  return { alerts, achievedGoals };
}
