// Общие подписи: строка о пациенте, текст наблюдений, названия сторон.

import type { ExerciseId } from '../../core/exercises';
import type { Alert, Level, Patient } from '../../data/models';
import type { Side } from '../../devices/types';
import type { Formatters, TFunction } from '../../i18n';

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
export function roman(l: Level | null): string {
  return l ? (ROMAN[l] as string) : '–';
}

export function ageOf(birthYear: number, now = new Date()): number {
  return Math.max(0, now.getFullYear() - birthYear);
}

/** «8 лет · Спастическая гемиплегия, правая сторона · GMFCS I · MACS II» */
export function patientLine(t: TFunction, p: Patient, withLevels = true): string {
  const parts = [t('common.yearsOld', { count: ageOf(p.birthYear) }), `${t(`cpForm.${p.cpForm}`)}${sideSuffix(t, p)}`];
  if (withLevels) parts.push(`GMFCS ${roman(p.gmfcs)}`, `MACS ${roman(p.macs)}`);
  return parts.join(' · ');
}

function sideSuffix(t: TFunction, p: Patient): string {
  if (p.affectedSide === 'left') return `, ${t('side.affectedLeft')}`;
  if (p.affectedSide === 'right') return `, ${t('side.affectedRight')}`;
  if (p.affectedSide === 'both') return `, ${t('side.affectedBoth')}`;
  return '';
}

export function armLabel(t: TFunction, side: Side): string {
  return side === 'left' ? t('side.leftArm') : t('side.rightArm');
}

export function exName(t: TFunction, ex: ExerciseId): string {
  return t(`exercise.${ex}.name`);
}

/** Текст наблюдения на языке интерфейса — из вида и параметров. Начинается с движения, поэтому с заглавной. */
export function alertText(t: TFunction, a: Alert): string {
  const s = alertBody(t, a);
  return s.charAt(0).toLocaleUpperCase() + s.slice(1);
}

function alertBody(t: TFunction, a: Alert): string {
  const p = a.params;
  const ex = typeof p.exercise === 'string' ? exName(t, p.exercise as ExerciseId).toLowerCase() : '';
  const side = p.side === 'left' ? t('side.leftArm').toLowerCase() : p.side === 'right' ? t('side.rightArm').toLowerCase() : '';
  switch (a.kind) {
    case 'rom_drop': {
      const base = t('alert.rom_drop', { delta: p.delta ?? 0, exercise: ex, side });
      const more = Number(p.more ?? 0);
      return more > 0 ? `${base} ${t('alert.rom_dropMore', { count: more })}` : base;
    }
    case 'trunk_compensation':
      return t('alert.trunk_compensation', { value: p.value ?? 0, exercise: ex, side });
    case 'signal_quality':
      return t('alert.signal_quality', { value: p.value ?? 0 });
    case 'goal_reached':
      return t('alert.goal_reached', { value: p.value ?? 0, target: p.target ?? 0, exercise: ex, side });
    case 'incomplete_session':
      return t('alert.incomplete_session', { done: p.done ?? 0, total: p.total ?? 0 });
    case 'measurement_conditions':
      return t('alert.measurement_conditions', { exercise: ex, side, flag: t(`report.flags.${String(p.flag) as 'upper_not_pinned'}`) });
    case 'plateau':
      return t('alert.plateau', { exercise: ex, side });
  }
}

export function greeting(t: TFunction, now = new Date()): string {
  const h = now.getHours();
  return h < 12 ? t('greeting.morning') : h < 18 ? t('greeting.day') : t('greeting.evening');
}

export function isSameDay(iso: string, d = new Date()): boolean {
  const a = new Date(iso);
  return a.getFullYear() === d.getFullYear() && a.getMonth() === d.getMonth() && a.getDate() === d.getDate();
}

export function durationLabel(f: Formatters, sec: number): string {
  return f.duration(sec);
}
