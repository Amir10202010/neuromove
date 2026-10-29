// Где у датчика «верх» — перенос angles.py (gravity_track) из лаборатории.
//
// Акселерометр видит гравитацию: не уплывает со временем, но дёргается при каждом рывке.
// Гироскоп даёт поворот: гладко, но потихоньку уплывает.
// Комплементарный фильтр на каждом шаге поворачивает прошлый «верх» по гироскопу
// и на 2% подтягивает его к акселерометру: гладкость одного без дрейфа другого.

import { DEG, normalize, type Vec3 } from '../lib/vec3';

/** Доля предсказания по гироскопу. 0.98 при 100 Гц — постоянная времени около 0.5 с. */
export const FILTER_ALPHA = 0.98;

export class GravityTracker {
  /** Направление «вверх» в осях датчика, единичный вектор. */
  up: Vec3 = [0, 0, 1];
  private ready = false;

  constructor(private readonly alpha = FILTER_ALPHA) {}

  /** acc — g, gyro — °/с (смещение вычтено), dt — секунды с прошлого отсчёта. */
  update(acc: Vec3, gyro: Vec3, dt: number): Vec3 {
    if (!this.ready) {
      // Первый отсчёт: верим акселерометру целиком
      this.up = normalize(acc);
      this.ready = true;
      return this.up;
    }
    const w0 = gyro[0] * DEG;
    const w1 = gyro[1] * DEG;
    const w2 = gyro[2] * DEG;
    const [g0, g1, g2] = this.up;
    // Датчик повернулся на w·dt — «верх» в его осях повернулся навстречу: pred = g − (w × g)·dt
    const p0 = g0 - (w1 * g2 - w2 * g1) * dt;
    const p1 = g1 - (w2 * g0 - w0 * g2) * dt;
    const p2 = g2 - (w0 * g1 - w1 * g0) * dt;
    // 98% — предсказание по гироскопу, 2% — поправка по гравитации
    const a = this.alpha;
    const x = a * p0 + (1 - a) * acc[0];
    const y = a * p1 + (1 - a) * acc[1];
    const z = a * p2 + (1 - a) * acc[2];
    const n = Math.hypot(x, y, z) || 1;
    this.up = [x / n, y / n, z / n];
    return this.up;
  }

  /** После обрыва связи начинаем заново: первый же отсчёт снова задаст «верх». */
  reset(): void {
    this.ready = false;
  }

  get isReady(): boolean {
    return this.ready;
  }
}

/**
 * Подъём кости, градусы: 0 — висит вниз, 90 — горизонтально, 180 — вверх.
 * Ось X датчика — вдоль кости, к кисти. Не зависит от плоскости движения:
 * вперёд, в сторону, по диагонали — считается одинаково.
 */
export function elevation(up: Vec3): number {
  const c = Math.max(-1, Math.min(1, -up[0]));
  return Math.acos(c) / DEG;
}

/**
 * Поворот датчика вокруг своей оси X (вдоль кости), градусы, −180…180.
 * Имеет смысл, когда кость близка к горизонтали: тогда гравитация лежит в плоскости Y–Z.
 * Нужен для пронации и супинации предплечья.
 */
export function roll(up: Vec3): number {
  return Math.atan2(up[2], up[1]) / DEG;
}

/** Угол между двумя направлениями «вверх», градусы. Наклон туловища от позы калибровки. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const c = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return Math.acos(c) / DEG;
}
