// SPARC — мера плавности движения по спектру профиля скорости.
// Источник: Balasubramanian S., Melendez-Calderon A., Roby-Brami A., Burdet E.
// On the analysis of movement smoothness. J NeuroEng Rehabil 12, 112 (2015).
// https://doi.org/10.1186/s12984-015-0090-9
//
// Идея: плавное движение — один «горб» скорости, его спектр короткий и гладкий.
// Рваное движение — несколько горбов (рывков), спектр длинный и волнистый.
// SPARC = минус длина кривой нормированного спектра. Значения отрицательные:
// чем ближе к нулю, тем плавнее.
//
// Параметры — как в статье: дополнение нулями на 4 уровня, частота среза 10 Гц,
// порог амплитуды 0.05.

import { magnitudeSpectrum } from '../lib/fft';

export interface SparcOptions {
  padLevel?: number;
  cutoffHz?: number;
  ampThreshold?: number;
}

/** speed — профиль скорости (например, модуль угловой скорости, °/с), fs — частота, Гц. */
export function sparc(speed: ArrayLike<number>, fs: number, opts: SparcOptions = {}): number {
  const padLevel = opts.padLevel ?? 4;
  const fc = opts.cutoffHz ?? 10;
  const ampTh = opts.ampThreshold ?? 0.05;
  const n = speed.length;
  if (n < 8) return NaN;

  // Длина БПФ: ближайшая степень двойки сверху плюс padLevel удвоений
  const nfft = 2 ** (Math.ceil(Math.log2(n)) + padLevel);
  const df = fs / nfft;
  const keep = Math.min(nfft, Math.floor(fc / df) + 1); // только частоты ≤ fc
  const mag = magnitudeSpectrum(speed, nfft, keep);

  let peak = 0;
  for (let i = 0; i < nfft && i < mag.length; i++) if ((mag[i] as number) > peak) peak = mag[i] as number;
  if (peak === 0) return NaN;

  // Отрезаем хвост ниже порога амплитуды: от первого до последнего отсчёта выше порога
  let first = -1;
  let last = -1;
  for (let i = 0; i < mag.length; i++) {
    if ((mag[i] as number) / peak >= ampTh) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0 || last <= first) return NaN;

  // Длина кривой в нормированных координатах: частота делится на ширину полосы
  const width = (last - first) * df;
  let length = 0;
  for (let i = first + 1; i <= last; i++) {
    const dfN = df / width;
    const dm = ((mag[i] as number) - (mag[i - 1] as number)) / peak;
    length += Math.sqrt(dfN * dfN + dm * dm);
  }
  return -length;
}
