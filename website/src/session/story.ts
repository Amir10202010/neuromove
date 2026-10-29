// Главное о курсе и о сеансе — для простого вида карточки пациента, отчёта о сеансе
// и стартовой страницы. Одна логика на всех, чтобы цифры везде совпадали:
//  • ряд метрики по сеансам (metricSeries), изменение = последнее − первое без округления —
//    как на плитках карточки пациента; округляется только показ;
//  • слова «выше / ниже / без изменений» — по порогам «Отчёта для семьи»:
//    объём и симметрия — 3, наклон туловища — 2.

import { EXERCISE_IDS, type ExerciseId } from '../core/exercises';
import type { StepFlag } from '../core/metrics';
import type { Patient, Session } from '../data/models';
import type { Side } from '../devices/types';
import { ALERT_RULES, isPlateau } from './alerts';
import { focusSide, metricSeries, otherSide, patientSessions, previousWith, stepOf, type MetricKey } from './compare';

/** Как изменилось: вверх, вниз или примерно так же. */
export type Trend = 'up' | 'down' | 'same';

export function trendOf(now: number | null, was: number | null, threshold: number): Trend | null {
  if (now === null || was === null) return null;
  if (now - was >= threshold) return 'up';
  if (was - now >= threshold) return 'down';
  return 'same';
}

/** Пороги слов: меньше — «без изменений». */
export const TREND_THRESHOLD = { rom: 3, symmetry: 3, trunk: 2 } as const;

/**
 * Разница показанных чисел: если на экране «было 127°» и «сейчас 146°», изменение —
 * «+19°», а не «+20°» из неокруглённых 126.6 и 146.4. Для простого вида, где видны оба
 * числа; подробные плитки и таблицы по-прежнему считают без округления.
 */
export function shownDelta(now: number, was: number): number {
  return Math.round(now) - Math.round(was);
}

/**
 * Слово по той разнице, которую человек видит на экране: «9° · было 11°» — это «меньше»,
 * даже если без округления вышло 9.45 и 11.4. Иначе слово спорит с цифрами рядом.
 */
export function shownTrend(now: number | null, was: number | null, threshold: number): Trend | null {
  if (now === null || was === null) return null;
  return trendOf(Math.round(now), Math.round(was), threshold);
}

export interface CourseStory {
  code: string;
  /** Поражённая рука (при поражении обеих — правая), о ней вся история. */
  side: Side;
  /** Подъём руки вперёд: первый и последний сеанс, градусы (без округления). */
  first: number;
  last: number;
  /** last − first. */
  delta: number;
  /** Симметрия подъёма вперёд, % от другой руки. */
  symWas: number | null;
  symNow: number | null;
  /** Обе руки в том же сеансе, что symNow: из них и считается симметрия — для картинки. */
  pairNow: { main: number; other: number } | null;
  /** Наклон туловища при подъёме — помощь корпусом, градусы. */
  trunkWas: number | null;
  trunkNow: number | null;
  /** Цель врача по подъёму вперёд этой рукой. */
  goal: { target: number; due: string | null; reached: boolean } | null;
  sessions: number;
}

/** Первое и последнее значение метрики подъёма вперёд по курсу. */
function ends(all: readonly Session[], patient: Patient, side: Side, metric: MetricKey): [number, number] | null {
  const s = metricSeries(all, patient, 'shoulder_flexion', side, metric);
  const a = s[0];
  const b = s[s.length - 1];
  return a && b && s.length > 1 ? [a.value, b.value] : null;
}

/** Главное о курсе. null — меньше двух сеансов с подъёмом руки вперёд: сравнивать не с чем. */
export function courseStory(all: readonly Session[], patient: Patient): CourseStory | null {
  const side = focusSide(patient.affectedSide);
  const rom = ends(all, patient, side, 'rom');
  if (!rom) return null;
  const sym = ends(all, patient, side, 'symmetry');
  const trunk = ends(all, patient, side, 'trunk');
  const goal = patient.goals.find((g) => g.exercise === 'shoulder_flexion' && g.side === side);
  // Последний сеанс, где подняты обе руки, — тот же, из которого symNow
  let pairNow: CourseStory['pairNow'] = null;
  for (const s of patientSessions(all, patient.id)) {
    const m = stepOf(s, 'shoulder_flexion', side);
    const o = stepOf(s, 'shoulder_flexion', otherSide(side));
    if (m && o) pairNow = { main: m.rom, other: o.rom };
  }
  return {
    code: patient.code,
    side,
    first: rom[0],
    last: rom[1],
    delta: rom[1] - rom[0],
    symWas: sym?.[0] ?? null,
    symNow: sym?.[1] ?? null,
    pairNow,
    trunkWas: trunk?.[0] ?? null,
    trunkNow: trunk?.[1] ?? null,
    goal: goal ? { target: goal.targetRom, due: goal.dueDate, reached: Boolean(goal.achievedAt) || rom[1] >= goal.targetRom } : null,
    sessions: patientSessions(all, patient.id).length,
  };
}

