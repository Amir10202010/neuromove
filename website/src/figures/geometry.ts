// Геометрия рисунков NeuroMove: точки, дуги, капсулы.
//
// Углы — как в приложении: 0° — сегмент висит вниз, 90° — вперёд (или в сторону),
// 180° — прямо вверх. Ось y в SVG смотрит вниз, поэтому «вниз» — это +y.
// dir: 1 — вперёд вправо по экрану, −1 — влево.

export interface P {
  x: number;
  y: number;
}
export type Dir = 1 | -1;

export const rad = (d: number) => (d * Math.PI) / 180;
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const lerp = (a: P, b: P, k: number): P => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
const f = (v: number) => (Math.abs(v) < 0.005 ? '0' : v.toFixed(2));

/** Точка на луче из o длиной len под углом deg (от «вниз» через «вперёд» к «вверх»). */
export function at(o: P, len: number, deg: number, dir: Dir = 1): P {
  return { x: o.x + dir * len * Math.sin(rad(deg)), y: o.y + len * Math.cos(rad(deg)) };
}

/** Дуга радиуса r вокруг o от угла a к углу b — путь для stroke. */
export function arc(o: P, r: number, a: number, b: number, dir: Dir = 1): string {
  if (Math.abs(b - a) < 0.05) return '';
  const p0 = at(o, r, a, dir);
  const p1 = at(o, r, b, dir);
  const large = Math.abs(b - a) > 180 ? 1 : 0;
  // «вниз → вперёд → вверх» вправо в SVG идёт против часовой стрелки
  const sweep = b > a === (dir === 1) ? 0 : 1;
  return `M${f(p0.x)},${f(p0.y)}A${f(r)},${f(r)} 0 ${large} ${sweep} ${f(p1.x)},${f(p1.y)}`;
}

/** Сектор-клин от угла a до b. */
export function wedge(o: P, r: number, a: number, b: number, dir: Dir = 1): string {
  const d = arc(o, r, a, b, dir);
  return d ? `M${f(o.x)},${f(o.y)}L${d.slice(1)}Z` : '';
}

/**
 * Капсула — отрезок a→b толщиной w со скруглёнными концами, замкнутый контур.
 * Из капсул собрано всё тело: замкнутый контур можно залить и обвести одним <use>.
 */
export function capsule(a: P, b: P, w: number): string {
  const r = w / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.01) return circle(a, r);
  const nx = (-dy / len) * r;
  const ny = (dx / len) * r;
  return (
    `M${f(a.x + nx)},${f(a.y + ny)}L${f(b.x + nx)},${f(b.y + ny)}` +
    `A${f(r)},${f(r)} 0 0 0 ${f(b.x - nx)},${f(b.y - ny)}` +
    `L${f(a.x - nx)},${f(a.y - ny)}A${f(r)},${f(r)} 0 0 0 ${f(a.x + nx)},${f(a.y + ny)}Z`
  );
}

/**
 * Сужающаяся капсула: толщина wa у точки a и wb у точки b, концы скруглены, стороны —
 * общие касательные двух кругов. Так рисуются сегменты тела: плечо шире у плечевого
 * сустава, предплечье тоньше у запястья. Обход — как у capsule.
 */
export function taper(a: P, b: P, wa: number, wb: number): string {
  const ra = wa / 2;
  const rb = wb / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = Math.hypot(dx, dy);
  if (L < 0.01) return circle(a, Math.max(ra, rb));
  if (L <= Math.abs(ra - rb)) return circle(ra > rb ? a : b, Math.max(ra, rb));
  const ux = dx / L;
  const uy = dy / L;
  const vx = -uy;
  const vy = ux;
  const s = (ra - rb) / L;
  const c = Math.sqrt(1 - s * s);
  // Внешние нормали касательных: m1 — сторона +v, m2 — сторона −v
  const m1 = { x: s * ux + c * vx, y: s * uy + c * vy };
  const m2 = { x: s * ux - c * vx, y: s * uy - c * vy };
  // Дуга вокруг b короче полуокружности, если a толще; вокруг a — длиннее
  const largeB = s > 0 ? 0 : 1;
  const largeA = s > 0 ? 1 : 0;
  return (
    `M${f(a.x + ra * m1.x)},${f(a.y + ra * m1.y)}L${f(b.x + rb * m1.x)},${f(b.y + rb * m1.y)}` +
    `A${f(rb)},${f(rb)} 0 ${largeB} 0 ${f(b.x + rb * m2.x)},${f(b.y + rb * m2.y)}` +
    `L${f(a.x + ra * m2.x)},${f(a.y + ra * m2.y)}A${f(ra)},${f(ra)} 0 ${largeA} 0 ${f(a.x + ra * m1.x)},${f(a.y + ra * m1.y)}Z`
  );
}

