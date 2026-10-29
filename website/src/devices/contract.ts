// Контракт с железом — софт.md, раздел 1. Любая правка формата — новая версия.
//
// USB (способы А и В): при старте устройство печатает паспорт — строки с `#`,
// затем заголовок столбцов и по строке на отсчёт, целые числа прямо с датчиков:
//
//   # imu-csv v1
//   # device=NM-01 fw=0.1 rate_hz=100 acc_g=4 gyro_dps=1000 sensors=trunk,upper_r,fore_r
//   seq,trunk_ax,trunk_ay,trunk_az,trunk_gx,trunk_gy,trunk_gz,upper_r_ax,…,fore_r_gz
//   0,152,-40,8174,12,-35,7,98,15,8201,-4,20,11,…
//
// Bluetooth (способ Б): пакет 18 байт, little-endian — разбор в parseBlePacket.

import type { AccCalibration } from '../core/imu';
import { PLACEMENTS, type Placement, type RawFrame, type SensorState } from './types';

export const CSV_FORMAT = 'imu-csv v1';
const AXES = ['ax', 'ay', 'az', 'gx', 'gy', 'gz'] as const;

export interface CsvPassport {
  format: string;
  device: string;
  firmware: string;
  rateHz: number;
  accG: number;
  gyroDps: number;
  sensors: Placement[];
  /** Остальные пары key=value из паспорта: пациент, движение, версия алгоритма… */
  extra: Record<string, string>;
}

export type CsvLineResult =
  | { kind: 'passport' }
  | { kind: 'header' }
  | { kind: 'frame'; frame: RawFrame }
  | { kind: 'mark'; seq: number; ref: number }
  | { kind: 'skip' }
  | { kind: 'error'; message: string };

function isPlacement(x: string): x is Placement {
  return (PLACEMENTS as readonly string[]).includes(x);
}

/**
 * Разбор построчно — подходит и для потока из USB-порта, и для файла записи.
 * Неверные строки не роняют разбор: возвращается { kind: 'error' }, их считают и показывают.
 */
export class ImuCsvParser {
  passport: CsvPassport = {
    format: '',
    device: '',
    firmware: '',
    rateHz: 100,
    accG: 4,
    gyroDps: 1000,
    sensors: [],
    extra: {},
  };
  private columns: Placement[] = [];
  errors = 0;

  get ready(): boolean {
    return this.columns.length > 0;
  }

  /** Датчики в последнем заголовке: прошивка убирает не ответивший датчик и шлёт новый заголовок. */
  get sensors(): Placement[] {
    return [...this.columns];
  }

  pushLine(raw: string): CsvLineResult {
    const line = raw.trim();
    if (!line) return { kind: 'skip' };
    if (line.startsWith('#')) return this.passportLine(line.slice(1).trim());
    if (line.startsWith('seq')) return this.headerLine(line);
    if (!this.ready) return { kind: 'skip' }; // строки до заголовка — мусор после перезагрузки платы
    const parts = line.split(',');
    const expected = 1 + this.columns.length * 6;
    if (parts.length !== expected) {
      this.errors += 1;
      return { kind: 'error', message: `ожидалось ${expected} чисел, пришло ${parts.length}` };
    }
    const nums = parts.map(Number);
    if (nums.some((n) => !Number.isFinite(n) || !Number.isInteger(n))) {
      this.errors += 1;
      return { kind: 'error', message: 'в строке не целые числа' };
    }
    // Датчик отдаёт int16. Число вне диапазона Int16Array молча «завернул» бы в другое —
    // такая строка испорчена, считаем её ошибкой, а не отсчётом.
    if (nums.some((n, i) => i > 0 && (n < -32768 || n > 32767))) {
      this.errors += 1;
      return { kind: 'error', message: 'число вне диапазона int16' };
    }
    const seq = nums[0] as number;
    const data: RawFrame['data'] = {};
    this.columns.forEach((p, i) => {
      const arr = new Int16Array(6);
      for (let j = 0; j < 6; j++) arr[j] = nums[1 + i * 6 + j] as number;
      data[p] = arr;
    });
    return { kind: 'frame', frame: { seq, t: seq / this.passport.rateHz, data } };
  }

