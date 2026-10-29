// Быстрое преобразование Фурье (радикс-2, на месте).
// Нужно для SPARC — меры плавности по спектру профиля скорости.

/**
 * Модуль спектра |X[k]| сигнала x, дополненного нулями до длины n (степень двойки).
 * Возвращает первые `keep` отсчётов спектра (дальше нам не нужно: SPARC берёт до 10 Гц).
 */
export function magnitudeSpectrum(x: ArrayLike<number>, n: number, keep = n): Float64Array {
  if ((n & (n - 1)) !== 0) throw new Error('FFT: длина должна быть степенью двойки');
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < Math.min(x.length, n); i++) re[i] = x[i] as number;

  // Перестановка по обращённым битам индекса
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i] as number;
      re[i] = re[j] as number;
      re[j] = tr;
      const ti = im[i] as number;
      im[i] = im[j] as number;
      im[j] = ti;
    }
  }

  // «Бабочки»: объединяем преобразования половинной длины
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const br = (re[b] as number) * cr - (im[b] as number) * ci;
        const bi = (re[b] as number) * ci + (im[b] as number) * cr;
        re[b] = (re[a] as number) - br;
        im[b] = (im[a] as number) - bi;
        re[a] = (re[a] as number) + br;
        im[a] = (im[a] as number) + bi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }

  const out = new Float64Array(Math.min(keep, n));
  for (let k = 0; k < out.length; k++) out[k] = Math.hypot(re[k] as number, im[k] as number);
  return out;
}
