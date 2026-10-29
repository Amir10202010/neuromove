// Генератор сырых чисел для независимого эталона: движение тела → что выдал бы MPU-6050.
//
// Как устроено:
//   1. Поза тела задаётся функцией непрерывного времени (траектории минимального рывка).
//   2. На сетке 1 кГц — как внутренняя частота MPU-6050 при включённом DLPF — считаются
//      удельная сила (что видит акселерометр) и угловая скорость в осях датчика:
//      ускорение — центральная разность 4-го порядка положения, угловая скорость — 2·vec(q* ⊗ q̇),
//      q̇ — центральная разность 4-го порядка.
//   3. Ошибки датчика по даташиту PS-MPU-6000A-00 rev 3.1: ноль, масштаб, перекрёстная
//      чувствительность, смещение гироскопа и его чувствительность к ускорению, шум.
//   4. Фильтр DLPF_CFG = 3: два звена первого порядка τ = 2,45 мс — срез ≈ 42 Гц, задержка 4,9 мс
//      (RM-MPU-6000A-00 rev 4.0, регистр 26).
//   5. Плата читает датчики по очереди: у каждого своя задержка чтения от начала цикла
//      и дрожание; берётся последнее значение регистров. Округление до int16 и упор в предел.

import type { RawFrame } from '../devices/types';
import { sensorKinematics, truth, type BodyPose, type BodyTruth, type SensorPlace } from './body';
import { Q_ID, RAD, qAxis, qConj, qMul, qRotInv, type Q, type V } from './quat';
import { XRng } from './rng';

export const G0 = 9.80665;
/** Масштабы из даташита: ±4 g и ±1000 °/с. Нарочно не импортируются из core/imu.ts. */
export const ACC_LSB = 8192;
export const GYRO_LSB = 32.8;
const FS = 1000;
const H = 1 / FS;
/** Плотность шума: акселерометр 400 мкg/√Гц, гироскоп 0,005 °/с/√Гц. На 1 кГц до фильтра — × √(fs/2). */
const ACC_NOISE = 400e-6 * Math.sqrt(FS / 2);
const GYRO_NOISE = 0.005 * Math.sqrt(FS / 2);
const DLPF_TAU = 2.45e-3;

// ── Траектории ──────────────────────────────────────────────────────────────

/** Профиль минимального рывка 0 → 1: гладкий, скорость и ускорение на концах нулевые. */
export function minJerk(x: number): number {
  const s = Math.min(1, Math.max(0, x));
  return s * s * s * (10 - 15 * s + 6 * s * s);
}

/** Кусочная траектория по ключевым точкам [время, значение]: между ними — минимальный рывок. */
export function keyframes(keys: readonly (readonly [number, number])[]): (t: number) => number {
  const first = keys[0] as readonly [number, number];
  const last = keys[keys.length - 1] as readonly [number, number];
  return (t) => {
    if (t <= first[0]) return first[1];
    for (let i = 1; i < keys.length; i++) {
      const [t1, v1] = keys[i] as readonly [number, number];
      const [t0, v0] = keys[i - 1] as readonly [number, number];
      if (t <= t1) return t1 === t0 ? v1 : v0 + (v1 - v0) * minJerk((t - t0) / (t1 - t0));
    }
    return last[1];
  };
}

// ── Ошибки датчика ──────────────────────────────────────────────────────────

export interface MpuErrors {
  /** Ноль акселерометра, g. */
  accOff: V;
  /** Масштаб и перекрёстная чувствительность акселерометра: матрица 3 × 3 по строкам. */
  accGain: number[];
  /** Смещение гироскопа, °/с. */
  gyroBias: V;
  gyroGain: number[];
  /** Чувствительность гироскопа к ускорению, °/с на g: матрица 3 × 3. */
  gSens: number[];
}

/** ideal — без ошибок, только шум; typical — случайно в пределах даташита; edge — на краю допусков. */
export type ErrorProfile = 'ideal' | 'typical' | 'edge';

