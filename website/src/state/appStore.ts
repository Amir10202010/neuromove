// Состояние приложения: настройки, профиль, данные обоих пространств, уведомления.
//
// Данные держим в памяти целиком (их немного: сотни сеансов — единицы мегабайт)
// и параллельно пишем в IndexedDB. Экран обновляется сразу, диск — следом.

import { create } from 'zustand';
import { checkStoredRecords, parseWorkspaceBackup } from '../data/backup';
import { openStorage, type CollectionName, type DataStorage } from '../data/db';
import { isSimulatedSession, type Alert, type Goal, type Locale, type Note, type Patient, type Profile, type Session, type Settings, type Workspace, type WorkspaceData } from '../data/models';
import { DEMO_SEED_VERSION, dayDiff, demoSessionCount, generateDemoWorkspace, shiftWorkspaceDates } from '../data/seed/demo';
import type { DeviceKind, RawFrame } from '../devices/types';
import { makeT } from '../i18n';
import { newId } from '../lib/ids';
import { evaluateSession } from '../session/alerts';

export type ToastKind = 'good' | 'info' | 'warn' | 'critical';
export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  desc?: string;
}

interface DemoMeta {
  seedVersion: number;
  /** День, на который построены даты демо. */
  seedDay: string;
  /** Пользователь что-то менял в демо — тогда даты сами не сдвигаем. */
  modified: boolean;
}

export type GuideStep = 'patient' | 'start' | 'setup' | 'connect' | 'test' | 'result' | 'progress' | 'analytics';
export const GUIDE_STEPS: GuideStep[] = ['patient', 'start', 'setup', 'connect', 'test', 'result', 'progress', 'analytics'];

interface State {
  status: 'loading' | 'seeding' | 'ready' | 'error';
  seedProgress: { done: number; total: number };
  storageKind: 'indexeddb' | 'memory';
  /** Сколько записей хранилища не прошли проверку при загрузке: не показаны, но и не удалены. */
  storageRejected: number;
  settings: Settings;
  profile: Profile | null;
  patients: Patient[];
  sessions: Session[];
  notes: Note[];
  alerts: Alert[];
  toasts: Toast[];
  /**
   * Гид демонстрации. intro — показано вступление «что вы сейчас сделаете»; done — путь
   * пройден, в карточке гида — итог и «пройти ещё раз».
   */
  guide: { active: boolean; step: GuideStep; minimized: boolean; intro: boolean; done: boolean };
  /** id последнего сеанса, сохранённого в клиническом демо, — для гида. */
  lastDemoSessionId: string | null;
}

interface Actions {
  init(): Promise<void>;
  setLocale(l: Locale): void;
  setWorkspace(w: Workspace): void;
  setAutoAdvance(v: boolean): void;
  setPreferredDevice(k: DeviceKind | null): void;
  setDetails(v: boolean): void;
  setHelloHidden(v: boolean): void;
  saveProfile(p: Profile): void;
  savePatient(p: Patient): void;
  deletePatient(id: string): void;
  saveGoals(patientId: string, goals: Goal[]): void;
  saveSession(s: Session, raw?: readonly RawFrame[]): Session;
  updateSessionNote(id: string, note: string): void;
  addNote(n: Omit<Note, 'id' | 'workspace' | 'createdAt'>): void;
  deleteNote(id: string): void;
  ackAlert(id: string): void;
  resetDemo(): Promise<void>;
  exportBackup(): string;
  importBackup(json: string): Promise<boolean>;
  clearClinic(): Promise<void>;
  markBackup(): void;
  getRaw(sessionId: string): Promise<RawFrame[] | null>;
  toast(kind: ToastKind, title: string, desc?: string): void;
  dismissToast(id: string): void;
  startGuide(): void;
  setGuideStep(step: GuideStep): void;
  setGuideMinimized(v: boolean): void;
  setGuideIntro(v: boolean): void;
  finishGuide(): void;
  stopGuide(): void;
}

type GuideState = State['guide'];
const GUIDE_OFF: GuideState = { active: false, step: 'patient', minimized: false, intro: false, done: false };
// v2: восемь шагов с подсветкой у элемента (14–15 октября); старый сохранённый шаг не подходит
const GUIDE_KEY = 'neuromove.guide.v2';

/**
 * Гид переживает перезагрузку страницы посреди показа: шаг лежит в sessionStorage этой вкладки.
 * Хранилище недоступно (приватное окно, запрет браузера) — гид просто начнётся заново.
 */
