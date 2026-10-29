// Инварианты предметной области (docs/ENGINEERING_10H, фаза E): то, что не должно случаться никогда,
// как бы ни пришли данные. Записи — от независимого эталона (src/verification), а не от симулятора.

import { describe, expect, it } from 'vitest';
import { PLACEMENTS, type RawFrame } from '../devices/types';
import { generate, keyframes } from '../verification/gen';
import { RAD, qAxis } from '../verification/quat';
import { CAL_SEC, armPose, placesFor, repTrack } from '../verification/scenarios';
import { SessionEngine } from './SessionEngine';

function elbowRecording(seed = 5) {
  const elbow = repTrack(110, 1.5, 1, 4);
  return generate({ durationSec: CAL_SEC + 4 * 5 + 1, motion: (t) => armPose('right', { elbow: elbow(t) }), places: placesFor('right'), seed, errors: 'ideal' });
}

function elbowEngine() {
  const engine = new SessionEngine({ steps: [{ exercise: 'elbow_flexion', side: 'right', reps: 0, durationSec: 1e9 }], autoAdvance: false });
  engine.start();
  return engine;
}

describe('пропавший датчик не выглядит живым', () => {
  it('датчик плеча пропал посреди сгибания локтя: угла нет, шаг помечен, подсказка называет датчик; вернулся — запись идёт дальше', () => {
    const gen = elbowRecording();
    const engine = elbowEngine();
    // Пропажа на 3 с посреди второго повтора: в строках остались туловище и предплечье — как после
    // нового заголовка от прошивки, которая убрала не ответивший датчик
    const gapFrom = CAL_SEC + 6;
    const gapTo = CAL_SEC + 9;
    let checked = 0;
    for (const f of gen.frames) {
      const inGap = f.t >= gapFrom && f.t < gapTo;
      const fr: RawFrame = inGap ? { ...f, data: { trunk: f.data.trunk, fore_r: f.data.fore_r } } : f;
      engine.process([fr]);
      if (inGap && f.t > gapFrom + 0.3) {
        const snap = engine.getSnapshot();
        expect(snap.hint).toBe('sensor_missing');
        expect(snap.missing).toEqual(['upper_r']);
        expect(engine.live.angle).toBeNull();
        checked += 1;
      }
      if (f.t > gapTo + 0.3) expect(engine.getSnapshot().missing).toEqual([]);
    }
    expect(checked).toBeGreaterThan(200);
    engine.stop();
    const res = engine.result();
    const step = res.steps[0];
    expect(step?.summary.flags).toContain('sensor_lost');
    const kinds = res.events.map((e) => e.kind);
    expect(kinds).toContain('sensor_lost');
    expect(kinds).toContain('sensor_restored');
    // В событии — номер места датчика: отчёт пишет «Нет данных от датчика: плечо правое»
    expect(res.events.find((e) => e.kind === 'sensor_lost')?.value).toBe(PLACEMENTS.indexOf('upper_r'));
    // Второй повтор шёл через пропажу — не засчитан; первый, третий и четвёртый — засчитаны
    expect(step?.summary.reps).toHaveLength(3);
  });
});

