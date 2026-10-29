// Тело ребёнка для рисунков NeuroMove — одна геометрия на все экраны.
//
// Пропорции — ребёнок лет восьми, сидит на табурете: голова крупнее взрослой, рука от плеча
// до кончиков пальцев примерно равна корпусу от таза до плеча. Единица — условная: корпус
// (таз → плечевой сустав) = 80. Сегменты — сужающиеся капсулы (geometry.taper): их можно
// обвести одним общим контуром без швов на суставах (Ink.tsx, InkLayer).
//
// Два вида:
//  • сбоку (лицом вправо) — подъём руки вперёд, локоть, наклон корпуса;
//  • спереди — отведение руки в сторону и схема датчиков. Правая сторона пациента —
//    слева от зрителя, как на врачебных схемах.

import { at, capsule, circle, lerp, pod, roundedPoly, screenAngle, taper, type Dir, type P } from './geometry';

export const SIDE = {
  /** Таз → верх корпуса. */
  trunk: 82,
  /** Таз → плечевой сустав: на 12 ниже верха корпуса — рука выходит из плеча, а не из шеи. */
  shoulder: 70,
  trunkW: [29, 26] as const,
  headR: 17,
  upper: 44,
  upperW: [16, 12.5] as const,
  fore: 36,
  foreW: [12.5, 10] as const,
  hand: 13,
  handW: 10.5,
  thigh: 62,
  thighW: [23, 17] as const,
  shin: 58,
  shinW: [16, 11] as const,
  foot: 18,
  footW: 10,
} as const;

/** Положение руки: подъём плеча и предплечья от «вниз», градусы (абсолютные, не в суставе). */
export interface ArmPose {
  upper: number;
  fore: number;
}

/** Рука из плечевого сустава: плечо, предплечье, кисть — три сегмента. */
export function armParts(shoulder: P, pose: ArmPose, dir: Dir = 1, scale = 1) {
  const s = SIDE;
  const elbow = at(shoulder, s.upper * scale, pose.upper, dir);
  const wrist = at(elbow, s.fore * scale, pose.fore, dir);
  const tip = at(wrist, s.hand * scale, pose.fore, dir);
  const d =
    taper(shoulder, elbow, s.upperW[0] * scale, s.upperW[1] * scale) +
    taper(elbow, wrist, s.foreW[0] * scale, s.foreW[1] * scale) +
    capsule(wrist, tip, s.handW * scale);
  return { elbow, wrist, tip, d };
}

/** Плечевой сустав сбоку: ниже верха корпуса и чуть впереди оси — центр шкал подъёма руки. */
export function sideShoulder(hip: P, lean = 0): P {
  return at(at(hip, SIDE.shoulder, 180 + lean), 2, 90 + lean);
}

export interface SideParts {
  hip: P;
  shoulder: P;
  elbow: P;
  wrist: P;
  tip: P;
  head: P;
  stool: string;
  body: string;
  /** Ближняя рука — та, что измеряется: рисуется поверх тела. */
  arm: string;
  /** Дальняя рука — за корпусом (для сравнения двух рук). */
  far: string;
  pods: { upper: string; fore: string; trunk: string };
  straps: { upper: string; fore: string; trunk: string };
  podCenters: { upper: P; fore: P; trunk: P };
}

/**
 * Тело сбоку. hip — тазобедренный сустав, lean — наклон корпуса назад, °.
 * legs: false — без голеней (компактные картинки в карточках): видно бедро на табурете,
 * и этого хватает, чтобы понять, где у ребёнка перед.
 */
