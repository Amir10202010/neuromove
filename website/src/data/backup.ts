import { EXERCISES } from '../core/exercises';
import { STEP_FLAGS } from '../core/metrics';
import { SESSION_EVENT_KINDS } from '../session/types';
import { isSimulatedSession, type Session, type Workspace, type WorkspaceData } from './models';

type Obj = Record<string, unknown>;
const object = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);
const text = (x: unknown): x is string => typeof x === 'string';
// Пределы длины: архив — чужой файл. Код пациента — тот же шаблон, что в форме (PatientFormModal):
// ни ФИО, ни формула для Excel (`=HYPERLINK(…)`) в нём не поместятся.
const short = (x: unknown): x is string => text(x) && x.length <= 300;
const long = (x: unknown): x is string => text(x) && x.length <= 20_000;
// Имя пациента (раньше код вроде P07): до 40 знаков, начинается с буквы или цифры — не с «=», «+», «-»,
// «@», с которых Excel начинает формулу, — и без служебных символов
const patientCode = (x: unknown) => text(x) && x.length <= 40 && /^[\p{L}\p{N}]/u.test(x) && !/[\p{C}]/u.test(x);
// Поправки акселерометра сеанса — те же пределы, что при разборе паспорта (contract.ts)
const vec3 = (x: unknown, ok: (v: number) => boolean) => Array.isArray(x) && x.length === 3 && x.every((v) => number(v) && ok(v));
const accCal = (x: unknown) =>
  x === undefined ||
  (object(x) &&
    Object.entries(x).every(([k, c]) => ['trunk', 'upper_l', 'upper_r', 'fore_l', 'fore_r'].includes(k) && object(c) && vec3(c.off, (v) => Math.abs(v) <= 2048) && vec3(c.scale, (v) => v >= 0.9 && v <= 1.1)));
// Поза калибровки: наклон каждого датчика от вертикали, 0–180°
const calPose = (x: unknown) =>
  x === undefined || (object(x) && Object.entries(x).every(([k, v]) => ['trunk', 'upper_l', 'upper_r', 'fore_l', 'fore_r'].includes(k) && typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 180));
// Отпечатки модулей — как в паспорте: 8 шестнадцатеричных цифр или none
const moduleIds = (x: unknown) =>
  x === undefined || (object(x) && Object.entries(x).every(([k, v]) => ['trunk', 'upper_l', 'upper_r', 'fore_l', 'fore_r'].includes(k) && typeof v === 'string' && /^([0-9A-F]{8}|none)$/.test(v)));
const number = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const nullableNumber = (x: unknown) => x === null || number(x);
const date = (x: unknown) => text(x) && Number.isFinite(Date.parse(x));
const nullableDate = (x: unknown) => x === null || date(x);
const array = (x: unknown, valid: (item: unknown) => boolean): x is unknown[] => Array.isArray(x) && x.every(valid);
const oneOf = (x: unknown, options: readonly unknown[]) => options.includes(x);
const side = (x: unknown) => oneOf(x, ['left', 'right']);
const exercise = (x: unknown) => text(x) && Object.hasOwn(EXERCISES, x);
const protocol = (x: unknown) => oneOf(x, ['upper_standard', 'upper_quick', 'elbow_endurance', 'custom']);
const level = (x: unknown) => x === null || oneOf(x, [1,2,3,4,5]);
const numericFields = (x: Obj, keys: string[]) => keys.every(k => nullableNumber(x[k]));
const goal = (x: unknown) => object(x) && text(x.id) && exercise(x.exercise) && side(x.side) && number(x.targetRom) && date(x.createdAt) && nullableDate(x.dueDate) && nullableDate(x.achievedAt);
const patient = (x: unknown) => object(x) && patientCode(x.code) && number(x.birthYear) && oneOf(x.cpForm, ['hemiplegia','diplegia','tetraplegia','dyskinetic','ataxic','other']) && level(x.gmfcs) && level(x.macs) && oneOf(x.affectedSide,['left','right','both','none']) && oneOf(x.status,['active','paused','discharged']) && date(x.createdAt) && nullableDate(x.courseStart) && nullableDate(x.nextVisit) && (x.nextProtocol === null || protocol(x.nextProtocol)) && array(x.goals, goal);
const rep = (x: unknown) => object(x) && numericFields(x,['index','tStart','tEnd','rom','supination','pronation','sparc','peakVelocity','duration','trunk','check']);
const flags: readonly string[] = STEP_FLAGS;
const step = (x: unknown) => {
  if (!object(x) || !object(x.summary) || !object(x.trace)) return false;
  const s = x.summary, tr = x.trace;
  return oneOf(x.status,['done','partial','skipped']) && exercise(s.exercise) && side(s.side) && number(s.targetReps) && array(s.reps,rep) && numericFields(s,['rom','romBest','supination','pronation','sparc','peakVelocity','repDuration','trunk','check','cv']) && array(s.flags,v => oneOf(v,flags)) && array(tr.t,number) && array(tr.angle,number) && array(tr.trunk,nullableNumber) && tr.t.length === tr.angle.length && tr.t.length === tr.trunk.length;
};
const events: readonly string[] = SESSION_EVENT_KINDS;
const session = (x: unknown) => object(x) && date(x.startedAt) && date(x.endedAt) && protocol(x.protocolId) && oneOf(x.status,['completed','incomplete']) && typeof x.demo === 'boolean' && typeof x.hasRaw === 'boolean' && numericFields(x,['activeSec','totalSec','calibrationAttempts']) && calPose(x.calibrationPose) && short(x.algorithmVersion) && short(x.appVersion) && short(x.clinician) && long(x.note) && object(x.device) && oneOf(x.device.kind,['usb','ble','simulator','replay']) && typeof x.device.simulated === 'boolean' && short(x.device.name) && short(x.device.firmware) && short(x.device.format) && number(x.device.rateHz) && accCal(x.device.accCal) && moduleIds(x.device.moduleIds) && object(x.quality) && numericFields(x.quality,['received','lost','saturated','percent']) && array(x.steps,step) && array(x.events,e => object(e) && oneOf(e.kind,events) && number(e.t) && (e.step === undefined || number(e.step)) && (e.value === undefined || number(e.value)));
const note = (x: unknown) => object(x) && long(x.text) && short(x.author) && oneOf(x.kind,['clinical','summary']) && date(x.createdAt);
const alert = (x: unknown) => object(x) && oneOf(x.kind,['rom_drop','trunk_compensation','signal_quality','goal_reached','incomplete_session','measurement_conditions','plateau']) && oneOf(x.severity,['info','attention','warning']) && typeof x.acknowledged === 'boolean' && date(x.createdAt) && object(x.params) && Object.values(x.params).every(v => short(v) || number(v));

