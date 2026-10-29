// Виртуальный пациент — «ребёнок», который выполняет указания специалиста.
//
// В настоящем кабинете ребёнок слышит: «подними правую руку вперёд три раза».
// В симуляторе те же указания получает VirtualPatient — через SessionEngine.onInstruction.
// Интерфейс ничего о нём не знает: он видит только сырые числа с «датчиков».

import type { ExerciseId } from '../core/exercises';
import type { Side } from '../devices/types';
import type { Instruction } from '../session/types';
import { createRng, type Rng } from '../lib/random';
import { restingPose, type ArmPose, type Pose } from './kinematics';
import { minJerk, repAngle, repDuration, segmentedReach, smoothstep, sway, tremorEnvelope, type RepPlan } from './motion';

/** Что пациент умеет в одном движении одной рукой. */
export interface ExerciseAbility {
  /** Средний пик угла, градусы. Для поворота — пик супинации. */
  rom: number;
  /** Разброс пика от повтора к повтору, градусы (СКО). */
  romSd: number;
  /** Только для поворота: пик пронации, градусы. */
  pronation?: number;
  /** Длительность подъёма и опускания, секунды. */
  riseTime: number;
  lowerTime: number;
  hold: number;
  rest: number;
  /** Среднее число подшагов при подъёме: 1 — плавно, 3–4 — прерывисто. */
  submovements: number;
  /** Наклон туловища на пике подъёма руки, градусы (компенсация). */
  trunkComp: number;
  /** Сгибание в локте: насколько плечо отрывается от тела на пике, градусы. */
  upperLift: number;
  /** Тремор, градусы. 0 — нет. */
  tremor: number;
  /** Утомление: доля потери размаха за повтор (0.02 = −2% на каждый следующий). */
  fatigue: number;
}

export type SideAbilities = Record<ExerciseId, ExerciseAbility>;

export interface MovementProfile {
  left: SideAbilities;
  right: SideAbilities;
  /** Покачивание туловища в покое, градусы. */
  sway: number;
}

interface ExerciseActivity {
  kind: 'exercise';
  exercise: ExerciseId;
  side: Side;
  since: number;
  /** Когда начнётся первый повтор (время реакции + установка). */
  firstRepAt: number;
  rep: RepPlan | null;
  repStart: number;
  repIndex: number;
}

type Activity = { kind: 'rest'; since: number } | { kind: 'hold_still'; since: number; fidgetAt: number | null } | ExerciseActivity;

export interface VirtualPatientOptions {
  /** Поёрзать во время первой калибровки — чтобы показать повтор калибровки. */
  fidgetOnFirstCalibration?: boolean;
}

export class VirtualPatient {
  private readonly rng: Rng;
  private activity: Activity = { kind: 'rest', since: 0 };
  private calibrations = 0;
  private readonly phase: number;
  /** Утомление к концу теста: множитель размаха уменьшается с каждым повтором. */
  private fatigueScale = 1;
  /** Последняя отданная поза и переход от неё к новой — человек не меняет позу мгновенно. */
  private lastPose: Pose | null = null;
  private blend: { from: Pose; start: number; duration: number } | null = null;

  constructor(
    private readonly profile: MovementProfile,
    seed: number,
    private readonly options: VirtualPatientOptions = {},
  ) {
    this.rng = createRng(seed);
    this.phase = this.rng.range(0, Math.PI * 2);
  }

  /** Сценарий «утомление»: к концу серии размах падает сильнее обычного. */
  setExtraFatigue(scale: number): void {
    this.fatigueScale = scale;
  }

  instruct(ins: Instruction, t: number): void {
    // Новое указание — плавно переходим из текущей позы за 0.7 с
    if (this.lastPose) this.blend = { from: clonePose(this.lastPose), start: t, duration: 0.7 };
    if (ins.kind === 'rest') {
      this.activity = { kind: 'rest', since: t };
    } else if (ins.kind === 'hold_still') {
      this.calibrations += 1;
      const fidget = this.options.fidgetOnFirstCalibration && this.calibrations === 1;
      this.activity = { kind: 'hold_still', since: t, fidgetAt: fidget ? t + this.rng.range(1.0, 1.8) : null };
    } else {
      const positioning = ins.exercise === 'forearm_rotation' ? 1.6 : 0;
      this.activity = {
        kind: 'exercise',
        exercise: ins.exercise,
        side: ins.side,
        since: t,
        firstRepAt: t + this.rng.range(0.7, 1.3) + positioning,
        rep: null,
        repStart: 0,
        repIndex: 0,
      };
    }
  }

