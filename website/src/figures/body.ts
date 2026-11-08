// Тело ребёнка для рисунков NeuroMove — одна геометрия на все экраны.
//
// Пропорции — ребёнок лет восьми, сидит на табурете: голова крупнее взрослой, рука от плеча
// до кончиков пальцев примерно равна корпусу от таза до плеча. Единица — условная: корпус
// (таз → плечевой сустав) = 70. Каждая часть тела — рисованный контур (geometry.smooth)
// в своей системе координат: плечо с дельтой и бицепсом, предплечье, сужающееся к запястью,
// кисть с большим пальцем, голова с профилем. Система координат поворачивается вместе
// с сегментом, поэтому форма одна в любой позе, а живая фигурка (StickFigure) перестраивает
// её 60 раз в секунду. Части одного слоя сливаются в один силуэт без швов (Ink.tsx, InkLayer).
//
// Два вида:
//  • сбоку (лицом вправо) — подъём руки вперёд, локоть, наклон корпуса;
//  • спереди — отведение руки в сторону и схема датчиков. Правая сторона пациента —
//    слева от зрителя, как на врачебных схемах.
//
// Датчики стоят как на прототипе (прототип.md, «Где носить»; корпус — hardware/models/enclosure):
//  • грудь — на грудине по центру, на ремне вокруг груди; корпус стоит «портретом»,
//    ось X вертикально, стрелка вниз;
//  • плечо — наружная сторона, посередине между плечевым суставом и локтем;
//  • предплечье — тыльная сторона, ближе к запястью.
// Корпус 36 × 28 мм: длинная сторона — вдоль кости, ремешок проходит через прорези
// в «ушках» основания по бокам и обнимает руку поперёк. Сбоку наружная сторона плеча
// и тыл предплечья смотрят на зрителя — датчик виден целиком; спереди он сидит на наружном
// крае руки и виден в три четверти.

import {
  at,
  band,
  frontFrame,
  rectIn,
  roundedPoly,
  segFrame,
  shift,
  smooth,
  stroke,
  trunkFrame,
  type Dir,
  type Frame,
  type P,
  type Pt,
} from './geometry';

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
  foreW: [12.5, 9.4] as const,
  /** Запястье → середина кисти; кончики пальцев — ещё на handW / 2 дальше. */
  hand: 13,
  handW: 10.5,
  thigh: 62,
  thighW: [23, 17] as const,
  shin: 58,
  shinW: [16, 11] as const,
  foot: 18,
  footW: 10,
} as const;

// ── Контуры частей тела ─────────────────────────────────────────────────────
// Рука: u — вперёд (сбоку: к большому пальцу) или наружу (спереди), v — от сустава вдоль кости.

/**
 * Плечо сбоку: дельта над суставом, бицепс спереди, трицепс сзади, локоть. Со стороны
 * подмышки контур сужается: поднятая рука уходит в плечо, а не торчит «колбаской» из груди.
 */
const UPPER_SIDE: Pt[] = [
  [0.8, -8],
  [5.6, -6.2],
  [8.1, -1.2],
  [8.3, 7.5],
  [7.1, 16.5],
  [7.5, 26],
  [6.7, 36],
  [6.0, 43],
  [3.8, 48.4],
  [-1.4, 50.2],
  [-5.6, 47.8],
  [-6.5, 40],
  [-7.6, 28],
  [-8.2, 15],
  [-7.6, 5.6],
  [-5.6, -2.2],
  [-2.6, -6.6],
];

/** Предплечье сбоку: мышцы у локтя, сужение к запястью. */
const FORE_SIDE: Pt[] = [
  [-5.6, -4.4],
  [-6.1, 4],
  [-5.7, 14],
  [-4.9, 26],
  [-4.5, 33],
  [-4.6, 37.6],
  [4.6, 37.6],
  [4.7, 30],
  [5.8, 18],
  [6.7, 7],
  [6.3, -1.2],
  [3, -5.6],
];

/** Кисть сбоку (тыльной стороной к зрителю): пальцы чуть согнуты, большой палец впереди. */
const HAND_SIDE: Pt[] = [
  [-4.5, -1.2],
  [-4.9, 5],
  [-4.7, 10.4],
  [-3.8, 14.6],
  [-1.6, 17.6],
  [1.0, 18.3],
  [3.0, 16.9],
  [3.9, 13.6],
  [4.6, 11.4],
  [6.2, 10.7],
  [6.9, 8.2],
  [6.0, 4.8],
  [4.6, 1.6],
  [4.5, -1.2],
];

/** Плечо спереди: дельта снаружи, гладкая внутренняя сторона. */
const UPPER_FRONT: Pt[] = [
  [0, -7.2],
  [5.4, -6.2],
  [8.4, -1.4],
  [8.5, 7],
  [7.5, 16],
  [6.8, 26],
  [6.4, 36],
  [6.3, 43],
  [4.1, 48.2],
  [-1.4, 49.4],
  [-5.5, 46.4],
  [-5.9, 38],
  [-6.3, 26],
  [-6.5, 14],
  [-6.7, 4],
  [-5.6, -3.8],
  [-3.4, -6.6],
];