  private passportLine(body: string): CsvLineResult {
    if (body.startsWith('imu-csv')) {
      this.passport.format = body;
      return { kind: 'passport' };
    }
    const pairs = Object.fromEntries(
      body
        .split(/\s+/)
        .map((kv) => kv.split('='))
        .filter((kv): kv is [string, string] => kv.length === 2),
    );
    if (body.startsWith('mark')) {
      return { kind: 'mark', seq: Number(pairs.seq), ref: Number(pairs.ref) };
    }
    for (const [k, v] of Object.entries(pairs)) {
      switch (k) {
        case 'device':
          this.passport.device = v;
          break;
        case 'fw':
          this.passport.firmware = v;
          break;
        case 'rate_hz':
          this.passport.rateHz = Number(v) || 100;
          break;
        case 'acc_g':
          this.passport.accG = Number(v) || 4;
          break;
        case 'gyro_dps':
          this.passport.gyroDps = Number(v) || 1000;
          break;
        case 'sensors':
          this.passport.sensors = v.split(',').filter(isPlacement);
          break;
        default:
          this.passport.extra[k] = v;
      }
    }
    return { kind: 'passport' };
  }

  private headerLine(line: string): CsvLineResult {
    const cols = line.split(',').slice(1);
    const places: Placement[] = [];
    for (let i = 0; i < cols.length; i += 6) {
      const name = (cols[i] ?? '').replace(/_ax$/, '');
      if (!isPlacement(name)) {
        this.errors += 1;
        return { kind: 'error', message: `неизвестное место датчика: ${name}` };
      }
      places.push(name);
    }
    this.columns = places;
    if (!this.passport.sensors.length) this.passport.sensors = places;
    return { kind: 'header' };
  }
}

/**
 * Строки из потока кусков. Порт отдаёт текст кусками, которые режутся где угодно — посреди строки
 * и даже посреди числа; хвост без перевода строки ждёт следующего куска. Если перевода строки нет
 * слишком долго (неверная скорость порта — сплошной мусор), хвост выбрасывается: буфер не растёт
 * без предела. Самая длинная строка imu-csv v1 — 5 датчиков × 6 чисел — около 220 знаков.
 */
export class LineSplitter {
  private buffer = '';
  /** Сколько раз хвост выброшен как мусор. */
  overflows = 0;

  constructor(private readonly maxLine = 4096) {}

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    if (this.buffer.length > this.maxLine) {
      this.buffer = '';
      this.overflows += 1;
    }
    return lines;
  }
}

/**
 * Кто на связи после нового заголовка. Прошивка стенда убирает из потока датчик, который не ответил
 * после трёх перезапусков шины, и печатает паспорт с заголовком заново; вернувшийся датчик — тоже.
 * Датчик, которого нет в заголовке, — не на связи, даже если раньше был: иначе экран показывал бы его
 * живым, а угол считался бы по последнему числу.
 */
export function sensorsAfterHeader(prev: readonly SensorState[], present: readonly Placement[]): SensorState[] {
  const out = prev.map((s) => ({ ...s, online: present.includes(s.placement), link: present.includes(s.placement) ? s.link : 0 }));
  for (const p of present) {
    if (!out.some((s) => s.placement === p)) out.push({ placement: p, online: true, battery: null, lowBattery: false, link: 1 });
  }
  return out;
}

/**
 * Номер отсчёта, который только растёт. Движок живёт по времени отсчётов (`t = seq / rate`), а номер
 * от железа может «отскочить» назад: плата перезагрузилась посреди теста, или прошивка считает seq
 * в 16 битах (65 535 → 0 через 11 минут на 100 Гц). Без поправки время пошло бы вспять, а учёт потерь
 * ослеп бы. Отскок склеиваем: следующий отсчёт идёт через `gapOnReset` номеров после последнего —
 * 1 для склейки, больше, если известно, сколько времени прошло (тогда движок увидит пропуск
 * и не засчитает разорванный повтор). Тот же номер второй раз — повтор строки, его выбрасываем.
 *
 * Одна испорченная цифра в номере (байт потерялся на линии) выглядит так же, как отскок или как
 * разрыв в тысячи номеров. Поэтому подозрительный номер — назад или дальше `maxJump` вперёд — ждёт
 * следующую строку: поток продолжился от него — это правда (перезагрузка или долгий разрыв);
 * продолжился от прежнего номера — строка испорчена и выбрасывается (`corrupt`).
 */