/** Круг как путь — чтобы голова и суставы рисовались тем же <use>, что и капсулы. */
export function circle(c: P, r: number): string {
  return `M${f(c.x - r)},${f(c.y)}a${f(r)},${f(r)} 0 1 0 ${f(2 * r)},0a${f(r)},${f(r)} 0 1 0 ${f(-2 * r)},0Z`;
}

/**
 * Многоугольник со скруглёнными углами (радиус у каждой вершины свой или общий).
 * Обход всегда против часовой стрелки на экране — как у capsule и circle: части тела одного
 * слоя лежат в одном пути, и при правиле заливки nonzero перекрытия сливаются, а не вырезаются.
 */
export function roundedPoly(input: P[], radius: number | number[]): string {
  let pts = input;
  let radii = radius;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i] as P;
    const b = pts[(i + 1) % pts.length] as P;
    area += a.x * b.y - b.x * a.y;
  }
  if (area > 0) {
    pts = [...pts].reverse();
    if (Array.isArray(radii)) radii = [...radii].reverse();
  }
  const n = pts.length;
  let d = '';
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n] as P;
    const cur = pts[i] as P;
    const next = pts[(i + 1) % n] as P;
    const r = Array.isArray(radii) ? (radii[i] ?? 0) : radii;
    const l1 = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const l2 = Math.hypot(next.x - cur.x, next.y - cur.y);
    const k1 = Math.min(r, l1 / 2) / l1;
    const k2 = Math.min(r, l2 / 2) / l2;
    const a = { x: cur.x + (prev.x - cur.x) * k1, y: cur.y + (prev.y - cur.y) * k1 };
    const b = { x: cur.x + (next.x - cur.x) * k2, y: cur.y + (next.y - cur.y) * k2 };
    d += `${i === 0 ? 'M' : 'L'}${f(a.x)},${f(a.y)}Q${f(cur.x)},${f(cur.y)} ${f(b.x)},${f(b.y)}`;
  }
  return d + 'Z';
}

/** Прямоугольник со скруглением, повёрнутый на угол rot° вокруг центра c, — корпус датчика. */
export function pod(c: P, w: number, h: number, rot: number, r = 2.4): string {
  const ca = Math.cos(rad(rot));
  const sa = Math.sin(rad(rot));
  const pts = [
    { x: -w / 2, y: -h / 2 },
    { x: w / 2, y: -h / 2 },
    { x: w / 2, y: h / 2 },
    { x: -w / 2, y: h / 2 },
  ].map((p) => ({ x: c.x + p.x * ca - p.y * sa, y: c.y + p.x * sa + p.y * ca }));
  return roundedPoly(pts, r);
}

/** Угол отрезка a→b на экране, градусы (для поворота корпусов датчиков вдоль сегмента). */
export function screenAngle(a: P, b: P): number {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

/** Полоска-ремешок поперёк сегмента a→b в точке k: ширина — толщина сегмента с запасом. */
export function strap(a: P, b: P, k: number, limbW: number, band = 6): string {
  const c = lerp(a, b, k);
  return pod(c, band, limbW + 3, screenAngle(a, b), 1.4);
}

/**
 * Экранный угол касательной к дуге (для наконечника стрелки) в точке deg.
 * forward — по направлению роста угла (от «вниз» к «вверх»), иначе — обратно.
 */
export function tangent(deg: number, dir: Dir = 1, forward = true): number {
  const a = dir === 1 ? -deg : deg + 180;
  return forward ? a : a + 180;
}

/** Плавность «выезда»: быстро в начале, мягко в конце. */
export const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
