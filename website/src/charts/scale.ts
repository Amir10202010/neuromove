// Шкалы и «круглые» деления осей.

export interface Linear {
  (v: number): number;
  domain: [number, number];
  range: [number, number];
  ticks(count?: number): number[];
}

export function linear(domain: [number, number], range: [number, number]): Linear {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  const f = ((v: number) => r0 + (v - d0) * k) as Linear;
  f.domain = domain;
  f.range = range;
  f.ticks = (count = 5) => niceTicks(d0, d1, count);
  return f;
}

/**
 * Деления 1, 2, 5 × 10ⁿ — как на обычном графике. Берём ближайший «круглый» шаг
 * (пороги √2, √10, √50 — как в d3), а не всегда больший: иначе на оси остаётся 2 деления.
 */
export function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count);
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m >= Math.sqrt(50) ? 10 : m >= Math.sqrt(10) ? 5 : m >= Math.SQRT2 ? 2 : 1) * p;
}

export function niceTicks(a: number, b: number, count = 5): number[] {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return [a];
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const step = niceStep(hi - lo, count);
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

/** Область значений с запасом и «круглыми» краями. */
export function niceDomain(values: number[], pad = 0.1, count = 4, include?: number[]): [number, number] {
  const vs = [...values, ...(include ?? [])].filter((v) => Number.isFinite(v));
  if (!vs.length) return [0, 1];
  let lo = Math.min(...vs);
  let hi = Math.max(...vs);
  if (lo === hi) {
    lo -= 5;
    hi += 5;
  }
  const span = hi - lo;
  lo -= span * pad;
  hi += span * pad;
  const step = niceStep(hi - lo, count);
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step];
}

/** Деления по времени: примерно `count` дат, выровненных по дням. */
export function timeTicks(t0: number, t1: number, count = 5): number[] {
  const day = 86400000;
  const spanDays = Math.max(1, (t1 - t0) / day);
  const stepDays = [1, 2, 7, 14, 28, 56].find((s) => spanDays / s <= count) ?? 91;
  const start = new Date(t0);
  const first = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1).getTime();
  const out: number[] = [];
  for (let v = first; v <= t1; v += stepDays * day) out.push(v);
  return out;
}
