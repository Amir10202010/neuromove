// Деление теста на повторы — перенос reps.py из лаборатории.
// Повторение: угол ушёл выше high и вернулся ниже low.
// Два порога (гистерезис) — дрожание около одного порога не даёт ложных повторов.

export interface RepWindow {
  /** Индекс отсчёта начала повтора — последний момент в нижней зоне. */
  start: number;
  /** Индекс отсчёта конца повтора — вернулись в нижнюю зону. */
  end: number;
}

/** Офлайн-версия: весь сигнал сразу. Точная копия count_reps из софт.md. */
export function countReps(angle: ArrayLike<number>, low: number, high: number): RepWindow[] {
  const reps: RepWindow[] = [];
  let state: 'low' | 'high' = 'low';
  let start = 0;
  for (let k = 0; k < angle.length; k++) {
    const a = angle[k] as number;
    if (state === 'low') {
      if (a < low) start = k;
      else if (a > high) state = 'high';
    } else if (a < low) {
      reps.push({ start, end: k });
      state = 'low';
      start = k;
    }
  }
  return reps;
}

/**
 * Потоковая версия той же логики — для живого теста: отсчёты приходят по одному.
 * push() возвращает готовый повтор в момент его завершения.
 */
export class RepDetector {
  private state: 'low' | 'high' = 'low';
  private start = 0;

  constructor(
    private readonly low: number,
    private readonly high: number,
  ) {}

  push(k: number, angle: number): RepWindow | null {
    if (this.state === 'low') {
      if (angle < this.low) this.start = k;
      else if (angle > this.high) this.state = 'high';
      return null;
    }
    if (angle < this.low) {
      const rep = { start: this.start, end: k };
      this.state = 'low';
      this.start = k;
      return rep;
    }
    return null;
  }

  /** Повтор начался, но ещё не закончен — для подсветки на экране. */
  get inProgress(): boolean {
    return this.state === 'high';
  }

  reset(k = 0): void {
    this.state = 'low';
    this.start = k;
  }
}

/**
 * Повтор «туда и обратно» для поворота предплечья: угол побывал выше +high
 * и ниже −high (в любом порядке) и вернулся к нейтрали |угол| < low.
 */
export class BidirectionalRepDetector {
  private pos = false;
  private neg = false;
  private start = 0;

  constructor(
    private readonly low: number,
    private readonly high: number,
  ) {}

  push(k: number, angle: number): RepWindow | null {
    if (angle > this.high) this.pos = true;
    else if (angle < -this.high) this.neg = true;

    if (!this.pos && !this.neg) {
      if (Math.abs(angle) < this.low) this.start = k;
      return null;
    }
    if (this.pos && this.neg && Math.abs(angle) < this.low) {
      const rep = { start: this.start, end: k };
      this.pos = false;
      this.neg = false;
      this.start = k;
      return rep;
    }
    return null;
  }

  get inProgress(): boolean {
    return this.pos || this.neg;
  }

  reset(k = 0): void {
    this.pos = false;
    this.neg = false;
    this.start = k;
  }
}

export function countBidirectionalReps(angle: ArrayLike<number>, low: number, high: number): RepWindow[] {
  const d = new BidirectionalRepDetector(low, high);
  const reps: RepWindow[] = [];
  for (let k = 0; k < angle.length; k++) {
    const r = d.push(k, angle[k] as number);
    if (r) reps.push(r);
  }
  return reps;
}
