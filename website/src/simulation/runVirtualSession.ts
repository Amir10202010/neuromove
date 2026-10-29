// Прогон целого сеанса без ожидания: виртуальный пациент + модель датчиков + тот же SessionEngine.
// Так построены истории демо-пациентов: каждая цифра в них посчитана алгоритмами
// приложения из сырых чисел, а не вписана руками.

import type { ProtocolStep } from '../core/protocols';
import type { ExerciseId } from '../core/exercises';
import type { Placement, RawFrame, Side } from '../devices/types';
import { SessionEngine } from '../session/SessionEngine';
import type { EngineResult } from '../session/types';
import { ImuSimulator } from './imuModel';
import { VirtualPatient, type MovementProfile } from './VirtualPatient';

export interface VirtualSessionOptions {
  profile: MovementProfile;
  steps: ProtocolStep[];
  seed: number;
  expectedRom?: (exercise: ExerciseId, side: Side) => number;
  /** Доля потерянных пакетов — сеанс с плохой связью. */
  packetLoss?: number;
  /** Ограничение времени устройства, секунды (страховка от бесконечного цикла). */
  maxSeconds?: number;
  /** Проверка одним датчиком: в поток идёт только этот датчик, остальных как будто не надели. */
  singleSensor?: Placement;
}

export function runVirtualSession(o: VirtualSessionOptions): EngineResult {
  const rate = 100;
  const imu = new ImuSimulator(o.seed, rate);
  const patient = new VirtualPatient(o.profile, o.seed ^ 0x5bd1e995);
  const engine = new SessionEngine({
    steps: o.steps,
    rateHz: rate,
    autoAdvance: true,
    ...(o.expectedRom ? { expectedRom: o.expectedRom } : {}),
  });
  engine.onInstruction((ins, t) => patient.instruct(ins, t));
  engine.start();

  const max = (o.maxSeconds ?? 900) * rate;
  let lossState = 0x9e3779b9 ^ o.seed;
  for (let seq = 0; seq < max && !engine.isFinished; seq++) {
    const t = seq / rate;
    let frame: RawFrame = imu.frame(patient.poseAt(t), seq);
    if (o.singleSensor) {
      // Остальные датчики модели существуют, но «не надеты»: их чисел в потоке нет
      const raw = frame.data[o.singleSensor];
      frame = { seq: frame.seq, t: frame.t, data: raw ? { [o.singleSensor]: raw } : {} };
    }
    if (o.packetLoss) {
      // Простой детерминированный генератор для потерь — чтобы не трогать зерно движений
      lossState = (Math.imul(lossState ^ (lossState >>> 15), 2246822507) + 0x6d2b79f5) >>> 0;
      if (lossState / 4294967296 < o.packetLoss) continue;
    }
    engine.process([frame]);
  }
  if (!engine.isFinished) engine.stop();
  return engine.result();
}