function loadGuide(): GuideState {
  try {
    const g = JSON.parse(sessionStorage.getItem(GUIDE_KEY) ?? 'null') as Partial<GuideState> | null;
    if (g?.active === true && GUIDE_STEPS.includes(g.step as GuideStep)) {
      return { active: true, step: g.step as GuideStep, minimized: g.minimized === true, intro: g.intro === true, done: g.done === true };
    }
  } catch {
    /* нет sessionStorage — гид без памяти */
  }
  return GUIDE_OFF;
}

function saveGuide(g: GuideState): void {
  try {
    if (g.active) sessionStorage.setItem(GUIDE_KEY, JSON.stringify(g));
    else sessionStorage.removeItem(GUIDE_KEY);
  } catch {
    /* нет sessionStorage — гид без памяти */
  }
}

// Русский — язык клиник-партнёров; простой вид — по умолчанию: подробности открывают сами
const DEFAULT_SETTINGS: Settings = { locale: 'ru', workspace: 'demo', autoAdvance: true, lastBackupAt: null, preferredDevice: null, details: false, helloHidden: false };

let storage: DataStorage | null = null;
let initialization: Promise<void> | null = null;
/** Копия служебной записи о демо — чтобы не читать базу ради одного флага. */
let demoMetaCache: DemoMeta | null = null;

function clinicianName(s: State): string {
  if (s.settings.workspace === 'demo') return makeT(s.settings.locale)('workspace.demoClinician');
  return s.profile?.name ?? '';
}