/** Предплечье спереди: плечелучевая мышца снаружи у локтя. */
const FORE_FRONT: Pt[] = [
  [-5.5, -3.8],
  [-5.6, 6],
  [-5.0, 16],
  [-4.2, 28],
  [-3.8, 37.6],
  [4.0, 37.6],
  [4.4, 30],
  [5.6, 18],
  [6.6, 6],
  [6.2, -1.6],
  [3, -5.2],
];

/** Кисть спереди: ладонь смотрит на бедро — видна ребром, пальцы чуть подогнуты внутрь. */
const HAND_FRONT: Pt[] = [
  [-3.5, -0.8],
  [-3.7, 5.4],
  [-3.3, 11.4],
  [-2.1, 15.6],
  [-0.2, 17.8],
  [1.6, 17],
  [2.8, 13.6],
  [3.5, 8.6],
  [3.8, 3],
  [3.7, -0.8],
];

/** Положение руки: подъём плеча и предплечья от «вниз», градусы (абсолютные, не в суставе). */
export interface ArmPose {
  upper: number;
  fore: number;
}

export type View = 'side' | 'front';

/** Рука из плечевого сустава: плечо, предплечье, кисть — три рисованных контура. */
export function armParts(shoulder: P, pose: ArmPose, dir: Dir = 1, scale = 1, view: View = 'side') {
  const s = SIDE;
  const elbow = at(shoulder, s.upper * scale, pose.upper, dir);
  const wrist = at(elbow, s.fore * scale, pose.fore, dir);
  const tip = at(wrist, s.hand * scale, pose.fore, dir);
  const U = segFrame(shoulder, pose.upper, dir, scale);
  const Fo = segFrame(elbow, pose.fore, dir, scale);
  const front = view === 'front';
  const d =
    smooth(front ? UPPER_FRONT : UPPER_SIDE, U) +
    smooth(front ? FORE_FRONT : FORE_SIDE, Fo) +
    smooth(front ? HAND_FRONT : HAND_SIDE, segFrame(wrist, pose.fore, dir, scale));
  return { elbow, wrist, tip, d, frames: { upper: U, fore: Fo } };
}

/** Полутолщина руки в точке v сегмента — чтобы ремешок доходил ровно до края. */
const UPPER_HALF = (k: number) => 7.9 - 1.6 * k;
const FORE_HALF = (k: number) => 6.1 - 1.4 * k;

// ── Датчик: корпус на ремешке ───────────────────────────────────────────────

export interface PodShape {
  /** Крышка корпуса. */
  d: string;
  /** Основание с «ушками» под ремешок. */
  base: string;
  /** Ремешок вокруг конечности или груди. */
  strap: string;
  /** Стрелка оси X на крышке (к кисти; на груди — вниз). */
  mark: string;
  /** Центр крышки — там светодиод. */
  c: P;
}

/** Корпус в системе координат сегмента: длинная сторона — вдоль кости. */
function limbPod(F: Frame, v: number, half: number, view: View): PodShape {
  // Сбоку датчик смотрит на зрителя; спереди — сидит на наружном крае и повёрнут на три четверти.
  // Спереди рисунок — схема датчиков на 200–300 px: корпус крупнее на 15%, чтобы читались
  // светодиод и стрелка; сбоку — в натуральную величину относительно руки.
  const front = view === 'front';
  const k = front ? 1.15 : 1;
  const u = front ? half * 0.42 : 0;
  const across = (front ? 5.4 : 6.6) * k;
  const along = 9 * k;
  return {
    d: rectIn(F, u, v, across, along, 1.9 * k),
    base: rectIn(F, u + (front ? 0.5 : 0), v + 0.2, front ? 7.6 * k : Math.min(10.2, 2 * half - 2.2), 7.4 * k, 1.6),
    strap: band(F, v + 0.2, half, 5.6 * k, front ? 0.9 : 0.5),
    mark: arrow(F, u, v + 1.4 * k, 1),
    c: F(u, v - 1.6 * k),
  };
}

/** Стрелка-шеврон на крышке: в системе F, в точке (u, v), остриё — по +v (dirV 1) или −v. */
function arrow(F: Frame, u: number, v: number, dirV: 1 | -1): string {
  const a = F(u - 1.3, v - 0.9 * dirV);
  const b = F(u, v + 0.7 * dirV);
  const c = F(u + 1.3, v - 0.9 * dirV);
  return `M${a.x.toFixed(2)},${a.y.toFixed(2)}L${b.x.toFixed(2)},${b.y.toFixed(2)}L${c.x.toFixed(2)},${c.y.toFixed(2)}`;
}

// ── Вид сбоку ───────────────────────────────────────────────────────────────
// Корпус: u — вперёд, v — вверх от тазобедренного сустава.

const TORSO_SIDE: Pt[] = [
  [5.4, 97],
  [5.1, 88],
  [5.8, 80.4],
  [9.6, 75.6],
  [13.2, 66],
  [14.7, 54],
  [14.4, 42],
  [13.7, 31],
  [14.5, 19],
  [13.8, 7],
  [9.5, -3],
  [0, -11.4],
  [-9.6, -10.4],
  [-14.4, -3],
  [-15.1, 8],
  [-13.1, 22],
  [-12.7, 34],
  [-14, 48],
  [-15, 60],
  [-13.4, 70.5],
  [-12.1, 78],
  [-10.9, 87],
  [-11.9, 96.4],
  [-4, 103],
];