  poseAt(t: number): Pose {
    const pose = restingPose();
    const a = this.activity;
    const swayAmp = a.kind === 'hold_still' ? this.profile.sway * 0.35 : this.profile.sway;
    pose.trunkPitch = sway(t, swayAmp, this.phase);
    pose.trunkRoll = sway(t + 7.3, swayAmp * 0.7, this.phase * 1.7);
    // Руки в покое тоже чуть покачиваются — это не ноль, а живой человек
    pose.left.flexion = Math.max(0, 2 + sway(t + 3.1, 1.2, this.phase));
    pose.right.flexion = Math.max(0, 2 + sway(t + 5.9, 1.2, this.phase * 0.6));

    if (a.kind === 'hold_still' && a.fidgetAt !== null) {
      // Ребёнок поёрзал: быстро поднял и опустил правую руку
      const u = (t - a.fidgetAt) / 0.9;
      // sin² — начинается и кончается с нулевой скоростью: рука не может тронуться с места рывком
      if (u > 0 && u < 1) pose.right.flexion += 35 * Math.sin(Math.PI * u) ** 2;
    }
    if (a.kind === 'exercise') this.applyExercise(a, t, pose);
    const out = this.blend ? blendPose(this.blend.from, pose, minJerk((t - this.blend.start) / this.blend.duration)) : pose;
    if (this.blend && t - this.blend.start >= this.blend.duration) this.blend = null;
    this.lastPose = out;
    return out;
  }

  private applyExercise(a: ExerciseActivity, t: number, pose: Pose): void {
    const ability = this.profile[a.side][a.exercise];
    const arm: ArmPose = a.side === 'left' ? pose.left : pose.right;
    const lean = a.side === 'left' ? -1 : 1; // при отведении правой руки туловище уходит влево (+)

    if (a.exercise === 'forearm_rotation') {
      // Установка: локоть согнут на 90°, плечо прижато, большой палец вверх
      arm.elbow = 90 * minJerk((t - a.since - 0.4) / 1.0);
      arm.flexion = 3;
    }
    if (t < a.firstRepAt) return;

    // Следующий повтор, когда закончился текущий
    if (!a.rep || t - a.repStart >= repDuration(a.rep)) {
      a.repStart = a.rep ? a.repStart + repDuration(a.rep) : a.firstRepAt;
      a.rep = this.planRep(ability, a.exercise, a.repIndex);
      a.repIndex += 1;
    }
    const rep = a.rep;
    const tr = t - a.repStart;
    // Поза покоя до первого повтора (2° и покачивание): повтор отсчитывается от неё, а не от нуля,
    // иначе на стыке угол прыгал бы на 1–3° за отсчёт — у датчика это ложный «упор» больше 4 g
    const restFlex = arm.flexion;
    const settle = minJerk((t - a.firstRepAt) / 0.5);

    switch (a.exercise) {
      case 'shoulder_flexion': {
        const th = Math.max(0, repAngle(rep, tr));
        arm.flexion = Math.max(restFlex, th);
        // Компенсация: на высоте ребёнок отклоняется назад, «доводя» руку корпусом
        const k = smoothstep((th - 0.45 * rep.peak) / (0.55 * rep.peak));
        pose.trunkPitch -= ability.trunkComp * k;
        break;
      }
      case 'shoulder_abduction': {
        const th = Math.max(0, repAngle(rep, tr));
        arm.abduction = th;
        arm.flexion = restFlex + (4 - restFlex) * settle;
        const k = smoothstep((th - 0.45 * rep.peak) / (0.55 * rep.peak));
        pose.trunkRoll += lean * ability.trunkComp * k;
        break;
      }
      case 'elbow_flexion': {
        const th = Math.max(0, repAngle(rep, tr));
        arm.elbow = th;
        // Плечо должно быть прижато; при слабости ребёнок помогает себе, отводя плечо вперёд
        arm.flexion = restFlex + ability.upperLift * (th / Math.max(rep.peak, 1)) ** 2;
        break;
      }
      case 'forearm_rotation': {
        arm.elbow = 90;
        arm.rotation = rotationAngle(rep, tr, ability);
        break;
      }
    }
  }

