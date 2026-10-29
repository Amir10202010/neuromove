// Обработка потока: сырые числа → единицы → «верх» каждого датчика → углы движения.
// Один и тот же код работает с симулятором, с USB, с Bluetooth и с записанным файлом.
// Экраны сами ничего не считают — берут готовое отсюда (правило из софт.md, раздел 3).

import type { Placement, RawFrame, Side } from '../devices/types';
import { placementOf } from '../devices/types';
import { DEG, cross, dot, norm, normalize, scale, sub, type Vec3 } from '../lib/vec3';
import type { ExerciseDef } from './exercises';
import { toPhysical, type AccCalibration } from './imu';
import { GravityTracker, angleBetween, elevation, roll } from './orientation';

export interface SensorReading {
  up: Vec3;
  /** °/с, смещение вычтено. */
  gyro: Vec3;
  t: number;
  saturated: boolean;
}

export class MotionPipeline {
  private readonly trackers = new Map<Placement, GravityTracker>();
  private bias: Partial<Record<Placement, Vec3>> = {};
  private accCal: Partial<Record<Placement, AccCalibration>> = {};
  private readonly lastT = new Map<Placement, number>();
  readonly latest: Partial<Record<Placement, SensorReading>> = {};
  saturatedSamples = 0;

  setBias(bias: Partial<Record<Placement, Vec3>>): void {
    this.bias = { ...bias };
  }

  /** Поправки акселерометра из паспорта устройства — те же нужно дать и Calibrator (withAccCal). */
  setAccCal(cal: Partial<Record<Placement, AccCalibration>>): void {
    this.accCal = { ...cal };
  }

  /** Задать «верх» датчиков сразу (из калибровки), не дожидаясь схождения фильтра. */
  seedUp(up: Partial<Record<Placement, Vec3>>): void {
    for (const [p, v] of Object.entries(up) as [Placement, Vec3][]) {
      const tr = this.tracker(p);
      tr.reset();
      tr.update(v, [0, 0, 0], 0);
    }
  }

  /** Обрыв связи: фильтры начинают заново по первому же отсчёту. */
  resetTrackers(): void {
    for (const tr of this.trackers.values()) tr.reset();
    this.lastT.clear();
  }

  private tracker(p: Placement): GravityTracker {
    let tr = this.trackers.get(p);
    if (!tr) {
      tr = new GravityTracker();
      this.trackers.set(p, tr);
    }
    return tr;
  }

  process(frame: RawFrame, rateHz: number): void {
    for (const [p, raw] of Object.entries(frame.data) as [Placement, Int16Array][]) {
      const s = toPhysical(raw, this.bias[p], this.accCal[p]);
      if (s.saturated) this.saturatedSamples += 1;
      const prev = this.lastT.get(p);
      let dt = prev === undefined ? 1 / rateHz : frame.t - prev;
      const tr = this.tracker(p);
      // Разрыв больше полсекунды — прошлому «верху» верить нельзя
      if (dt > 0.5 || dt <= 0) {
        tr.reset();
        dt = 1 / rateHz;
      }
      const up = tr.update(s.acc, s.gyro, dt);
      this.lastT.set(p, frame.t);
      this.latest[p] = { up, gyro: s.gyro, t: frame.t, saturated: s.saturated };
    }
  }
}

// ── Калибровка ──────────────────────────────────────────────────────────────
// «Сидим прямо, руки вдоль тела, не двигаемся 3 секунды» (софт.md, «Калибровка»).
// Среднее гироскопа — смещение, его вычитаем весь тест. Поза калибровки — ноль углов.
// Если в эти секунды было движение — калибровка повторяется.

export interface CalibrationResult {
  bias: Partial<Record<Placement, Vec3>>;
  up: Partial<Record<Placement, Vec3>>;
}

interface Acc3 {
  g: Vec3;
  a: Vec3;
  n: number;
  gMin: Vec3;
  gMax: Vec3;
}

export class Calibrator {
  private readonly sums = new Map<Placement, Acc3>();
  private startT: number | null = null;
  private lastT = 0;
  private accCal: Partial<Record<Placement, AccCalibration>> = {};
  moved = false;

  constructor(
    readonly duration = 3,
    /** Размах показаний гироскопа (макс − мин), °/с, выше которого считаем, что было движение. */
    private readonly gyroRange = 16,
    /** Отклонение модуля ускорения от 1 g. */
    private readonly accDev = 0.15,
  ) {}

