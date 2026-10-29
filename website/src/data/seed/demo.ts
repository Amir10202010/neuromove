// Демо-пространство: шесть вымышленных пациентов с историей курса.
//
// ⚠️ Это не настоящие дети. Имена (Алихан, Айша, …), профили и история придуманы для
// демонстрации; что это демо, говорит тёмная полоса сверху. Внутри у каждого ребёнка ключ
// P01–P06: от него зависят случайные движения, поэтому числа демо не меняются, когда меняется имя.
//
// Как получены цифры: для каждого прошлого сеанса виртуальный пациент «выполняет» тест,
// модель датчиков выдаёт сырые числа, а SessionEngine считает углы, повторы и метрики —
// теми же алгоритмами, что и живой тест. Вписано руками только одно: насколько
// ограничены движения ребёнка в каждый день курса (тяжесть s от 0 до 1).

import type { ExerciseId } from '../../core/exercises';
import { PROTOCOLS, resolveSteps, type ProtocolId } from '../../core/protocols';
import { SimulatorDevice } from '../../devices/SimulatorDevice';
import type { Side } from '../../devices/types';
import type { TFunction } from '../../i18n';
import { hashSeed } from '../../lib/random';
import { buildProfile } from '../../simulation/profiles';
import { runVirtualSession } from '../../simulation/runVirtualSession';
import type { MovementProfile } from '../../simulation/VirtualPatient';
import { evaluateSession } from '../../session/alerts';
import { buildSession } from '../../session/buildSession';
import { expectedRomFn } from '../../session/compare';
import type { Alert, AffectedSide, CpForm, Goal, Level, Note, Patient, Session, WorkspaceData } from '../models';

/** Меняется, когда меняется описание демо-пациентов, формулы, которыми посчитана их история, или тексты, записанные в неё, — тогда снимок пересобирается. 7 — новый расчёт локтя; 8 — виртуальный пациент без скачков позы (ложный «упор»); 9 — заметки и подпись специалиста без длинных тире и слова «демо», числа прежние; 10 — имена вместо кодов P01–P06, числа прежние. */
export const DEMO_SEED_VERSION = 10;
/** Зерно движений виртуальных пациентов: от него зависят все числа демо. Меняется, только когда числа должны стать другими. */
const DEMO_MOTION_SEED = 8;

type SeedNoteKey = 'p01a' | 'p01b' | 'p02a' | 'p03a' | 'p03b' | 'p04a' | 'p05a' | 'p06a';
/** Внутренний ключ демо-ребёнка. На экране не показывается: там имя из словаря (seedNames). */
type DemoKey = 'P01' | 'P02' | 'P03' | 'P04' | 'P05' | 'P06';

interface SessionPlan {
  day: number;
  time: string;
  protocol: Exclude<ProtocolId, 'custom' | 'elbow_endurance' | 'single'>;
  sev: Record<Side, number>;
  loss?: number;
  /** Ребёнок помогает себе плечом при сгибании локтя — нарушение условий замера. */
  upperLiftRight?: number;
}

interface DemoPatientDef {
  id: string;
  /** Ключ для зерна движений и профиля живого теста; имя на экране берётся по нему из словаря. */
  key: DemoKey;
  birthYear: number;
  cpForm: CpForm;
  gmfcs: Level;
  macs: Level;
  affected: AffectedSide;
  courseStartDay: number | null;
  plans: SessionPlan[];
  nextVisit: { day: number; time: string; protocol: ProtocolId } | null;
  goals: { exercise: ExerciseId; side: Side; target: number; dueDay: number | null; createdDay: number }[];
  notes: { key: SeedNoteKey; day: number; time: string }[];
  /** Тяжесть сегодня — для живого сеанса в демо. */
  live: Record<Side, number>;
}

const Q: SessionPlan['protocol'] = 'upper_quick';
const S: SessionPlan['protocol'] = 'upper_standard';

/** Год рождения от «сегодня», чтобы возраст в демо не устаревал. */
function born(age: number, now: Date): number {
  return now.getFullYear() - age;
}

