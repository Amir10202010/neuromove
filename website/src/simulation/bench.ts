// Запись «станка» на симуляторе: калибровка 3 с, затем углы 0–120° — по 1 с перехода и 3 с
// неподвижно, отметка эталона в середине каждой остановки. Нужна, чтобы проверить сам инструмент
// проверки точности (core/validation.ts) до стенда. Это проверка формул, а не прибора: устройство
// в паспорте — симулятор, и экран «Проверка точности» так и подписывает такую запись.

import { serializeImuCsv, withMarks } from '../devices/contract';
import { PLACEMENTS, type RawFrame, type Side } from '../devices/types';
import { ImuSimulator } from './imuModel';
import { restingPose, type Pose } from './kinematics';
import { minJerk } from './motion';

export type BenchExercise = 'shoulder_flexion' | 'shoulder_abduction' | 'elbow_flexion';

export const BENCH_ANGLES = [0, 30, 60, 90, 120];

function pose(ex: BenchExercise, side: Side, angle: number): Pose {
  const p = restingPose();
  const arm = side === 'left' ? p.left : p.right;
  if (ex === 'shoulder_flexion') arm.flexion = angle;
  else if (ex === 'shoulder_abduction') arm.abduction = angle;
  else arm.elbow = angle;
  return p;
}

export function simulateBench(ex: BenchExercise, side: Side = 'right', seed = 11, rateHz = 100) {
  const sim = new ImuSimulator(seed, rateHz);
  const frames: RawFrame[] = [];
  const marks: { seq: number; ref: number }[] = [];
  let seq = 0;
  for (; seq < 3 * rateHz + 20; seq++) frames.push(sim.frame(restingPose(), seq));
  let prev = 0;
  for (const target of BENCH_ANGLES) {
    for (let i = 0; i < rateHz; i++, seq++) frames.push(sim.frame(pose(ex, side, prev + (target - prev) * minJerk(i / rateHz)), seq));
    for (let i = 0; i < 3 * rateHz; i++, seq++) {
      if (i === Math.round(1.5 * rateHz)) marks.push({ seq, ref: target });
      frames.push(sim.frame(pose(ex, side, target), seq));
    }
    prev = target;
  }
  return { frames, marks };
}

/** Та же запись файлом imu-csv v1: отметка — сразу после строки своего отсчёта, как пишет record.py. */
export function benchCsv(ex: BenchExercise, side: Side = 'right', seed = 11, rateHz = 100): string {
  const { frames, marks } = simulateBench(ex, side, seed, rateHz);
  const csv = serializeImuCsv(
    { device: 'NM-SIM-BENCH', firmware: 'sim', rateHz, accG: 4, gyroDps: 1000, sensors: [...PLACEMENTS], extra: { exercise: ex, side } },
    frames,
  );
  return withMarks(csv, marks);
}
