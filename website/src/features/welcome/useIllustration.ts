// Иллюстрации на стартовой странице: виртуальный пациент поднимает руку — вперёд или в сторону.
// Берём позу прямо из модели движения — без датчиков (это картинка, а не измерение;
// так и подписано на экране). Устроено как движок сеанса: объект live читают рисунки
// каждый кадр, а обновляет его только сам источник — без перерисовки React.
//
// Часы свои: идут, только пока рисунок на экране. Ушёл с экрана — модель замирает
// и продолжает с того же места, без скачка на пропущенные секунды.

import { useEffect, useState } from 'react';
import { useAnimationFrame } from '../../hooks/useAnimationFrame';
import { buildProfile } from '../../simulation/profiles';
import { VirtualPatient } from '../../simulation/VirtualPatient';
import type { LiveValues } from '../../session/types';
import { prefersReducedMotion } from './motion';

/** Какое движение показывает иллюстрация: подъём вперёд (вид сбоку) или отведение (вид спереди). */
export type IllustrationMove = 'shoulder_flexion' | 'shoulder_abduction';

export interface IllustrationLive extends LiveValues {
  /** Сколько повторов закончено с начала показа. */
  reps: number;
  /** Пик последнего законченного повтора, градусы. */
  lastPeak: number | null;
}

/** Выше этого угла рука считается «в повторе» — как порог на экране теста. */
const IN_REP = 20;

// Тяжесть правой руки 0.31 — как у демо-пациента P01 сегодня (data/seed/demo.ts)
const SEVERITY = { left: 0.04, right: 0.31 };
const SEED = 2026;

/**
 * Для «уменьшить движение»: момент пика первого повтора. Прогоняем ту же модель с тем же
 * зерном шагами по 1/30 с — рисунок застынет на самом выразительном кадре, а не на покое.
 */
function peakTime(move: IllustrationMove): number {
  const vp = new VirtualPatient(buildProfile(SEVERITY), SEED);
  vp.instruct({ kind: 'exercise', exercise: move, side: 'right' }, 0);
  let best = 0;
  let at = 0;
  for (let t = 0; t <= 6; t += 1 / 30) {
    const arm = vp.poseAt(t).right;
    const a = move === 'shoulder_flexion' ? arm.flexion : arm.abduction;
    if (a > best) {
      best = a;
      at = t;
    }
  }
  return at;
}

class IllustrationSource {
  readonly live: IllustrationLive = {
    t: 0,
    angle: 0,
    trunk: 0,
    check: null,
    repPeak: null,
    inRep: false,
    upperElevation: 0,
    foreElevation: 0,
    reps: 0,
    lastPeak: null,
  };
  private readonly vp = new VirtualPatient(buildProfile(SEVERITY), SEED);
  private clock = 0;
  private lastNow: number | null = null;
  /** Не null — движение остановлено на этом моменте («уменьшить движение» в системе). */
  private readonly frozenAt: number | null;

  constructor(
    private readonly move: IllustrationMove,
    reduced: boolean,
  ) {
    this.vp.instruct({ kind: 'exercise', exercise: move, side: 'right' }, 0);
    this.frozenAt = reduced ? peakTime(move) : null;
  }

  tick(now: number): void {
    // Шаг часов не больше 50 мс: после паузы или свёрнутой вкладки модель не «прыгает»
    const dt = this.lastNow === null ? 0 : Math.min(0.05, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;
    this.clock = this.frozenAt ?? this.clock + dt;
    const pose = this.vp.poseAt(this.clock);
    const L = this.live;
    const arm = pose.right;
    const a = this.move === 'shoulder_flexion' ? arm.flexion : arm.abduction;
    L.t = this.clock;
    L.angle = a;
    L.upperElevation = a;
    L.foreElevation = a + arm.elbow;
    // Компенсация: при подъёме вперёд ребёнок отклоняется назад, при отведении — в сторону
    L.trunk = Math.abs(this.move === 'shoulder_flexion' ? pose.trunkPitch : pose.trunkRoll);
    const moving = a > IN_REP;
    if (moving) {
      L.repPeak = Math.max(L.repPeak ?? 0, a);
    } else if (L.inRep) {
      // Рука опустилась — повтор закончен
      L.reps += 1;
      L.lastPeak = L.repPeak;
      L.repPeak = null;
    }
    L.inRep = moving;
  }

  /** Модель стоит на месте, пока рисунок не виден: следующий кадр начнётся без скачка. */
  pause(): void {
    this.lastNow = null;
  }
}

/**
 * Живые значения для иллюстрации. active = false — модель на паузе (рисунок за экраном).
 * Объект live один и тот же всё время: рисунки читают его в своём кадре.
 */
export function useIllustration(move: IllustrationMove = 'shoulder_flexion', active = true): IllustrationLive {
  const [source] = useState(() => new IllustrationSource(move, prefersReducedMotion()));
  useAnimationFrame((now) => source.tick(now), active);
  useEffect(() => {
    if (!active) source.pause();
  }, [active, source]);
  return source.live;
}
