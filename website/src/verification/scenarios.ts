// Сценарии экспериментов (docs/ENGINEERING_10H/EXPERIMENTS.md). Каждый — функция времени → поза
// тела и что сравнивать. Все начинаются с 4 с покоя в позе калибровки: руки вдоль тела.

import type { ExerciseId } from '../core/exercises';
import type { Side } from '../devices/types';
import { hangingArm, uprightPose, type ArmAngles, type BodyPose, type BodyTruth, type SensorPlace } from './body';
import { keyframes } from './gen';

/** Сколько секунд покоя в начале: калибровка движка — 3 с. */
export const CAL_SEC = 4;

export type Track = (t: number) => number;

/** Повторы «0 → пик → 0»: подъём rise с, удержание hold с, опускание rise с, отдых rest с. */
export function repTrack(peak: number, rise: number, hold: number, n: number, rest = 1, from = CAL_SEC, base = 0): Track {
  const keys: [number, number][] = [[0, base], [from, base]];
  let t = from;
  for (let i = 0; i < n; i++) {
    keys.push([t + rise, peak], [t + rise + hold, peak], [t + 2 * rise + hold, base], [t + 2 * rise + hold + rest, base]);
    t += 2 * rise + hold + rest;
  }
  return keyframes(keys);
}

/** Удержания на ступенях: каждая ступень — переход move с и удержание hold с. Возвращает и окна удержаний. */
export function stairsTrack(levels: readonly number[], move = 1.5, hold = 3, from = CAL_SEC, base = 0): { track: Track; holds: [number, number][]; end: number } {
  const keys: [number, number][] = [[0, base], [from, base]];
  const holds: [number, number][] = [];
  let t = from;
  for (const v of levels) {
    keys.push([t + move, v], [t + move + hold, v]);
    // Окно удержания без первых 0,5 с: фильтру нужно успокоиться
    holds.push([t + move + 0.5, t + move + hold]);
    t += move + hold;
  }
  keys.push([t + move, base], [t + move + 1, base]);
  return { track: keyframes(keys), holds, end: t + move + 1 };
}

export function armPose(side: Side, arm: Partial<ArmAngles>, trunk: { pitch?: number; roll?: number } = {}): BodyPose {
  const pose = uprightPose();
  pose.trunkPitch = trunk.pitch ?? 0;
  pose.trunkRoll = trunk.roll ?? 0;
  pose[side] = { ...hangingArm(), ...arm };
  return pose;
}

export function placesFor(side: Side): SensorPlace[] {
  return side === 'right' ? ['trunk', 'upper_r', 'fore_r'] : ['trunk', 'upper_l', 'fore_l'];
}

/** Что сравниваем с прибором для каждого движения. */
export function truthFor(exercise: ExerciseId, side: Side, neutral = 0): (b: BodyTruth) => number {
  switch (exercise) {
    case 'shoulder_flexion':
    case 'shoulder_abduction':
      return (b) => b[side].elevationWorld;
    case 'elbow_flexion':
      return (b) => b[side].elbowHinge;
    case 'forearm_rotation':
      return (b) => b[side].proSup - neutral;
  }
}