describe('пропал главный датчик движения', () => {
  it('подъём руки, датчик плеча (главный) пропал на 3 с: подсказка, пометка, угломер пуст', () => {
    const arm = repTrack(140, 1.5, 1, 4);
    const gen = generate({ durationSec: CAL_SEC + 4 * 5 + 1, motion: (t) => armPose('right', { elevation: arm(t) }), places: placesFor('right'), seed: 31, errors: 'ideal' });
    const engine = new SessionEngine({ steps: [{ exercise: 'shoulder_flexion', side: 'right', reps: 0, durationSec: 1e9 }], autoAdvance: false });
    engine.start();
    const gapFrom = CAL_SEC + 6;
    const gapTo = CAL_SEC + 9;
    let checked = 0;
    for (const f of gen.frames) {
      const inGap = f.t >= gapFrom && f.t < gapTo;
      engine.process([inGap ? { ...f, data: { trunk: f.data.trunk, fore_r: f.data.fore_r } } : f]);
      if (inGap && f.t > gapFrom + 0.3) {
        expect(engine.getSnapshot().hint).toBe('sensor_missing');
        expect(engine.getSnapshot().missing).toEqual(['upper_r']);
        expect(engine.live.angle).toBeNull();
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(200);
    engine.stop();
    const res = engine.result();
    expect(res.steps[0]?.summary.flags).toContain('sensor_lost');
    expect(res.steps[0]?.summary.reps).toHaveLength(3);
  });
});

describe('калибровка с движением не выдаётся за чистую', () => {
  it('ребёнок двигается во всех четырёх попытках: калибровка принята, но событие и пометка на шаге есть', () => {
    // Локоть покачивается ±15° всё время калибровки, затем три чистых повтора
    const wobble = (t: number) => (t < 16 ? 15 + 15 * Math.sin(2 * Math.PI * 0.7 * t) : 0);
    const reps = repTrack(110, 1.5, 1, 3, 1, 17);
    const gen = generate({ durationSec: 17 + 3 * 5 + 1, motion: (t) => armPose('right', { elbow: t < 16 ? wobble(t) : reps(t) }), places: placesFor('right'), seed: 9, errors: 'ideal' });
    const engine = elbowEngine();
    engine.process(gen.frames);
    engine.stop();
    const res = engine.result();
    expect(res.calibrationAttempts).toBe(4);
    expect(res.events.some((e) => e.kind === 'calibration_forced')).toBe(true);
    expect(res.steps[0]?.summary.flags).toContain('calibration_moved');
  });

  it('чистая калибровка — без пометки', () => {
    const engine = elbowEngine();
    engine.process(elbowRecording().frames);
    engine.stop();
    const res = engine.result();
    expect(res.events.some((e) => e.kind === 'calibration_forced')).toBe(false);
    expect(res.steps[0]?.summary.flags).not.toContain('calibration_moved');
  });
});

describe('поза калибровки видна в итоге', () => {
  it('локоть согнут на 25° в позе калибровки (контрактура): событие и наклон предплечья около 25°', () => {
    const elbow = repTrack(110, 1.5, 1, 2, 1, CAL_SEC, 25);
    const gen = generate({ durationSec: CAL_SEC + 2 * 5 + 1, motion: (t) => armPose('right', { elbow: elbow(t) }), places: placesFor('right'), seed: 21, errors: 'ideal' });
    const engine = elbowEngine();
    engine.process(gen.frames);
    engine.stop();
    const res = engine.result();
    expect(res.calibrationPose.fore_r).toBeGreaterThanOrEqual(23);
    expect(res.calibrationPose.fore_r).toBeLessThanOrEqual(27);
    expect(res.calibrationPose.upper_r).toBeLessThanOrEqual(2);
    expect(res.events.find((e) => e.kind === 'calibration_pose')?.value).toBe(res.calibrationPose.fore_r);
  });

  it('рука висит, ремешки с перекосом 8°: предупреждения нет', () => {
    const elbow = repTrack(110, 1.5, 1, 2);
    const gen = generate({ durationSec: CAL_SEC + 2 * 5 + 1, motion: (t) => armPose('right', { elbow: elbow(t) }), places: placesFor('right'), seed: 22, errors: 'typical', misalignDeg: 8 });
    const engine = elbowEngine();
    engine.process(gen.frames);
    engine.stop();
    const res = engine.result();
    expect(Math.max(...Object.values(res.calibrationPose))).toBeLessThan(15);
    expect(res.events.some((e) => e.kind === 'calibration_pose')).toBe(false);
  });
});

describe('датчик, надетый наоборот (крышкой к коже), замечается', () => {
  const flip = qAxis([1, 0, 0], 180 * RAD);

  it('поворот предплечья: нейтраль не ловится, подсказка называет датчик, событие в итоге', () => {
    const elbow = keyframes([[0, 0], [CAL_SEC, 0], [CAL_SEC + 1.5, 90]]);
    const gen = generate({ durationSec: CAL_SEC + 6, motion: (t) => armPose('right', { elbow: elbow(t) }), places: placesFor('right'), seed: 41, errors: 'ideal', mountExtra: { fore_r: flip } });
    const engine = new SessionEngine({ steps: [{ exercise: 'forearm_rotation', side: 'right', reps: 0, durationSec: 1e9 }], autoAdvance: false });
    engine.start();
    engine.process(gen.frames);
    expect(engine.currentPhase).toBe('positioning');
    expect(engine.getSnapshot().hint).toBe('mount_flipped');
    expect(engine.getSnapshot().flipped).toBe('fore_r');
    engine.stop();
    expect(engine.result().events.some((e) => e.kind === 'mount_flipped')).toBe(true);
  });

  for (const [exercise, plane] of [['shoulder_flexion', 0], ['shoulder_abduction', 90]] as const) {
    it(`${exercise}: датчик плеча наоборот — пометка и событие, углы подъёма при этом верные`, () => {
      const arm = repTrack(120, 1.5, 1, 2);
      const gen = generate({ durationSec: CAL_SEC + 2 * 5 + 1, motion: (t) => armPose('left', { plane, elevation: arm(t) }), places: placesFor('left'), seed: 42, errors: 'ideal', mountExtra: { upper_l: flip } });
      const engine = new SessionEngine({ steps: [{ exercise, side: 'left', reps: 0, durationSec: 1e9 }], autoAdvance: false });
      engine.start();
      engine.process(gen.frames);
      engine.stop();
      const res = engine.result();
      expect(res.steps[0]?.summary.flags).toContain('mount_flipped');
      expect(res.events.find((e) => e.kind === 'mount_flipped')?.value).toBe(PLACEMENTS.indexOf('upper_l'));
      for (const r of res.steps[0]?.summary.reps ?? []) expect(Math.abs(r.rom - 120)).toBeLessThan(2);
    });
  }

  it('правильное крепление с перекосом 10° и поворот до ±80°: ни одной ложной тревоги, обе руки', () => {
    for (const side of ['right', 'left'] as const) {
      const arm = repTrack(150, 1.5, 1, 2);
      for (const [exercise, plane] of [['shoulder_flexion', 0], ['shoulder_abduction', 90]] as const) {
        const gen = generate({ durationSec: CAL_SEC + 2 * 5 + 1, motion: (t) => armPose(side, { plane, elevation: arm(t) }), places: placesFor(side), seed: 43, errors: 'typical', misalignDeg: 10 });
        const engine = new SessionEngine({ steps: [{ exercise, side, reps: 0, durationSec: 1e9 }], autoAdvance: false });
        engine.start();
        engine.process(gen.frames);
        engine.stop();
        expect(engine.result().events.some((e) => e.kind === 'mount_flipped')).toBe(false);
      }
      const elbow = keyframes([[0, 0], [CAL_SEC, 0], [CAL_SEC + 1.5, 90]]);
      const rot = keyframes([[0, 0], [CAL_SEC + 3, 0], [CAL_SEC + 4.5, 80], [CAL_SEC + 6, -80], [CAL_SEC + 7.5, 0]]);
      const gen = generate({ durationSec: CAL_SEC + 8, motion: (t) => armPose(side, { elbow: elbow(t), proSup: rot(t) }), places: placesFor(side), seed: 44, errors: 'typical', misalignDeg: 10 });
      const engine = new SessionEngine({ steps: [{ exercise: 'forearm_rotation', side, reps: 0, durationSec: 1e9 }], autoAdvance: false });
      engine.start();
      engine.process(gen.frames);
      engine.stop();
      expect(engine.result().events.some((e) => e.kind === 'mount_flipped')).toBe(false);
      expect(engine.result().events.some((e) => e.kind === 'positioning_done')).toBe(true);
    }
  });
});
