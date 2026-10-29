// Как двигается виртуальный пациент: траектории углов для одного повтора.
//
// Здоровое движение руки близко к «минимальному рывку» (minimum jerk, Flash & Hogan, 1985):
// один плавный горб скорости. У ребёнка с ДЦП на поражённой стороне движение часто
// распадается на несколько «подшагов» (submovements) — скорость то растёт, то падает.
// Мы складываем подшаги из кусков минимального рывка: чем их больше и чем меньше
// они перекрываются, тем менее плавное движение — и тем ниже SPARC. Никаких
// «нарисованных» метрик: плавность получается из самой траектории.

import type { Rng } from '../lib/random';

/** Профиль минимального рывка: 0 → 1 за τ ∈ [0, 1]. */
export function minJerk(tau: number): number {
  if (tau <= 0) return 0;
  if (tau >= 1) return 1;
  const t3 = tau * tau * tau;
  return t3 * (10 - 15 * tau + 6 * tau * tau);
}

/** Плавная ступенька 0 → 1 (для компенсаций и перехода позы). */
export function smoothstep(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * (3 - 2 * x);
}

interface SubMove {
  start: number;
  duration: number;
  amplitude: number;
}

/** Траектория: функция времени → угол, и полная длительность. */
export interface Trajectory {
  duration: number;
  at(t: number): number;
}

/**
 * Движение от 0 до `amplitude` за `duration` секунд, собранное из `count` подшагов.
 * count = 1 — один плавный минимальный рывок.
 */
export function segmentedReach(amplitude: number, duration: number, count: number, rng: Rng): Trajectory {
  const n = Math.max(1, Math.round(count));
  if (n === 1) {
    return { duration, at: (t) => amplitude * minJerk(t / duration) };
  }
  // Доли амплитуды: первый подшаг самый крупный, но не подавляющий — у прерывистого
  // движения «горбы» скорости соизмеримы (веса 1.6 : 1 : 0.8 : 0.65 … с разбросом ±30%).
  const weights: number[] = [];
  for (let i = 0; i < n; i++) weights.push((i === 0 ? 1.6 : Math.max(0.5, 1 - 0.15 * (i - 1))) * rng.range(0.7, 1.3));
  const wsum = weights.reduce((a, b) => a + b, 0);
  const shares = weights.map((w) => w / wsum);
  // Подшаги идут почти встык: следующий начинается, когда предыдущий прошёл 75–100% пути.
  // Скорость между ними проседает — на графике видно несколько «горбов», а не один.
  const unit = duration / (1 + (n - 1) * 0.85);
  const moves: SubMove[] = [];
  let t0 = 0;
  for (let i = 0; i < n; i++) {
    const d = unit * rng.range(0.85, 1.15);
    moves.push({ start: t0, duration: d, amplitude: amplitude * (shares[i] as number) });
    t0 += d * rng.range(0.75, 1.0);
  }
  const last = moves[moves.length - 1] as SubMove;
  const total = last.start + last.duration;
  return {
    duration: total,
    at: (t) => {
      let v = 0;
      for (const m of moves) v += m.amplitude * minJerk((t - m.start) / m.duration);
      return v;
    },
  };
}

/** Параметры одного повтора «вверх — задержка — вниз — отдых». */
export interface RepPlan {
  peak: number;
  rise: Trajectory;
  hold: number;
  lower: Trajectory;
  rest: number;
  /** Дрожание (тремор) в градусах и его частота, Гц. 0 — нет. */
  tremorAmp: number;
  tremorHz: number;
  tremorPhase: number;
  /** Только для поворота предплечья: пик пронации, градусы (пик супинации — peak). */
  pron?: number;
  /** Дополнительное время движения: у поворота три дуги вместо двух. */
  extra?: number;
}

export function repDuration(p: RepPlan): number {
  return p.rise.duration + p.hold + p.lower.duration + (p.extra ?? 0) + p.rest;
}

/** Угол в момент t от начала повтора. */
export function repAngle(p: RepPlan, t: number): number {
  const r = p.rise.duration;
  let v: number;
  if (t < r) v = p.rise.at(t);
  else if (t < r + p.hold) v = p.peak;
  else if (t < r + p.hold + p.lower.duration) v = p.peak - p.lower.at(t - r - p.hold);
  else v = 0;
  if (p.tremorAmp > 0) {
    // Тремор заметнее, когда рука поднята и работает против силы тяжести. Огибающая плавная:
    // нарастает в начале повтора, после опускания спадает до 30 %, к концу отдыха — до нуля.
    // Скачок угла на градус за один отсчёт дал бы датчику ускорение больше 4 g — ложный «упор»
    const moveEnd = r + p.hold + p.lower.duration;
    const active = 1 - 0.7 * smoothstep((t - moveEnd) / 0.25);
    v += tremorEnvelope(t, repDuration(p)) * active * p.tremorAmp * Math.sin(2 * Math.PI * p.tremorHz * t + p.tremorPhase);
  }
  return v;
}

/** Огибающая тремора повтора длиной total: 0 в начале и в конце, плавно, за 0,2 с. */
export function tremorEnvelope(t: number, total: number): number {
  return smoothstep(t / 0.2) * (1 - smoothstep((t - (total - 0.2)) / 0.2));
}

/** Медленное покачивание в покое: сумма двух синусоид, амплитуда в градусах. */
export function sway(t: number, amp: number, phase: number): number {
  return amp * (0.6 * Math.sin(2 * Math.PI * 0.23 * t + phase) + 0.4 * Math.sin(2 * Math.PI * 0.51 * t + 2.1 * phase));
}