export interface Unwrapped<T> {
  seq: number;
  item: T;
}

export class SeqUnwrapper {
  private offset = 0;
  private last: number | null = null;
  private pending: { seq: number; gap: number; item: unknown } | null = null;
  /** Сколько раз номер отскакивал назад — перезагрузка платы. */
  resets = 0;
  /** Сколько строк выброшено как испорченные: номер прыгнул, а поток продолжился от прежнего. */
  corrupt = 0;
  /** Сколько строк пришло второй раз. */
  duplicates = 0;

  /** maxJump — разрыв вперёд, который принимается сразу: 2 с на 100 Гц. Дальше — только с подтверждением. */
  constructor(private readonly maxJump = 200) {}

  /** Строка ждёт подтверждения следующей строкой. */
  get waiting(): boolean {
    return this.pending !== null;
  }

  /**
   * Очередная строка. Возвращает строки, готовые к выдаче, с монотонными номерами: обычно одну,
   * ни одной — для повтора или подозрительной строки, две — когда подозрительная подтвердилась.
   */
  push<T>(seq: number, item: T, gapOnReset = 1): Unwrapped<T>[] {
    const out: Unwrapped<T>[] = [];
    const held = this.pending;
    if (held) {
      this.pending = null;
      if (seq === held.seq + 1) {
        out.push({ seq: this.accept(held.seq, held.gap), item: held.item as T });
        out.push({ seq: this.accept(seq, 1), item });
        return out;
      }
      this.corrupt += 1;
    }
    if (this.last === null) {
      out.push({ seq: this.accept(seq, gapOnReset), item });
      return out;
    }
    const prevRaw = this.last - this.offset;
    if (seq === prevRaw) {
      this.duplicates += 1;
      return out;
    }
    if (seq > prevRaw && seq - prevRaw <= this.maxJump) {
      out.push({ seq: this.accept(seq, gapOnReset), item });
      return out;
    }
    this.pending = { seq, gap: gapOnReset, item };
    return out;
  }

  /** Конец записи: подтвердить подозрительную строку нечем — она выбрасывается. */
  flush(): void {
    if (this.pending) this.corrupt += 1;
    this.pending = null;
  }

  private accept(seq: number, gapOnReset: number): number {
    let abs = seq + this.offset;
    if (this.last !== null && abs <= this.last) {
      this.offset = this.last + Math.max(1, gapOnReset) - seq;
      abs = seq + this.offset;
      this.resets += 1;
    }
    this.last = abs;
    return abs;
  }

  /** Номер с той же поправкой, без учёта как отсчёта — для отметок `# mark seq=…`. */
  map(seq: number): number {
    return seq + this.offset;
  }
}

/**
 * Поправки акселерометра из паспорта: `# cal_fore_r=12,-30,45,10012,9988,10005` — ноль трёх осей
 * в единицах датчика и масштаб × 10 000 (прошивка стенда, firmware, accel_cal.h).
 * Строку, которая не похожа на правду (не 6 целых, ноль дальше 0,25 g, масштаб вне 0,9–1,1),
 * не берём: лучше без поправок, чем с испорченными.
 */
export function accCalFromPassport(extra: Record<string, string>): Partial<Record<Placement, AccCalibration>> {
  const out: Partial<Record<Placement, AccCalibration>> = {};
  for (const p of PLACEMENTS) {
    const v = extra[`cal_${p}`];
    if (!v) continue;
    const n = v.split(',').map(Number);
    if (n.length !== 6 || n.some((x) => !Number.isInteger(x))) continue;
    const off = n.slice(0, 3) as [number, number, number];
    const scale = n.slice(3).map((x) => x / 10_000) as [number, number, number];
    if (off.some((x) => Math.abs(x) > 2048) || scale.some((x) => x < 0.9 || x > 1.1)) continue;
    out[p] = { off, scale };
  }
  return out;
}

/**
 * Отпечатки модулей из паспорта: `# id_trunk=5A4C6311 id_fore_r=5A4C6333` — заводские значения
 * самопроверки MPU-6050 (прошивка стенда, mpu6050.h), `none` — у копии чипа их нет. Хранятся с сеансом:
 * видно, каким модулем снят замер, и что поправки калибровки сняты с него же.
 */