/** Голова в профиль, центр черепа — (0, 0): крупный свод, маленькое лицо, короткий нос. */
const HEAD_SIDE: Pt[] = [
  [0, 17.6],
  [9.4, 14.6],
  [14.4, 7.2],
  [15.6, 1.4],
  [15.2, -1.6],
  [17.2, -5.1],
  [15.3, -7.2],
  [15.4, -9.6],
  [13.6, -12.8],
  [10.4, -15.5],
  [5, -15.3],
  [-2, -12.9],
  [-9, -12.6],
  [-14.5, -8],
  [-17, 1],
  [-14.1, 11.5],
  [-8, 16.5],
];

/** Волосы сбоку: короткая стрижка, линия роста над ухом и на лбу. */
const HAIR_SIDE: Pt[] = [
  [13.8, 8.4, 1],
  [12.6, 11.6],
  [14.4, 13.2, 1],
  [10.6, 17.4],
  [1, 21],
  [-9.8, 19.4],
  [-15.6, 12],
  [-18.2, 1.4],
  [-16.2, -7.6],
  [-12.4, -10, 1],
  [-11.2, -4],
  [-8.8, 1.8],
  [-5.4, 6.6],
  [1.2, 8.6],
  [7.4, 8.9],
];

/** Хвост на затылке — за головой, резинка у основания. */
const PONYTAIL_SIDE: Pt[] = [
  [-12.6, 9.6],
  [-18.6, 8.6],
  [-23, 2],
  [-24.4, -8],
  [-23.2, -18],
  [-20.6, -25, 1],
  [-19.4, -16],
  [-18.2, -6],
  [-15.6, -0.6],
  [-12, 2],
]

/** Ухо сбоку — штрих внутри силуэта головы. */
const EAR_SIDE: Pt[] = [
  [-1.4, 2.8],
  [-5.4, 3.6],
  [-6.9, -0.8],
  [-5.2, -4.6],
  [-1.9, -6.1],
];

/** Ноги сбоку: бедро на сиденье, колено, голень до пола, стопа. Пол — на 67 ниже таза. */
const LEG_SIDE: Pt[] = [
  [-6, -10],
  [10, -11.6],
  [30, -10.8],
  [50, -9.2],
  [60.4, -8],
  [66.4, -4.5],
  [68.5, 2],
  [67.3, 10],
  [66.5, 24],
  [66.1, 40],
  [65.6, 51],
  [66.3, 57.6],
  [70.4, 60.4],
  [77.8, 62.4],
  [82.4, 63.9],
  [83.9, 65.6],
  [82, 67, 1],
  [60.2, 67, 1],
  [57.7, 64.6],
  [57.5, 59.4],
  [58.4, 50],
  [57, 36],
  [55.4, 24],
  [55.6, 16],
  [52.4, 11.6],
  [36, 11.7],
  [14, 11.8],
  [-4, 11.5],
];

/** Только бедро до колена — для компактных картинок. */
const THIGH_SIDE: Pt[] = [
  [-6, -10],
  [10, -11.6],
  [30, -10.8],
  [46, -9.4],
  [54.6, -7.6],
  [59.6, -2],
  [60, 5],
  [56.2, 10.6],
  [46, 11.7],
  [14, 11.8],
  [-4, 11.5],
];


// ── Одежда: белая футболка, тёмные шорты, белые носки и кроссовки ──────────
// Как на референсе стиля NeuroMove (8 ноября 2026): человек в простой спортивной одежде,
// датчики — на голой коже под коротким рукавом. Рукав заканчивается выше датчика плеча.

/** Футболка сбоку (система корпуса): круглый ворот, подол на бёдрах. */
const SHIRT_SIDE: Pt[] = [
  [6.6, 84.4],
  [10.6, 76.2],
  [14.3, 66],
  [15.7, 54],
  [15.5, 42],
  [14.9, 30],
  [15.5, 18],
  [15.3, 7],
  [14.6, 1.6, 1],
  [-15.9, 2.6, 1],
  [-16, 9],
  [-14.1, 22],
  [-13.7, 34],
  [-15, 48],
  [-16, 60],
  [-14.5, 71],
  [-13, 79.4],
  [-10.8, 84.2],
  [-2.2, 85.6],
];

/** Шорты сбоку (неподвижная система от таза): закрывают ягодицы и две трети бедра. */
const SHORTS_SIDE: Pt[] = [
  [-15.2, -6],
  [-15.9, 3],
  [-13.2, 9.4],
  [-8, 12],
  [14, 12.3],
  [39.4, 12.4, 1],
  [40.8, 5],
  [40, -11.5, 1],
  [30, -11.6],
  [12, -12.3],
  [3, -10.6],
  [-6, -8.4],
];

/** Носок сбоку: от середины голени до кроссовка. */
const SOCK_SIDE: Pt[] = [
  [58.1, 44, 1],
  [66.6, 44, 1],
  [66.6, 57],
  [57.4, 57],
];

/** Кроссовок сбоку: подошва на полу. */
const SHOE_SIDE: Pt[] = [
  [65.4, 54.6],
  [70.8, 58.4],
  [78.6, 60.4],
  [83.6, 62.2],
  [85.6, 64.6],
  [84.8, 67, 1],
  [58.8, 67, 1],
  [56.4, 65],
  [56.5, 59.4],
  [57.8, 54.8],
  [61.6, 53.6],
];

