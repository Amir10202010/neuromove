// Кватернионы для независимого эталона (docs/ENGINEERING_10H/EXPERIMENTS.md).
//
// ⚠️ Нарочно свой код, а не lib/vec3: эталон не должен повторять математику, которую проверяет.
// Кватернион q = [w, x, y, z] переводит вектор из осей тела в оси мира: v_мир = q ⊗ v ⊗ q*.

export type Q = readonly [number, number, number, number];
export type V = readonly [number, number, number];

export const Q_ID: Q = [1, 0, 0, 0];
export const RAD = Math.PI / 180;

/** Произведение Гамильтона a ⊗ b: сначала поворот b, потом a. */
export function qMul(a: Q, b: Q): Q {
  const [aw, ax, ay, az] = a;
  const [bw, bx, by, bz] = b;
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ];
}

export function qConj(q: Q): Q {
  return [q[0], -q[1], -q[2], -q[3]];
}

export function qLen(q: Q): number {
  return Math.hypot(q[0], q[1], q[2], q[3]);
}

/** Поворот вокруг оси на угол (радианы), по правилу правой руки. Ось нормируется. */
export function qAxis(axis: V, rad: number): Q {
  const n = Math.hypot(axis[0], axis[1], axis[2]);
  if (n === 0) return Q_ID;
  const s = Math.sin(rad / 2) / n;
  return [Math.cos(rad / 2), axis[0] * s, axis[1] * s, axis[2] * s];
}

/** v в осях мира, если v задан в осях тела q. */
export function qRot(q: Q, v: V): V {
  const p = qMul(qMul(q, [0, v[0], v[1], v[2]]), qConj(q));
  return [p[1], p[2], p[3]];
}

/** v в осях тела q, если v задан в осях мира. */
export function qRotInv(q: Q, v: V): V {
  return qRot(qConj(q), v);
}

/**
 * Кватернион из трёх осей тела, заданных в осях родителя (столбцы матрицы поворота).
 * Формула Шеппарда — устойчива при любом угле.
 */
export function qFromAxes(x: V, y: V, z: V): Q {
  const m00 = x[0], m10 = x[1], m20 = x[2];
  const m01 = y[0], m11 = y[1], m21 = y[2];
  const m02 = z[0], m12 = z[1], m22 = z[2];
  const tr = m00 + m11 + m22;
  let q: Q;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [0.25 * s, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [(m21 - m12) / s, 0.25 * s, (m01 + m10) / s, (m02 + m20) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m02 - m20) / s, (m01 + m10) / s, 0.25 * s, (m12 + m21) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, 0.25 * s];
  }
  const n = qLen(q);
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

export function vDot(a: V, b: V): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function vCross(a: V, b: V): V {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function vLen(a: V): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function vUnit(a: V): V {
  const n = vLen(a);
  return [a[0] / n, a[1] / n, a[2] / n];
}

export function vAdd(a: V, b: V): V {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function vScale(a: V, k: number): V {
  return [a[0] * k, a[1] * k, a[2] * k];
}

/** Угол между векторами, градусы. Через atan2 — точно и у 0°, и у 180°. */
export function vAngleDeg(a: V, b: V): number {
  return Math.atan2(vLen(vCross(a, b)), vDot(a, b)) / RAD;
}