  /**
   * Поправки акселерометра — те же, что у MotionPipeline. Иначе «верх» в позе калибровки и «верх»
   * сейчас считались бы по-разному, и угол между ними стал бы хуже, а не лучше.
   */
  withAccCal(cal: Partial<Record<Placement, AccCalibration>>): this {
    this.accCal = { ...cal };
    return this;
  }

  push(frame: RawFrame): 'collecting' | 'moved' | 'done' {
    if (this.startT === null) this.startT = frame.t;
    this.lastT = frame.t;
    for (const [p, raw] of Object.entries(frame.data) as [Placement, Int16Array][]) {
      const s = toPhysical(raw, [0, 0, 0], this.accCal[p]);
      let acc = this.sums.get(p);
      if (!acc) {
        acc = { g: [0, 0, 0], a: [0, 0, 0], n: 0, gMin: [...s.gyro], gMax: [...s.gyro] };
        this.sums.set(p, acc);
      }
      for (let i = 0; i < 3; i++) {
        acc.g[i] = (acc.g[i] as number) + (s.gyro[i] as number);
        acc.a[i] = (acc.a[i] as number) + (s.acc[i] as number);
        acc.gMin[i] = Math.min(acc.gMin[i] as number, s.gyro[i] as number);
        acc.gMax[i] = Math.max(acc.gMax[i] as number, s.gyro[i] as number);
        if ((acc.gMax[i] as number) - (acc.gMin[i] as number) > this.gyroRange) this.moved = true;
      }
      const an = Math.hypot(s.acc[0], s.acc[1], s.acc[2]);
      if (Math.abs(an - 1) > this.accDev) this.moved = true;
      acc.n += 1;
    }
    if (this.moved) return 'moved';
    return this.progress >= 1 ? 'done' : 'collecting';
  }

  get progress(): number {
    if (this.startT === null) return 0;
    return Math.min(1, (this.lastT - this.startT) / this.duration);
  }

  result(): CalibrationResult {
    const bias: CalibrationResult['bias'] = {};
    const up: CalibrationResult['up'] = {};
    for (const [p, s] of this.sums) {
      bias[p] = [s.g[0] / s.n, s.g[1] / s.n, s.g[2] / s.n];
      up[p] = normalize([s.a[0] / s.n, s.a[1] / s.n, s.a[2] / s.n]);
    }
    return { bias, up };
  }
}

// ── Углы для конкретного движения ───────────────────────────────────────────

/**
 * Нули углов из позы калибровки: направление «вверх» каждого датчика, когда руки висят вдоль тела.
 *
 * ⚠️ Отличие от софт.md. Там подъём = arccos(−g_x): считается, что ось X датчика идёт точно
 * вдоль кости. Ремешок никогда не сидит идеально: при перекосе 2–5° ошибка на высоких углах
 * доходит до 10° (проверено на симуляторе, см. core.test.ts), потому что поправка калибровкой
 * верна только около нуля. Здесь подъём = угол между «верхом» сейчас и «верхом» в позе
 * калибровки. В этой позе кость висит вертикально, значит её направление в осях датчика
 * известно точно, как бы датчик ни был надет. Формула точная при любом перекосе.
 */
export interface AngleReference {
  up: Partial<Record<Placement, Vec3>>;
}

export function referenceFrom(cal: CalibrationResult): AngleReference {
  return { up: { ...cal.up } };
}

/** Подъём сегмента от позы калибровки (руки вдоль тела), градусы. */
function elevationFromRef(p: Placement, pipe: MotionPipeline, ref: AngleReference): number | null {
  const now = pipe.latest[p];
  const cal = ref.up[p];
  if (!now) return null;
  return cal ? angleBetween(now.up, cal) : elevation(now.up);
}

/**
 * Показание старше этого (относительно главного датчика движения) — датчик не на связи. Прошивка
 * стенда убирает не ответивший датчик из потока и шлёт новый заголовок; последнее показание такого
 * датчика осталось бы в `latest` навсегда, и угол считался бы по замёрзшему числу.
 */
export const STALE_SEC = 0.25;

/** Датчики, без которых угол движения не считается (туловище — только для компенсации). */
export function requiredSensors(def: ExerciseDef, side: Side): Placement[] {
  switch (def.angle) {
    case 'elevation':
      return [placementOf('upper', side)];
    case 'elbow':
      return [placementOf('upper', side), placementOf('fore', side)];
    case 'rotation':
      return [placementOf('fore', side)];
  }
}