/** Короткий рукав (система плеча): от плечевого сустава до трети плеча — датчик ниже. */
const SLEEVE_SIDE: Pt[] = [
  [1, -9.4],
  [6.6, -7.2],
  [9.3, -1.2],
  [9.7, 8],
  [9.5, 15.4, 1],
  [-9.5, 14.4, 1],
  [-9.2, 6],
  [-7, -2.8],
  [-3, -7.9],
];

const SLEEVE_FRONT: Pt[] = [
  [0, -6.6],
  [6, -5.8],
  [9.6, -1],
  [9.8, 7],
  [9.4, 15.4, 1],
  [-8.2, 14.6, 1],
  [-7.8, 6],
  [-7.2, -4],
  [-4.2, -8.2],
];

/** Лицо сбоку (система головы): открытый круглый глаз и мягкая бровь — заливкой цвета волос. */
const FACE_SIDE = (H: Frame) =>
  smooth([[10.4, 0.8], [11.3, 2.1], [12.3, 0.9], [11.4, -0.5]], H) +
  smooth([[8.2, 4.3], [10.6, 5.5], [13, 5.1], [12.9, 4.5], [10.6, 4.8]], H);
/** Ресницы у внешнего угла глаза — у девочки. */
const LASH_SIDE = (H: Frame) => smooth([[12, 1.3], [13.3, 2.4, 1], [12.4, 0.5]], H);
const LASH_FRONT = (H: Frame) => [-1, 1].map((k) => smooth([[k * 6.6, 1.4], [k * 8.1, 2.4, 1], [k * 7, 0.5]], H)).join('');

const MOUTH_SIDE: Pt[] = [
  [13.6, -10],
  [14.9, -9.7],
];

/** Лицо спереди: открытые круглые глаза и мягко изогнутые брови — заливкой; нос и рот — штрихами. */
const FACE_FRONT = (H: Frame) =>
  [-1, 1]
    .map(
      (k) =>
        smooth([[k * 4.4, 0.7], [k * 5.7, 2.2], [k * 7, 0.7], [k * 5.7, -0.9]], H) +
        smooth([[k * 3.6, 4.3], [k * 5.6, 5.6], [k * 7.9, 5], [k * 7.8, 4.4], [k * 5.6, 4.9], [k * 3.7, 3.8]], H),
    )
    .join('');
const NOSE_MOUTH_FRONT = (H: Frame) =>
  stroke([[0.5, -1.8], [1.1, -4.4], [-0.2, -5.1]], H) + stroke([[-2.4, -8.9], [0, -9.9], [2.4, -8.9]], H);

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
  /** Тень на полу под табуретом и ногами. */
  floor: string;
  body: string;
  /** Волосы — отдельным слоем поверх головы. */
  hair: string;
  /** Длинные волосы за головой (хвост сбоку, до плеч спереди) — у девочки. */
  hairBack: string;
  /** Ресницы — у девочки. */
  lashes: string;
  /** Штрихи внутри силуэта: ухо, подошва. */
  lines: string;
  /** Лицо: бровь, глаз, губы. */
  face: string;
  shirt: string;
  shorts: string;
  socks: string;
  shoes: string;
  /** Ближняя рука — та, что измеряется: рисуется поверх тела. */
  arm: string;
  /** Рукав футболки на ближней руке. */
  sleeve: string;
  /** Дальняя рука — за корпусом (для сравнения двух рук). */
  far: string;
  farSleeve: string;
  pods: { upper: string; fore: string; trunk: string };
  bases: { upper: string; fore: string; trunk: string };
  straps: { upper: string; fore: string; trunk: string };
  marks: { upper: string; fore: string; trunk: string };
  podCenters: { upper: P; fore: P; trunk: P };
}

/** Табурет сбоку: сиденье под тазом и бёдрами, ножки чуть врозь, перекладина. */
function sideStool(hip: P, legs: boolean): string {
  const seatY = hip.y + 11.6;
  const floor = hip.y + 67;
  let d = roundedPoly(
    [
      { x: hip.x - 27, y: seatY },
      { x: hip.x + 29, y: seatY },
      { x: hip.x + 29, y: seatY + 5.4 },
      { x: hip.x - 27, y: seatY + 5.4 },
    ],
    [2.4, 2.4, 1.4, 1.4],
  );
  if (!legs) return d;
  for (const [top, bot] of [
    [-20, -23.5],
    [22, 25.5],
  ] as const) {
    d += roundedPoly(
      [
        { x: hip.x + top - 1.9, y: seatY + 5 },
        { x: hip.x + top + 1.9, y: seatY + 5 },
        { x: hip.x + bot + 1.5, y: floor },
        { x: hip.x + bot - 1.5, y: floor },
      ],
      [0.6, 0.6, 1, 1],
    );
  }
  const ry = seatY + 37;
  d += roundedPoly(
    [
      { x: hip.x - 22, y: ry },
      { x: hip.x + 24, y: ry },
      { x: hip.x + 24, y: ry + 2.4 },
      { x: hip.x - 22, y: ry + 2.4 },
    ],
    1,
  );
  return d;
}