/**
 * Записи из хранилища браузера проверяются по тем же правилам, что архив. Запись, которая не проходит
 * (испорчена, осталась от старой версии, подменена, смоделированный сеанс в клинике), не показывается,
 * но и не удаляется: её видно в счётчике, а в базе она остаётся для разбора.
 */
export function checkStoredRecords(data: WorkspaceData): { data: WorkspaceData; rejected: number } {
  const validators = { patients: patient, sessions: session, notes: note, alerts: alert };
  let rejected = 0;
  const keep = (key: keyof typeof validators, entry: unknown) => {
    // Проверяется так, как запись легла бы в архив: в памяти «нет значения» — это NaN (у пропущенного
    // шага нет объёма), в JSON — null. Без этого сеанс, завершённый досрочно, пропадал бы после перезагрузки
    let asArchived: unknown;
    try {
      asArchived = JSON.parse(JSON.stringify(entry));
    } catch {
      asArchived = null;
    }
    const ok =
      validators[key](asArchived) &&
      object(entry) &&
      short(entry.id) &&
      entry.id !== '' &&
      oneOf(entry.workspace, ['demo', 'clinic']) &&
      !(key === 'sessions' && entry.workspace === 'clinic' && isSimulatedSession(entry as unknown as Session));
    if (!ok) rejected += 1;
    return ok;
  };
  return {
    data: {
      patients: data.patients.filter((e) => keep('patients', e)),
      sessions: data.sessions.filter((e) => keep('sessions', e)),
      notes: data.notes.filter((e) => keep('notes', e)),
      alerts: data.alerts.filter((e) => keep('alerts', e)),
    },
    rejected,
  };
}

export interface BackupPreview {
  patients: number;
  sessions: number;
  notes: number;
  /** Самый ранний и самый поздний сеанс в архиве; null — сеансов нет. */
  from: string | null;
  to: string | null;
}

/** Что внутри архива — до того, как он заменит данные пространства. null — архив не годится. */
export function previewBackup(json: string, workspace: Workspace): BackupPreview | null {
  const data = parseWorkspaceBackup(json, workspace);
  if (!data) return null;
  const starts = data.sessions.map((s) => s.startedAt).sort();
  return { patients: data.patients.length, sessions: data.sessions.length, notes: data.notes.length, from: starts[0] ?? null, to: starts.at(-1) ?? null };
}

/** Validate before touching storage. Never convert data between research environments. */
export function parseWorkspaceBackup(json: string, workspace: Workspace): WorkspaceData | null {
  try {
    if (json.length > 50_000_000) return null;
    const archive: unknown = JSON.parse(json);
    if (!object(archive) || archive.format !== 'neuromove-backup' || archive.version !== 1 || archive.workspace !== workspace || !object(archive.data)) return null;
    const d = archive.data;
    const validators = { patients: patient, sessions: session, notes: note, alerts: alert };
    for (const key of ['patients','sessions','notes','alerts'] as const) {
      if (!array(d[key], validators[key])) return null;
      const ids = new Set<string>();
      for (const entry of d[key]) {
        if (!object(entry) || !short(entry.id) || !entry.id || entry.workspace !== workspace || ids.has(entry.id)) return null;
        ids.add(entry.id);
      }
    }
    const data = d as unknown as WorkspaceData;
    const patientIds = new Set(data.patients.map(p => p.id));
    const sessionIds = new Set(data.sessions.map(s => s.id));
    for (const entry of [...data.sessions,...data.notes,...data.alerts]) if (!patientIds.has(entry.patientId)) return null;
    for (const entry of [...data.notes,...data.alerts]) if (entry.sessionId !== null && !sessionIds.has(entry.sessionId)) return null;
    for (const s of data.sessions) {
      if (workspace === 'clinic' && isSimulatedSession(s)) return null;
      if (workspace === 'demo') s.demo = true;
      // Raw chunks are exported separately, not included in this JSON format.
      s.hasRaw = false;
    }
    return data;
  } catch { return null; }
}
