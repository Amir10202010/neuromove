// Перевод сырых чисел датчика в физические единицы — перенос imu.py из лаборатории.
// Настройки датчика — из контракта с железом (софт.md, раздел 1):
//   акселерометр ±4 g   → 8192 единицы = 1 g
//   гироскоп ±1000 °/с  → 32.8 единицы = 1 °/с

import type { Vec3 } from '../lib/vec3';

export const ACC_LSB_PER_G = 8192;
export const GYRO_LSB_PER_DPS = 32.8;
export const DEFAULT_RATE_HZ = 100;
export const INT16_MAX = 32767;

export interface ImuSample {
  /** Ускорение, g. В покое — вектор длиной 1, смотрит «вверх» в осях датчика. */
  acc: Vec3;
  /** Угловая скорость, °/с, смещение гироскопа уже вычтено. */
  gyro: Vec3;
  /** Хотя бы одна ось упёрлась в предел диапазона — значение ненадёжно. */
  saturated: boolean;
}

/**
 * Поправки акселерометра одного датчика из калибровки в 6 положениях — её делает прошивка стенда
 * (firmware, accel_cal.h) и печатает в паспорте строкой `# cal_fore_r=…`. Без поправок
 * заводской ноль MPU-6050 (до ±50 мг) даёт до ~3° ошибки наклона.
 */
export interface AccCalibration {
  /** Ноль оси, единицы датчика. */
  off: Vec3;
  /** Масштаб оси: 1 — ровно как в документации, 8192 единицы на 1 g. */
  scale: Vec3;
}

/**
 * raw — 6 чисел ax ay az gx gy gz; bias — смещение гироскопа, °/с (из калибровки позы);
 * cal — поправки акселерометра, если датчик откалиброван.
 */
export function toPhysical(raw: ArrayLike<number>, bias: Vec3 = [0, 0, 0], cal?: AccCalibration): ImuSample {
  let saturated = false;
  for (let i = 0; i < 6; i++) {
    const v = raw[i] as number;
    if (v >= INT16_MAX || v <= -INT16_MAX - 1) saturated = true;
  }
  const acc = (i: 0 | 1 | 2) =>
    cal ? ((raw[i] as number) - cal.off[i]) / (ACC_LSB_PER_G * cal.scale[i]) : (raw[i] as number) / ACC_LSB_PER_G;
  return {
    acc: [acc(0), acc(1), acc(2)],
    gyro: [
      (raw[3] as number) / GYRO_LSB_PER_DPS - bias[0],
      (raw[4] as number) / GYRO_LSB_PER_DPS - bias[1],
      (raw[5] as number) / GYRO_LSB_PER_DPS - bias[2],
    ],
    saturated,
  };
}