/**
 * Тело сбоку. hip — тазобедренный сустав, lean — наклон корпуса назад, °.
 * legs: false — без голеней (компактные картинки в карточках): видно бедро на табурете,
 * и этого хватает, чтобы понять, где у ребёнка перед.
 */
export function sideParts(hip: P, lean: number, near: ArmPose, opts: { legs?: boolean; far?: ArmPose | null } = {}): SideParts {
  const s = SIDE;
  const legs = opts.legs ?? true;
  const T = trunkFrame(hip, lean);
  // Голова чуть позади оси: поднятая вперёд рука проходит перед лицом, а не сквозь него
  const hc = T(-4, s.trunk + 25);
  const H = trunkFrame(hc, lean);
  const head = hc;

  const body =
    smooth(TORSO_SIDE, T) + smooth(HEAD_SIDE, H) + smooth(legs ? LEG_SIDE : THIGH_SIDE, shift(hip));
  const hair = smooth(HAIR_SIDE, H);
  const hairBack = smooth(PONYTAIL_SIDE, H);
  const S = shift(hip);
  const lines =
    stroke(EAR_SIDE, H) +
    stroke(MOUTH_SIDE, H) +
    stroke([[-11.2, 82.4], [-3, 83.8], [5.8, 82.6]], T) +
    (legs ? stroke([[56.8, 64.6], [71, 64.8], [85.4, 64.8]], S) : '');

  const shoulder = sideShoulder(hip, lean);
  const arm = armParts(shoulder, near);
  const farArm = opts.far ? armParts(shoulder, opts.far) : null;
  const far = farArm ? farArm.d : '';

  // Датчики: середина плеча снаружи, тыл предплечья ближе к запястью, грудина
  const up = limbPod(arm.frames.upper, s.upper * 0.5, UPPER_HALF(0.5), 'side');
  const fo = limbPod(arm.frames.fore, s.fore * 0.7, FORE_HALF(0.7), 'side');
  // На груди сбоку корпус виден ребром: короткий выступ на передней стенке, ремень — поперёк корпуса
  const chestV = 54;
  const chestU = 14.6;
  const trunk: PodShape = {
    d: roundedPoly([T(chestU + 0.9, chestV + 4.5), T(chestU + 3.6, chestV + 4.5), T(chestU + 3.6, chestV - 4.5), T(chestU + 0.9, chestV - 4.5)], 1.2),
    base: roundedPoly([T(chestU - 0.4, chestV + 5.4), T(chestU + 1.2, chestV + 5.4), T(chestU + 1.2, chestV - 5.4), T(chestU - 0.4, chestV - 5.4)], 0.6),
    strap: roundedPoly([T(-15.3, chestV + 4.2), T(chestU + 0.4, chestV + 4.4), T(chestU + 0.4, chestV - 4.4), T(-15.3, chestV - 4.2)], 1),
    mark: '',
    c: T(chestU + 2.25, chestV),
  };
  return {
    hip,
    shoulder,
    elbow: arm.elbow,
    wrist: arm.wrist,
    tip: arm.tip,
    head,
    stool: sideStool(hip, legs),
    floor: legs ? ellipse({ x: hip.x + 26, y: hip.y + 67.6 }, 54, 3.2) : '',
    body,
    hair,
    hairBack,
    lines,
    face: FACE_SIDE(H),
    lashes: LASH_SIDE(H),
    shirt: smooth(SHIRT_SIDE, T),
    shorts: smooth(SHORTS_SIDE, S),
    socks: legs ? smooth(SOCK_SIDE, S) : '',
    shoes: legs ? smooth(SHOE_SIDE, S) : '',
    arm: arm.d,
    sleeve: smooth(SLEEVE_SIDE, arm.frames.upper),
    far,
    farSleeve: farArm ? smooth(SLEEVE_SIDE, farArm.frames.upper) : '',
    pods: { upper: up.d, fore: fo.d, trunk: trunk.d },
    bases: { upper: up.base, fore: fo.base, trunk: trunk.base },
    straps: { upper: up.strap, fore: fo.strap, trunk: trunk.strap },
    marks: { upper: up.mark, fore: fo.mark, trunk: '' },
    podCenters: { upper: up.c, fore: fo.c, trunk: trunk.c },
  };
}

// ── Вид спереди ─────────────────────────────────────────────────────────────
// Корпус: u — вправо по экрану, v — вверх от середины таза.

export const FRONT = {
  trunk: 80,
  /** Плечевой сустав — снаружи от рёбер: опущенная рука висит вдоль груди, а не за ней. */
  shoulderX: 27.5,
  /** Масштаб руки спереди. */
  arm: 0.8,
  /** Корпус спереди по высоте: сидящий ребёнок без укороченных перспективой бёдер иначе выглядит «длинным». */
  torso: 0.88,
  headR: 18,
} as const;

/**
 * Половина корпуса спереди (правая по экрану), от шеи вниз; левая — зеркально.
 * Руки спереди рисуются под корпусом: линия плеч идёт от шеи по трапеции, а дельта руки
 * продолжает её наружу — без «шарниров» куклы над плечом.
 */
const TORSO_HALF: [number, number][] = [
  [6.6, 84.6],
  [13.6, 83.4],
  [20.6, 80.8],
  [25.4, 77.4],
  [27.2, 72],
  [25.8, 64],
  [23.8, 57.4],
  [22.6, 48],
  [21.6, 38],
  [21.2, 28],
  [22, 17],
  [23.4, 7],
  [23.2, -3],
  [17, -10.4],
  [7, -13.6],
];

