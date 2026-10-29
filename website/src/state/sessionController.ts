// Контроллер живого сеанса: устройство → движок → сохранение.
//
//   устройство.onData ──► engine.process        (сырые кадры)
//   устройство.onStatus ─► engine.handleDeviceStatus (обрыв связи → пауза)
//   engine.onInstruction ─► симулятор.instruct   (только в демо: «ребёнок слышит специалиста»)
//
// Экран видит только состояние контроллера и снимки движка. Какое устройство внутри —
// симулятор, USB, Bluetooth или файл, — экран не знает.

import { EXERCISES } from '../core/exercises';
import type { ProtocolId, ProtocolStep } from '../core/protocols';
import type { Patient, Session, Workspace } from '../data/models';
import { liveProfileFor } from '../data/seed/demo';
import { BleDevice } from '../devices/BleDevice';
import { ReplayDevice } from '../devices/ReplayDevice';
import { SerialDevice } from '../devices/SerialDevice';
import { SimulatorDevice } from '../devices/SimulatorDevice';
import { SinglePlacementDevice } from '../devices/SinglePlacementDevice';
import { emptyStatus, placementOf, type DeviceKind, type DeviceStatus, type NeuroMoveDevice, type Placement } from '../devices/types';
import { buildSession } from '../session/buildSession';
import { expectedRomFn } from '../session/compare';
import { SessionEngine, type EngineOptions } from '../session/SessionEngine';

export type DemoScenario = 'normal' | 'unstable' | 'low_battery' | 'fatigue' | 'fidget';

export interface SessionSetup {
  workspace: Workspace;
  patientId: string;
  protocolId: ProtocolId;
  steps: ProtocolStep[];
  deviceKind: DeviceKind;
  scenario: DemoScenario;
  autoAdvance: boolean;
  replay?: { name: string; text: string };
  /**
   * Тест одним датчиком: где он надет. Тогда нужен только он, а единственный датчик потока
   * переименовывается в это место, как бы его ни назвала прошивка (SinglePlacementDevice).
   */
  single?: { placement: Placement };
}

export type Stage = 'connect' | 'test' | 'saving' | 'done';

export interface ControllerState {
  stage: Stage;
  device: DeviceStatus;
  savedSessionId: string | null;
}

const RECOVERY_KEY = 'neuromove.recovery.v1';

export interface RecoveryRecord {
  setup: Omit<SessionSetup, 'replay'>;
  patientCode: string;
  startedAt: string;
  savedAt: string;
  resume: NonNullable<EngineOptions['resume']>;
}

/**
 * Датчики, без которых этот протокол не пройти: туловище и сегменты нужных рук.
 * Тест одним датчиком — только он: компенсацию туловищем без датчика груди не считаем, и это видно в отчёте.
 */
export function requiredPlacements(steps: readonly ProtocolStep[], single?: { placement: Placement }): Placement[] {
  if (single) return [single.placement];
  const set = new Set<Placement>();
  for (const st of steps) {
    set.add(placementOf('upper', st.side));
    set.add(placementOf('fore', st.side));
    if (EXERCISES[st.exercise].trunk) set.add('trunk');
  }
  return [...set];
}

export class SessionController {
  readonly device: NeuroMoveDevice;
  engine: SessionEngine | null = null;
  private state: ControllerState;
  private readonly listeners = new Set<() => void>();
  private readonly unsubs: (() => void)[] = [];
  private recoveryTimer: ReturnType<typeof setInterval> | null = null;
  private faultTimer: ReturnType<typeof setTimeout> | null = null;
  private startedAt: Date | null = null;
  private disposed = false;

  constructor(
    readonly setup: SessionSetup,
    readonly patient: Patient,
    private readonly history: readonly Session[],
    private readonly resume: RecoveryRecord | null = null,
  ) {
    this.device = createDevice(setup, patient);
    this.state = { stage: 'connect', device: this.device.getStatus(), savedSessionId: null };
    this.unsubs.push(
      this.device.onStatus((s) => {
        this.engine?.handleDeviceStatus(s);
        this.set({ device: s });
        // Поток включаем сразу после подключения — чтобы проверить сигнал до калибровки
        if (s.phase === 'connected' && this.state.stage !== 'done') void this.device.start();
      }),
    );
  }

