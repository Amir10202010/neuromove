// Векторы и матрицы 3×3 — минимум, нужный для ориентации датчиков.
// Матрица хранится как массив из 9 чисел по строкам:
//   [m00 m01 m02
//    m10 m11 m12
//    m20 m21 m22]

export type Vec3 = [number, number, number];
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const DEG = Math.PI / 180;

export function norm(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

export function normalize(v: Vec3): Vec3 {
  const n = norm(v) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: Vec3, k: number): Vec3 {
  return [a[0] * k, a[1] * k, a[2] * k];
}

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mul(a: Mat3, b: Mat3): Mat3 {
  const [a0, a1, a2, a3, a4, a5, a6, a7, a8] = a;
  const [b0, b1, b2, b3, b4, b5, b6, b7, b8] = b;
  return [
    a0 * b0 + a1 * b3 + a2 * b6, a0 * b1 + a1 * b4 + a2 * b7, a0 * b2 + a1 * b5 + a2 * b8,
    a3 * b0 + a4 * b3 + a5 * b6, a3 * b1 + a4 * b4 + a5 * b7, a3 * b2 + a4 * b5 + a5 * b8,
    a6 * b0 + a7 * b3 + a8 * b6, a6 * b1 + a7 * b4 + a8 * b7, a6 * b2 + a7 * b5 + a8 * b8,
  ];
}

export function transpose(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

/** m · v */
export function apply(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** mᵀ · v — перевод вектора из мира в оси датчика, если m переводит из датчика в мир. */
export function applyT(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
    m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
    m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
  ];
}

/** Поворот вокруг оси X на угол a (радианы). */
export function rotX(a: number): Mat3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}

/** Поворот вокруг оси Y на угол a (радианы). */
export function rotY(a: number): Mat3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}

/** Поворот вокруг оси Z на угол a (радианы). */
export function rotZ(a: number): Mat3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/** Поворот вокруг произвольной оси (формула Родрига). Ось нормируется. */
export function rotAxis(axis: Vec3, a: number): Mat3 {
  const [x, y, z] = normalize(axis);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
}

/** Матрица из трёх столбцов: куда в мире смотрят оси X, Y, Z датчика. */
export function fromColumns(x: Vec3, y: Vec3, z: Vec3): Mat3 {
  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
}

export function det(m: Mat3): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}
