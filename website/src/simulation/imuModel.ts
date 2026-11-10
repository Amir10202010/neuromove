// Что «видят» акселерометр и гироскоп каждого датчика — перенос идеи simulate.py.
// Берём позу тела (известные углы), считаем показания и добавляем то, что делает
// настоящий MPU-6050: шум, смещение гироскопа, небольшой перекос крепления,
// округление до целых и упор в предел диапазона.

import { ACC_LSB_PER_G, GYRO_LSB_PER_DPS, INT16_MAX } from '../core/imu';
import { PLACEMENTS, type Placement, type RawFrame } from '../devices/types';
import { createRng, type Rng } from '../lib/random';
import { DEG, add, apply, applyT, mul, rotAxis, transpose, type Mat3, type Vec3 } from '../lib/vec3';
import { bodyKinematics, type Pose } from './kinematics';

const G = 9.81;

export interface SensorNoise {
  /** Шум акселерометра, g (СКО). У MPU-6050 порядка 0.004 g при фильтре 44 Гц. */
  acc: number;
  /** Шум гироскопа, °/с (СКО). */
  gyro: number;
}

export const NORMAL_NOISE: SensorNoise = { acc: 0.004, gyro: 0.08 };

interface SensorState {
  /** Перекос крепления: датчик надет не идеально ровно. Настоящий поворот, 2–5°. */
  misalign: Mat3;
  /** Смещение гироскопа, °/с — в покое показывает не ноль. */
  gyroBias: Vec3;
  /** Смещение акселерометра, g. */
  accBias: Vec3;
  prevR: Mat3 | null;
  prevP: Vec3 | null;
  prevP2: Vec3 | null;
  /** Номер последнего кадра, где датчик считался: пропуск — прошлые значения не годятся. */
  lastSeq: number;
  noiseFactor: number;
  /** Displacement of the sensor from its nominal place on the segment, metres, in the sensor's own axes; null = nominal. */
  shift: Vec3 | null;
}

export class ImuSimulator {
  private readonly rng: Rng;
  /** Source of the per-sample sensor noise. The same generator as the mount unless a separate noise seed is given. */
  private readonly noiseRng: Rng;
  private readonly sensors: Record<Placement, SensorState>;
  readonly rateHz: number;

  /**
   * `noiseSeed` (optional): draw the per-sample noise from its own generator, so that the SAME mount (misalignment,
   * biases — from `seed`) can be recorded with independent noise realisations (uncertainty validation,
   * lab/measure/uncertainty.ts). Without it the behaviour is exactly as before: one generator for everything.
   */
  constructor(seed: number, rateHz = 100, noiseSeed?: number) {
    this.rng = createRng(seed);
    this.noiseRng = noiseSeed === undefined ? this.rng : createRng(noiseSeed);
    this.rateHz = rateHz;
    const s = {} as Record<Placement, SensorState>;
    for (const p of PLACEMENTS) {
      const axis: Vec3 = [this.rng.normal(), this.rng.normal(), this.rng.normal()];
      s[p] = {
        misalign: rotAxis(axis, this.rng.range(2, 5) * DEG),
        gyroBias: [this.rng.normal(0, 1.5), this.rng.normal(0, 1.5), this.rng.normal(0, 1.5)],
        accBias: [this.rng.normal(0, 0.01), this.rng.normal(0, 0.01), this.rng.normal(0, 0.01)],
        prevR: null,
        prevP: null,
        prevP2: null,
        lastSeq: -2,
        noiseFactor: 1,
        shift: null,
      };
    }
    this.sensors = s;
  }

  /** Сбой «шумный датчик»: плохо прилегает ремешок, помехи. factor = 1 — норма. */
  setNoiseFactor(p: Placement, factor: number): void {
    this.sensors[p].noiseFactor = factor;
  }

  /**
   * Sensor strapped at a different place on the segment (re-attachment study, lab/measure/placement.ts): `shift` is
   * the displacement in metres along the sensor's own axes (X = along the bone). Orientation is unchanged — only the
   * linear acceleration the accelerometer sees changes. Default: nominal position (output identical to before).
   */
  setPositionShift(p: Placement, shift: Vec3 | null): void {
    this.sensors[p].shift = shift && (shift[0] !== 0 || shift[1] !== 0 || shift[2] !== 0) ? shift : null;
  }

  /** После обрыва связи прошлые отсчёты не годятся для производных. */
  resetHistory(): void {
    for (const p of PLACEMENTS) {
      const s = this.sensors[p];
      s.prevR = null;
      s.prevP = null;
      s.prevP2 = null;
    }
  }

  /** Один кадр: поза тела в момент seq / rateHz → сырые числа всех датчиков. */
  frame(pose: Pose, seq: number, placements: readonly Placement[] = PLACEMENTS): RawFrame {
    const dt = 1 / this.rateHz;
    const kin = bodyKinematics(pose);
    const data: RawFrame['data'] = {};
    for (const p of placements) {
      const st = this.sensors[p];
      if (st.lastSeq !== seq - 1) {
        st.prevR = null;
        st.prevP = null;
        st.prevP2 = null;
      }
      st.lastSeq = seq;
      const R = mul(kin[p].R, st.misalign);
      const pos = st.shift ? add(kin[p].p, apply(kin[p].R, st.shift)) : kin[p].p;

      // Линейное ускорение — вторая разность положения
      let a: Vec3 = [0, 0, 0];
      if (st.prevP && st.prevP2) {
        a = [
          (pos[0] - 2 * st.prevP[0] + st.prevP2[0]) / (dt * dt),
          (pos[1] - 2 * st.prevP[1] + st.prevP2[1]) / (dt * dt),
          (pos[2] - 2 * st.prevP[2] + st.prevP2[2]) / (dt * dt),
        ];
      }
      // Акселерометр меряет ускорение минус гравитацию — в покое это +1 g «вверх»
      const fWorld: Vec3 = [a[0] / G, a[1] / G, a[2] / G + 1];
      const acc = applyT(R, fWorld);

      // Гироскоп: угловая скорость из поворота между соседними отсчётами, в осях датчика
      let gyro: Vec3 = [0, 0, 0];
      if (st.prevR) {
        const M = mul(transpose(st.prevR), R); // ≈ I + [ω·dt]×
        gyro = [
          ((M[7] - M[5]) / (2 * dt)) / DEG,
          ((M[2] - M[6]) / (2 * dt)) / DEG,
          ((M[3] - M[1]) / (2 * dt)) / DEG,
        ];
      }
      st.prevP2 = st.prevP;
      st.prevP = pos;
      st.prevR = R;

      const nf = st.noiseFactor;
      const raw = new Int16Array(6);
      for (let i = 0; i < 3; i++) {
        const av = (acc[i] as number) + (st.accBias[i] as number) + this.noiseRng.normal(0, NORMAL_NOISE.acc * nf);
        const gv = (gyro[i] as number) + (st.gyroBias[i] as number) + this.noiseRng.normal(0, NORMAL_NOISE.gyro * nf);
        raw[i] = quantize(av * ACC_LSB_PER_G);
        raw[i + 3] = quantize(gv * GYRO_LSB_PER_DPS);
      }
      data[p] = raw;
    }
    return { seq, t: seq / this.rateHz, data };
  }
}

/** Округление до целого и упор в предел int16 — как у настоящего датчика. */
function quantize(v: number): number {
  const r = Math.round(v);
  return r > INT16_MAX ? INT16_MAX : r < -INT16_MAX - 1 ? -INT16_MAX - 1 : r;
}
