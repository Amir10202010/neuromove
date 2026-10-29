// Самопроверка эталона (P0-1 в docs/ENGINEERING_10H/ENGINEERING_BACKLOG.md): прежде чем мерить им
// приложение, эталон должен сам давать известные числа — 1 g в покое, нужные оси, точную скорость.

import { describe, expect, it } from 'vitest';
import { hangingArm, sensorKinematics, truth, uprightPose, type BodyPose } from './body';
import { ACC_LSB, GYRO_LSB, generate, keyframes } from './gen';
import { qLen } from './quat';

const still = () => uprightPose();

describe('эталон: самопроверка', () => {
  it('эталон не берёт математику приложения: ни симулятора, ни lib/vec3, ни core/', () => {
    const sources = import.meta.glob(['./quat.ts', './rng.ts', './body.ts', './gen.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(sources)).toHaveLength(4);
    for (const [file, src] of Object.entries(sources)) {
      const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1] as string);
      for (const imp of imports) {
        const ok = imp.startsWith('./') || imp === '../devices/types';
        expect(ok, `${file} импортирует ${imp}`).toBe(true);
      }
    }
  });

  it('кватернионы сегментов остаются единичными на сложном движении', () => {
    const f = keyframes([[0, 0], [1, 120], [2, 30]]);
    for (let t = 0; t <= 2; t += 0.01) {
      const pose: BodyPose = {
        trunkPitch: f(t) / 10,
        trunkRoll: -f(t) / 20,
        right: { plane: f(t) / 2, elevation: f(t), axial: f(t) / 3, elbow: f(t), proSup: -f(t) / 2, carrying: 10 },
        left: hangingArm(),
      };
      for (const k of Object.values(sensorKinematics(pose))) expect(Math.abs(qLen(k.q) - 1)).toBeLessThan(1e-12);
    }
  });

  it('в покое акселерометр видит 1 g «вверх»: у рук — по −X датчика, у груди — тоже по −X', () => {
    const g = generate({ durationSec: 0.2, motion: still, places: ['trunk', 'upper_r', 'fore_r', 'upper_l', 'fore_l'], seed: 1, errors: 'ideal', noise: 0 });
    const f = g.frames[10];
    expect(f).toBeDefined();
    for (const raw of Object.values(f?.data ?? {})) {
      expect(raw[0]).toBe(-ACC_LSB);
      expect(Math.abs(raw[1] as number)).toBeLessThanOrEqual(1);
      expect(Math.abs(raw[2] as number)).toBeLessThanOrEqual(1);
      for (let i = 3; i < 6; i++) expect(Math.abs(raw[i] as number)).toBeLessThanOrEqual(1);
    }
  });

  it('гироскоп = производная поворота: локоть сгибается со скоростью 90 °/с — ось Z датчика предплечья', () => {
    const motion = (t: number): BodyPose => ({ ...uprightPose(), right: { ...hangingArm(), elbow: 90 * t } });
    const g = generate({ durationSec: 1, motion, places: ['fore_r', 'upper_r'], seed: 2, errors: 'ideal', noise: 0, dlpf: false });
    for (const k of [20, 50, 80]) {
      const raw = g.frames[k]?.data.fore_r;
      expect(raw).toBeDefined();
      // ±1 единица — округление; 1 ед = 0,03 °/с
      expect(Math.abs((raw?.[5] as number) - 90 * GYRO_LSB)).toBeLessThanOrEqual(1);
      expect(Math.abs(raw?.[3] as number)).toBeLessThanOrEqual(1);
      expect(Math.abs(raw?.[4] as number)).toBeLessThanOrEqual(1);
      // Плечо не двигалось
      const up = g.frames[k]?.data.upper_r;
      for (let i = 3; i < 6; i++) expect(Math.abs(up?.[i] as number)).toBeLessThanOrEqual(1);
    }
  });

  it('эталонные углы считаются по костям: подъём, локоть, наклон туловища', () => {
    // Туловище отклонено назад на 10° — так дети «добирают» подъём руки
    const pose: BodyPose = { trunkPitch: -10, trunkRoll: 0, right: { ...hangingArm(), elevation: 90, plane: 0, elbow: 45 }, left: hangingArm() };
    const tr = truth(pose);
    expect(tr.trunkTilt).toBeCloseTo(10, 9);
    // Плечо поднято на 90° относительно туловища, туловище отклонено назад на 10° → в мире 100°
    expect(tr.right.elevationThorax).toBeCloseTo(90, 9);
    expect(tr.right.elevationWorld).toBeCloseTo(100, 9);
    expect(tr.right.elbow3d).toBeCloseTo(45, 9);
    expect(tr.right.foreElevation).toBeCloseTo(145, 9);
    // Наклон вперёд — рука опускается: 80°
    expect(truth({ ...pose, trunkPitch: 10 }).right.elevationWorld).toBeCloseTo(80, 9);
  });

  it('фильтр DLPF задерживает сигнал примерно на 4,9 мс, как в даташите', () => {
    // Локоть разгоняется равномерно: ω = 200·t °/с. Задержка τ даёт недобор 200·τ °/с
    const motion = (t: number): BodyPose => ({ ...uprightPose(), right: { ...hangingArm(), elbow: 100 * t * t } });
    const g = generate({ durationSec: 1, motion, places: ['fore_r'], seed: 3, errors: 'ideal', noise: 0, dlpf: true });
    const raw = g.frames[50]?.data.fore_r;
    const w = (raw?.[5] as number) / GYRO_LSB;
    const delayMs = ((200 * 0.5 - w) / 200) * 1000;
    expect(delayMs).toBeGreaterThan(4.2);
    expect(delayMs).toBeLessThan(5.6);
  });
});
