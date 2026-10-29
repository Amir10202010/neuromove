// Простая статистика для метрик. Пустой массив → NaN, а не ошибка:
// вызывающий код решает, как показать «нет данных».

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

/** Выборочное стандартное отклонение (делим на n − 1). */
export function sd(xs: readonly number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return Math.sqrt(s / (xs.length - 1));
}

/** Коэффициент вариации, %: насколько повторы отличаются друг от друга. */
export function cvPercent(xs: readonly number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return m === 0 ? NaN : (sd(xs) / Math.abs(m)) * 100;
}

export function max(xs: readonly number[]): number {
  let r = -Infinity;
  for (const x of xs) if (x > r) r = x;
  return xs.length ? r : NaN;
}

export function min(xs: readonly number[]): number {
  let r = Infinity;
  for (const x of xs) if (x < r) r = x;
  return xs.length ? r : NaN;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Линейная регрессия y = a + b·x; возвращает наклон b. Для тренда «° в неделю». */
export function slope(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return NaN;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += ((xs[i] as number) - mx) * ((ys[i] as number) - my);
    den += ((xs[i] as number) - mx) ** 2;
  }
  return den === 0 ? NaN : num / den;
}

export function round(x: number, digits = 0): number {
  const k = 10 ** digits;
  return Math.round(x * k) / k;
}
