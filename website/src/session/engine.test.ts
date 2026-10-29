// Сеанс целиком на виртуальном пациенте: калибровка → шаги → повторы → итог.

import { describe, expect, it } from 'vitest';
import { PROTOCOLS, resolveSteps } from '../core/protocols';
import { symmetry } from '../core/metrics';
import { runVirtualSession } from '../simulation/runVirtualSession';
import { buildProfile } from '../simulation/profiles';
import { ImuSimulator } from '../simulation/imuModel';
import { VirtualPatient } from '../simulation/VirtualPatient';
import { SessionEngine } from './SessionEngine';
import { emptyStatus } from '../devices/types';

// Правая сторона поражена (как при правосторонней гемиплегии), левая — почти без ограничений
const profile = buildProfile({ left: 0.05, right: 0.45 });

describe('виртуальный сеанс, стандартный протокол', () => {
  const steps = resolveSteps(PROTOCOLS.upper_standard, 'right');
  const r = runVirtualSession({ profile, steps, seed: 42 });

  it('все 8 шагов пройдены, по 3 повтора', () => {
    expect(r.completed).toBe(true);
    expect(r.steps).toHaveLength(8);
    for (const s of r.steps) expect(s.summary.reps.length).toBe(3);
  });

  it('сначала менее поражённая сторона', () => {
    expect(r.steps[0]?.summary.side).toBe('left');
    expect(r.steps[1]?.summary.side).toBe('right');
  });

  it('ROM близок к заданному в модели пациента', () => {
    const byKey = (ex: string, side: string) => r.steps.find((s) => s.summary.exercise === ex && s.summary.side === side)!.summary;
    const flexR = byKey('shoulder_flexion', 'right');
    const flexL = byKey('shoulder_flexion', 'left');
    // У поражённой стороны модель задаёт 166 − 88·0.45 ≈ 126°, плюс наклон туловища назад
    expect(flexR.rom).toBeGreaterThan(110);
    expect(flexR.rom).toBeLessThan(150);
    expect(flexL.rom).toBeGreaterThan(150);
    const sym = symmetry(flexL.rom, flexR.rom, 'right')!;
    expect(sym).toBeGreaterThan(65);
    expect(sym).toBeLessThan(97);
  });

  it('поражённая сторона менее плавная и с большей компенсацией туловищем', () => {
    const flexR = r.steps.find((s) => s.summary.exercise === 'shoulder_flexion' && s.summary.side === 'right')!.summary;
    const flexL = r.steps.find((s) => s.summary.exercise === 'shoulder_flexion' && s.summary.side === 'left')!.summary;
    expect(flexR.sparc).toBeLessThan(flexL.sparc);
    expect(flexR.trunk!).toBeGreaterThan(flexL.trunk! + 3);
  });

  it('поворот предплечья: супинация и пронация посчитаны', () => {
    const rot = r.steps.find((s) => s.summary.exercise === 'forearm_rotation' && s.summary.side === 'left')!.summary;
    expect(rot.supination!).toBeGreaterThan(60);
    expect(rot.pronation!).toBeGreaterThan(60);
  });

  it('качество сигнала 100% без потерь', () => {
    expect(r.quality.lost).toBe(0);
    expect(r.quality.percent).toBeGreaterThan(99);
  });
});

describe('потери пакетов', () => {
  it('потери видны в качестве сигнала', () => {
    const steps = resolveSteps(PROTOCOLS.upper_quick, 'right');
    const r = runVirtualSession({ profile, steps, seed: 7, packetLoss: 0.05 });
    expect(r.quality.lost).toBeGreaterThan(0);
    expect(r.quality.percent).toBeLessThan(97);
    expect(r.quality.percent).toBeGreaterThan(90);
  });
});

