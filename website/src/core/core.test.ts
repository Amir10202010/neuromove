// Проверка алгоритмов на данных симулятора: правильный ответ известен заранее.
// Критерий приёмки из софт.md, раздел 5: углы на данных симулятора —
// ошибка < 3° с шумом и смещением гироскопа.

import { describe, expect, it } from 'vitest';
import type { Side } from '../devices/types';
import { det, rotAxis, rotX, rotY, rotZ, mul } from '../lib/vec3';
import { max, mean } from '../lib/stats';
import { ImuSimulator } from '../simulation/imuModel';
import { restingPose, type Pose } from '../simulation/kinematics';
import { minJerk } from '../simulation/motion';
import { EXERCISES, type ExerciseId } from './exercises';
import { Calibrator, MotionPipeline, exerciseSample, forearmReady, currentRoll, newElbowTrack, referenceFrom } from './pipeline';
import { countReps } from './reps';
import { sparc } from './sparc';

const FS = 100;

/** Движение: 0 → peak → 0, затем пауза. Возвращает истинный угол во времени t. */
function oscillation(peak: number, t: number, period = 4): number {
  const u = (t % period) / period;
  if (u < 0.4) return peak * minJerk(u / 0.4);
  if (u < 0.8) return peak * (1 - minJerk((u - 0.4) / 0.4));
  return 0;
}

function poseFor(ex: ExerciseId, side: Side, angle: number): Pose {
  const pose = restingPose();
  const arm = side === 'left' ? pose.left : pose.right;
  if (ex === 'shoulder_flexion') arm.flexion = angle;
  if (ex === 'shoulder_abduction') arm.abduction = angle;
  if (ex === 'elbow_flexion') arm.elbow = angle;
  if (ex === 'forearm_rotation') {
    arm.elbow = 90;
    arm.rotation = angle;
  }
  return pose;
}

/** Прогон: 3 с калибровки, затем движение. Возвращает пары (истина, измерено). */
function run(ex: ExerciseId, side: Side, peak: number, seconds = 12, seed = 7) {
  const sim = new ImuSimulator(seed, FS);
  const pipe = new MotionPipeline();
  const cal = new Calibrator(3);
  const def = EXERCISES[ex];
  let seq = 0;
  // Калибровка: руки вдоль тела, неподвижно
  for (; seq < 3 * FS + 5; seq++) {
    const f = sim.frame(restingPose(), seq);
    cal.push(f);
  }
  expect(cal.moved).toBe(false);
  const c = cal.result();
  pipe.setBias(c.bias);
  pipe.seedUp(c.up);
  const ref = referenceFrom(c);

  // Для поворота — сначала установка: локоть 90°, нейтраль
  let rollZero = 0;
  if (ex === 'forearm_rotation') {
    for (let i = 0; i < 2 * FS; i++, seq++) {
      const t = i / FS;
      const pose = poseFor(ex, side, 0);
      (side === 'left' ? pose.left : pose.right).elbow = 90 * minJerk(t / 1.0);
      pipe.process(sim.frame(pose, seq), FS);
    }
    expect(forearmReady(pipe, side, ref)).toBe(true);
    rollZero = currentRoll(pipe, side) as number;
  }

  const truth: number[] = [];
  const measured: number[] = [];
  const speed: number[] = [];
  // Как в движке сеанса: у локтя есть память ветви
  const track = newElbowTrack();
  for (let i = 0; i < seconds * FS; i++, seq++) {
    const t = i / FS;
    const a = oscillation(peak, t);
    pipe.process(sim.frame(poseFor(ex, side, a), seq), FS);
    const s = exerciseSample(def, side, pipe, ref, rollZero, track);
    if (!s) continue;
    truth.push(a);
    measured.push(s.angle);
    speed.push(s.speed);
  }
  const err = truth.map((x, i) => Math.abs(x - (measured[i] as number)));
  return { truth, measured, speed, meanErr: mean(err), maxErr: max(err) };
}

describe('матрицы поворота', () => {
  it('настоящие повороты: определитель +1', () => {
    for (const m of [rotX(0.7), rotY(-1.2), rotZ(2.1), rotAxis([1, 2, 3], 0.4), mul(rotX(0.3), rotY(0.9))]) {
      expect(det(m)).toBeCloseTo(1, 10);
    }
  });
});

describe('углы на данных симулятора: шум, смещение гироскопа, перекос крепления', () => {
  const cases: [ExerciseId, number][] = [
    ['shoulder_flexion', 140],
    ['shoulder_abduction', 120],
    ['elbow_flexion', 125],
    ['forearm_rotation', 60],
  ];
  // Пять разных «надеваний» датчиков (зерно = свой перекос крепления и смещение гироскопа)
  for (const seed of [1, 2, 3, 4, 5]) {
    for (const side of ['left', 'right'] as const) {
      for (const [ex, peak] of cases) {
        it(`${ex}, ${side}, зерно ${seed}: средняя ошибка < 3°, пик ±3°`, () => {
          const r = run(ex, side, peak, 12, seed);
          expect(r.meanErr).toBeLessThan(3);
          expect(r.maxErr).toBeLessThan(5);
          expect(Math.abs(max(r.measured) - peak)).toBeLessThan(3);
        });
      }
    }
  }

  it('супинация положительна на обеих руках, пронация — отрицательна', () => {
    for (const side of ['left', 'right'] as const) {
      const sup = run('forearm_rotation', side, 50, 2);
      expect(max(sup.measured)).toBeGreaterThan(40);
      const pro = run('forearm_rotation', side, -50, 2);
      expect(Math.min(...pro.measured)).toBeLessThan(-40);
    }
  });

  it('повторы считаются: 3 из 3', () => {
    const r = run('shoulder_flexion', 'right', 130, 12);
    const reps = countReps(r.measured, 0.2 * 130, 0.45 * 130);
    expect(reps.length).toBe(3);
  });
});

describe('SPARC', () => {
  const profile = (n: number, bumps: number) => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      let v = 0;
      for (let b = 0; b < bumps; b++) {
        const c = (b + 0.5) / bumps;
        v += Math.exp(-(((u - c) * bumps * 2.2) ** 2));
      }
      out.push(v);
    }
    return out;
  };
  it('плавное движение ближе к нулю, чем прерывистое', () => {
    const smooth = sparc(profile(150, 1), FS);
    const jerky = sparc(profile(150, 3), FS);
    expect(smooth).toBeLessThan(0);
    expect(smooth).toBeGreaterThan(jerky);
  });
  it('минимальный рывок: около −1.4…−1.8', () => {
    // Скорость минимального рывка — производная minJerk
    const n = 150;
    const v: number[] = [];
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      v.push(30 * u * u * (1 - u) * (1 - u));
    }
    const s = sparc(v, FS);
    expect(s).toBeLessThan(-1.3);
    expect(s).toBeGreaterThan(-1.9);
  });
});
