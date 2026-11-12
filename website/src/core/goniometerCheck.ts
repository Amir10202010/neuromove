// Быстрая проверка с угломером: человек держит угол, по угломеру читает число, прибор берёт
// медиану угла за последнюю секунду. Ошибка каждого замера и итог считаются здесь — экран только
// показывает. Формулы те же, что в core/validation.ts (проверка по записи с отметками).
//
//   e_i   = θ_прибор,i − θ_угломер,i              ошибка замера
//   bias  = (1/n) Σ e_i                           систематическая ошибка (прибор завышает «+», занижает «−»)
//   MAE   = (1/n) Σ |e_i|                         средняя абсолютная ошибка — главный итог, порог 5°
//   RMSE  = √((1/n) Σ e_i²)                       среднеквадратичная ошибка
//   SD    = √(Σ (e_i − bias)² / (n − 1))          разброс ошибок
//   LoA   = bias ± 1.96 · SD                      пределы согласия Бланда — Альтмана (n ≥ 3)

import { mean, median, sd } from '../lib/stats';

export interface GonioRow {
  /** Угол по угломеру, градусы. */
  gonio: number;
  /** Угол прибора: медиана за окно, градусы. */
  device: number;
  /** Разброс угла прибора в окне (SD), градусы: больше ~2° — рука двигалась. */
  spread: number;
}

export interface GonioSummary {
  n: number;
  bias: number | null;
  mae: number | null;
  rmse: number | null;
  maxAbs: number | null;
  sd: number | null;
  limits: [number, number] | null;
  passed: boolean | null;
}

/** Порог средней абсолютной ошибки — критерий SMART v2. */
export const GONIO_THRESHOLD_DEG = 5;
/** Окно замера, секунды. */
export const GONIO_WINDOW_SEC = 1;
/** Разброс в окне больше этого — замер помечается «рука двигалась». */
export const GONIO_STEADY_SD = 2;

export function rowError(r: GonioRow): number {
  return r.device - r.gonio;
}

export function summarizeGonio(rows: readonly GonioRow[], threshold = GONIO_THRESHOLD_DEG): GonioSummary {
  const e = rows.map(rowError);
  if (!e.length) return { n: 0, bias: null, mae: null, rmse: null, maxAbs: null, sd: null, limits: null, passed: null };
  const bias = mean(e);
  const mae = mean(e.map(Math.abs));
  const rmse = Math.sqrt(mean(e.map((x) => x * x)));
  const spread = e.length >= 2 ? sd(e) : null;
  return {
    n: e.length,
    bias,
    mae,
    rmse,
    maxAbs: Math.max(...e.map(Math.abs)),
    sd: spread,
    limits: spread !== null && e.length >= 3 ? [bias - 1.96 * spread, bias + 1.96 * spread] : null,
    passed: mae <= threshold,
  };
}

/** Замер по углам прибора за окно: медиана и разброс. null — в окне нет углов. */
export function captureWindow(angles: readonly number[]): { device: number; spread: number } | null {
  if (!angles.length) return null;
  return { device: median(angles), spread: angles.length >= 2 ? sd(angles) : 0 };
}
