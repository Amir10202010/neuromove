// Настоящие датчики по USB — способы А и В из железо.md (ESP32 → USB → компьютер).
// Web Serial есть в Chrome и Edge на компьютере; в Safari и Firefox его нет.
// Окно выбора порта открывается только по нажатию кнопки — это правило браузера.
//
// ⚠️ Не проверено на железе: прототипа ещё нет. Разбор формата проверен тестами (contract.test.ts).

import { accCalFromPassport, ImuCsvParser, LineSplitter, moduleIdsFromPassport, passportProblem, passportText, SeqUnwrapper, sensorsAfterHeader } from './contract';
import { emptyStatus, type DeviceStatus, type NeuroMoveDevice, type RawFrame, type Unsubscribe } from './types';

// Скорость порта — та же, что SERIAL_BAUD в прошивке (firmware/NeuroMoveStand/config.h). Была 921 600:
// 12 октября 2026 на маке с платой на CH340C на ней приходили каракули, на 460 800 — чистый текст
const BAUD = 460800;
const HEADER_TIMEOUT_MS = 6000;
const RECONNECT_MAX = 5;

export function isWebSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

export class SerialDevice implements NeuroMoveDevice {
  readonly kind = 'usb' as const;
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private parser = new ImuCsvParser();
  private status: DeviceStatus = emptyStatus();
  private streaming = false;
  private closing = false;
  private readonly statusListeners = new Set<(s: DeviceStatus) => void>();
  private readonly dataListeners = new Set<(f: readonly RawFrame[]) => void>();
  private batch: RawFrame[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private lastSeq: number | null = null;
  /** Живёт весь сеанс, через переподключения: номера отсчётов не повторяются и не идут назад. */
  private readonly unwrap = new SeqUnwrapper();
  /** Когда пришёл прошлый отсчёт (performance.now) — чтобы оценить длину разрыва при отскоке seq. */
  private lastWall: number | null = null;

  async connect(): Promise<void> {
    if (!isWebSerialSupported()) {
      this.fail('unsupported', 'Этот браузер не поддерживает Web Serial. Откройте NeuroMove в Chrome или Edge на компьютере.');
      return;
    }
    this.setStatus({ ...emptyStatus(), phase: 'requesting' });
    try {
      this.port = await navigator.serial.requestPort();
    } catch {
      this.fail('cancelled', 'Устройство не выбрано.');
      return;
    }
    await this.open();
  }

  private async open(): Promise<void> {
    const port = this.port;
    if (!port) return;
    this.setStatus({ ...this.status, phase: 'connecting', error: null });
    try {
      await port.open({ baudRate: BAUD });
    } catch (e) {
      this.fail('permission', `Порт не открылся: ${(e as Error).message}`);
      return;
    }
    this.parser = new ImuCsvParser();
    this.lastSeq = null;
    void this.readLoop(port);
    // Устройство при старте печатает паспорт и заголовок; ждём их
    const started = Date.now();
    while (!this.parser.ready && Date.now() - started < HEADER_TIMEOUT_MS && !this.closing) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!this.parser.ready) {
      this.fail('bad_format', 'Устройство не прислало паспорт imu-csv v1. Нажмите RESET на плате и подключите снова.');
      return;
    }
    const p = this.parser.passport;
    const problem = passportProblem(p);
    if (problem) {
      this.fail('bad_format', `Паспорт устройства не по контракту imu-csv v1: ${problem}.`);
      return;
    }
    this.setStatus({
      ...this.status,
      phase: this.streaming ? 'streaming' : 'connected',
      reconnect: null,
      info: {
        id: passportText(p.device) || 'NM-USB',
        name: `NeuroMove ${passportText(p.device) || 'USB'}`,
        kind: 'usb',
        firmware: passportText(p.firmware, 32),
        format: p.format || 'imu-csv v1',
        rateHz: p.rateHz,
        accRangeG: p.accG,
        gyroRangeDps: p.gyroDps,
        placements: p.sensors,
        simulated: false,
        accCal: accCalFromPassport(p.extra),
        moduleIds: moduleIdsFromPassport(p.extra),
      },
      // Провода: все датчики на одних часах; заряд по USB не передаётся
      sensors: p.sensors.map((placement) => ({ placement, online: true, battery: null, lowBattery: false, link: 1 })),
    });
  }