  // ── Подписка для экрана ───────────────────────────────────────────────────

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getState = (): ControllerState => this.state;

  private set(patch: Partial<ControllerState>) {
    this.state = { ...this.state, ...patch };
    for (const cb of this.listeners) cb();
  }

  get isSimulator(): boolean {
    return this.device instanceof SimulatorDevice;
  }

  get simulator(): SimulatorDevice | null {
    return this.device instanceof SimulatorDevice ? this.device : null;
  }

  get required(): Placement[] {
    return requiredPlacements(this.setup.steps, this.setup.single);
  }

  /** Все нужные датчики на связи и поток идёт — можно калибровать. */
  get ready(): boolean {
    const s = this.state.device;
    if (s.phase !== 'streaming') return false;
    return this.required.every((p) => s.sensors.find((x) => x.placement === p)?.online);
  }

  // ── Шаги ──────────────────────────────────────────────────────────────────

  /** Для USB и Bluetooth — только из обработчика нажатия кнопки (правило браузера). */
  async connect(): Promise<void> {
    try {
      await this.device.connect();
    } catch {
      this.set({ device: { ...this.device.getStatus(), phase: 'error', error: { code: 'unknown', message: '' } } });
    }
  }

  beginTest(): void {
    if (this.engine) return;
    const engine = new SessionEngine({
      steps: this.setup.steps,
      rateHz: this.device.getStatus().info?.rateHz ?? 100,
      autoAdvance: this.setup.autoAdvance,
      expectedRom: expectedRomFn(this.history, this.patient),
      recordRaw: true,
      accCal: this.device.getStatus().info?.accCal ?? {},
      ...(this.resume ? { resume: this.resume.resume } : {}),
    });
    this.engine = engine;
    this.startedAt = this.resume ? new Date(this.resume.startedAt) : new Date();
    this.unsubs.push(this.device.onData((frames) => engine.process(frames)));
    const sim = this.simulator;
    if (sim) {
      this.unsubs.push(engine.onInstruction((ins) => sim.instruct(ins)));
      this.scheduleScenario(sim, engine);
    }
    this.unsubs.push(
      engine.subscribe(() => {
        if (engine.isFinished && this.state.stage === 'test') this.set({ stage: 'saving' });
      }),
    );
    engine.start();
    this.set({ stage: 'test' });
    this.recoveryTimer = setInterval(() => this.saveRecovery(), 2000);
  }

  /** Сценарий демо: какой сбой и когда показать. */
  private scheduleScenario(sim: SimulatorDevice, engine: SessionEngine): void {
    const sc = this.setup.scenario;
    if (sc === 'fatigue') sim.injectFault('fatigue');
    if (sc === 'unstable' || sc === 'low_battery') {
      let fired = false;
      const unsub = engine.subscribe(() => {
        const snap = engine.getSnapshot();
        const targetStep = sc === 'unstable' ? Math.min(1, snap.steps.length - 1) : 0;
        if (!fired && snap.phase === 'recording' && snap.stepIndex === targetStep) {
          fired = true;
          this.faultTimer = setTimeout(() => sim.injectFault(sc === 'unstable' ? 'disconnect' : 'low_battery'), 3500);
          unsub();
        }
      });
      this.unsubs.push(unsub);
    }
  }

  /** Сохранить результат. Возвращает готовую запись сеанса. */
  finalize(clinician: string): Session | null {
    const engine = this.engine;
    if (!engine || !this.startedAt) return null;
    if (!engine.isFinished) engine.stop();
    const result = engine.result();
    const info = this.device.getStatus().info;
    const raw = engine.rawFrames;
    const session = buildSession({
      workspace: this.setup.workspace,
      patientId: this.patient.id,
      protocolId: this.setup.protocolId,
      result,
      startedAt: this.startedAt,
      device: {
        kind: this.device.kind,
        name: info?.name ?? this.device.kind,
        firmware: info?.firmware ?? '–',
        format: info?.format ?? 'imu-csv v1',
        rateHz: info?.rateHz ?? 100,
        simulated: info?.simulated ?? this.device.kind === 'simulator',
        // Поправки хранятся с сеансом: выгрузка сырых данных несёт их в паспорте
        ...(info?.accCal && Object.keys(info.accCal).length ? { accCal: info.accCal } : {}),
        ...(info?.moduleIds && Object.keys(info.moduleIds).length ? { moduleIds: info.moduleIds } : {}),
      },
      clinician,
      demo: this.setup.workspace === 'demo' || this.device.kind === 'simulator' || info?.simulated === true,
      hasRaw: raw.length > 0,
    });
    clearRecovery();
    this.set({ stage: 'done', savedSessionId: session.id });
    return session;
  }

