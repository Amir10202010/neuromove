// Черновик заключения по сеансу — по правилам, из измерений. Без ИИ: данные детей
// не уходят во внешние сервисы, а каждая фраза проверяема по таблице отчёта.
// Специалист правит черновик и сам решает, что в нём оставить.

import { EXERCISE_IDS } from '../core/exercises';
import type { Patient, Session } from '../data/models';
import type { Side } from '../devices/types';
import type { Formatters, TFunction } from '../i18n';
import { baselineWith, focusSide, otherSide, patientSessions, previousWith, sessionSymmetry, stepOf } from './compare';

export function buildSummary(t: TFunction, f: Formatters, s: Session, patient: Patient, all: readonly Session[]): string {
  const lines: string[] = [];
  const list = patientSessions(all, patient.id);
  const n = list.findIndex((x) => x.id === s.id) + 1 || list.length + 1;
  lines.push(t('summary.header', { n, protocol: t(`protocol.${s.protocolId}`).toLowerCase(), date: f.dateEnd(s.startedAt) }));

  const both = patient.affectedSide === 'both';
  const focus: Side = focusSide(patient.affectedSide);
  const arm = (side: Side) => t(`summary.armNominative.${side}`);

  for (const ex of EXERCISE_IDS) {
    const main = stepOf(s, ex, focus);
    const oth = stepOf(s, ex, otherSide(focus));
    if (!main && !oth) continue;
    const parts: string[] = [];
    if (main) {
      let line = t('summary.exerciseLine', { exercise: t(`exercise.${ex}.name`), affectedArm: arm(focus), rom: Math.round(main.rom) });
      const prev = previousWith(all, s, ex, focus);
      const prevStep = prev ? stepOf(prev, ex, focus) : null;
      const base = baselineWith(all, patient.id, ex, focus);
      const baseStep = base && base.id !== s.id ? stepOf(base, ex, focus) : null;
      const deltas: string[] = [];
      if (prevStep) deltas.push(t('summary.vsPrev', { delta: f.deltaDeg(main.rom - prevStep.rom).replace('°', '') }));
      if (baseStep && base?.id !== prev?.id) deltas.push(t('summary.vsBaseline', { delta: f.deltaDeg(main.rom - baseStep.rom).replace('°', '') }));
      if (deltas.length) line += ` (${deltas.join(', ')})`;
      parts.push(line);
    }
    if (oth) parts.push(t('summary.otherLine', { otherArm: arm(otherSide(focus)), rom: Math.round(oth.rom) }));
    const sym = sessionSymmetry(s, ex, patient.affectedSide);
    if (sym !== null && !both) parts.push(t('summary.symmetry', { value: Math.round(sym) }));
    lines.push(`${parts.join('; ')}.`);
  }

  // Компенсация туловищем и плавность — по подъёму руки вперёд на главной стороне
  const flex = stepOf(s, 'shoulder_flexion', focus);
  if (flex?.trunk != null) {
    const prev = previousWith(all, s, 'shoulder_flexion', focus);
    const prevTrunk = prev ? stepOf(prev, 'shoulder_flexion', focus)?.trunk : null;
    let line = t('summary.trunk', { arm: t(`summary.armGenitive.${focus}`), value: Math.round(flex.trunk) });
    if (prevTrunk != null) line += ` ${t('summary.trunkWas', { value: Math.round(prevTrunk) })}`;
    lines.push(`${line}.`);
  }
  if (flex && Number.isFinite(flex.sparc)) {
    const other = stepOf(s, 'shoulder_flexion', otherSide(focus));
    let line = t('summary.sparc', { arm: t(`summary.armPossessive.${focus}`), value: f.num(flex.sparc, 2) });
    if (other && Number.isFinite(other.sparc)) line += ` ${t('summary.sparcOther', { value: f.num(other.sparc, 2) })}`;
    lines.push(`${line}.`);
  }

  for (const g of patient.goals) {
    const st = stepOf(s, g.exercise, g.side);
    if (st) lines.push(t('summary.goal', { target: g.targetRom, exercise: t(`exercise.${g.exercise}.name`).toLowerCase(), value: Math.round(st.rom) }));
  }

  const q = Math.round(s.quality.percent * 10) / 10;
  lines.push(q < 95 ? t('summary.qualityLow', { value: q }) : t('summary.quality', { value: q }));
  if (s.status === 'incomplete') lines.push(t('summary.incomplete'));
  lines.push('');
  lines.push(t('summary.footer'));
  return lines.join('\n');
}
