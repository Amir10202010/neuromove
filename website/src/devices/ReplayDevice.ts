// Повтор записи: CSV в формате imu-csv v1 проигрывается так, будто датчики подключены вживую.
// Зачем: прогнать через приложение запись из лаборатории на Python или из центра
// и проверить, что приложение считает так же (софт.md, «Фейковые датчики»).

import { accCalFromPassport, isSimulatedRecording, moduleIdsFromPassport, parseImuCsv, passportProblem, passportText, type CsvPassport } from './contract';
import { emptyStatus, type DeviceStatus, type NeuroMoveDevice, type RawFrame, type Unsubscribe } from './types';

export class ReplayDevice implements NeuroMoveDevice {
  readonly kind = 'replay' as const;
  private readonly frames: RawFrame[];
  readonly passport: CsvPassport;
  readonly parseErrors: number;
  private status: DeviceStatus = emptyStatus();
  private timer: ReturnType<typeof setInterval> | null = null;
  private pos = 0;
  private wallZero = 0;
  private readonly statusListeners = new Set<(s: DeviceStatus) => void>();
  private readonly dataListeners = new Set<(f: readonly RawFrame[]) => void>();

  constructor(
    csvText: string,
    readonly fileName = 'recording.csv',
    private readonly speed = 1,
  ) {
    const parsed = parseImuCsv(csvText);
    this.frames = parsed.frames;
    this.passport = parsed.passport;
    this.parseErrors = parsed.errors;
  }

  get frameCount(): number {
    return this.frames.length;
  }

  get durationSec(): number {
    const last = this.frames[this.frames.length - 1];
    return last ? last.t - (this.frames[0]?.t ?? 0) : 0;
  }

  async connect(): Promise<void> {
    if (!this.frames.length) {
      this.setStatus({
        ...emptyStatus(),
        phase: 'error',
        error: { code: 'bad_format', message: 'В файле нет отсчётов в формате imu-csv v1.' },
      });
      return;
    }
    const p = this.passport;
    const problem = passportProblem(p);
    if (problem) {
      this.setStatus({ ...emptyStatus(), phase: 'error', error: { code: 'bad_format', message: `Паспорт записи не по контракту imu-csv v1: ${problem}.` } });
      return;
    }
    this.setStatus({
      ...emptyStatus(),
      phase: 'connected',
      info: {
        id: passportText(p.device) || 'REPLAY',
        // Имя файла бывает длинным — в записи сеанса хватит 120 знаков
        name: `Запись · ${this.fileName.slice(0, 120)}`,
        kind: 'replay',
        firmware: passportText(p.firmware, 32) || '–',
        format: p.format || 'imu-csv v1',
        rateHz: p.rateHz,
        accRangeG: p.accG,
        gyroRangeDps: p.gyroDps,
        placements: p.sensors,
        // Выгрузка из демо остаётся смоделированной и после повтора
        simulated: isSimulatedRecording(p),
        accCal: accCalFromPassport(p.extra),
        moduleIds: moduleIdsFromPassport(p.extra),
      },
      sensors: p.sensors.map((placement) => ({ placement, online: true, battery: null, lowBattery: false, link: 1 })),
    });
  }

  async disconnect(): Promise<void> {
    await this.stop();
    this.setStatus(emptyStatus());
  }

  async start(): Promise<void> {
    if (this.status.phase !== 'connected') return;
    const t0 = this.frames[this.pos]?.t ?? 0;
    this.wallZero = performance.now() - (t0 / this.speed) * 1000;
    this.setStatus({ ...this.status, phase: 'streaming' });
    this.timer = setInterval(() => {
      const tNow = ((performance.now() - this.wallZero) / 1000) * this.speed;
      const batch: RawFrame[] = [];
      while (this.pos < this.frames.length && (this.frames[this.pos] as RawFrame).t <= tNow) {
        batch.push(this.frames[this.pos] as RawFrame);
        this.pos += 1;
      }
      if (batch.length) {
        this.status = { ...this.status, received: this.status.received + batch.length };
        for (const cb of this.dataListeners) cb(batch);
      }
      if (this.pos >= this.frames.length) void this.stop(); // запись кончилась
    }, 40);
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

  private setStatus(s: DeviceStatus): void {
    this.status = s;
    for (const cb of this.statusListeners) cb(s);
  }
}