export function sideParts(hip: P, lean: number, near: ArmPose, opts: { legs?: boolean; far?: ArmPose | null } = {}): SideParts {
  const s = SIDE;
  const legs = opts.legs ?? true;
  // Ось корпуса — от таза вверх, наклон назад (от руки, влево по экрану)
  const base = at(hip, 3, 180 + lean);
  const top = at(hip, s.trunk, 180 + lean);
  const shoulder = sideShoulder(hip, lean);
  const neckTop = at(hip, s.trunk + 20, 180 + lean);
  const headC = at(hip, s.trunk + 33, 180 + lean);
  // Голова чуть позади оси: поднятая вперёд рука проходит перед лицом, а не сквозь него
  const head = { x: headC.x - 4, y: headC.y };

  const knee = { x: hip.x + s.thigh, y: hip.y + 1 };
  const ankle = { x: knee.x + 1, y: knee.y + s.shin };
  let body = taper(base, top, s.trunkW[0], s.trunkW[1]) + capsule(top, neckTop, 13.5) + circle(head, s.headR);
  if (legs) {
    body +=
      taper(hip, knee, s.thighW[0], s.thighW[1]) +
      taper(knee, ankle, s.shinW[0], s.shinW[1]) +
      capsule({ x: ankle.x - 1, y: ankle.y + 2.5 }, { x: ankle.x + s.foot, y: ankle.y + 3 }, s.footW);
  } else {
    body += taper(hip, { x: hip.x + s.thigh - 16, y: hip.y + 0.6 }, s.thighW[0], 19);
  }

  // Табурет: сиденье под тазом и бёдрами, ножки до пола
  const seatY = hip.y + s.thighW[0] / 2;
  const floor = ankle.y + 3 + s.footW / 2;
  let stool = roundedPoly(
    [
      { x: hip.x - 26, y: seatY },
      { x: hip.x + 28, y: seatY },
      { x: hip.x + 28, y: seatY + 6 },
      { x: hip.x - 26, y: seatY + 6 },
    ],
    2,
  );
  if (legs) {
    for (const lx of [hip.x - 20, hip.x + 22]) {
      stool += roundedPoly(
        [
          { x: lx - 2, y: seatY + 5 },
          { x: lx + 2, y: seatY + 5 },
          { x: lx + 2.6, y: floor },
          { x: lx - 2.6, y: floor },
        ],
        1,
      );
    }
  }

  const arm = armParts(shoulder, near);
  const far = opts.far ? armParts(shoulder, opts.far).d : '';

  // Датчики: середина плеча, две трети предплечья, грудина — на передней поверхности корпуса
  const upperC = lerp(shoulder, arm.elbow, 0.5);
  const foreC = lerp(arm.elbow, arm.wrist, 0.62);
  const chest = lerp(base, top, 0.66);
  const trunkRot = screenAngle(base, top);
  const front = at(chest, (s.trunkW[0] + s.trunkW[1]) / 4, 90 + lean);
  return {
    hip,
    shoulder,
    elbow: arm.elbow,
    wrist: arm.wrist,
    tip: arm.tip,
    head,
    stool,
    body,
    arm: arm.d,
    far,
    pods: {
      upper: pod(upperC, 13, 9, screenAngle(shoulder, arm.elbow)),
      fore: pod(foreC, 12, 8, screenAngle(arm.elbow, arm.wrist)),
      // Датчик на груди сбоку виден ребром: короткий корпус на передней стенке
      trunk: pod(front, 13, 6, trunkRot, 1.8),
    },
    straps: {
      upper: pod(upperC, 6, s.upperW[0] + 2, screenAngle(shoulder, arm.elbow), 1.4),
      fore: pod(foreC, 6, s.foreW[0] + 2, screenAngle(arm.elbow, arm.wrist), 1.4),
      // Ремешок поперёк корпуса: тонкий вдоль оси, на всю глубину груди
      trunk: pod(chest, 5.5, (s.trunkW[0] + s.trunkW[1]) / 2 + 2, trunkRot, 1.4),
    },
    podCenters: { upper: upperC, fore: foreC, trunk: front },
  };
}

// ── Вид спереди ─────────────────────────────────────────────────────────────

export const FRONT = {
  trunk: 80,
  shoulderX: 24,
  headR: 18,
} as const;

export interface FrontPose {
  /** Отведение правой и левой руки от «вдоль тела», °. */
  right: ArmPose;
  left: ArmPose;
  /** Наклон корпуса в сторону, ° (плюс — вправо от зрителя). */
  lean?: number;
}

export type FrontPodKey = 'trunk' | 'upper_r' | 'upper_l' | 'fore_r' | 'fore_l';

export interface FrontParts {
  hip: P;
  top: P;
  shoulders: { right: P; left: P };
  elbows: { right: P; left: P };
  wrists: { right: P; left: P };
  tips: { right: P; left: P };
  head: P;
  stool: string;
  body: string;
  arms: { right: string; left: string };
  pods: Record<FrontPodKey, { d: string; strap: string; c: P }>;
}