/** Нужные датчики, которых нет: не приходили, отстали больше чем на STALE_SEC от tNow или не откалиброваны. */
export function missingSensors(def: ExerciseDef, side: Side, pipe: MotionPipeline, ref: AngleReference, tNow: number): Placement[] {
  return requiredSensors(def, side).filter((p) => {
    const r = pipe.latest[p];
    return !r || tNow - r.t > STALE_SEC || !ref.up[p];
  });
}

/**
 * Датчик надет наоборот — крышкой к коже? Тогда ось Z смотрит внутрь руки, а знаки шарнира локтя
 * и поворота предплечья переворачиваются: при плече, ушедшем назад, вернулась бы ошибка F1,
 * а супинация и пронация поменялись бы местами. Видно по «верху» в осях датчика, когда сегмент
 * далеко от вертикали:
 *   рука поднята в сторону — наружная сторона смотрит вверх: «верх» по +Z датчика;
 *   рука поднята вперёд или предплечье горизонтально, большой палец вверх — «верх» по +Y у правой
 *   руки и по −Y у левой (COORDINATES.md, раздел 2).
 * Уверенно противоположный знак (больше 0,5 из 1) при правильном креплении невозможен: для предплечья
 * это поворот больше 120° от нейтрали. Возвращает true, если датчик перевёрнут.
 */
const Y_UP_SIGN: Record<Side, number> = { right: 1, left: -1 };

export function mountFlipped(raised: 'forward' | 'sideways', side: Side, up: Vec3): boolean {
  if (raised === 'sideways') return up[2] < -0.5;
  return Y_UP_SIGN[side] * up[1] < -0.5;
}

/** Знак супинации: у правой и левой руки датчики зеркальны (проверено тестом core.test.ts). */
const ROTATION_SIGN: Record<Side, number> = { right: -1, left: 1 };

// ── Локоть: сгибание в плоскости шарнира ─────────────────────────────────────
//
// Было: сгибание = подъём предплечья − подъём плеча. Подъём — угол без направления, поэтому формула
// верна, только если плечо отклонилось вперёд. Плечо ушло назад на 10° — ошибка −19°, в сторону
// на 10° — −8°, без пометки (находка F1, docs/ENGINEERING_10H/FINDINGS.md; проверено на независимом
// эталоне src/verification/).
//
// Стало: локоть — шарнир, его ось закреплена в плече. Датчик плеча надет на наружную сторону, ось Z —
// наружу от кожи: это и есть ось сгибания локтя. В осях датчика плеча строим плоскость шарнира
// (перпендикулярно оси), проецируем на неё «вниз» и меряем углы со знаком от этой проекции:
//   φ_плеча — по датчику плеча, точно и со знаком;
//   φ_предплечья — по подъёму предплечья ef: cos ef = |проекция «вниз»| · cos φ, отсюда φ с точностью
//   до знака (по гравитации не видно, впереди предплечье или позади вертикали).
// Сгибание = φ_предплечья − φ_плеча. Знак φ_предплечья выбирается так, чтобы угол был возможен для
// локтя (−25…175°), а из двух возможных — ближе к продолжению движения (ElbowTrack).
// Ось шарнира почти вертикальна (рука отведена далеко в сторону) или датчик надет не по правилу —
// угол по гравитации не определить, остаётся прежняя формула, а проверка «плечо не прижато» её пометит.

/** Сгибание локтя — поворот вокруг +Z датчика плеча у правой руки и вокруг −Z у левой. */
const HINGE_SIGN: Record<Side, number> = { right: 1, left: -1 };
const ELBOW_MIN = -25;
const ELBOW_MAX = 175;
/** Предплечье ближе 4° к вертикали плоскости шарнира: ветви ближе 8°, их можно сменить. */
const ELBOW_TOUCH = 4;
/** Перевес, без которого выбирается ветвь «предплечье впереди», градусы. */
const ELBOW_MARGIN = 3;
/** Медленнее этого (гироскоп предплечья, °/с) рука у вертикали стоит, а не проходит её. */
const ELBOW_REST_DPS = 15;
/** Дальше этого прогноз прохода через вертикаль не тянем, секунды. */
const ELBOW_HORIZON = 0.3;