  rawFrames() {
    return this.engine?.rawFrames ?? [];
  }

  async reconnect(): Promise<void> {
    await this.device.disconnect();
    await this.connect();
  }

  private saveRecovery(): void {
    const engine = this.engine;
    if (!engine || engine.isFinished || !this.startedAt) return;
    const { replay: _replay, ...setup } = this.setup;
    const rec: RecoveryRecord = {
      setup,
      patientCode: this.patient.code,
      startedAt: this.startedAt.toISOString(),
      savedAt: new Date().toISOString(),
      resume: engine.resumeState(),
    };
    try {
      localStorage.setItem(RECOVERY_KEY, JSON.stringify(rec));
    } catch {
      // Хранилище недоступно (приватное окно) — восстановления после перезагрузки не будет
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    if (this.faultTimer) clearTimeout(this.faultTimer);
    for (const u of this.unsubs) u();
    this.listeners.clear();
    await this.device.stop().catch(() => undefined);
    await this.device.disconnect().catch(() => undefined);
  }
}

function createDevice(setup: SessionSetup, patient: Patient): NeuroMoveDevice {
  const device = createSource(setup, patient);
  // Один датчик: переименовать его в место, где он надет. Симулятор не оборачиваем — он присылает
  // все пять мест, а контроллер узнаёт его по классу (подсказки виртуальному пациенту)
  return setup.single && setup.deviceKind !== 'simulator' ? new SinglePlacementDevice(device, setup.single.placement) : device;
}

function createSource(setup: SessionSetup, patient: Patient): NeuroMoveDevice {
  switch (setup.deviceKind) {
    case 'simulator':
      return new SimulatorDevice({
        seed: (Date.now() ^ 0x2f6b) >>> 0,
        profile: liveProfileFor(patient),
        fidgetOnFirstCalibration: setup.scenario === 'fidget',
      });
    case 'usb':
      return new SerialDevice();
    case 'ble':
      return new BleDevice();
    case 'replay':
      return new ReplayDevice(setup.replay?.text ?? '', setup.replay?.name ?? 'recording.csv');
  }
}

// ── Восстановление после перезагрузки ────────────────────────────────────────

export function readRecovery(): RecoveryRecord | null {
  try {
    const raw = localStorage.getItem(RECOVERY_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw) as RecoveryRecord;
    // Старше 12 часов — это уже не «прерванный сеанс», а забытый
    if (Date.now() - new Date(rec.savedAt).getTime() > 12 * 3600 * 1000) {
      clearRecovery();
      return null;
    }
    return rec;
  } catch {
    return null;
  }
}

export function clearRecovery(): void {
  try {
    localStorage.removeItem(RECOVERY_KEY);
  } catch {
    // нечего чистить
  }
}

/** Собрать неполный сеанс из того, что успели записать до перезагрузки. */
export function sessionFromRecovery(rec: RecoveryRecord, clinician: string): Session {
  const engine = new SessionEngine({ steps: rec.setup.steps, resume: rec.resume });
  engine.stop();
  const result = { ...engine.result(), activeSec: rec.resume.activeSec, totalSec: rec.resume.activeSec };
  return buildSession({
    workspace: rec.setup.workspace,
    patientId: rec.setup.patientId,
    protocolId: rec.setup.protocolId,
    result,
    startedAt: new Date(rec.startedAt),
    device: {
      kind: rec.setup.deviceKind,
      name: rec.setup.deviceKind === 'simulator' ? SimulatorDevice.info().name : rec.setup.deviceKind,
      firmware: '–',
      format: 'imu-csv v1',
      rateHz: 100,
      simulated: rec.setup.deviceKind === 'simulator',
    },
    clinician,
    demo: rec.setup.workspace === 'demo',
    hasRaw: false,
  });
}

export { emptyStatus };
