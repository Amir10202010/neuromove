// Состояние приложения: настройки, профиль, данные обоих пространств, уведомления.
//
// Данные держим в памяти целиком (их немного: сотни сеансов — единицы мегабайт)
// и параллельно пишем в IndexedDB. Экран обновляется сразу, диск — следом.

import { create } from 'zustand';
import { checkStoredRecords, parseWorkspaceBackup, type RejectedRecord } from '../data/backup';
import { openStorage, type CollectionName, type DataStorage } from '../data/db';
import { isSimulatedSession, type Alert, type Goal, type Locale, type Note, type Patient, type Profile, type Session, type Settings, type Workspace, type WorkspaceData } from '../data/models';
import { DEMO_SEED_VERSION, dayDiff, demoSessionCount, generateDemoWorkspace, shiftWorkspaceDates } from '../data/seed/demo';
import type { DeviceKind, RawFrame } from '../devices/types';
import { makeT } from '../i18n';
import { newId } from '../lib/ids';
import { evaluateSession } from '../session/alerts';
import { ENTITY_OF_COLLECTION, makeOp } from '../sync/ops';
import { remoteListeners, scheduleSync, setRawSource, useSyncStore, type SyncConfig } from '../sync/engine';
import type { PullChange } from '../sync/types';
import { validRehabRecord } from '../rehab/validate';
import { isLabRecord } from '../lab/records';

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
  /** Writes started but not yet confirmed by IndexedDB. 0 = everything shown is on disk. */
  pendingWrites: number;
  /** Last failed local write (cleared by the next successful one). */
  writeError: string | null;
  /** Another tab holds the old database version open; the upgrade waits for it to close. */
  dbBlocked: boolean;
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
  /** Resolve when every write started so far is committed. false = at least one of them failed. */
  flush(): Promise<boolean>;
  /** Records hidden at load time (failed validation), exactly as stored — for download and analysis. */
  exportQuarantine(): string;
  /** The storage instance (research module and sync engine share it). */
  storage(): DataStorage | null;
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
/** Records that failed validation at load: shown nowhere, deleted never (replaceWorkspace preserves them). */
let quarantine: RejectedRecord[] = [];
const quarantineIds = () => new Set(quarantine.map((r) => r.id).filter(Boolean));
/** In-flight local writes: flush() awaits them. */
const inflight = new Set<Promise<boolean>>();
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
    set({ pendingWrites: get().pendingWrites + 1 });
    const p: Promise<boolean> = task(storage).then(
      () => {
        set({ writeError: null });
        return true;
      },
      (e: unknown) => {
        const t = makeT(get().settings.locale);
        get().toast('critical', t('errors.saveFailed'));
        set({ writeError: e instanceof Error ? e.message : String(e) });
        return false;
      },
    );
    inflight.add(p);
    void p.finally(() => {
      inflight.delete(p);
      set({ pendingWrites: Math.max(0, get().pendingWrites - 1) });
    });
  };
  // Clinic records go to the sync outbox in the same IndexedDB transaction as the record itself.
  // Demo records never leave the browser.
  // Simulated sessions in the clinic stay local: the server refuses them (simulated_data_not_accepted).
  const put = (c: CollectionName, v: Patient | Session | Note | Alert) => {
    const sync = v.workspace === 'clinic' && !(c === 'sessions' && isSimulatedSession(v as Session));
    persist((st) => st.put(c, v, sync ? makeOp(ENTITY_OF_COLLECTION[c], v.id, v) : undefined));
    if (sync) scheduleSync();
  };
  const tombstone = (c: CollectionName, ws: string, id: string) => {
    if (ws !== 'clinic') return;
    persist((st) => st.enqueue(makeOp(ENTITY_OF_COLLECTION[c], id, null, true)));
    scheduleSync();
  };

  /**
   * A change pulled from the server: written locally WITHOUT a new outbox op (it is already on the
   * server). Base records pass the same validation as records loaded from disk; research records are
   * written to their stores and announced to the research store.
   */
  const COLLECTION_OF: Record<string, CollectionName> = { participant: 'patients', rehab_session: 'sessions', note: 'notes', alert: 'alerts' };
  const RESEARCH_OF: Record<string, 'protocols' | 'vsessions' | 'trials' | 'rehab' | 'lab'> = { protocol_version: 'protocols', validation_session: 'vsessions', trial: 'trials', rehab_record: 'rehab', lab_record: 'lab' };
  const applyRemote = async (ch: PullChange) => {
    if (!storage) return;
    const c = COLLECTION_OF[ch.entity];
    if (c) {
      if (ch.deleted) {
        await storage.remove(c, ch.entityId);
        set({ [c]: (get()[c] as { id: string }[]).filter((x) => x.id !== ch.entityId) } as Partial<State>);
        return;
      }
      const one = { patients: [], sessions: [], notes: [], alerts: [], [c]: [ch.payload] } as unknown as WorkspaceData;
      const checked = checkStoredRecords(one);
      const v = checked.data[c][0] as Patient | Session | Note | Alert | undefined;
      if (!v || v.workspace !== 'clinic') return;
      await storage.put(c, v);
      const list = get()[c] as { id: string }[];
      set({ [c]: list.some((x) => x.id === v.id) ? list.map((x) => (x.id === v.id ? v : x)) : [...list, v] } as Partial<State>);
      return;
    }
    const r = RESEARCH_OF[ch.entity];
    if (r && ch.payload && !ch.deleted) {
      // Rehab records pass the shared validator before they touch the disk (the server validated them too)
      if (r === 'rehab' && !validRehabRecord(ch.payload)) return;
      // Lab records: same shape + hash rules as the server (an altered run or protocol never reaches the disk)
      if (r === 'lab' && !isLabRecord(ch.payload)) return;
      await storage.putResearchBatch(r, [ch.payload as never], []);
      for (const l of remoteListeners) l(ch);
    }
  };
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
    pendingWrites: 0,
    writeError: null,
    dbBlocked: false,
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
      const onBlocked = () => set({ dbBlocked: true });
      if (typeof window !== 'undefined') window.addEventListener('neuromove:db-blocked', onBlocked);
      storage = await openStorage().finally(() => {
        if (typeof window !== 'undefined') window.removeEventListener('neuromove:db-blocked', onBlocked);
        set({ dbBlocked: false });
      });
      const loaded = await storage.loadAll();
      const settings = { ...DEFAULT_SETTINGS, ...(loaded.meta.settings as Partial<Settings> | undefined) };
      const profile = (loaded.meta.profile as Profile | undefined) ?? null;
      set({ storageKind: storage.kind, settings, profile });

      const now = new Date();
      // Записи из базы — через те же проверки, что архив: испорченная запись не уронит экран
      const checked = checkStoredRecords({ patients: loaded.patients, sessions: loaded.sessions, notes: loaded.notes, alerts: loaded.alerts });
      let data: WorkspaceData = checked.data;
      quarantine = checked.records;
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
      // Sync engine: starts disabled unless the team enabled cloud sync on this device
      const st = storage;
      setRawSource({ sessions: () => get().sessions.filter((x) => x.workspace === 'clinic' && x.hasRaw).map((x) => x.id), get: (id) => st.getRaw(id) });
      void useSyncStore.getState().start(st, applyRemote, loaded.meta.sync as Partial<SyncConfig> | undefined, (c) => st.setMeta('sync', c));
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
      // Server side this is a soft delete (deleted_at), children first so references stay valid
      const ws = s.patients.find((x) => x.id === id)?.workspace ?? 'demo';
      for (const x of s.alerts.filter((n) => n.patientId === id)) tombstone('alerts', ws, x.id);
      for (const x of s.notes.filter((n) => n.patientId === id)) tombstone('notes', ws, x.id);
      for (const x of sessions) tombstone('sessions', ws, x.id);
      tombstone('patients', ws, id);
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
      // С 13 ноября 2026 (решение основателя): симуляция разрешена и в клинике — сеанс помечен «симуляция»
      // (device.simulated, demo) и подписан на всех экранах и в выгрузках
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
      const ws = get().notes.find((n) => n.id === id)?.workspace ?? 'demo';
      set({ notes: get().notes.filter((n) => n.id !== id) });
      persist((st) => st.remove('notes', id));
      tombstone('notes', ws, id);
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
        await storage?.replaceWorkspace(ws, data, quarantineIds());
        set(mergeWs(pickWs(get(), ws === 'demo' ? 'clinic' : 'demo'), data));
        // Imported clinic records are queued for the server like any other edit
        if (ws === 'clinic' && storage) {
          for (const x of data.patients) await storage.enqueue(makeOp('participant', x.id, x));
          for (const x of data.sessions) await storage.enqueue(makeOp('rehab_session', x.id, x));
          for (const x of data.notes) await storage.enqueue(makeOp('note', x.id, x));
          for (const x of data.alerts) await storage.enqueue(makeOp('alert', x.id, x));
        }
        if (ws === 'demo') markDemoModified();
        return true;
      } catch {
        return false;
      }
    },

    async clearClinic() {
      // Clears this browser only. Synced records stay on the server; quarantined records are kept.
      await storage?.replaceWorkspace('clinic', { patients: [], sessions: [], notes: [], alerts: [] }, quarantineIds());
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

    async flush() {
      const all = await Promise.all([...inflight]);
      return all.every(Boolean);
    },

    exportQuarantine() {
      return JSON.stringify({ format: 'neuromove-quarantine', version: 1, exportedAt: new Date().toISOString(), records: quarantine }, null, 1);
    },

    storage() {
      return storage;
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
