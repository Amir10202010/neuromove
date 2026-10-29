// Модель тела независимого эталона: туловище, плечо, предплечье обеих рук и пять датчиков.
//
// Оси мира: X — вправо, Y — вперёд, Z — вверх. У симулятора приложения (simulation/kinematics.ts)
// x — вперёд, y — влево: оси нарочно другие — приложение видит только оси датчика и от мира
// зависеть не должно.
//
// Плечо задано как в рекомендациях ISB для плечевого сустава: плоскость подъёма, подъём и поворот
// вокруг своей оси (swing — затем twist), а не «сгибание, затем отведение», как в симуляторе.
// Локоть — шарнир с осью, закреплённой в плече, плюс угол вальгуса; предплечье поворачивается
// вокруг своей длинной оси.
//
// Как надет датчик — по документам проекта (прототип.md, раздел 3; железо.md, раздел 5):
//   плечо       — середина плеча снаружи; X вдоль кости к кисти, Z наружу от кожи;
//   предплечье  — тыльная сторона у запястья; X к кисти, Z наружу от кожи;
//   туловище    — грудина; X вниз, Z вперёд от груди.

import { Q_ID, RAD, qAxis, qFromAxes, qMul, qRot, vAdd, vAngleDeg, type Q, type V } from './quat';

export type ArmSide = 'right' | 'left';
export type SensorPlace = 'trunk' | 'upper_r' | 'fore_r' | 'upper_l' | 'fore_l';

export interface ArmAngles {
  /** Плоскость подъёма плеча, градусы: 0 — вперёд, 90 — в сторону (наружу). */
  plane: number;
  /** Подъём плеча от висящего положения, градусы. */
  elevation: number;
  /** Поворот плеча вокруг своей оси, градусы: + наружу. */
  axial: number;
  /** Сгибание в локте — поворот вокруг оси шарнира, градусы: 0 — рука прямая. */
  elbow: number;
  /** Поворот предплечья вокруг своей оси, градусы: + супинация. 0 — большой палец вперёд (рука висит). */
  proSup: number;
  /** Угол вальгуса локтя, градусы: у детей 5–15°. */
  carrying: number;
}

export interface BodyPose {
  /** Наклон туловища вперёд (+), градусы. */
  trunkPitch: number;
  /** Наклон туловища вправо (+), градусы. */
  trunkRoll: number;
  right: ArmAngles;
  left: ArmAngles;
}

export function hangingArm(): ArmAngles {
  return { plane: 0, elevation: 0, axial: 0, elbow: 0, proSup: 0, carrying: 0 };
}

export function uprightPose(): BodyPose {
  return { trunkPitch: 0, trunkRoll: 0, right: hangingArm(), left: hangingArm() };
}

/** Размеры ребёнка ~9 лет, метры. Свои, не из симулятора; на углы влияют только через ускорения. */
const DIM = {
  shoulderHalf: 0.12,
  shoulderUp: 0.3,
  sternum: [0, 0.08, 0.2] as V,
  humerus: 0.22,
  upperSensorAlong: 0.11,
  upperSensorOut: 0.035,
  foreSensorAlong: 0.15,
  foreSensorOut: 0.025,
};

const X: V = [1, 0, 0];
const Y: V = [0, 1, 0];
const DOWN: V = [0, 0, -1];

/** Оси датчика в осях сегмента (столбцы). Правая рука: Z — вправо (наружу), левая — влево. */
export const MOUNT: Record<'trunk' | 'arm_r' | 'arm_l', Q> = {
  trunk: qFromAxes([0, 0, -1], [-1, 0, 0], [0, 1, 0]),
  arm_r: qFromAxes([0, 0, -1], [0, 1, 0], [1, 0, 0]),
  arm_l: qFromAxes([0, 0, -1], [0, -1, 0], [-1, 0, 0]),
};

export interface Segments {
  trunk: Q;
  upper_r: Q;
  fore_r: Q;
  upper_l: Q;
  fore_l: Q;
}

export interface SensorKin {
  /** Поворот «оси датчика → оси мира» без перекоса крепления. */
  q: Q;
  /** Положение датчика в мире, метры. */
  p: V;
}

function trunkQ(pose: BodyPose): Q {
  // Вперёд: ось Z туловища наклоняется к +Y — поворот вокруг X на −угол; вправо — вокруг Y на +угол
  return qMul(qAxis(X, -pose.trunkPitch * RAD), qAxis(Y, pose.trunkRoll * RAD));
}

