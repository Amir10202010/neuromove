// Генератор случайных чисел с зерном (seed).
// Зачем своё, а не Math.random(): с одним и тем же зерном симулятор выдаёт
// ровно те же «движения ребёнка» — демо-данные и тесты воспроизводимы.

export interface Rng {
  /** Равномерное число в [0, 1). */
  next(): number;
  /** Нормальное распределение: среднее mean, стандартное отклонение sd. */
  normal(mean?: number, sd?: number): number;
  /** Равномерное число в [min, max). */
  range(min: number, max: number): number;
  /** Целое в [min, max] включительно. */
  int(min: number, max: number): number;
  /** true с вероятностью p. */
  chance(p: number): boolean;
}

/** mulberry32 — маленький быстрый генератор, 32 бита состояния. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  let spare: number | null = null;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    normal(mean = 0, sd = 1) {
      // Преобразование Бокса — Мюллера: из двух равномерных — два нормальных
      if (spare !== null) {
        const v = spare;
        spare = null;
        return mean + sd * v;
      }
      let u = 0;
      while (u === 0) u = next();
      const v = next();
      const r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * Math.PI * v);
      return mean + sd * r * Math.cos(2 * Math.PI * v);
    },
    range(min, max) {
      return min + (max - min) * next();
    },
    int(min, max) {
      return Math.floor(min + (max - min + 1) * next());
    },
    chance(p) {
      return next() < p;
    },
  };
}

/** Строка → число для зерна (хэш FNV-1a). Удобно: зерно из id пациента и даты. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
