// Синтетический курс для любого пациента — в демо и в клинике. Виртуальный пациент проходит N сеансов
// раз в неделю, ограничение на поражённой стороне постепенно уменьшается (научение). Каждый сеанс посчитан
// тем же движком, что живой тест, и сохраняется вместе с сырым потоком и манифестом — поэтому сразу
// работают модели научения, двойник, стратегии движения, обсерватория и отчёты.
// Все такие сеансы помечены как симуляция (device.simulated, demo) и в отчётах подписаны.

import { PROTOCOLS, resolveSteps, type ProtocolId } from '../core/protocols';
import { ALGORITHM_VERSION, APP_VERSION } from '../core/version';
import type { Patient, Session } from '../data/models';
import type { RawFrame, Side } from '../devices/types';
import { SimulatorDevice } from '../devices/SimulatorDevice';
import { buildManifest, syncModelFor, timelineFromEvents } from '../lab/coord/provenance';
import { buildSession } from '../session/buildSession';
import { expectedRomFn } from '../session/compare';
import { buildProfile } from './profiles';
import { runVirtualSessionRaw } from './runVirtualSession';

export interface SyntheticCourseOptions {
  patient: Patient;
  existing: readonly Session[];
  clinician: string;
  count?: number;
  protocol?: Exclude<ProtocolId, 'custom' | 'single'>;
  /** Дней между сеансами. */
  everyDays?: number;
  now?: Date;
  onProgress?: (done: number, total: number) => void;
}

export async function generateSyntheticCourse(o: SyntheticCourseOptions): Promise<{ session: Session; raw: RawFrame[] }[]> {
  const count = o.count ?? 8;
  const every = o.everyDays ?? 7;
  const now = o.now ?? new Date();
  const protocol = o.protocol ?? 'upper_quick';
  const affected = o.patient.affectedSide;
  const steps = resolveSteps(PROTOCOLS[protocol], affected);
  const info = SimulatorDevice.info();
  const out: { session: Session; raw: RawFrame[] }[] = [];
  const history: Session[] = [...o.existing.filter((s) => s.patientId === o.patient.id)];
  const salt = Date.now() >>> 0;
  const hit = (side: Side) => affected === side || affected === 'both';
  for (let i = 0; i < count; i++) {
    // Научение: ограничение 0.55 → ~0.3 по экспоненте, здоровая сторона почти без ограничения
    const k = Math.exp(-i / Math.max(2, count / 2.5));
    const sev = 0.28 + 0.27 * k;
    const profile = buildProfile({ left: hit('left') ? sev : 0.05, right: hit('right') ? sev : 0.05 }, 0.6);
    const { result, raw } = runVirtualSessionRaw({
      profile,
      steps,
      seed: (salt + i * 7919) >>> 0,
      expectedRom: expectedRomFn(history, o.patient),
    });
    const start = new Date(now.getTime() - (count - 1 - i) * every * 86400000);
    start.setHours(10, 0, 0, 0);
    const session = buildSession({
      workspace: o.patient.workspace,
      patientId: o.patient.id,
      protocolId: protocol,
      result,
      startedAt: start,
      device: { kind: 'simulator', name: info.name, firmware: info.firmware, format: info.format, rateHz: info.rateHz, simulated: true },
      clinician: o.clinician,
      demo: true,
      hasRaw: raw.length > 0,
    });
    const manifest = buildManifest(raw, {
      rateHz: info.rateHz,
      sync: syncModelFor('simulator', true),
      accCalibrated: false,
      timeline: timelineFromEvents(result.events, steps),
      algorithm: ALGORITHM_VERSION,
      app: APP_VERSION,
    });
    if (manifest) session.rawManifest = manifest;
    history.push(session);
    out.push({ session, raw });
    o.onProgress?.(i + 1, count);
    await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}
