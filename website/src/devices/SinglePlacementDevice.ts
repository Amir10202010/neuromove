// Один датчик — под тем местом, где он на самом деле надет.
//
// Прошивка называет датчик по проводке, а не по руке: модуль на шине 0 с AD0 на GND — это
// «правое плечо» (upper_r), с AD0 на VCC — «правое предплечье» (fore_r), на шине 1 — «туловище»
// (firmware/NeuroMoveStand/config.h). Когда датчик один, его могут надеть куда угодно: на левое
// предплечье, на правое плечо. Обёртка переименовывает единственный датчик потока в выбранное
// специалистом место — тогда приложение считает углы для той руки и того сегмента, где он стоит.
//
// Если в потоке уже есть выбранное место или датчиков несколько — ничего не трогаем: значит,
// подключён полный комплект, и переименование только спутало бы данные.

import type { DeviceKind, DeviceStatus, NeuroMoveDevice, Placement, RawFrame, Unsubscribe } from './types';

export class SinglePlacementDevice implements NeuroMoveDevice {
  constructor(
    private readonly inner: NeuroMoveDevice,
    /** Где датчик надет на самом деле: например, fore_l. */
    readonly target: Placement,
  ) {}

  get kind(): DeviceKind {
    return this.inner.kind;
  }

  connect(): Promise<void> {
    return this.inner.connect();
  }

  disconnect(): Promise<void> {
    return this.inner.disconnect();
  }

  start(): Promise<void> {
    return this.inner.start();
  }

  stop(): Promise<void> {
    return this.inner.stop();
  }

  getStatus(): DeviceStatus {
    return this.mapStatus(this.inner.getStatus());
  }

  onStatus(cb: (s: DeviceStatus) => void): Unsubscribe {
    return this.inner.onStatus((s) => cb(this.mapStatus(s)));
  }

  onData(cb: (frames: readonly RawFrame[]) => void): Unsubscribe {
    return this.inner.onData((frames) => cb(frames.map((f) => this.mapFrame(f))));
  }

  /** Какое место переименовать: единственное в списке и не совпадающее с выбранным. Иначе — null. */
  private sourceOf(places: readonly Placement[]): Placement | null {
    if (places.length !== 1) return null;
    const only = places[0] as Placement;
    return only === this.target ? null : only;
  }

  private mapStatus(s: DeviceStatus): DeviceStatus {
    const from = this.sourceOf(s.sensors.map((x) => x.placement));
    if (!from) return s;
    const info = s.info
      ? {
          ...s.info,
          placements: s.info.placements.map((p) => (p === from ? this.target : p)),
          // Поправки калибровки и отпечаток принадлежат модулю, а не месту: переезжают вместе с ним
          ...(s.info.accCal ? { accCal: rekey(s.info.accCal, from, this.target) } : {}),
          ...(s.info.moduleIds ? { moduleIds: rekey(s.info.moduleIds, from, this.target) } : {}),
        }
      : null;
    return { ...s, info, sensors: s.sensors.map((x) => ({ ...x, placement: this.target })) };
  }

  private mapFrame(f: RawFrame): RawFrame {
    const from = this.sourceOf(Object.keys(f.data) as Placement[]);
    if (!from) return f;
    const raw = f.data[from];
    return raw ? { seq: f.seq, t: f.t, data: { [this.target]: raw } } : f;
  }
}

/** Та же запись, но значение места from лежит под ключом to. */
function rekey<T>(rec: Partial<Record<Placement, T>>, from: Placement, to: Placement): Partial<Record<Placement, T>> {
  const out: Partial<Record<Placement, T>> = {};
  for (const [k, v] of Object.entries(rec) as [Placement, T][]) out[k === from ? to : k] = v;
  return out;
}