export function moduleIdsFromPassport(extra: Record<string, string>): Partial<Record<Placement, string>> {
  const out: Partial<Record<Placement, string>> = {};
  for (const p of PLACEMENTS) {
    const v = extra[`id_${p}`];
    if (v && /^([0-9A-F]{8}|none)$/.test(v)) out[p] = v;
  }
  return out;
}

export function moduleIdsToPassport(ids: Partial<Record<Placement, string>> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of PLACEMENTS) {
    const v = ids?.[p];
    if (v) out[`id_${p}`] = v;
  }
  return out;
}

/** Обратно в пары паспорта — чтобы выгрузка сырых данных несла те же поправки. */
export function accCalToPassport(cal: Partial<Record<Placement, AccCalibration>> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of PLACEMENTS) {
    const c = cal?.[p];
    if (!c) continue;
    out[`cal_${p}`] = [...c.off.map((x) => Math.round(x)), ...c.scale.map((x) => Math.round(x * 10_000))].join(',');
  }
  return out;
}

/**
 * Паспорт по контракту imu-csv v1 (софт.md, раздел 1): частота 10–1000 Гц, диапазоны ровно ±4 g
 * и ±1000 °/с. Масштаб в приложении жёстко под них (`core/imu.ts`): устройство с ±8 g и ±2000 °/с
 * дало бы гироскоп вдвое меньше настоящего и тревогу «ребёнок двигался» вместо честного «не тот
 * формат». Отрицательная частота развернула бы время. null — паспорт годится; иначе — что не так.
 */
export function passportProblem(p: CsvPassport): string | null {
  if (p.format && !p.format.startsWith(CSV_FORMAT)) return `формат «${p.format.slice(0, 40)}», а нужен ${CSV_FORMAT}`;
  if (!Number.isFinite(p.rateHz) || p.rateHz < 10 || p.rateHz > 1000) return `частота ${p.rateHz} Гц вне 10–1000 Гц`;
  if (p.accG !== 4 || p.gyroDps !== 1000) return `диапазоны ±${p.accG} g и ±${p.gyroDps} °/с, а по контракту нужны ±4 g и ±1000 °/с`;
  return null;
}

/** Строка из паспорта устройства для записи сеанса: без управляющих символов и не длиннее limit (архив принимает до 300). */
export function passportText(v: string, limit = 64): string {
  const chars: string[] = [];
  for (const ch of v) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 32 && c !== 127) chars.push(ch);
    if (chars.length >= limit) break;
  }
  return chars.join('');
}

/**
 * Запись сделана симулятором: выгрузка из демо (в паспорте `demo=yes`) или имя устройства-симулятора.
 * Такую запись нельзя проиграть в пространстве клиники — она стала бы «замером» настоящего ребёнка.
 */
export function isSimulatedRecording(p: CsvPassport): boolean {
  return p.extra.demo === 'yes' || /sim|симулятор/i.test(p.device);
}

/**
 * Разбор целого файла записи. Номера отсчётов — монотонные (`SeqUnwrapper`): запись, в которой плата
 * перезагрузилась, проигрывается без скачка времени назад; отметки после перезагрузки сдвигаются так же.
 */
export function parseImuCsv(text: string): { passport: CsvPassport; frames: RawFrame[]; errors: number; marks: { seq: number; ref: number }[] } {
  const parser = new ImuCsvParser();
  const unwrap = new SeqUnwrapper();
  const frames: RawFrame[] = [];
  const marks: { seq: number; ref: number }[] = [];
  // Отметка, пришедшая, пока строка ждёт подтверждения, сдвигается так, как решится эта строка
  let waitingMarks: { seq: number; ref: number }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const r = parser.pushLine(line);
    if (r.kind === 'frame') {
      for (const u of unwrap.push(r.frame.seq, r.frame)) frames.push({ ...u.item, seq: u.seq, t: u.seq / parser.passport.rateHz });
      if (!unwrap.waiting && waitingMarks.length) {
        for (const m of waitingMarks) marks.push({ seq: unwrap.map(m.seq), ref: m.ref });
        waitingMarks = [];
      }
    }
    if (r.kind === 'mark') {
      if (unwrap.waiting) waitingMarks.push({ seq: r.seq, ref: r.ref });
      else marks.push({ seq: unwrap.map(r.seq), ref: r.ref });
    }
  }
  unwrap.flush();
  for (const m of waitingMarks) marks.push({ seq: unwrap.map(m.seq), ref: m.ref });
  return { passport: parser.passport, frames, errors: parser.errors + unwrap.corrupt, marks };
}