/**
 * Тело спереди: center — середина таза. Правая рука пациента — слева от зрителя (dir −1).
 * legs: сидит на табурете, бёдра направлены на зрителя — видны коротко, торцом.
 */
export function frontParts(center: P, pose: FrontPose, opts: { legs?: boolean } = {}): FrontParts {
  const legs = opts.legs ?? true;
  const lean = pose.lean ?? 0;
  const hip = center;
  const top = at(hip, FRONT.trunk, 180 - lean, 1);
  const dx = top.x - hip.x;
  // Корпус — трапеция со скруглениями: плечи шире таза; у ребёнка без «талии»
  const torso = roundedPoly(
    [
      { x: top.x - 31, y: top.y - 9 },
      { x: top.x + 31, y: top.y - 9 },
      { x: hip.x + 23 + dx * 0.2, y: hip.y + 9 },
      { x: hip.x - 23 + dx * 0.2, y: hip.y + 9 },
    ],
    [14, 14, 9, 9],
  );
  // Шея у ребёнка короткая: голова сидит почти на плечах
  const neckTop = { x: top.x, y: top.y - 20 };
  const head = { x: top.x, y: top.y - 34 };
  let body = torso + capsule({ x: top.x, y: top.y - 6 }, neckTop, 15) + circle(head, FRONT.headR);

  const legX = 12;
  const floor = hip.y + 76;
  if (legs) {
    for (const sx of [-1, 1]) {
      const kx = hip.x + sx * legX;
      // Бедро смотрит на зрителя — видно торцом: короткая широкая капсула; голень — до пола
      body += capsule({ x: kx, y: hip.y + 4 }, { x: kx + sx * 1, y: hip.y + 16 }, 21);
      body += taper({ x: kx + sx * 1, y: hip.y + 20 }, { x: kx + sx * 1.5, y: floor - 9 }, 15, 11);
      body += capsule({ x: kx + sx * 1.5, y: floor - 5.5 }, { x: kx + sx * 3.5, y: floor - 4 }, 11);
    }
  }
  const seatY = hip.y + 11;
  let stool = roundedPoly(
    [
      { x: hip.x - 36, y: seatY },
      { x: hip.x + 36, y: seatY },
      { x: hip.x + 36, y: seatY + 6 },
      { x: hip.x - 36, y: seatY + 6 },
    ],
    2,
  );
  if (legs) {
    for (const lx of [hip.x - 31, hip.x + 31]) {
      stool += roundedPoly(
        [
          { x: lx - 2, y: seatY + 5 },
          { x: lx + 2, y: seatY + 5 },
          { x: lx + 2.6, y: floor },
          { x: lx - 2.6, y: floor },
        ],
        1,
      );
    }
  }

  const shR = { x: top.x - FRONT.shoulderX, y: top.y + 2 };
  const shL = { x: top.x + FRONT.shoulderX, y: top.y + 2 };
  const r = armParts(shR, pose.right, -1);
  const l = armParts(shL, pose.left, 1);

  const podOn = (a: P, b: P, k: number, len: number, limbW: number) => {
    const c = lerp(a, b, k);
    const rot = screenAngle(a, b);
    return { d: pod(c, len, limbW - 3.5, rot), strap: pod(c, 6, limbW + 2, rot, 1.4), c };
  };
  const chest = lerp(hip, top, 0.58);
  const across = screenAngle(hip, top) + 90;
  return {
    hip,
    top,
    shoulders: { right: shR, left: shL },
    elbows: { right: r.elbow, left: l.elbow },
    wrists: { right: r.wrist, left: l.wrist },
    tips: { right: r.tip, left: l.tip },
    head,
    stool,
    body,
    arms: { right: r.d, left: l.d },
    pods: {
      trunk: { d: pod(chest, 16, 11, across), strap: pod(chest, 50, 6, across, 2), c: chest },
      upper_r: podOn(shR, r.elbow, 0.5, 12, SIDE.upperW[0]),
      upper_l: podOn(shL, l.elbow, 0.5, 12, SIDE.upperW[0]),
      fore_r: podOn(r.elbow, r.wrist, 0.62, 11, SIDE.foreW[0]),
      fore_l: podOn(l.elbow, l.wrist, 0.62, 11, SIDE.foreW[0]),
    },
  };
}
