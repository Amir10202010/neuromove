// Проверка точности по записи «станка» из симулятора: угол на каждой отметке известен заранее.
// Так проверяется сам инструмент проверки — до того, как на нём будут считать стенд и добровольцев.

import { describe, expect, it } from 'vitest';
import { parseImuCsv } from '../devices/contract';
import type { RawFrame } from '../devices/types';
import { BENCH_ANGLES as ANGLES, benchCsv, simulateBench } from '../simulation/bench';
import { ImuSimulator } from '../simulation/imuModel';
import { restingPose } from '../simulation/kinematics';
import { validateRecording } from './validation';

const FS = 100;
const benchRecording = (ex: 'shoulder_flexion' | 'shoulder_abduction' | 'elbow_flexion') => simulateBench(ex, 'right', 11, FS);

describe('проверка точности по отметкам эталона', () => {
  for (const ex of ['shoulder_flexion', 'shoulder_abduction', 'elbow_flexion'] as const) {
    it(`${ex}: станок 0–120° — средняя ошибка меньше 3°, порог 5° пройден`, () => {
      const { frames, marks } = benchRecording(ex);
      const r = validateRecording({ frames, marks, rateHz: FS, exercise: ex, side: 'right' });
      expect(r.problem).toBeNull();
      expect(r.n).toBe(ANGLES.length);
      expect(r.mae).toBeLessThan(3);
      expect(r.maxAbs).toBeLessThan(5);
      expect(r.limits).not.toBeNull();
      expect(r.passed).toBe(true);
    });
  }

  it('эталон врёт на 10° — систематическая ошибка видна, порог не пройден', () => {
    const { frames, marks } = benchRecording('shoulder_flexion');
    const shifted = marks.map((m) => ({ ...m, ref: m.ref + 10 }));
    const r = validateRecording({ frames, marks: shifted, rateHz: FS, exercise: 'shoulder_flexion', side: 'right' });
    expect(r.bias).toBeLessThan(-7);
    expect(r.bias).toBeGreaterThan(-13);
    expect(r.passed).toBe(false);
  });

  it('тот же результат через файл imu-csv v1 с отметками `# mark`', () => {
    const { frames, marks } = benchRecording('elbow_flexion');
    const parsed = parseImuCsv(benchCsv('elbow_flexion', 'right', 11, FS));
    expect(parsed.marks).toEqual(marks);
    expect(parsed.passport.extra).toMatchObject({ exercise: 'elbow_flexion', side: 'right' });
    const direct = validateRecording({ frames, marks, rateHz: FS, exercise: 'elbow_flexion', side: 'right' });
    const viaFile = validateRecording({ frames: parsed.frames, marks: parsed.marks, rateHz: FS, exercise: 'elbow_flexion', side: 'right' });
    expect(viaFile.mae).toBeCloseTo(direct.mae as number, 6);
  });

  it('без неподвижной позы в начале — честное «нет калибровки», а не цифры', () => {
    const sim = new ImuSimulator(3, FS);
    const frames: RawFrame[] = [];
    for (let seq = 0; seq < 10 * FS; seq++) {
      const a = 60 + 50 * Math.sin((2 * Math.PI * seq) / (2 * FS));
      const p = restingPose();
      p.right.flexion = a;
      frames.push(sim.frame(p, seq));
    }
    const r = validateRecording({ frames, marks: [{ seq: 500, ref: 60 }], rateHz: FS, exercise: 'shoulder_flexion', side: 'right' });
    expect(r.problem).toBe('no_calibration');
    expect(r.passed).toBeNull();
  });

  it('поворот предплечья и запись без отметок — не считаются', () => {
    const { frames, marks } = benchRecording('elbow_flexion');
    expect(validateRecording({ frames, marks, rateHz: FS, exercise: 'forearm_rotation', side: 'right' }).problem).toBe('rotation_unsupported');
    expect(validateRecording({ frames, marks: [], rateHz: FS, exercise: 'elbow_flexion', side: 'right' }).problem).toBe('no_marks');
  });
});

describe('поправки акселерометра: заводской ноль MPU-6050 и калибровка в 6 положениях', () => {
  // Датчик с заводским нулём: +0,05 g по X, −0,04 g по Y, +0,03 g по Z и масштабом 1,03 по X —
  // в пределах datasheet (±50 мг по X и Y, ±80 мг по Z). Так выглядит GY-521 без калибровки
  const OFF: [number, number, number] = [410, -330, 245];
  const SCALE: [number, number, number] = [1.03, 1, 1];
  const spoil = (frames: readonly RawFrame[]): RawFrame[] =>
    frames.map((f) => {
      const data: RawFrame['data'] = {};
      for (const [p, raw] of Object.entries(f.data) as [keyof RawFrame['data'], Int16Array][]) {
        const d = Int16Array.from(raw);
        for (let a = 0; a < 3; a++) d[a] = Math.max(-32768, Math.min(32767, Math.round(OFF[a]! + (raw[a] as number) * SCALE[a]!)));
        data[p] = d;
      }
      return { ...f, data };
    });

  it('без поправок ошибка растёт, с поправками из паспорта возвращается к исходной', () => {
    const { frames, marks } = benchRecording('shoulder_flexion');
    const clean = validateRecording({ frames, marks, rateHz: FS, exercise: 'shoulder_flexion', side: 'right' });
    const bad = validateRecording({ frames: spoil(frames), marks, rateHz: FS, exercise: 'shoulder_flexion', side: 'right' });
    const cal = { off: OFF, scale: SCALE };
    const fixed = validateRecording({
      frames: spoil(frames),
      marks,
      rateHz: FS,
      exercise: 'shoulder_flexion',
      side: 'right',
      accCal: { trunk: cal, upper_r: cal, fore_r: cal },
    });
    expect(bad.maxAbs as number).toBeGreaterThan((clean.maxAbs as number) + 1);
    expect(Math.abs((fixed.mae as number) - (clean.mae as number))).toBeLessThan(0.05);
  });
});
