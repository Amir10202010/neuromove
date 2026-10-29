// Симулятор комплекта NeuroMove: 5 датчиков, 100 Гц, сырые числа по контракту.
//
// Ведёт себя как настоящее устройство: ищется, подключает датчики по одному,
// отдаёт поток, садится батарея, теряет пакеты, рвёт и восстанавливает связь.
// Внутри — виртуальный пациент (что он делает) и модель датчиков (что они видят).
// Снаружи — только интерфейс NeuroMoveDevice: интерфейс не отличит его от железа.

import { createRng, type Rng } from '../lib/random';
import { ImuSimulator } from '../simulation/imuModel';
import { VirtualPatient, type MovementProfile } from '../simulation/VirtualPatient';
import type { Instruction } from '../session/types';
import {
  PLACEMENTS,
  emptyStatus,
  type DeviceInfo,
  type DeviceStatus,
  type NeuroMoveDevice,
  type Placement,
  type RawFrame,
  type Unsubscribe,
} from './types';

export type SimFault = 'disconnect' | 'packet_loss' | 'low_battery' | 'fatigue' | 'sensor_drop';

export interface SimulatorOptions {
  seed: number;
  profile: MovementProfile;
  rateHz?: number;
  /** Поёрзать во время первой калибровки — показать повтор калибровки. */
  fidgetOnFirstCalibration?: boolean;
  /** Скорость «поиска» и подключения: 1 — как у настоящего, 0 — мгновенно (для тестов). */
  handshakeScale?: number;
}

const TICK_MS = 40; // 25 раз в секунду отдаём пачку по 4 отсчёта
const MAX_CATCHUP_SEC = 10; // вкладка была в фоне дольше — пропускаем, а не догоняем
const RECONNECT_MAX = 5;

export class SimulatorDevice implements NeuroMoveDevice {
  readonly kind = 'simulator' as const;
  readonly patient: VirtualPatient;
  private readonly imu: ImuSimulator;
  private readonly rng: Rng;
  private readonly rate: number;
  private readonly handshake: number;
  private status: DeviceStatus = emptyStatus();
  private readonly statusListeners = new Set<(s: DeviceStatus) => void>();
  private readonly dataListeners = new Set<(f: readonly RawFrame[]) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private timeouts: ReturnType<typeof setTimeout>[] = [];
  private pendingResolvers: (() => void)[] = [];

  /** Номер следующего отсчёта и момент (performance.now), которому соответствует seq = 0. */
  private seq = 0;
  private wallZero = 0;
  private battery: Record<Placement, number>;
  private lossRate = 0;
  /** Сбой «датчик отвалился»: эти датчики молчат до такого времени устройства, секунды. */
  private dropped: { places: Placement[]; until: number } | null = null;
  private linkDown = false;
  private lastStatusEmit = 0;
  private receivedWindow: number[] = [];
  /** Номер попытки подключения: отключение посреди подключения отменяет её. */
  private generation = 0;

  constructor(opts: SimulatorOptions) {
    this.rate = opts.rateHz ?? 100;
    this.handshake = opts.handshakeScale ?? 1;
    this.rng = createRng(opts.seed ^ 0xa5a5a5);
    this.imu = new ImuSimulator(opts.seed, this.rate);
    this.patient = new VirtualPatient(opts.profile, opts.seed ^ 0x5bd1e995, {
      fidgetOnFirstCalibration: opts.fidgetOnFirstCalibration ?? false,
    });
    const b = {} as Record<Placement, number>;
    for (const p of PLACEMENTS) b[p] = Math.round(this.rng.range(72, 96));
    this.battery = b;
  }

  static info(rateHz = 100): DeviceInfo {
    return {
      id: 'NM-SIM-01',
      name: 'NeuroMove Kit · симулятор',
      kind: 'simulator',
      firmware: 'sim-0.1',
      format: 'imu-csv v1',
      rateHz,
      accRangeG: 4,
      gyroRangeDps: 1000,
      placements: [...PLACEMENTS],
      simulated: true,
    };
  }