export interface MoveRow {
  exercise: ExerciseId;
  /** Объём главной (поражённой) рукой в этом сеансе. */
  main: number | null;
  /** Объём другой рукой. */
  other: number | null;
  /** Объём главной рукой в прошлом сеансе с этим движением. */
  prev: number | null;
  /** Поворот предплечья: супинация и пронация каждой рукой — для картинки. */
  split: { main: { sup: number | null; pro: number | null } | null; other: { sup: number | null; pro: number | null } | null };
  /** Пометки о условиях замера (плечо не прижато и т. п.) — по обеим рукам. */
  flags: { side: Side; flag: StepFlag }[];
}

export interface SessionStory {
  side: Side;
  rows: MoveRow[];
  /** Главная строка — подъём вперёд, а если его не было — первое измеренное движение. */
  lead: MoveRow | null;
}

/** Главное о сеансе: по каждому движению — главная рука, другая рука, прошлый раз. */
export function sessionStory(all: readonly Session[], session: Session, patient: Patient): SessionStory {
  const side = focusSide(patient.affectedSide);
  const rows: MoveRow[] = [];
  for (const ex of EXERCISE_IDS) {
    const main = stepOf(session, ex, side);
    const other = stepOf(session, ex, otherSide(side));
    if (!main && !other) continue;
    const p = previousWith(all, session, ex, side);
    const flags = [main, other].flatMap((s) => (s ? s.flags.filter((fl) => fl !== 'skipped').map((flag) => ({ side: s.side, flag })) : []));
    rows.push({
      exercise: ex,
      main: main?.rom ?? null,
      other: other?.rom ?? null,
      prev: p ? stepOf(p, ex, side)?.rom ?? null : null,
      split: {
        main: main ? { sup: main.supination, pro: main.pronation } : null,
        other: other ? { sup: other.supination, pro: other.pronation } : null,
      },
      flags,
    });
  }
  const lead = rows.find((r) => r.exercise === 'shoulder_flexion' && r.main !== null) ?? rows.find((r) => r.main !== null) ?? null;
  return { side, rows, lead };
}

export interface PatientTrend {
  patient: Patient;
  side: Side;
  /** Подъём руки вперёд главной рукой: первый и последний замер, сколько замеров. */
  first: number | null;
  last: number | null;
  count: number;
  /** Изменение за курс по показанным числам (от двух замеров). */
  course: number | null;
  /** К прошлому сеансу: откат на 10° и больше — как в наблюдении «объём упал». */
  drop: number | null;
  /** Плато: последние 4 замера в пределах 6° и тренд меньше 1° за сеанс — как в наблюдении «плато». */
  plateau: boolean;
}

/**
 * Как идут дела у пациента — для простого вида обзора и аналитики. Пороги — те же правила,
 * что у наблюдений после сеанса (ALERT_RULES): список и наблюдения не спорят друг с другом.
 */
export function patientTrend(all: readonly Session[], patient: Patient): PatientTrend {
  const side = focusSide(patient.affectedSide);
  const v = metricSeries(all, patient, 'shoulder_flexion', side, 'rom').map((p) => p.value);
  const first = v[0] ?? null;
  const last = v[v.length - 1] ?? null;
  const prev = v.length > 1 ? (v[v.length - 2] as number) : null;
  const plateau = isPlateau(v.slice(-ALERT_RULES.plateauSessions));
  return {
    patient,
    side,
    first,
    last,
    count: v.length,
    course: first !== null && last !== null && v.length > 1 ? shownDelta(last, first) : null,
    drop: prev !== null && last !== null && prev - last >= ALERT_RULES.romDrop ? last - prev : null,
    plateau,
  };
}
