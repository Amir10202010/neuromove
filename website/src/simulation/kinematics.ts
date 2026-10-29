// Модель тела для симулятора: из углов в суставах → где каждый датчик и как он повёрнут.
//
// Оси мира: x — вперёд, y — влево, z — вверх. Начало — точка вращения туловища (таз).
// Датчики крепятся одинаково (железо.md, раздел 5): ось X — вдоль кости, к кисти.
// На туловище (грудина) ось X смотрит вниз, к тазу: в прямой позе подъём = 0.
//
// ⚠️ Все матрицы — настоящие повороты (определитель +1). С зеркальной матрицей
// симулятор врёт, и правильный алгоритм выглядит сломанным (софт.md, «Симулятор»).

import type { Placement, Side } from '../devices/types';
import { DEG, IDENTITY, add, apply, fromColumns, mul, rotX, rotY, rotZ, type Mat3, type Vec3 } from '../lib/vec3';

export interface ArmPose {
  /** Сгибание в плечевом суставе — подъём руки вперёд, градусы. */
  flexion: number;
  /** Отведение — подъём руки в сторону, градусы. */
  abduction: number;
  /** Сгибание в локте, градусы: 0 — рука прямая. */
  elbow: number;
  /** Поворот предплечья: + супинация (ладонь вверх), − пронация (ладонь вниз). */
  rotation: number;
}

export interface Pose {
  /** Наклон туловища вперёд (+) или назад (−), градусы. */
  trunkPitch: number;
  /** Наклон туловища влево (+) или вправо (−), градусы. */
  trunkRoll: number;
  left: ArmPose;
  right: ArmPose;
}

export function restingArm(): ArmPose {
  return { flexion: 0, abduction: 0, elbow: 0, rotation: 0 };
}

export function restingPose(): Pose {
  return { trunkPitch: 0, trunkRoll: 0, left: restingArm(), right: restingArm() };
}

/** Размеры тела ребёнка ~8 лет, метры. На углы не влияют — только на ускорения при движении. */
const BODY = {
  trunkSensor: [0.07, 0, 0.26] as Vec3,
  shoulderHeight: 0.33,
  shoulderHalfWidth: 0.13,
  upperArm: 0.21,
  upperSensorAlong: 0.09,
  foreSensorAlong: 0.16,
};

// Как оси датчика лежат на сегменте (столбцы — оси X, Y, Z датчика в осях сегмента).
// Сегмент в исходной позе совпадает с осями мира: рука висит вниз, большой палец вперёд.
const MOUNT_TRUNK = fromColumns([0, 0, -1], [0, 1, 0], [1, 0, 0]);
const MOUNT_RIGHT = fromColumns([0, 0, -1], [1, 0, 0], [0, -1, 0]); // Z — наружу, вправо
const MOUNT_LEFT = fromColumns([0, 0, -1], [-1, 0, 0], [0, 1, 0]); // Z — наружу, влево

export interface SensorKinematics {
  /** Поворот «оси датчика → оси мира». */
  R: Mat3;
  /** Положение датчика в мире, метры. */
  p: Vec3;
}

export type BodyKinematics = Record<Placement, SensorKinematics>;

function armKinematics(side: Side, arm: ArmPose, Rtrunk: Mat3): { upper: SensorKinematics; fore: SensorKinematics } {
  const sgn = side === 'right' ? -1 : 1; // направление «наружу» по оси y
  // Плечо: сначала отведение (в сторону), потом сгибание (вперёд)
  const Rupper = mul(Rtrunk, mul(rotY(-arm.flexion * DEG), rotX(sgn * arm.abduction * DEG)));
  // Предплечье: сгибание в локте — вперёд-вверх; поворот — вокруг собственной оси кости.
  // Ось кости предплечья в его осях — −z, поэтому супинация правой руки — поворот rotZ(−угол),
  // левой — rotZ(+угол) (руки зеркальны).
  const Rfore = mul(Rupper, mul(rotY(-arm.elbow * DEG), rotZ(sgn * arm.rotation * DEG)));

  const shoulder = apply(Rtrunk, [0, sgn * BODY.shoulderHalfWidth, BODY.shoulderHeight]);
  const upperSensor = add(shoulder, apply(Rupper, [0, sgn * 0.035, -BODY.upperSensorAlong]));
  const elbow = add(shoulder, apply(Rupper, [0, 0, -BODY.upperArm]));
  const foreSensor = add(elbow, apply(Rfore, [0, sgn * 0.025, -BODY.foreSensorAlong]));

  const mount = side === 'right' ? MOUNT_RIGHT : MOUNT_LEFT;
  return {
    upper: { R: mul(Rupper, mount), p: upperSensor },
    fore: { R: mul(Rfore, mount), p: foreSensor },
  };
}

/** Поза тела → положение и поворот всех пяти датчиков. */
export function bodyKinematics(pose: Pose): BodyKinematics {
  // Наклон вперёд — поворот вокруг оси y; влево — вокруг оси x в обратную сторону
  const Rtrunk = mul(rotY(pose.trunkPitch * DEG), rotX(-pose.trunkRoll * DEG));
  const left = armKinematics('left', pose.left, Rtrunk);
  const right = armKinematics('right', pose.right, Rtrunk);
  return {
    trunk: { R: mul(Rtrunk, MOUNT_TRUNK), p: apply(Rtrunk, BODY.trunkSensor) },
    upper_l: left.upper,
    fore_l: left.fore,
    upper_r: right.upper,
    fore_r: right.fore,
  };
}

export { IDENTITY };
