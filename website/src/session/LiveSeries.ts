// Кольцевой буфер последних секунд сигнала для живого графика.
// Пишем 100 раз в секунду, читаем 60 раз в секунду при отрисовке — без выделения памяти.

export class LiveSeries {
  readonly t: Float64Array;
  readonly angle: Float64Array;
  readonly trunk: Float64Array;
  /** 1 — отсчёт внутри повтора (для подсветки на графике). */
  readonly inRep: Uint8Array;
  private head = 0;
  private count = 0;

  constructor(readonly capacity = 1500) {
    this.t = new Float64Array(capacity);
    this.angle = new Float64Array(capacity);
    this.trunk = new Float64Array(capacity);
    this.inRep = new Uint8Array(capacity);
  }

  push(t: number, angle: number, trunk: number | null, inRep: boolean): void {
    this.t[this.head] = t;
    this.angle[this.head] = angle;
    this.trunk[this.head] = trunk ?? NaN;
    this.inRep[this.head] = inRep ? 1 : 0;
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }

  get size(): number {
    return this.count;
  }

  /** Индекс в массивах для i-го отсчёта от самого старого (0) до самого нового (size − 1). */
  index(i: number): number {
    return (this.head - this.count + i + this.capacity) % this.capacity;
  }

  get lastT(): number {
    return this.count ? (this.t[this.index(this.count - 1)] as number) : 0;
  }
}