function defs(now: Date): DemoPatientDef[] {
  // P01 — ровное улучшение: тяжесть правой руки 0.56 → 0.34 за 9 недель
  const p01: SessionPlan[] = [-63, -56, -49, -42, -35, -28, -21, -14, -7].map((day, i) => ({
    day,
    time: '10:30',
    protocol: [0, 3, 6, 8].includes(i) ? S : Q,
    sev: { left: 0.04, right: 0.56 - 0.0275 * i },
  }));
  // P02 — плато: быстрый прирост за 4 недели, потом без изменений
  const p02: SessionPlan[] = [-59, -52, -45, -38, -31, -24, -17, -3].map((day, i) => ({
    day,
    time: '15:00',
    protocol: [0, 4, 7].includes(i) ? S : Q,
    sev: { left: i < 4 ? 0.63 - 0.03 * i : 0.52 + (i % 2 === 0 ? 0.003 : -0.003), right: 0.05 },
  }));
  // P03 — поражены обе стороны; в четвёртом сеансе сползал ремешок — потери связи
  const p03: SessionPlan[] = [-70, -56, -42, -28, -14, -2].map((day, i) => ({
    day,
    time: '11:45',
    protocol: S,
    sev: { left: 0.4 - 0.014 * i, right: 0.52 - 0.02 * i },
    upperLiftRight: 27,
    ...(i === 3 ? { loss: 0.065 } : {}),
  }));
  // P04 — рос, потом перерыв 5 недель (болел) и откат
  const p04: SessionPlan[] = [-84, -77, -70, -63, -56, -49, -8].map((day, i) => ({
    day,
    time: '16:00',
    protocol: [0, 3, 6].includes(i) ? S : Q,
    sev: { left: 0.06, right: i < 6 ? 0.52 - 0.028 * i : 0.56 },
  }));
  const p05: SessionPlan[] = [{ day: -6, time: '09:30', protocol: S, sev: { left: 0.28, right: 0.03 } }];

  return [
    {
      id: 'demo-p01',
      key: 'P01',
      birthYear: born(8, now),
      cpForm: 'hemiplegia',
      gmfcs: 1,
      macs: 2,
      affected: 'right',
      courseStartDay: -63,
      plans: p01,
      nextVisit: { day: 0, time: '10:30', protocol: 'upper_quick' },
      goals: [
        { exercise: 'shoulder_flexion', side: 'right', target: 150, dueDay: 28, createdDay: -63 },
        { exercise: 'elbow_flexion', side: 'right', target: 118, dueDay: 7, createdDay: -63 },
      ],
      notes: [
        { key: 'p01a', day: -63, time: '11:05' },
        { key: 'p01b', day: -28, time: '11:02' },
      ],
      live: { left: 0.04, right: 0.31 },
    },
    {
      id: 'demo-p02',
      key: 'P02',
      birthYear: born(6, now),
      cpForm: 'hemiplegia',
      gmfcs: 2,
      macs: 3,
      affected: 'left',
      courseStartDay: -59,
      plans: p02,
      nextVisit: { day: 4, time: '15:00', protocol: 'upper_standard' },
      goals: [{ exercise: 'shoulder_flexion', side: 'left', target: 135, dueDay: 14, createdDay: -59 }],
      notes: [{ key: 'p02a', day: -17, time: '15:40' }],
      live: { left: 0.5, right: 0.05 },
    },
    {
      id: 'demo-p03',
      key: 'P03',
      birthYear: born(11, now),
      cpForm: 'tetraplegia',
      gmfcs: 3,
      macs: 2,
      affected: 'both',
      courseStartDay: -70,
      plans: p03,
      nextVisit: { day: 12, time: '11:45', protocol: 'upper_standard' },
      goals: [{ exercise: 'shoulder_abduction', side: 'right', target: 140, dueDay: 30, createdDay: -70 }],
      notes: [
        { key: 'p03a', day: -70, time: '12:30' },
        { key: 'p03b', day: -28, time: '12:25' },
      ],
      live: { left: 0.32, right: 0.41 },
    },
    {
      id: 'demo-p04',
      key: 'P04',
      birthYear: born(9, now),
      cpForm: 'hemiplegia',
      gmfcs: 2,
      macs: 2,
      affected: 'right',
      courseStartDay: -84,
      plans: p04,
      nextVisit: { day: 0, time: '16:00', protocol: 'upper_standard' },
      goals: [{ exercise: 'shoulder_flexion', side: 'right', target: 135, dueDay: 28, createdDay: -84 }],
      notes: [{ key: 'p04a', day: -8, time: '16:45' }],
      live: { left: 0.06, right: 0.45 },
    },
    {
      id: 'demo-p05',
      key: 'P05',
      birthYear: born(7, now),
      cpForm: 'hemiplegia',
      gmfcs: 1,
      macs: 1,
      affected: 'left',
      courseStartDay: -6,
      plans: p05,
      nextVisit: { day: 1, time: '09:30', protocol: 'upper_quick' },
      goals: [],
      notes: [{ key: 'p05a', day: -6, time: '10:15' }],
      live: { left: 0.27, right: 0.03 },
    },
    {
      id: 'demo-p06',
      key: 'P06',
      birthYear: born(5, now),
      cpForm: 'hemiplegia',
      gmfcs: 2,
      macs: 2,
      affected: 'right',
      courseStartDay: null,
      plans: [],
      nextVisit: { day: 0, time: '14:00', protocol: 'upper_standard' },
      goals: [],
      notes: [{ key: 'p06a', day: -2, time: '14:20' }],
      live: { left: 0.05, right: 0.42 },
    },
  ];
}