  private planRep(ability: ExerciseAbility, exercise: ExerciseId, index: number): RepPlan {
    const rng = this.rng;
    const fatigue = Math.max(0.6, 1 - ability.fatigue * this.fatigueScale * index);
    const peak = Math.max(8, rng.normal(ability.rom, ability.romSd) * fatigue);
    const count = Math.max(1, Math.round(rng.normal(ability.submovements, 0.35)));
    const rise = segmentedReach(peak, ability.riseTime * rng.range(0.88, 1.12), count, rng);
    const lowerCount = Math.max(1, Math.round(count * 0.6));
    const lower = segmentedReach(peak, ability.lowerTime * rng.range(0.88, 1.12), lowerCount, rng);
    const plan: RepPlan = {
      peak,
      rise,
      hold: ability.hold * rng.range(0.7, 1.3),
      lower,
      rest: ability.rest * rng.range(0.8, 1.25),
      tremorAmp: ability.tremor,
      tremorHz: rng.range(5, 8),
      tremorPhase: rng.range(0, Math.PI * 2),
    };
    if (exercise === 'forearm_rotation') {
      // Для поворота «пик» — супинация; пронация хранится отдельно в том же плане.
      // Три дуги вместо двух — движение длиннее на одну дугу подъёма.
      plan.pron = Math.max(8, rng.normal(ability.pronation ?? ability.rom, ability.romSd) * fatigue);
      plan.extra = rise.duration;
    }
    return plan;
  }
}

/**
 * Один повтор поворота: нейтраль → супинация → пронация → нейтраль.
 * Время делится на три дуги: 0 → +sup, +sup → −pron, −pron → 0.
 */
function rotationAngle(rep: RepPlan, t: number, ability: ExerciseAbility): number {
  const sup = rep.peak;
  const pron = rep.pron ?? rep.peak;
  const d1 = rep.rise.duration * 0.8;
  const d2 = rep.rise.duration * 1.2;
  const d3 = rep.lower.duration * 0.8;
  const h = rep.hold * 0.5;
  let v: number;
  if (t < d1) v = rep.rise.at((t / d1) * rep.rise.duration) * (sup / rep.peak);
  else if (t < d1 + h) v = sup;
  else if (t < d1 + h + d2) v = sup - (sup + pron) * minJerk((t - d1 - h) / d2);
  else if (t < d1 + 2 * h + d2) v = -pron;
  else if (t < d1 + 2 * h + d2 + d3) v = -pron + pron * minJerk((t - d1 - 2 * h - d2) / d3);
  else v = 0;
  // Тремор с плавной огибающей: на стыке повторов фаза меняется, и скачок дал бы ложный «упор»
  if (ability.tremor > 0) v += tremorEnvelope(t, d1 + 2 * h + d2 + d3 + rep.rest) * ability.tremor * Math.sin(2 * Math.PI * rep.tremorHz * t + rep.tremorPhase);
  return v;
}

function clonePose(p: Pose): Pose {
  return { trunkPitch: p.trunkPitch, trunkRoll: p.trunkRoll, left: { ...p.left }, right: { ...p.right } };
}

/** Промежуточная поза: k = 0 — from, k = 1 — to. */
function blendPose(from: Pose, to: Pose, k: number): Pose {
  const mix = (a: number, b: number) => a + (b - a) * k;
  const arm = (a: ArmPose, b: ArmPose): ArmPose => ({
    flexion: mix(a.flexion, b.flexion),
    abduction: mix(a.abduction, b.abduction),
    elbow: mix(a.elbow, b.elbow),
    rotation: mix(a.rotation, b.rotation),
  });
  return { trunkPitch: mix(from.trunkPitch, to.trunkPitch), trunkRoll: mix(from.trunkRoll, to.trunkRoll), left: arm(from.left, to.left), right: arm(from.right, to.right) };
}