const TORSO_FRONT: Pt[] = [
  [0, 85],
  ...TORSO_HALF,
  [0, -14],
  ...TORSO_HALF.map(([u, v]) => [-u, v] as const).reverse(),
];

const NECK_FRONT: Pt[] = [
  [-6.4, 80],
  [-6.2, 92],
  [-6.6, 101],
  [6.6, 101],
  [6.2, 92],
  [6.4, 80],
];

/** Голова спереди, центр — (0, 0): высокий свод, круглые щёки, небольшой подбородок. */
const HEAD_HALF: [number, number][] = [
  [8.8, 17.4],
  [14.2, 11.6],
  [16.1, 3],
  [15.6, -5],
  [13, -11.6],
  [7.6, -16.4],
];
const HEAD_FRONT: Pt[] = [[0, 18.8], ...HEAD_HALF, [0, -18.3], ...HEAD_HALF.map(([u, v]) => [-u, v] as const).reverse()];

const EAR_FRONT = (sx: 1 | -1): Pt[] => [
  [sx * 14.6, 3.2],
  [sx * 17.8, 2.6],
  [sx * 18.7, -1.8],
  [sx * 17.4, -5.8],
  [sx * 14.6, -6.2],
];

/** Волосы спереди: объём на макушке, чёлка прядями — как на референсе стиля. */
const HAIR_FRONT: Pt[] = [
  [-17.4, 0.4, 1],
  [-18.7, 5.8],
  [-17.8, 13.2],
  [-12.8, 19.6],
  [-4, 22.4],
  [5, 22.2],
  [13, 19.8],
  [18, 13.4],
  [18.9, 5.8],
  [17.4, 0.4, 1],
  [15.4, 3.6],
  [14.2, 8.6],
  [11.4, 10.8],
  [9.4, 8.2, 1],
  [7.2, 11.4],
  [3.8, 12.2],
  [1.6, 8.6, 1],
  [-0.8, 11.8],
  [-4.4, 12.4],
  [-6.8, 9, 1],
  [-9.2, 11.6],
  [-12.8, 10.4],
  [-14.6, 7.2],
  [-15.6, 3.6],
];

/** Длинные волосы спереди — за головой и шеей, до плеч: на рисунках девочка. */
const HAIR_BACK_FRONT: Pt[] = [
  [0, 21],
  [12.6, 18.4],
  [18.8, 8],
  [20.2, -6],
  [20.8, -18],
  [19.6, -26.4, 1],
  [12.4, -27.4, 1],
  [9.6, -17],
  [0, -15],
  [-9.6, -17],
  [-12.4, -27.4, 1],
  [-19.6, -26.4, 1],
  [-20.8, -18],
  [-20.2, -6],
  [-18.8, 8],
  [-12.6, 18.4],
];

/** Нога спереди (по экрану слева; правая — зеркально): бедро к зрителю, колено, голень, стопа. */
const LEG_FRONT_L: [number, number][] = [
  [-22.6, 2],
  [-22.8, -7],
  [-21.4, -14],
  [-19.2, -20.5],
  [-17.4, -26],
  [-17.6, -34],
  [-16.2, -48],
  [-14.8, -60],
  [-14.6, -66.4],
  [-16.4, -71],
  [-16.2, -75.6],
  [-11, -76.4],
  [-5.8, -75.6],
  [-5.6, -71],
  [-7.4, -66.4],
  [-7.6, -60],
  [-6.4, -48],
  [-5.2, -36],
  [-4.8, -28],
  [-3.8, -21],
  [-2.6, -14],
  [-0.8, -7],
  [-3, 1.6],
];

/** Только бёдра — короткие, торцом к зрителю. */
const KNEE_FRONT_L: [number, number][] = [
  [-23.4, 0],
  [-23.2, -8],
  [-21.4, -15],
  [-17.4, -19.4],
  [-11.6, -20.4],
  [-5.8, -19.2],
  [-2.4, -14.4],
  [-0.6, -6],
  [-3, 1.6],
];

const mirror = (pts: [number, number][]): Pt[] => pts.map(([u, v]) => [-u, v] as const);


/** Футболка спереди: круглый ворот, плечевой шов у сустава, прямой подол. */
const SHIRT_HALF: [number, number][] = [
  [7.4, 85.4],
  [13.8, 84],
  [20.8, 81.4],
  [26, 77.8],
  [28.4, 72.6],
  [26.6, 64],
  [24.6, 57.6],
  [23.6, 48],
  [22.6, 38],
  [22.2, 28],
  [23.2, 17],
  [24.6, 8],
];
const SHIRT_FRONT: Pt[] = [
  [0, 81.2],
  ...SHIRT_HALF.map(([u, v]) => [-u, v] as const),
  [-25.2, 1.6, 1],
  [0, 0.6],
  [25.2, 1.6, 1],
  ...[...SHIRT_HALF].reverse(),
];

/** Шорты спереди: бёдра к зрителю, штанины до колена. */
const SHORTS_FRONT: Pt[] = [
  [-24.2, 6],
  [-24.8, -4],
  [-23.4, -13.2, 1],
  [-12, -15],
  [-1.4, -13.4, 1],
  [0, -10.6],
  [1.4, -13.4, 1],
  [12, -15],
  [23.4, -13.2, 1],
  [24.8, -4],
  [24.2, 6],
];