/**
 * Память выбора ветви. По гравитации видно, на сколько предплечье отклонено от вертикали плоскости
 * шарнира, но не видно, впереди оно или позади. Сменить ветвь можно только там, где ветви сходятся, —
 * у вертикали. Там решает гироскоп предплечья: рука проходит вертикаль — продолжаем движение с той
 * скоростью, с какой она подошла; стоит у вертикали — остаёмся у того угла, где она остановилась,
 * а при равенстве выбираем «впереди» (из позы калибровки локоть сгибается вперёд).
 * Сбрасывается при калибровке, новом шаге и после разрыва.
 */
export interface ElbowTrack {
  prev: number | null;
  prevT: number | null;
  /** Скорость угла, °/с, сглаженная; считается вне зоны схода, где ветвь известна. */
  vel: number;
  /** Опора в зоне схода: угол, скорость и время входа (или начала остановки); null — вне зоны. */
  zone: { value: number; vel: number; t: number } | null;
}

export function newElbowTrack(): ElbowTrack {
  return { prev: null, prevT: null, vel: 0, zone: null };
}

/**
 * Сгибание локтя от позы калибровки, градусы.
 * upperNow, upperCal — «верх» датчика плеча сейчас и в позе калибровки; foreElevation — подъём
 * предплечья от позы калибровки; foreSpeed — модуль угловой скорости предплечья, °/с;
 * fallback — прежняя формула на случай, когда шарнир не определить; t — время отсчёта, секунды.
 */
export function elbowFlexion(
  side: Side,
  upperNow: Vec3,
  upperCal: Vec3,
  foreElevation: number,
  foreSpeed: number,
  fallback: number,
  t: number,
  track?: ElbowTrack,
): number {
  const bone = scale(upperCal, -1);
  const z: Vec3 = [0, 0, HINGE_SIGN[side]];
  const hRaw = sub(z, scale(bone, dot(z, bone)));
  const down = scale(upperNow, -1);
  let angle = fallback;
  let phi = Infinity;
  if (norm(hRaw) >= 0.5) {
    const h = normalize(hRaw);
    const dp = sub(down, scale(h, dot(down, h)));
    const m = norm(dp);
    if (m >= 0.5) {
      const phiU = Math.atan2(dot(cross(dp, bone), h), dot(dp, bone)) / DEG;
      phi = Math.acos(Math.max(-1, Math.min(1, Math.cos(foreElevation * DEG) / m))) / DEG;
      // a — предплечье впереди вертикали, b — позади; невозможные для локтя углы отбрасываем
      const cands = [phi - phiU, -phi - phiU].filter((e) => e >= ELBOW_MIN && e <= ELBOW_MAX);
      if (cands.length === 1) angle = cands[0] as number;
      else if (cands.length === 2) angle = chooseBranch(cands[0] as number, cands[1] as number, phi, foreSpeed, t, track);
      else angle = phi - phiU;
    }
  }
  if (track) {
    // Скорость — только вне зоны схода: там ветвь известна, и скорость честная
    if (phi >= ELBOW_TOUCH && track.prev !== null && track.prevT !== null) {
      const dt = t - track.prevT;
      if (dt > 0 && dt < 0.5) track.vel = 0.7 * track.vel + 0.3 * ((angle - track.prev) / dt);
    }
    if (phi >= ELBOW_TOUCH) track.zone = null;
    track.prev = angle;
    track.prevT = t;
  }
  return angle;
}

function chooseBranch(a: number, b: number, phi: number, foreSpeed: number, t: number, track?: ElbowTrack): number {
  // b — только если она ближе к цели с перевесом; иначе «впереди»
  const prefer = (target: number) => (Math.abs(b - target) + ELBOW_MARGIN < Math.abs(a - target) ? b : a);
  // Без истории: ближе к нулю (в начале шага рука выпрямлена)
  if (!track || track.prev === null) return prefer(0);
  if (phi >= ELBOW_TOUCH) {
    // Ветви далеко друг от друга: остаёмся на той, что ближе к прошлому значению
    return Math.abs(b - track.prev) < Math.abs(a - track.prev) ? b : a;
  }
  if (foreSpeed < ELBOW_REST_DPS) {
    // Рука стоит у вертикали: опора — угол, где она остановилась, без прогноза
    if (!track.zone || track.zone.vel !== 0) track.zone = { value: track.prev, vel: 0, t };
  } else {
    // Рука проходит вертикаль: продолжаем движение со скоростью при входе
    track.zone ??= { value: track.prev, vel: track.vel, t };
  }
  return prefer(track.zone.value + track.zone.vel * Math.min(t - track.zone.t, ELBOW_HORIZON));
}