function at(now: Date, day: number, time: string, extraMin = 0): Date {
  const [h = '0', m = '0'] = time.split(':');
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + day, Number(h), Number(m) + extraMin, 0, 0);
  return d;
}

/** Сколько сеансов будет сгенерировано — для индикатора прогресса. */
export function demoSessionCount(): number {
  return defs(new Date()).reduce((n, d) => n + d.plans.length, 0);
}

/** Профиль движений демо-пациента на сегодня — для живого сеанса на симуляторе. */
export function liveProfileFor(patient: Patient): MovementProfile {
  const d = defs(new Date()).find((x) => x.id === patient.id || x.key === patient.demoProfile);
  if (d) return buildProfile(d.live);
  // Пациент, добавленный в демо вручную: умеренное ограничение на поражённой стороне
  const sev = (side: Side) => (patient.affectedSide === side || patient.affectedSide === 'both' ? 0.4 : 0.05);
  return buildProfile({ left: sev('left'), right: sev('right') });
}

export interface GenerateOptions {
  now: Date;
  t: TFunction;
  clinician: string;
  onProgress?: (done: number, total: number) => void;
}

/** Сгенерировать демо-пространство. Асинхронно — чтобы интерфейс не замирал. */
export async function generateDemoWorkspace(o: GenerateOptions): Promise<WorkspaceData> {
  const now = o.now;
  const patients: Patient[] = [];
  const sessions: Session[] = [];
  const notes: Note[] = [];
  const alerts: Alert[] = [];
  const all = defs(now);
  const total = all.reduce((n, d) => n + d.plans.length, 0);
  let done = 0;
  const simInfo = SimulatorDevice.info();

  for (const d of all) {
    const goals: Goal[] = d.goals.map((g, i) => ({
      id: `${d.id}-g${i + 1}`,
      exercise: g.exercise,
      side: g.side,
      targetRom: g.target,
      dueDate: g.dueDay === null ? null : at(now, g.dueDay, '12:00').toISOString(),
      createdAt: at(now, g.createdDay, '11:00').toISOString(),
      achievedAt: null,
    }));
    const patient: Patient = {
      id: d.id,
      workspace: 'demo',
      code: o.t(`seedNames.${d.key}`),
      birthYear: d.birthYear,
      cpForm: d.cpForm,
      gmfcs: d.gmfcs,
      macs: d.macs,
      affectedSide: d.affected,
      status: 'active',
      courseStart: d.courseStartDay === null ? null : at(now, d.courseStartDay, '09:00').toISOString(),
      createdAt: at(now, d.courseStartDay ?? -2, '09:00').toISOString(),
      goals,
      nextVisit: d.nextVisit ? at(now, d.nextVisit.day, d.nextVisit.time).toISOString() : null,
      nextProtocol: d.nextVisit?.protocol ?? null,
      demoProfile: d.key,
    };

    const mine: Session[] = [];
    for (let i = 0; i < d.plans.length; i++) {
      const plan = d.plans[i] as SessionPlan;
      const result = runVirtualSession({
        profile: buildProfile(plan.sev, 0.6, plan.upperLiftRight ? { right: { elbow_flexion: { upperLift: plan.upperLiftRight } } } : {}),
        steps: resolveSteps(PROTOCOLS[plan.protocol], d.affected),
        seed: hashSeed(`${d.key}-${i}-v${DEMO_MOTION_SEED}`),
        expectedRom: expectedRomFn(mine, patient),
        ...(plan.loss ? { packetLoss: plan.loss } : {}),
      });
      const session = buildSession({
        id: `${d.id}-s${i + 1}`,
        workspace: 'demo',
        patientId: patient.id,
        protocolId: plan.protocol,
        result,
        startedAt: at(now, plan.day, plan.time, 4),
        device: { kind: 'simulator', name: simInfo.name, firmware: simInfo.firmware, format: simInfo.format, rateHz: simInfo.rateHz, simulated: true },
        clinician: o.clinician,
        demo: true,
        hasRaw: false,
      });
      const outcome = evaluateSession(session, patient, mine, 'demo');
      for (const g of outcome.achievedGoals) {
        const idx = patient.goals.findIndex((x) => x.id === g.id);
        if (idx >= 0) patient.goals[idx] = g;
      }
      // Наблюдения старше 10 дней специалист уже видел
      const age = (now.getTime() - new Date(session.endedAt).getTime()) / 86400000;
      alerts.push(...outcome.alerts.map((a) => ({ ...a, acknowledged: age > 10 })));
      mine.push(session);
      done += 1;
      o.onProgress?.(done, total);
      // Отдаём управление браузеру: интерфейс рисует прогресс, а не замирает
      await new Promise((r) => setTimeout(r, 0));
    }
    sessions.push(...mine);
    patients.push(patient);

    for (const n of d.notes) {
      notes.push({
        id: `${d.id}-n-${n.key}`,
        workspace: 'demo',
        patientId: patient.id,
        sessionId: null,
        createdAt: at(now, n.day, n.time).toISOString(),
        author: o.clinician,
        text: o.t(`seedNotes.${n.key}`),
        kind: 'clinical',
      });
    }
  }
  return { patients, sessions, notes, alerts };
}