/** Запись в тот же формат — выгрузка сеанса открывается в Excel и в лаборатории на Python. */
export function serializeImuCsv(
  passport: Omit<CsvPassport, 'format'>,
  frames: readonly RawFrame[],
): string {
  const sensors = passport.sensors;
  const extra = Object.entries(passport.extra)
    .map(([k, v]) => `${k}=${String(v).replace(/\s+/g, '_')}`)
    .join(' ');
  const lines: string[] = [
    `# ${CSV_FORMAT}`,
    `# device=${passport.device} fw=${passport.firmware} rate_hz=${passport.rateHz} acc_g=${passport.accG} gyro_dps=${passport.gyroDps} sensors=${sensors.join(',')}`,
  ];
  if (extra) lines.push(`# ${extra}`);
  const header = (places: readonly Placement[]) => ['seq', ...places.flatMap((p) => AXES.map((a) => `${p}_${a}`))].join(',');
  // Заголовок — по датчикам, которые есть в кадре. Набор сменился (датчик пропал или вернулся) — новый
  // заголовок, как у прошивки. Пропавший датчик не пишется нулями: нули прочитались бы как настоящий
  // замер «датчик смотрит в никуда», и угол после загрузки файла стал бы ложным.
  let current: string | null = null;
  if (!frames.length) lines.push(header(sensors));
  for (const f of frames) {
    const present = sensors.filter((p) => f.data[p]);
    if (!present.length) continue;
    const key = present.join(',');
    if (key !== current) {
      lines.push(header(present));
      current = key;
    }
    const row: number[] = [f.seq];
    for (const p of present) row.push(...(f.data[p] as Int16Array));
    lines.push(row.join(','));
  }
  return lines.join('\n') + '\n';
}

/**
 * Отметки эталона в записи: строка `# mark seq=… ref=…` сразу после строки своего отсчёта —
 * так её пишет программа записи (софт.md, «Паспорт записи») и так её читает `parseImuCsv`.
 */
export function withMarks(csv: string, marks: readonly { seq: number; ref: number }[]): string {
  if (!marks.length) return csv;
  const bySeq = new Map<number, number[]>();
  for (const m of marks) bySeq.set(m.seq, [...(bySeq.get(m.seq) ?? []), m.ref]);
  return csv
    .split('\n')
    .flatMap((line) => {
      if (!/^\d/.test(line)) return [line];
      const seq = Number(line.slice(0, line.indexOf(',')));
      const refs = bySeq.get(seq);
      return refs ? [line, ...refs.map((ref) => `# mark seq=${seq} ref=${ref}`)] : [line];
    })
    .join('\n');
}

// ── Bluetooth LE ────────────────────────────────────────────────────────────

export interface BlePacket {
  seq: number;
  place: Placement;
  lowBattery: boolean;
  raw: Int16Array;
}

/**
 * Пакет `data` — 18 байт, little-endian:
 *   0–3  seq, uint32 · 4 номер места, uint8 · 5 флаги (бит 0 — батарея садится) · 6–17 ax…gz, int16 × 6
 */
export function parseBlePacket(v: DataView): BlePacket | null {
  if (v.byteLength < 18) return null;
  const placeIdx = v.getUint8(4);
  const place = PLACEMENTS[placeIdx];
  if (!place) return null;
  const raw = new Int16Array(6);
  for (let i = 0; i < 6; i++) raw[i] = v.getInt16(6 + 2 * i, true);
  return { seq: v.getUint32(0, true), place, lowBattery: (v.getUint8(5) & 1) === 1, raw };
}

/** Обратная операция — для тестов и для будущего эмулятора блока. */
export function encodeBlePacket(p: BlePacket): DataView {
  const v = new DataView(new ArrayBuffer(18));
  v.setUint32(0, p.seq, true);
  v.setUint8(4, PLACEMENTS.indexOf(p.place));
  v.setUint8(5, p.lowBattery ? 1 : 0);
  for (let i = 0; i < 6; i++) v.setInt16(6 + 2 * i, p.raw[i] as number, true);
  return v;
}