describe('команды специалиста', () => {
  function setup(fidget = false) {
    const steps = resolveSteps(PROTOCOLS.upper_quick, 'right');
    const imu = new ImuSimulator(3);
    const patient = new VirtualPatient(profile, 3, { fidgetOnFirstCalibration: fidget });
    const engine = new SessionEngine({ steps });
    engine.onInstruction((ins, t) => patient.instruct(ins, t));
    let seq = 0;
    const runFor = (sec: number) => {
      const end = seq + sec * 100;
      for (; seq < end; seq++) engine.process([imu.frame(patient.poseAt(seq / 100), seq)]);
    };
    return { engine, runFor };
  }

  it('движение во время калибровки — калибровка повторяется', () => {
    const { engine, runFor } = setup(true);
    engine.start();
    runFor(8);
    const snap = engine.getSnapshot();
    expect(snap.calibration.attempt).toBeGreaterThanOrEqual(2);
    expect(snap.events.some((e) => e.kind === 'calibration_moved')).toBe(true);
    expect(snap.phase).toBe('recording');
  });

  it('калибровка не повторяется, если пациент до неё сидел в покое (без рывка при смене позы)', () => {
    const steps = resolveSteps(PROTOCOLS.upper_quick, 'right');
    const imu = new ImuSimulator(11);
    const patient = new VirtualPatient(profile, 11);
    const engine = new SessionEngine({ steps });
    engine.onInstruction((ins, t) => patient.instruct(ins, t));
    // 7 секунд устройство уже шлёт данные (подключение), движок их ещё не видит
    let seq = 0;
    for (; seq < 700; seq++) imu.frame(patient.poseAt(seq / 100), seq);
    engine.start();
    for (const end = seq + 600; seq < end; seq++) engine.process([imu.frame(patient.poseAt(seq / 100), seq)]);
    expect(engine.getSnapshot().calibration.attempt).toBe(1);
    expect(engine.getSnapshot().phase).toBe('recording');
  });

  it('пауза и продолжение', () => {
    const { engine, runFor } = setup();
    engine.start();
    runFor(8);
    engine.pause();
    expect(engine.getSnapshot().phase).toBe('paused');
    const before = engine.getSnapshot().activeSec;
    runFor(3);
    expect(engine.getSnapshot().activeSec).toBeCloseTo(before, 5); // на паузе время записи стоит
    engine.resume();
    runFor(60);
    expect(engine.getSnapshot().phase).not.toBe('paused');
  });

  it('обрыв связи ставит сеанс на паузу, после восстановления — продолжение по кнопке', () => {
    const { engine, runFor } = setup();
    engine.start();
    runFor(6);
    engine.handleDeviceStatus({ ...emptyStatus(), phase: 'reconnecting' });
    expect(engine.getSnapshot().phase).toBe('interrupted');
    engine.handleDeviceStatus({ ...emptyStatus(), phase: 'streaming' });
    expect(engine.getSnapshot().connection).toBe('restored');
    expect(engine.getSnapshot().phase).toBe('interrupted');
    engine.resume();
    runFor(90);
    expect(engine.isFinished).toBe(true);
  });

  it('досрочная остановка: собранное сохраняется, остальное помечено', () => {
    const { engine, runFor } = setup();
    engine.start();
    runFor(20);
    engine.stop();
    const res = engine.result();
    expect(res.completed).toBe(false);
    expect(res.steps.some((s) => s.status === 'skipped')).toBe(true);
    expect(res.steps[0]?.summary.reps.length).toBeGreaterThan(0);
  });

  it('продолжение после перезагрузки страницы', () => {
    const { engine, runFor } = setup();
    engine.start();
    runFor(30);
    const state = engine.resumeState();
    expect(state.completed.length).toBeGreaterThan(0);
    const steps = resolveSteps(PROTOCOLS.upper_quick, 'right');
    const e2 = new SessionEngine({ steps, resume: state });
    const imu = new ImuSimulator(9);
    const patient = new VirtualPatient(profile, 9);
    e2.onInstruction((ins, t) => patient.instruct(ins, t));
    e2.start();
    for (let seq = 0; seq < 120 * 100 && !e2.isFinished; seq++) e2.process([imu.frame(patient.poseAt(seq / 100), seq)]);
    const res = e2.result();
    expect(res.completed).toBe(true);
    expect(res.steps[0]?.summary.rom).toBeCloseTo(state.completed[0]!.summary.rom, 5);
  });
});