/** Сдвинуть все даты демо на `days` дней — чтобы демо всегда выглядело «сегодняшним». */
export function shiftWorkspaceDates(data: WorkspaceData, days: number): WorkspaceData {
  if (!days) return data;
  const ms = days * 86400000;
  const sh = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + ms).toISOString() : iso);
  return {
    patients: data.patients.map((p) => ({
      ...p,
      courseStart: sh(p.courseStart),
      createdAt: sh(p.createdAt) as string,
      nextVisit: sh(p.nextVisit),
      goals: p.goals.map((g) => ({ ...g, dueDate: sh(g.dueDate), createdAt: sh(g.createdAt) as string, achievedAt: sh(g.achievedAt) })),
    })),
    sessions: data.sessions.map((s) => ({ ...s, startedAt: sh(s.startedAt) as string, endedAt: sh(s.endedAt) as string })),
    notes: data.notes.map((n) => ({ ...n, createdAt: sh(n.createdAt) as string })),
    alerts: data.alerts.map((a) => ({ ...a, createdAt: sh(a.createdAt) as string })),
  };
}

/** Целых дней между двумя датами (по календарю, не по часам). */
export function dayDiff(fromIso: string, to: Date): number {
  const a = new Date(fromIso);
  const a0 = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const b0 = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((b0 - a0) / 86400000);
}