export interface ExerciseSample {
  /** Главный угол движения, градусы. */
  angle: number;
  /** Скорость для SPARC, °/с. */
  speed: number;
  /** Наклон туловища от позы калибровки, градусы; null — датчика нет или не нужен. */
  trunk: number | null;
  /** Контроль условий: отрыв плеча при сгибании локтя или подъём предплечья при повороте. */
  check: number | null;
}

/**
 * Считает главный угол выбранного движения по последним показаниям датчиков.
 * rollZero — нейтраль поворота предплечья, её ловит движок на этапе установки.
 */
export function exerciseSample(
  def: ExerciseDef,
  side: Side,
  pipe: MotionPipeline,
  ref: AngleReference,
  rollZero: number,
  /** Память ветви для локтя; без неё каждый отсчёт решается заново. */
  elbowTrack?: ElbowTrack,
): ExerciseSample | null {
  const upperP = placementOf('upper', side);
  const foreP = placementOf('fore', side);
  // Время главного датчика движения: показания, отставшие от него больше STALE_SEC, не используем
  const tRef = pipe.latest[def.angle === 'elevation' ? upperP : foreP]?.t;
  if (tRef === undefined) return null;
  const fresh = (p: Placement) => {
    const r = pipe.latest[p];
    return r && tRef - r.t <= STALE_SEC ? r : undefined;
  };
  // Нужный датчик без калибровки — угла нет, а не «угол другим способом»
  if (requiredSensors(def, side).some((p) => !fresh(p) || !ref.up[p])) return null;
  const upper = fresh(upperP);
  const fore = fresh(foreP);
  const trunk = fresh('trunk');
  const trunkTilt = def.trunk && trunk && ref.up.trunk ? angleBetween(trunk.up, ref.up.trunk) : null;

  switch (def.angle) {
    case 'elevation': {
      const e = elevationFromRef(upperP, pipe, ref);
      if (!upper || e === null) return null;
      return {
        angle: e,
        speed: Math.hypot(upper.gyro[0], upper.gyro[1], upper.gyro[2]),
        trunk: trunkTilt,
        check: null,
      };
    }
    case 'elbow': {
      const eu = elevationFromRef(upperP, pipe, ref);
      const ef = elevationFromRef(foreP, pipe, ref);
      if (!fore || !upper || eu === null || ef === null) return null;
      // Сгибание в плоскости шарнира (см. elbowFlexion). check — насколько оторвано плечо
      const calU = ref.up[upperP];
      return {
        angle: calU ? elbowFlexion(side, upper.up, calU, ef, Math.hypot(...fore.gyro), ef - eu, fore.t, elbowTrack) : ef - eu,
        speed: Math.hypot(fore.gyro[0], fore.gyro[1], fore.gyro[2]),
        trunk: trunkTilt,
        check: eu,
      };
    }
    case 'rotation': {
      const ef = elevationFromRef(foreP, pipe, ref);
      if (!fore || ef === null) return null;
      return {
        angle: ROTATION_SIGN[side] * wrap180(roll(fore.up) - rollZero),
        speed: Math.abs(fore.gyro[0]),
        trunk: trunkTilt,
        check: ef,
      };
    }
  }
}

/** Приводит угол к диапазону −180…180. */
export function wrap180(a: number): number {
  let x = a % 360;
  if (x > 180) x -= 360;
  if (x < -180) x += 360;
  return x;
}

/** Предплечье горизонтально и неподвижно — можно ловить нейтраль поворота. tNow — время последнего кадра. */
export function forearmReady(pipe: MotionPipeline, side: Side, ref?: AngleReference, tNow?: number): boolean {
  const p = placementOf('fore', side);
  const fore = pipe.latest[p];
  // Замёрзшее показание пропавшего датчика выглядело бы «неподвижным» — нейтраль по нему не ловим
  if (!fore || (tNow !== undefined && tNow - fore.t > STALE_SEC)) return false;
  const e = ref ? elevationFromRef(p, pipe, ref) ?? elevation(fore.up) : elevation(fore.up);
  const speed = Math.hypot(fore.gyro[0], fore.gyro[1], fore.gyro[2]);
  return e > 65 && e < 115 && speed < 20;
}

export function currentRoll(pipe: MotionPipeline, side: Side): number | null {
  const fore = pipe.latest[placementOf('fore', side)];
  return fore ? roll(fore.up) : null;
}