export const useAppStore = create<State & Actions>((set, get) => {
  /** Запись на диск в фоне; ошибку показываем, но не роняем интерфейс. */
  const persist = (task: (st: DataStorage) => Promise<void>) => {
    if (!storage) return;
    task(storage).catch(() => {
      const t = makeT(get().settings.locale);
      get().toast('critical', t('errors.saveFailed'));
    });
  };
  const put = (c: CollectionName, v: Patient | Session | Note | Alert) => persist((st) => st.put(c, v));
  const markDemoModified = () => {
    if (get().settings.workspace !== 'demo' || !demoMetaCache || demoMetaCache.modified) return;
    demoMetaCache = { ...demoMetaCache, modified: true };
    const meta = demoMetaCache;
    persist((st) => st.setMeta('demo', meta));
  };
  const writeDemoMeta = async (st: DataStorage, meta: DemoMeta) => {
    demoMetaCache = meta;
    await st.setMeta('demo', meta);
  };

  const buildDemo = async (now: Date): Promise<WorkspaceData> => {
    const t = makeT(get().settings.locale);
    set({ status: 'seeding', seedProgress: { done: 0, total: demoSessionCount() } });
    const data = await generateDemoWorkspace({
      now,
      t,
      clinician: t('workspace.demoClinician'),
      onProgress: (done, total) => set({ seedProgress: { done, total } }),
    });
    return data;
  };

  return {
    status: 'loading',
    seedProgress: { done: 0, total: 0 },
    storageKind: 'indexeddb',
    storageRejected: 0,
    settings: DEFAULT_SETTINGS,
    profile: null,
    patients: [],
    sessions: [],
    notes: [],
    alerts: [],
    toasts: [],
    guide: loadGuide(),
    lastDemoSessionId: null,

    async init() {
      if (get().status === 'ready') return;
      if (initialization) return initialization;
      set({ status: 'loading' });
      initialization = (async () => {
      storage = await openStorage();
      const loaded = await storage.loadAll();
      const settings = { ...DEFAULT_SETTINGS, ...(loaded.meta.settings as Partial<Settings> | undefined) };
      const profile = (loaded.meta.profile as Profile | undefined) ?? null;
      set({ storageKind: storage.kind, settings, profile });

      const now = new Date();
      // Записи из базы — через те же проверки, что архив: испорченная запись не уронит экран
      const checked = checkStoredRecords({ patients: loaded.patients, sessions: loaded.sessions, notes: loaded.notes, alerts: loaded.alerts });
      let data: WorkspaceData = checked.data;
      set({ storageRejected: checked.rejected });
      const demoMeta = loaded.meta.demo as DemoMeta | undefined;
      let snapshot = loaded.meta.demoSnapshot as WorkspaceData | undefined;
      const hasDemo = data.patients.some((p) => p.workspace === 'demo');

      demoMetaCache = demoMeta ?? null;
      if (!demoMeta || demoMeta.seedVersion !== DEMO_SEED_VERSION || !snapshot || !hasDemo) {
        // Первый запуск или новая версия демо: симулируем историю и запоминаем снимок для сброса
        snapshot = await buildDemo(now);
        await storage.replaceWorkspace('demo', snapshot);
        await storage.setMeta('demoSnapshot', snapshot);
        await storage.setMeta('demoSnapshotDay', now.toISOString());
        await writeDemoMeta(storage, { seedVersion: DEMO_SEED_VERSION, seedDay: now.toISOString(), modified: false });
        data = mergeWs(pickWs(data, 'clinic'), snapshot);
      } else if (!demoMeta.modified && dayDiff(demoMeta.seedDay, now) !== 0) {
        // Демо не трогали — сдвигаем даты, чтобы «сегодня» в демо было сегодня
        const shifted = shiftWorkspaceDates(pickWs(data, 'demo'), dayDiff(demoMeta.seedDay, now));
        await storage.replaceWorkspace('demo', shifted);
        await writeDemoMeta(storage, { ...demoMeta, seedDay: now.toISOString() });
        data = mergeWs(pickWs(data, 'clinic'), shifted);
      }
      set({ ...data, status: 'ready' });
      if (checked.rejected) get().toast('critical', makeT(get().settings.locale)('errors.corruptedRecords', { count: checked.rejected }));
      })().catch(() => { set({ status: 'error' }); }).finally(() => { initialization = null; });
      return initialization;
    },

    setLocale(locale) {
      const settings = { ...get().settings, locale };
      set({ settings });
      persist((st) => st.setMeta('settings', settings));
      document.documentElement.lang = locale === 'kk' ? 'kk' : locale;
    },

    setWorkspace(workspace) {
      const settings = { ...get().settings, workspace };
      set({ settings });
      persist((st) => st.setMeta('settings', settings));
    },

    setAutoAdvance(autoAdvance) {
      const settings = { ...get().settings, autoAdvance };
      set({ settings });
      persist((st) => st.setMeta('settings', settings));
    },

    setPreferredDevice(preferredDevice) {
      const settings = { ...get().settings, preferredDevice };
      set({ settings });
      persist((st) => st.setMeta('settings', settings));
    },

    setDetails(details) {
      if (get().settings.details === details) return;
      const settings = { ...get().settings, details };
      set({ settings });
      persist((st) => st.setMeta('settings', settings));
    },

    setHelloHidden(helloHidden) {
      if (get().settings.helloHidden === helloHidden) return;
      const settings = { ...get().settings, helloHidden };
      set({ settings });
      persist((st) => st.setMeta('settings', settings));
    },

    saveProfile(profile) {
      set({ profile });
      persist((st) => st.setMeta('profile', profile));
    },

    savePatient(p) {
      const exists = get().patients.some((x) => x.id === p.id);
      set({ patients: exists ? get().patients.map((x) => (x.id === p.id ? p : x)) : [...get().patients, p] });
      put('patients', p);
      if (p.workspace === 'demo') markDemoModified();
    },

    deletePatient(id) {
      const s = get();
      const sessions = s.sessions.filter((x) => x.patientId === id);
      set({
        patients: s.patients.filter((x) => x.id !== id),
        sessions: s.sessions.filter((x) => x.patientId !== id),
        notes: s.notes.filter((x) => x.patientId !== id),
        alerts: s.alerts.filter((x) => x.patientId !== id),
      });
      persist(async (st) => {
        await st.remove('patients', id);
        for (const x of sessions) {
          await st.remove('sessions', x.id);
          await st.removeRaw(x.id);
        }
        for (const x of s.notes.filter((n) => n.patientId === id)) await st.remove('notes', x.id);
        for (const x of s.alerts.filter((n) => n.patientId === id)) await st.remove('alerts', x.id);
      });
      markDemoModified();
    },

    saveGoals(patientId, goals) {
      const p = get().patients.find((x) => x.id === patientId);
      if (!p) return;
      get().savePatient({ ...p, goals });
    },

    saveSession(session, raw) {
      const s = get();
      // Последняя линия защиты: экран выбора файла уже отказывает, но смоделированные данные
      // не должны попасть в историю настоящих пациентов никаким путём
      if (session.workspace === 'clinic' && isSimulatedSession(session)) {
        get().toast('critical', makeT(s.settings.locale)('errors.simulatedInClinic'));
        return session;
      }
      // Тот же сеанс второй раз (двойной клик, повтор эффекта, восстановление после перезагрузки) ничего
      // не меняет: иначе он задвоился бы в списке, оповещения — тоже, а следующий визит сдвинулся бы дважды
      const existing = s.sessions.find((x) => x.id === session.id);
      if (existing) return existing;
      const patient = s.patients.find((p) => p.id === session.patientId);
      const prior = s.sessions.filter((x) => x.patientId === session.patientId);
      let alerts: Alert[] = [];
      if (patient) {
        const out = evaluateSession(session, patient, prior, session.workspace);
        alerts = out.alerts;
        // Цели, достигнутые в этом сеансе, и следующий визит — через неделю в то же время
        const goals = patient.goals.map((g) => out.achievedGoals.find((a) => a.id === g.id) ?? g);
        let nextVisit = patient.nextVisit;
        if (nextVisit && dayDiff(nextVisit, new Date(session.startedAt)) >= 0) {
          nextVisit = new Date(new Date(nextVisit).getTime() + 7 * 86400000).toISOString();
        }
        const updated: Patient = {
          ...patient,
          goals,
          nextVisit,
          courseStart: patient.courseStart ?? session.startedAt,
          status: patient.status === 'discharged' ? 'discharged' : 'active',
        };
        set({ patients: s.patients.map((p) => (p.id === updated.id ? updated : p)) });
        put('patients', updated);
      }
      set({ sessions: [...get().sessions, session], alerts: [...get().alerts, ...alerts] });
      put('sessions', session);
      for (const a of alerts) put('alerts', a);
      if (raw && raw.length && storage) {
        // Места не хватило — сеанс остаётся, но честно «без сырых данных», а не со ссылкой в пустоту
        storage.putRaw(session.id, raw).catch(() => {
          const fixed = { ...session, hasRaw: false };
          set({ sessions: get().sessions.map((x) => (x.id === session.id ? fixed : x)) });
          put('sessions', fixed);
          get().toast('critical', makeT(get().settings.locale)('errors.rawNotSaved'));
        });
      }
      if (session.workspace === 'demo') {
        markDemoModified();
        set({ lastDemoSessionId: session.id });
      }
      return session;
    },

    updateSessionNote(id, note) {
      const s = get().sessions.find((x) => x.id === id);
      if (!s) return;
      const next = { ...s, note };
      set({ sessions: get().sessions.map((x) => (x.id === id ? next : x)) });
      put('sessions', next);
      markDemoModified();
    },

    addNote(n) {
      const note: Note = { ...n, id: newId('n'), workspace: get().settings.workspace, createdAt: new Date().toISOString() };
      set({ notes: [...get().notes, note] });
      put('notes', note);
      markDemoModified();
    },

    deleteNote(id) {
      set({ notes: get().notes.filter((n) => n.id !== id) });
      persist((st) => st.remove('notes', id));
      markDemoModified();
    },

    ackAlert(id) {
      const a = get().alerts.find((x) => x.id === id);
      if (!a) return;
      const next = { ...a, acknowledged: true };
      set({ alerts: get().alerts.map((x) => (x.id === id ? next : x)) });
      put('alerts', next);
      markDemoModified();
    },

    async resetDemo() {
      if (!storage) return;
      const loaded = await storage.loadAll();
      let snapshot = loaded.meta.demoSnapshot as WorkspaceData | undefined;
      const snapDay = loaded.meta.demoSnapshotDay as string | undefined;
      const now = new Date();
      if (!snapshot || !snapDay || demoMetaCache?.seedVersion !== DEMO_SEED_VERSION) {
        snapshot = await buildDemo(now);
      } else {
        // Снимок хранит даты дня, когда его построили, — сдвигаем на сегодня
        snapshot = shiftWorkspaceDates(snapshot, dayDiff(snapDay, now));
      }
      await storage.setMeta('demoSnapshot', snapshot);
      await storage.setMeta('demoSnapshotDay', now.toISOString());
      await writeDemoMeta(storage, { seedVersion: DEMO_SEED_VERSION, seedDay: now.toISOString(), modified: false });
      await storage.replaceWorkspace('demo', snapshot);
      set({ ...mergeWs(pickWs(get(), 'clinic'), snapshot), status: 'ready', lastDemoSessionId: null });
    },

    exportBackup() {
      const s = get();
      const ws = s.settings.workspace;
      return JSON.stringify(
        { format: 'neuromove-backup', version: 1, workspace: ws, exportedAt: new Date().toISOString(), data: pickWs(s, ws) },
        null,
        1,
      );
    },

    async importBackup(json) {
      try {
        const ws = get().settings.workspace;
        const data = parseWorkspaceBackup(json, ws);
        if (!data || !storage) return false;
        const other = pickWs(get(), ws === 'demo' ? 'clinic' : 'demo');
        for (const key of ['patients','sessions','notes','alerts'] as const) {
          const ids = new Set(other[key].map(entry => entry.id));
          if (data[key].some(entry => ids.has(entry.id))) return false;
        }
        await storage?.replaceWorkspace(ws, data);
        set(mergeWs(pickWs(get(), ws === 'demo' ? 'clinic' : 'demo'), data));
        if (ws === 'demo') markDemoModified();
        return true;
      } catch {
        return false;
      }
    },

    async clearClinic() {
      await storage?.replaceWorkspace('clinic', { patients: [], sessions: [], notes: [], alerts: [] });
      set(mergeWs(pickWs(get(), 'demo'), { patients: [], sessions: [], notes: [], alerts: [] }));
    },

    markBackup() {
      const settings = { ...get().settings, lastBackupAt: new Date().toISOString() };
      set({ settings });
      persist((st) => st.setMeta('settings', settings));
    },

    async getRaw(sessionId) {
      return storage ? storage.getRaw(sessionId) : null;
    },

    toast(kind, title, desc) {
      const id = newId('t');
      const t: Toast = desc ? { id, kind, title, desc } : { id, kind, title };
      set({ toasts: [...get().toasts.slice(-3), t] });
      setTimeout(() => get().dismissToast(id), kind === 'critical' ? 8000 : 4500);
    },

    dismissToast(id) {
      set({ toasts: get().toasts.filter((t) => t.id !== id) });
    },

    startGuide() {
      const guide: GuideState = { active: true, step: 'patient', minimized: false, intro: true, done: false };
      set({ guide });
      saveGuide(guide);
    },
    setGuideStep(step) {
      if (!get().guide.active) return;
      const guide = { ...get().guide, step };
      set({ guide });
      saveGuide(guide);
    },
    setGuideMinimized(minimized) {
      const guide = { ...get().guide, minimized };
      set({ guide });
      saveGuide(guide);
    },
    setGuideIntro(intro) {
      if (!get().guide.active) return;
      const guide = { ...get().guide, intro };
      set({ guide });
      saveGuide(guide);
    },
    finishGuide() {
      if (!get().guide.active) return;
      const guide = { ...get().guide, done: true, minimized: false, intro: false };
      set({ guide });
      saveGuide(guide);
    },
    stopGuide() {
      set({ guide: GUIDE_OFF });
      saveGuide(GUIDE_OFF);
    },
  };
});