export function makeErrors(profile: ErrorProfile, rng: XRng): MpuErrors {
  if (profile === 'ideal') {
    return { accOff: [0, 0, 0], accGain: eye(), gyroBias: [0, 0, 0], gyroGain: eye(), gSens: zeros() };
  }
  const edge = profile === 'edge';
  const pick = (lim: number) => (edge ? (rng.next() < 0.5 ? -lim : lim) : rng.uniform(-lim, lim));
  const gain = (scaleLim: number, crossLim: number) => {
    const m = eye();
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        m[i * 3 + j] = i === j ? 1 + pick(scaleLim) : rng.uniform(-crossLim, crossLim);
      }
    }
    return m;
  };
  return {
    accOff: [pick(0.05), pick(0.05), pick(0.08)],
    accGain: gain(0.03, 0.02),
    gyroBias: [pick(20), pick(20), pick(20)],
    gyroGain: gain(0.03, 0.02),
    gSens: Array.from({ length: 9 }, () => rng.uniform(-0.1, 0.1)),
  };
}

function eye(): number[] {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

function zeros(): number[] {
  return [0, 0, 0, 0, 0, 0, 0, 0, 0];
}

function mulMV(m: number[], v: V): [number, number, number] {
  return [
    (m[0] as number) * v[0] + (m[1] as number) * v[1] + (m[2] as number) * v[2],
    (m[3] as number) * v[0] + (m[4] as number) * v[1] + (m[5] as number) * v[2],
    (m[6] as number) * v[0] + (m[7] as number) * v[1] + (m[8] as number) * v[2],
  ];
}

/** Вторая производная по пяти точкам с шагом H (4-й порядок). */
function d2(m2: number, m1: number, c: number, p1: number, p2: number): number {
  return (-p2 + 16 * p1 - 30 * c + 16 * m1 - m2) / (12 * H * H);
}

/** Первая производная по четырём точкам вокруг центра с шагом H (4-й порядок). */
function d1(m2: number, m1: number, p1: number, p2: number): number {
  return (-p2 + 8 * p1 - 8 * m1 + m2) / (12 * H);
}

function quantize(x: number): number {
  const r = Math.round(x);
  return r > 32767 ? 32767 : r < -32768 ? -32768 : r;
}

/** Случайный перекос крепления: поворот на заданный угол вокруг случайной оси. */
export function randomTilt(rng: XRng, deg: number): Q {
  if (deg === 0) return Q_ID;
  const axis: V = [rng.normal(), rng.normal(), rng.normal()];
  return qAxis(axis, deg * RAD);
}

// ── Генерация записи ────────────────────────────────────────────────────────

export interface GenSpec {
  durationSec: number;
  motion: (t: number) => BodyPose;
  places: readonly SensorPlace[];
  seed: number;
  rateHz?: number;
  errors?: ErrorProfile;
  /** Множитель шума: 1 — как в даташите. */
  noise?: number;
  /** Перекос крепления, градусы: у каждого датчика своя случайная ось. */
  misalignDeg?: number;
  /** Свой поворот крепления на конкретном датчике (поверх перекоса), в осях датчика. */
  mountExtra?: Partial<Record<SensorPlace, Q>>;
  /** Задержка чтения датчика от начала цикла, мс: I2C читает по очереди, ~1,6 мс на датчик при 100 кГц. */
  readSkewMs?: Partial<Record<SensorPlace, number>>;
  /** СКО дрожания момента чтения, мс (обрезается до ±4 мс). */
  jitterMs?: number;
  /** Смещение гироскопа, добавленное после калибровки (тепловой дрейф), °/с. */
  gyroDrift?: (t: number, place: SensorPlace) => V;
  /** Фильтр DLPF; false — без фильтра. */
  dlpf?: boolean;
}

export interface Generated {
  frames: RawFrame[];
  /** Углы эталона на номинальный момент отсчёта t = seq / rate. */
  truth: BodyTruth[];
  errors: Record<SensorPlace, MpuErrors>;
  rateHz: number;
}

interface KinSample {
  q: Q;
  p: V;
}

export function generate(spec: GenSpec): Generated {
  const rate = spec.rateHz ?? 100;
  const rng = new XRng(spec.seed);
  const noise = spec.noise ?? 1;
  const dlpf = spec.dlpf ?? true;
  const places = spec.places;
  const errors = {} as Record<SensorPlace, MpuErrors>;
  const mis = {} as Record<SensorPlace, Q>;
  for (const p of places) {
    errors[p] = makeErrors(spec.errors ?? 'typical', rng);
    mis[p] = qMul(randomTilt(rng, spec.misalignDeg ?? 0), spec.mountExtra?.[p] ?? Q_ID);
  }
  const nFrames = Math.round(spec.durationSec * rate);
  const nMs = Math.round(spec.durationSec * FS) + 10;

  // Когда читается каждый датчик: номер отсчёта 1 кГц → кто читается
  const reads = new Map<number, { k: number; place: SensorPlace }[]>();
  const frames: RawFrame[] = [];
  const truths: BodyTruth[] = [];
  for (let k = 0; k < nFrames; k++) {
    const t = k / rate;
    frames.push({ seq: k, t, data: {} });
    truths.push(truth(spec.motion(t)));
    for (const place of places) {
      let jit = spec.jitterMs ? rng.normal(spec.jitterMs) : 0;
      jit = Math.max(-4, Math.min(4, jit));
      const j = Math.max(2, Math.round((t + ((spec.readSkewMs?.[place] ?? 0) + jit) / 1000) * FS));
      const list = reads.get(j) ?? [];
      list.push({ k, place });
      reads.set(j, list);
    }
  }

  // Скользящее окно из 5 точек кинематики для разностей 4-го порядка
  const kinAt = (j: number): Record<SensorPlace, KinSample> => {
    const kin = sensorKinematics(spec.motion(j * H));
    const out = {} as Record<SensorPlace, KinSample>;
    for (const p of places) out[p] = { q: qMul(kin[p].q, mis[p]), p: kin[p].p };
    return out;
  };
  const win: Record<SensorPlace, KinSample>[] = [kinAt(-2), kinAt(-1), kinAt(0), kinAt(1), kinAt(2)];
  const state = {} as Record<SensorPlace, { s1: number[]; s2: number[] }>;
  for (const p of places) state[p] = { s1: [0, 0, 0, 0, 0, 0], s2: [0, 0, 0, 0, 0, 0] };
  // Обратный Эйлер: задержка звена на линейном сигнале ровно τ — два звена дают 4,9 мс, как в даташите
  const a = H / (DLPF_TAU + H);
  let primed = false;

  for (let j = 0; j <= nMs; j++) {
    if (j > 0) {
      win.shift();
      win.push(kinAt(j + 2));
    }
    for (const place of places) {
      const m2 = (win[0] as Record<SensorPlace, KinSample>)[place];
      const m1 = (win[1] as Record<SensorPlace, KinSample>)[place];
      const c = (win[2] as Record<SensorPlace, KinSample>)[place];
      const p1 = (win[3] as Record<SensorPlace, KinSample>)[place];
      const p2 = (win[4] as Record<SensorPlace, KinSample>)[place];
      // Ускорение, м/с², и q̇ — центральные разности 4-го порядка
      const acc: V = [d2(m2.p[0], m1.p[0], c.p[0], p1.p[0], p2.p[0]), d2(m2.p[1], m1.p[1], c.p[1], p1.p[1], p2.p[1]), d2(m2.p[2], m1.p[2], c.p[2], p1.p[2], p2.p[2])];
      const qd: Q = [
        d1(m2.q[0], m1.q[0], p1.q[0], p2.q[0]),
        d1(m2.q[1], m1.q[1], p1.q[1], p2.q[1]),
        d1(m2.q[2], m1.q[2], p1.q[2], p2.q[2]),
        d1(m2.q[3], m1.q[3], p1.q[3], p2.q[3]),
      ];
      // Угловая скорость в осях датчика: ω = 2·vec(q* ⊗ q̇)
      const w = qMul(qConj(c.q), qd);
      const gyroTrue: V = [(2 * w[1]) / RAD, (2 * w[2]) / RAD, (2 * w[3]) / RAD];
      // Удельная сила: ускорение минус гравитация, в g; в покое — +1 g «вверх»
      const fWorld: V = [acc[0] / G0, acc[1] / G0, acc[2] / G0 + 1];
      const f = qRotInv(c.q, fWorld);

      const e = errors[place];
      const accM = mulMV(e.accGain, f);
      const gyroM = mulMV(e.gyroGain, gyroTrue);
      const gs = mulMV(e.gSens, f);
      const drift = spec.gyroDrift?.(j * H, place) ?? [0, 0, 0];
      const x = [
        accM[0] + e.accOff[0] + rng.normal(ACC_NOISE * noise),
        accM[1] + e.accOff[1] + rng.normal(ACC_NOISE * noise),
        accM[2] + e.accOff[2] + rng.normal(ACC_NOISE * noise),
        gyroM[0] + e.gyroBias[0] + gs[0] + drift[0] + rng.normal(GYRO_NOISE * noise),
        gyroM[1] + e.gyroBias[1] + gs[1] + drift[1] + rng.normal(GYRO_NOISE * noise),
        gyroM[2] + e.gyroBias[2] + gs[2] + drift[2] + rng.normal(GYRO_NOISE * noise),
      ];
      const st = state[place];
      for (let i = 0; i < 6; i++) {
        if (!dlpf || !primed) {
          st.s1[i] = x[i] as number;
          st.s2[i] = x[i] as number;
        } else {
          st.s1[i] = (st.s1[i] as number) + a * ((x[i] as number) - (st.s1[i] as number));
          st.s2[i] = (st.s2[i] as number) + a * ((st.s1[i] as number) - (st.s2[i] as number));
        }
      }
    }
    primed = true;
    for (const r of reads.get(j) ?? []) {
      const st = state[r.place].s2;
      const raw = new Int16Array(6);
      for (let i = 0; i < 3; i++) raw[i] = quantize((st[i] as number) * ACC_LSB);
      for (let i = 3; i < 6; i++) raw[i] = quantize((st[i] as number) * GYRO_LSB);
      (frames[r.k] as RawFrame).data[r.place] = raw;
    }
  }
  return { frames, truth: truths, errors, rateHz: rate };
}

// ── Калибровка акселерометра в 6 положениях — как в прошивке ────────────────

export interface SixPoseResult {
  /** Ноль, единицы датчика (как в паспорте `# cal_<место>=…`). */
  off: [number, number, number];
  /** Масштаб, 1 — ровно 8192 ед/g; округлён до 1e-4, как в паспорте. */
  scale: [number, number, number];
}

/**
 * Повтор процедуры прошивки (firmware/NeuroMoveStand/accel_cal.h) на модели датчика:
 * 6 граней, по 150 отсчётов, ноль = (+1 g + −1 g) / 2, масштаб = (+1 g − −1 g) / 2 / 8192.
 * tiltDeg — насколько грань стоит неровно (стол, рука). Проверки прошивки повторены:
 * нужная ось 0,8–1,2 g, остальные меньше 0,25 g, ноль не дальше 0,2 g, масштаб 0,9–1,1.
 * null — прошивка отказала бы.
 */
export function sixPoseCalibration(e: MpuErrors, rng: XRng, tiltDeg = 0): SixPoseResult | null {
  const outNoise = 400e-6 * Math.sqrt(1 / (8 * DLPF_TAU)); // СКО после фильтра, g
  const mean = (up: V): [number, number, number] => {
    const tilt = randomTilt(rng, tiltDeg);
    const f = qRotInv(tilt, up);
    const m = mulMV(e.accGain, f);
    const s = [0, 0, 0];
    for (let n = 0; n < 150; n++) {
      for (let i = 0; i < 3; i++) {
        s[i] = (s[i] as number) + quantize(((m[i] as number) + (e.accOff[i] as number) + rng.normal(outNoise)) * ACC_LSB);
      }
    }
    return [(s[0] as number) / 150, (s[1] as number) / 150, (s[2] as number) / 150];
  };
  const off: [number, number, number] = [0, 0, 0];
  const scale: [number, number, number] = [1, 1, 1];
  for (let axis = 0; axis < 3; axis++) {
    const unit = [0, 0, 0];
    unit[axis] = 1;
    const hi = mean(unit as unknown as V);
    const lo = mean([-(unit[0] as number), -(unit[1] as number), -(unit[2] as number)]);
    for (const [v, sign] of [[hi, 1], [lo, -1]] as const) {
      const upc = sign * (v[axis] as number);
      if (upc < 0.8 * ACC_LSB || upc > 1.2 * ACC_LSB) return null;
      for (let i = 0; i < 3; i++) if (i !== axis && Math.abs(v[i] as number) > 0.25 * ACC_LSB) return null;
    }
    const o = ((hi[axis] as number) + (lo[axis] as number)) / 2;
    const sc = ((hi[axis] as number) - (lo[axis] as number)) / 2 / ACC_LSB;
    if (Math.abs(o) > 0.2 * ACC_LSB || sc < 0.9 || sc > 1.1) return null;
    off[axis] = Math.round(o);
    scale[axis] = Math.round(sc * 1e4) / 1e4;
  }
  return { off, scale };
}