/** Носок и кроссовок спереди (нога слева по экрану; правая — зеркально). */
const SOCK_FRONT_L: [number, number][] = [
  [-16.4, -54],
  [-15.6, -66],
  [-6.4, -66],
  [-6, -54],
];
const SHOE_FRONT_L: [number, number][] = [
  [-15.8, -64.6],
  [-18.2, -70.4],
  [-18.2, -76.2],
  [-3.8, -76.2],
  [-3.8, -70.4],
  [-6.2, -64.6],
  [-11, -63.4],
];

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
  floor: string;
  body: string;
  hair: string;
  /** Длинные волосы за головой (хвост сбоку, до плеч спереди) — у девочки. */
  hairBack: string;
  /** Ресницы — у девочки. */
  lashes: string;
  lines: string;
  face: string;
  shirt: string;
  shorts: string;
  socks: string;
  shoes: string;
  arms: { right: string; left: string };
  sleeves: { right: string; left: string };
  pods: Record<FrontPodKey, PodShape>;
}

/** Табурет спереди: сиденье и две передние ножки врозь, перекладина. */
function frontStool(hip: P, legs: boolean): string {
  const seatY = hip.y + 11;
  const floor = hip.y + 76;
  let d = roundedPoly(
    [
      { x: hip.x - 37, y: seatY },
      { x: hip.x + 37, y: seatY },
      { x: hip.x + 37, y: seatY + 5.4 },
      { x: hip.x - 37, y: seatY + 5.4 },
    ],
    [2.4, 2.4, 1.4, 1.4],
  );
  if (!legs) return d;
  for (const sx of [-1, 1]) {
    d += roundedPoly(
      [
        { x: hip.x + sx * 29.6 - 1.9, y: seatY + 5 },
        { x: hip.x + sx * 29.6 + 1.9, y: seatY + 5 },
        { x: hip.x + sx * 33 + 1.5, y: floor },
        { x: hip.x + sx * 33 - 1.5, y: floor },
      ],
      [0.6, 0.6, 1, 1],
    );
  }
  const ry = seatY + 40;
  d += roundedPoly(
    [
      { x: hip.x - 31.5, y: ry },
      { x: hip.x + 31.5, y: ry },
      { x: hip.x + 31.5, y: ry + 2.4 },
      { x: hip.x - 31.5, y: ry + 2.4 },
    ],
    1,
  );
  return d;
}

/**
 * Тело спереди: center — середина таза. Правая рука пациента — слева от зрителя (dir −1).
 * legs: сидит на табурете, бёдра направлены на зрителя — видны коротко, торцом.
 */
export function frontParts(center: P, pose: FrontPose, opts: { legs?: boolean } = {}): FrontParts {
  const legs = opts.legs ?? true;
  const lean = pose.lean ?? 0;
  const hip = center;
  const T0 = frontFrame(hip, lean);
  // Корпус, шея, голова и одежда — с укороченной высотой; ноги и табурет — в натуральную величину
  const T: Frame = (u, v) => T0(u, v * FRONT.torso);
  const top = T(0, FRONT.trunk);
  const head = T(0, FRONT.trunk + 33);
  const H = frontFrame(head, lean);
  const L = shift(hip);
  const leg = legs ? LEG_FRONT_L : KNEE_FRONT_L;
  // Ось v у ног направлена вниз по экрану — переворачиваем: shift считает v вниз, а точки заданы вверх
  const Ld: Frame = (u, v) => L(u, -v);
  const body =
    smooth(TORSO_FRONT, T) +
    smooth(NECK_FRONT, T) +
    smooth(HEAD_FRONT, H) +
    smooth(EAR_FRONT(1), H) +
    smooth(EAR_FRONT(-1), H) +
    smooth(leg, Ld) +
    smooth(mirror(leg), Ld);
  const hair = smooth(HAIR_FRONT, H);
  const hairBack = smooth(HAIR_BACK_FRONT, H);
  // Ворот футболки, нос и рот
  const lines =
    stroke([[-7.6, 83.4], [-4, 80.6], [0, 79.6], [4, 80.6], [7.6, 83.4]], T) +
    NOSE_MOUTH_FRONT(H);

  const shR = T(-FRONT.shoulderX + 1.5, 71.5);
  const shL = T(FRONT.shoulderX - 1.5, 71.5);
  // Спереди бёдра укорочены перспективой, и рука в натуральную длину кажется длиннее ног
  // и корпуса. Руку спереди рисуем на 20% короче и тоньше — кисть у бедра, как на референсе стиля.
  const r = armParts(shR, pose.right, -1, FRONT.arm, 'front');
  const l = armParts(shL, pose.left, 1, FRONT.arm, 'front');

  // Нагрудный корпус «портретом»: ось X вертикально, стрелка вниз; ремень 38 мм вокруг груди
  const cv = 52;
  const halfAt = 22.4;
  const trunk: PodShape = {
    d: rectIn(T, 0, cv, 8.2, 10.4, 2.1),
    base: rectIn(T, 0, cv, 12, 11.6, 1.8),
    strap: chestBand(T, cv, halfAt, 9),
    mark: arrow(T, 0, cv - 2.2, -1),
    c: T(0, cv + 2),
  };

  return {
    hip,
    top,
    shoulders: { right: shR, left: shL },
    elbows: { right: r.elbow, left: l.elbow },
    wrists: { right: r.wrist, left: l.wrist },
    tips: { right: r.tip, left: l.tip },
    head,
    stool: frontStool(hip, legs),
    floor: legs ? ellipse({ x: hip.x, y: hip.y + 76.6 }, 46, 3.4) : '',
    body,
    hair,
    hairBack,
    lines,
    face: FACE_FRONT(H),
    lashes: LASH_FRONT(H),
    shirt: smooth(SHIRT_FRONT, T),
    shorts: smooth(SHORTS_FRONT, Ld),
    socks: legs ? smooth(SOCK_FRONT_L, Ld) + smooth(mirror(SOCK_FRONT_L), Ld) : '',
    shoes: legs ? smooth(SHOE_FRONT_L, Ld) + smooth(mirror(SHOE_FRONT_L), Ld) : '',
    arms: { right: r.d, left: l.d },
    sleeves: { right: smooth(SLEEVE_FRONT, r.frames.upper), left: smooth(SLEEVE_FRONT, l.frames.upper) },
    pods: {
      trunk,
      upper_r: limbPod(r.frames.upper, SIDE.upper * 0.5, UPPER_HALF(0.5) - 0.4, 'front'),
      upper_l: limbPod(l.frames.upper, SIDE.upper * 0.5, UPPER_HALF(0.5) - 0.4, 'front'),
      fore_r: limbPod(r.frames.fore, SIDE.fore * 0.7, FORE_HALF(0.7) - 0.4, 'front'),
      fore_l: limbPod(l.frames.fore, SIDE.fore * 0.7, FORE_HALF(0.7) - 0.4, 'front'),
    },
  };
}