function armQ(trunk: Q, side: ArmSide, a: ArmAngles): { upper: Q; fore: Q } {
  const lat = side === 'right' ? 1 : -1;
  const pl = a.plane * RAD;
  // Направление подъёма в горизонтальной плоскости туловища; ось поворота (−Z) × d
  const d: V = [lat * Math.sin(pl), Math.cos(pl), 0];
  const swing = qAxis([d[1], -d[0], 0], a.elevation * RAD);
  // Поворот плеча наружу: вокруг оси кости (−Z в осях плеча), у левой руки — зеркально
  const axial = qAxis(DOWN, lat * a.axial * RAD);
  const upper = qMul(trunk, qMul(swing, axial));
  // Шарнир локтя: ось +X плеча, сгибание ведёт предплечье вперёд у обеих рук
  const hinge = qAxis(X, a.elbow * RAD);
  // Вальгус: предплечье при прямой руке отклонено наружу
  const carry = qAxis(Y, -lat * a.carrying * RAD);
  // Супинация — поворот вокруг оси предплечья к кисти (−Z): у правой руки +, у левой −
  const proSup = qAxis(DOWN, lat * a.proSup * RAD);
  const fore = qMul(upper, qMul(hinge, qMul(carry, proSup)));
  return { upper, fore };
}

export function segments(pose: BodyPose): Segments {
  const trunk = trunkQ(pose);
  const r = armQ(trunk, 'right', pose.right);
  const l = armQ(trunk, 'left', pose.left);
  return { trunk, upper_r: r.upper, fore_r: r.fore, upper_l: l.upper, fore_l: l.fore };
}

/** Поворот и положение каждого датчика (без перекоса крепления — его добавляет генератор). */
export function sensorKinematics(pose: BodyPose): Record<SensorPlace, SensorKin> {
  const s = segments(pose);
  const out = {} as Record<SensorPlace, SensorKin>;
  out.trunk = { q: qMul(s.trunk, MOUNT.trunk), p: qRot(s.trunk, DIM.sternum) };
  for (const side of ['right', 'left'] as const) {
    const lat = side === 'right' ? 1 : -1;
    const upperQ = side === 'right' ? s.upper_r : s.upper_l;
    const foreQ = side === 'right' ? s.fore_r : s.fore_l;
    const mount = side === 'right' ? MOUNT.arm_r : MOUNT.arm_l;
    const shoulder = qRot(s.trunk, [lat * DIM.shoulderHalf, 0, DIM.shoulderUp]);
    const upperP = vAdd(shoulder, qRot(upperQ, [lat * DIM.upperSensorOut, 0, -DIM.upperSensorAlong]));
    const elbow = vAdd(shoulder, qRot(upperQ, [0, 0, -DIM.humerus]));
    const foreP = vAdd(elbow, qRot(foreQ, [lat * DIM.foreSensorOut, 0, -DIM.foreSensorAlong]));
    const u = side === 'right' ? 'upper_r' : 'upper_l';
    const f = side === 'right' ? 'fore_r' : 'fore_l';
    out[u] = { q: qMul(upperQ, mount), p: upperP };
    out[f] = { q: qMul(foreQ, mount), p: foreP };
  }
  return out;
}

/** Углы эталона: считаются по положению костей в мире, а не берутся из входных параметров. */
export interface ArmTruth {
  /** Подъём плеча относительно вертикали мира (0 — висит вниз). */
  elevationWorld: number;
  /** Подъём плеча относительно туловища — клиническое определение. */
  elevationThorax: number;
  /** Сгибание локтя — поворот в шарнире (то, что меряет гониометр). */
  elbowHinge: number;
  /** Угол между осями плеча и предплечья в пространстве. */
  elbow3d: number;
  /** Подъём предплечья от вертикали мира. */
  foreElevation: number;
  /** Поворот предплечья, + супинация. */
  proSup: number;
}

export interface BodyTruth {
  /** Наклон туловища от вертикали мира. */
  trunkTilt: number;
  right: ArmTruth;
  left: ArmTruth;
}

export function truth(pose: BodyPose): BodyTruth {
  const s = segments(pose);
  const trunkDown = qRot(s.trunk, DOWN);
  const arm = (upper: Q, fore: Q, a: ArmAngles): ArmTruth => {
    const hum = qRot(upper, DOWN);
    const fa = qRot(fore, DOWN);
    return {
      elevationWorld: vAngleDeg(hum, DOWN),
      elevationThorax: vAngleDeg(hum, trunkDown),
      elbowHinge: a.elbow,
      elbow3d: vAngleDeg(hum, fa),
      foreElevation: vAngleDeg(fa, DOWN),
      proSup: a.proSup,
    };
  };
  return {
    trunkTilt: vAngleDeg(trunkDown, DOWN),
    right: arm(s.upper_r, s.fore_r, pose.right),
    left: arm(s.upper_l, s.fore_l, pose.left),
  };
}

export { Q_ID };
