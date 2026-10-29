// Случайные числа эталона: xoshiro128** с засевом splitmix32. Нарочно не lib/random (mulberry32),
// чтобы шум эталона не совпал с шумом симулятора приложения ни при каком зерне.

export class XRng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;
  private spare: number | null = null;

  constructor(seed: number) {
    let x = seed >>> 0;
    const split = () => {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.s0 = split();
    this.s1 = split();
    this.s2 = split();
    this.s3 = split();
  }

  /** Равномерно в [0, 1). */
  next(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    return result / 4294967296;
  }

  uniform(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Нормальное распределение (Бокс — Мюллер). */
  normal(sd = 1): number {
    if (this.spare !== null) {
      const v = this.spare;
      this.spare = null;
      return v * sd;
    }
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v) * sd;
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}