/** Эллипс как путь — тень на полу. */
function ellipse(c: P, rx: number, ry: number): string {
  return `M${(c.x - rx).toFixed(2)},${c.y.toFixed(2)}a${rx},${ry} 0 1 0 ${2 * rx},0a${rx},${ry} 0 1 0 ${-2 * rx},0Z`;
}

/** Ремень вокруг груди спереди: от бока до бока, края чуть провисают — обнимает рёбра. */
function chestBand(T: Frame, cv: number, half: number, w: number): string {
  const p = (u: number, v: number) => {
    const q = T(u, v);
    return `${q.x.toFixed(2)},${q.y.toFixed(2)}`;
  };
  const a = half + 0.6;
  const h = w / 2;
  const sag = 1.4;
  return `M${p(-a, cv + h - 0.6)}Q${p(0, cv + h - sag)} ${p(a, cv + h - 0.6)}L${p(a, cv - h)}Q${p(0, cv - h - sag + 0.6)} ${p(-a, cv - h)}Z`;
}

// ── Кисть сверху: поворот предплечья ───────────────────────────────────────
// Предплечье лежит горизонтально, кисть смотрит вправо, сверху виден тыл кисти (ладонь вниз),
// большой палец сверху. Поворот предплечья — кисть «переворачивается»: сужается до ребра
// и раскрывается ладонью вверх, большой палец уходит вниз. k — видимая высота кисти:
// 1 — ладонь вниз, 0 — ребром, −1 — ладонь вверх. Предплечье и рукав — цилиндры: не меняются.

const HAND_TOP: Pt[] = [
  [0, -4.6],
  [2.6, -6.4],
  [6.2, -10.8],
  [9.2, -11.6],
  [10.2, -9.8],
  [7.6, -6.1, 1],
  [12.4, -5.6],
  [19.2, -5.2],
  [21.8, -3.4],
  [22.6, 0],
  [21.8, 3.4],
  [19.2, 5.3],
  [8, 5.7],
  [0, 4.8],
];

/** sleeveFrom — где рукав уходит за край рисунка (левее — длиннее рука из-за края). */
export function handTop(c: P, s = 1, k = 1, sleeveFrom = -27) {
  const F: Frame = (u, v) => ({ x: c.x + u * s, y: c.y + v * s });
  const H: Frame = (u, v) => ({ x: c.x + u * s, y: c.y + v * k * s });
  return {
    hand: smooth(HAND_TOP, H),
    fore: smooth([[-19, -5.6, 1], [-1, -4.8], [-1, 4.8], [-19, 5.6, 1]], F),
    // Короткий рукав футболки: шире к плечу, подол скруглён
    sleeve: smooth([[sleeveFrom, -8.6, 1], [-17.6, -7.8], [-15.4, -3.6], [-15, 0], [-15.4, 3.6], [-17.6, 7.9], [sleeveFrom, 8.8, 1]], F),
    fingers: [-2.6, 0, 2.6].map((v) => stroke([[15.4, v], [21.4, v * 1.1]], H)).join(''),
    /** Складки ладони — видны, когда ладонь вверх. */
    palm: stroke([[3.4, -2.4], [8.4, 0.4], [11.6, -0.8]], H) + stroke([[3, 2.6], [7.4, 1.2]], H),
    /** Костяшки — видны с тыла кисти. */
    back: stroke([[13.2, -4.4], [13.8, 0], [13.2, 4.4]], H),
  };
}