// ── Помощники для пространств ───────────────────────────────────────────────

function pickWs(d: WorkspaceData, ws: Workspace): WorkspaceData {
  return {
    patients: d.patients.filter((x) => x.workspace === ws),
    sessions: d.sessions.filter((x) => x.workspace === ws),
    notes: d.notes.filter((x) => x.workspace === ws),
    alerts: d.alerts.filter((x) => x.workspace === ws),
  };
}

function mergeWs(a: WorkspaceData, b: WorkspaceData): WorkspaceData {
  return {
    patients: [...a.patients, ...b.patients],
    sessions: [...a.sessions, ...b.sessions],
    notes: [...a.notes, ...b.notes],
    alerts: [...a.alerts, ...b.alerts],
  };
}

export { pickWs };

// ── Селекторы: данные текущего пространства ─────────────────────────────────

export function useWorkspaceData() {
  const ws = useAppStore((s) => s.settings.workspace);
  const patients = useAppStore((s) => s.patients);
  const sessions = useAppStore((s) => s.sessions);
  const notes = useAppStore((s) => s.notes);
  const alerts = useAppStore((s) => s.alerts);
  return memoWs(ws, patients, sessions, notes, alerts);
}

// Один и тот же объект, пока исходные массивы не поменялись, — чтобы не перерисовывать экраны зря
let memo: { key: unknown[]; value: WorkspaceData & { ws: Workspace } } | null = null;
function memoWs(ws: Workspace, patients: Patient[], sessions: Session[], notes: Note[], alerts: Alert[]) {
  const key = [ws, patients, sessions, notes, alerts];
  if (memo && memo.key.every((k, i) => k === key[i])) return memo.value;
  const value = { ws, ...pickWs({ patients, sessions, notes, alerts }, ws) };
  memo = { key, value };
  return value;
}

export function currentClinician(): string {
  return clinicianName(useAppStore.getState());
}