  private async readLoop(port: SerialPort): Promise<void> {
    if (!port.readable) return;
    const decoder = new TextDecoderStream();
    // Порт отдаёт байты; TextDecoderStream превращает их в текст
    void port.readable.pipeTo(decoder.writable as unknown as WritableStream<Uint8Array>).catch(() => undefined);
    this.reader = decoder.readable.getReader();
    const lines = new LineSplitter();
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        for (const line of lines.push(value)) {
          const r = this.parser.pushLine(line);
          if (r.kind === 'header') this.onHeader();
          if (r.kind !== 'frame') continue;
          // Номер отсчёта — монотонный: перезагрузка платы или 16-битный seq не повернут время вспять.
          // При отскоке вставляем пропуск длиной в реально прошедшее время — движок увидит разрыв
          // Испорченный номер (байт потерялся на линии) ждёт следующую строку — см. SeqUnwrapper
          const now = performance.now();
          const rate = this.parser.passport.rateHz;
          const gap = this.lastWall === null ? 1 : Math.round(((now - this.lastWall) / 1000) * rate);
          this.lastWall = now;
          for (const { seq, item } of this.unwrap.push(r.frame.seq, r.frame, gap)) {
            if (!this.streaming) continue;
            const frame = { ...item, seq, t: seq / rate };
            if (this.lastSeq !== null && seq > this.lastSeq + 1) {
              this.status = { ...this.status, lost: this.status.lost + (seq - this.lastSeq - 1) };
            }
            this.lastSeq = seq;
            this.status = { ...this.status, received: this.status.received + 1 };
            this.batch.push(frame);
          }
        }
      }
    } catch {
      // Кабель выдернули или плата перезагрузилась
    } finally {
      this.reader?.releaseLock();
      this.reader = null;
    }
    if (!this.closing) void this.reconnect();
  }

  /** Новый заголовок посреди работы — набор датчиков сменился: обновляем, кто на связи. */
  private onHeader(): void {
    const info = this.status.info;
    if (!info) return; // первый заголовок после открытия порта — статус соберёт open()
    const present = this.parser.sensors;
    const sensors = sensorsAfterHeader(this.status.sensors, present);
    const same = sensors.length === this.status.sensors.length && sensors.every((s, i) => s.online === this.status.sensors[i]?.online);
    if (same) return;
    const placements = [...new Set([...info.placements, ...present])];
    this.setStatus({ ...this.status, info: { ...info, placements }, sensors });
  }

  /** Обрыв: пробуем открыть тот же порт снова, 5 попыток раз в секунду. */
  private async reconnect(): Promise<void> {
    for (let attempt = 1; attempt <= RECONNECT_MAX && !this.closing; attempt++) {
      this.setStatus({ ...this.status, phase: 'reconnecting', reconnect: { attempt, max: RECONNECT_MAX } });
      await new Promise((r) => setTimeout(r, 1000));
      try {
        await this.port?.close().catch(() => undefined);
        await this.open();
        if (this.status.phase === 'connected' || this.status.phase === 'streaming') return;
      } catch {
        // следующая попытка
      }
    }
    if (!this.closing) this.fail('connection_lost', 'Связь с устройством потеряна. Проверьте кабель и подключите снова.');
  }

  async disconnect(): Promise<void> {
    this.closing = true;
    this.streaming = false;
    if (this.flushTimer) clearInterval(this.flushTimer);
    try {
      await this.reader?.cancel();
      await this.port?.close();
    } catch {
      // порт уже закрыт
    }
    this.port = null;
    this.closing = false;
    this.setStatus(emptyStatus());
  }

  async start(): Promise<void> {
    // В контракте способа А устройство шлёт поток всегда; «старт» — начать принимать
    this.streaming = true;
    this.lastSeq = null;
    this.flushTimer = setInterval(() => {
      if (!this.batch.length) return;
      const frames = this.batch;
      this.batch = [];
      for (const cb of this.dataListeners) cb(frames);
    }, 40);
    if (this.status.phase === 'connected') this.setStatus({ ...this.status, phase: 'streaming' });
  }

  async stop(): Promise<void> {
    this.streaming = false;
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
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

  private fail(code: NonNullable<DeviceStatus['error']>['code'], message: string): void {
    this.setStatus({ ...this.status, phase: 'error', reconnect: null, error: { code, message } });
  }

  private setStatus(s: DeviceStatus): void {
    this.status = s;
    for (const cb of this.statusListeners) cb(s);
  }
}
