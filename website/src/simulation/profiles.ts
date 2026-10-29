// Профили движений виртуальных пациентов.
// Тяжесть s ∈ [0, 1]: 0 — движения без ограничений, 1 — тяжёлое ограничение.
// Это модель для демонстрации и тестов, а не клинические нормы.

import type { ExerciseId } from '../core/exercises';
import type { Side } from '../devices/types';
import type { ExerciseAbility, MovementProfile, SideAbilities } from './VirtualPatient';

export type AbilityOverrides = Partial<Record<ExerciseId, Partial<ExerciseAbility>>>;

export function abilitiesFor(s: number, overrides: AbilityOverrides = {}): SideAbilities {
  const base: SideAbilities = {
    shoulder_flexion: {
      rom: 166 - 88 * s,
      romSd: 1.5 + 3.5 * s,
      riseTime: 1.15 + 1.3 * s,
      lowerTime: 1.1 + 0.8 * s,
      hold: 0.4,
      rest: 1.1 + 0.5 * s,
      submovements: 1 + 4.5 * s,
      trunkComp: 1.5 + 17 * s,
      upperLift: 0,
      tremor: 0,
      fatigue: 0.004 + 0.02 * s,
    },
    shoulder_abduction: {
      rom: 162 - 92 * s,
      romSd: 1.5 + 4 * s,
      riseTime: 1.2 + 1.3 * s,
      lowerTime: 1.1 + 0.8 * s,
      hold: 0.4,
      rest: 1.1 + 0.5 * s,
      submovements: 1 + 4.5 * s,
      trunkComp: 1.5 + 19 * s,
      upperLift: 0,
      tremor: 0,
      fatigue: 0.004 + 0.02 * s,
    },
    elbow_flexion: {
      rom: 142 - 62 * s,
      romSd: 1.2 + 3.5 * s,
      riseTime: 0.95 + 1.0 * s,
      lowerTime: 0.95 + 0.7 * s,
      hold: 0.3,
      rest: 1.0 + 0.5 * s,
      submovements: 1 + 4 * s,
      trunkComp: 0,
      upperLift: 3 + 22 * s,
      tremor: 0,
      fatigue: 0.004 + 0.025 * s,
    },
    forearm_rotation: {
      rom: 82 - 66 * s, // супинация
      pronation: 78 - 42 * s,
      romSd: 1.5 + 3.5 * s,
      riseTime: 0.85 + 0.9 * s,
      lowerTime: 0.85 + 0.7 * s,
      hold: 0.35,
      rest: 1.0 + 0.4 * s,
      submovements: 1 + 3.8 * s,
      trunkComp: 0,
      upperLift: 0,
      tremor: 0,
      fatigue: 0.004 + 0.02 * s,
    },
  };
  for (const [ex, o] of Object.entries(overrides) as [ExerciseId, Partial<ExerciseAbility>][]) {
    base[ex] = { ...base[ex], ...o };
  }
  return base;
}

export function buildProfile(severity: Record<Side, number>, sway = 0.6, overrides: Partial<Record<Side, AbilityOverrides>> = {}): MovementProfile {
  return {
    left: abilitiesFor(severity.left, overrides.left),
    right: abilitiesFor(severity.right, overrides.right),
    sway,
  };
}