  // ── NeuroMoveDevice ───────────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.status.phase !== 'idle' && this.status.phase !== 'error') return;
    const gen = ++this.generation;
    const alive = () => gen === this.generation;
    this.setStatus({ ...emptyStatus(), phase: 'searching' });
    await this.wait(1100);
    if (!alive()) return;
    const info = SimulatorDevice.info(this.rate);
    this.setStatus({
      ...this.status,
      phase: 'connecting',
      info,
      sensors: PLACEMENTS.map((p) => ({ placement: p, online: false, battery: null, lowBattery: false, link: 0 })),
    });
    // Датчики выходят на связь по одному — как Bluetooth-блоки в настоящем комплекте
    for (const p of PLACEMENTS) {
      await this.wait(280);
      if (!alive()) return;
      this.setStatus({
        ...this.status,
        sensors: this.status.sensors.map((s) =>
          s.placement === p ? { ...s, online: true, battery: this.battery[p], link: 0.97 + this.rng.range(0, 0.03) } : s,
        ),
      });
    }
    await this.wait(250);
    if (!alive()) return;
    this.setStatus({ ...this.status, phase: 'connected' });
  }

  async disconnect(): Promise<void> {
    this.generation += 1;
    this.clearTimers();
    this.setStatus({ ...emptyStatus() });
  }

  async start(): Promise<void> {
    if (this.status.phase !== 'connected') return;
    this.wallZero = performance.now() - (this.seq / this.rate) * 1000;
    this.setStatus({ ...this.status, phase: 'streaming' });
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.status.phase === 'streaming') this.setStatus({ ...this.status, phase: 'connected' });
  }

  getStatus(): DeviceStatus {
    return this.status;
  }

  onStatus(cb: (s: DeviceStatus) => void): Unsubscribe {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  onData(cb: (f: readonly RawFrame[]) => void): Unsubscribe {
    this.dataListeners.add(cb);
    return () => this.dataListeners.delete(cb);
  }

  // ── Только у симулятора ──────────────────────────────────────────────────

  /** Текущее время устройства, секунды. */
  get deviceTime(): number {
    return this.seq / this.rate;
  }

  /** Указание пациенту — «ребёнок слышит специалиста». */
  instruct(ins: Instruction): void {
    this.patient.instruct(ins, this.deviceTime);
  }

  /** Сбои для демонстрации: как интерфейс переживает обрыв, потери, разряд. */
  injectFault(fault: SimFault): void {
    switch (fault) {
      case 'disconnect':
        this.dropLink(4.5);
        break;
      case 'packet_loss':
        this.lossRate = this.lossRate > 0 ? 0 : 0.07;
        break;
      case 'low_battery': {
        this.battery.fore_r = 12;
        this.battery.fore_l = Math.min(this.battery.fore_l, 12);
        this.emitSensors(true);
        break;
      }
      case 'fatigue':
        this.patient.setExtraFatigue(4);
        break;
      case 'sensor_drop':
        // Как у стенда: не ответивший датчик убран из потока, остальные идут дальше (F5)
        this.dropped = { places: ['upper_l', 'upper_r'], until: this.deviceTime + 3 };
        this.setStatus({ ...this.status, sensors: this.status.sensors.map((s) => (this.dropped?.places.includes(s.placement) ? { ...s, online: false, link: 0 } : s)) });
        break;
    }
  }

  get packetLossActive(): boolean {
    return this.lossRate > 0;
  }

  // ── Внутреннее ────────────────────────────────────────────────────────────

  private tick(): void {
    if (this.linkDown) return;
    const now = performance.now();
    let target = Math.floor(((now - this.wallZero) / 1000) * this.rate);
    if (target - this.seq > MAX_CATCHUP_SEC * this.rate) {
      // Вкладка долго была в фоне: не догоняем минуты данных, а продолжаем с «сейчас»
      this.seq = target - this.rate;
      this.imu.resetHistory();
    }
    target = Math.min(target, this.seq + MAX_CATCHUP_SEC * this.rate);
    const frames: RawFrame[] = [];
    let delivered = 0;
    let total = 0;
    for (; this.seq < target; this.seq++) {
      const t = this.seq / this.rate;
      const frame = this.imu.frame(this.patient.poseAt(t), this.seq);
      total += 1;
      if (this.lossRate > 0 && this.rng.next() < this.lossRate) continue; // пакет потерялся по дороге
      if (this.dropped && t < this.dropped.until) for (const p of this.dropped.places) delete frame.data[p];
      frames.push(frame);
      delivered += 1;
    }
    if (total) {
      this.receivedWindow.push(delivered / total);
      if (this.receivedWindow.length > 25) this.receivedWindow.shift();
    }
    if (frames.length) for (const cb of this.dataListeners) cb(frames);
    if (this.dropped && this.deviceTime >= this.dropped.until) {
      const back = this.dropped.places;
      this.dropped = null;
      this.setStatus({ ...this.status, sensors: this.status.sensors.map((s) => (back.includes(s.placement) ? { ...s, online: true, link: 1 } : s)) });
    }
    this.emitSensors(false);
  }

  /** Раз в секунду обновляем заряд и качество связи датчиков. */
  private emitSensors(force: boolean): void {
    const now = performance.now();
    if (!force && now - this.lastStatusEmit < 1000) return;
    this.lastStatusEmit = now;
    const link = this.receivedWindow.length
      ? this.receivedWindow.reduce((a, b) => a + b, 0) / this.receivedWindow.length
      : 1;
    // Заряд: ~1% за 90 секунд потока
    if (this.status.phase === 'streaming') {
      for (const p of PLACEMENTS) if (this.rng.chance(1 / 90) && this.battery[p] > 3) this.battery[p] -= 1;
    }
    this.setStatus({
      ...this.status,
      sensors: this.status.sensors.map((s) => ({
        ...s,
        battery: this.battery[s.placement],
        lowBattery: this.battery[s.placement] <= 15,
        link: Math.max(0, Math.min(1, link - this.rng.range(0, 0.015))),
      })),
    });
  }

  private dropLink(seconds: number): void {
    if (this.status.phase !== 'streaming' || this.linkDown) return;
    this.linkDown = true;
    this.setStatus({
      ...this.status,
      phase: 'reconnecting',
      reconnect: { attempt: 1, max: RECONNECT_MAX },
      sensors: this.status.sensors.map((s) => ({ ...s, online: false, link: 0 })),
    });
    const attempts = Math.min(RECONNECT_MAX - 1, Math.floor(seconds / 1.2));
    for (let i = 1; i <= attempts; i++) {
      this.timeouts.push(
        setTimeout(() => {
          if (this.status.phase === 'reconnecting')
            this.setStatus({ ...this.status, reconnect: { attempt: i + 1, max: RECONNECT_MAX } });
        }, i * 1200),
      );
    }
    this.timeouts.push(
      setTimeout(() => {
        // Связь вернулась: время шло, отсчёты за время обрыва потеряны — это видно по seq
        this.linkDown = false;
        this.imu.resetHistory();
        const now = performance.now();
        const skipTo = Math.floor(((now - this.wallZero) / 1000) * this.rate);
        const lostFrames = Math.max(0, skipTo - this.seq);
        this.seq = skipTo;
        this.setStatus({
          ...this.status,
          phase: 'streaming',
          reconnect: null,
          lost: this.status.lost + lostFrames * PLACEMENTS.length,
          sensors: this.status.sensors.map((s) => ({ ...s, online: true, link: 0.95 })),
        });
      }, seconds * 1000),
    );
  }

  private setStatus(s: DeviceStatus): void {
    this.status = s;
    for (const cb of this.statusListeners) cb(s);
  }

  /** Пауза, которая завершится и при отмене — тогда connect() просто выйдет по generation. */
  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const id = setTimeout(resolve, ms * this.handshake);
      this.timeouts.push(id);
      this.pendingResolvers.push(resolve);
    });
  }

  private clearTimers(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const t of this.timeouts) clearTimeout(t);
    this.timeouts = [];
    for (const r of this.pendingResolvers) r();
    this.pendingResolvers = [];
    this.linkDown = false;
  }
}
