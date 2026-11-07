import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryStorage, openStorage } from '../data/db';
import { holdCapture, repPeakCapture, type SeriesView } from './capture';
import type { ImuCapture, Trial, ValidationSession } from './model';
import { TEMPLATES, checkDefinition, latestVersions, newVersion } from './protocols';
import { errorSummary } from './stats';
import { capture, correctTrial, counts, cursor, markInvalid, parseReference, protocolSlots, repeatMeasurement, saveReference, skip, validPairs, type Result } from './workflow';

const def = { ...(TEMPLATES[0] as (typeof TEMPLATES)[number]).definition, repetitions: 3 }; // 3 reps × 2 points

const session: ValidationSession = {
  id: 'vs_1',
  workspace: 'clinic',
  participantId: 'p_1',
  operator: 'A',
  protocolKey: 'prot_1@1',
  protocol: def,
  protocolVersion: 1,
  device: { kind: 'usb', name: 'Stand', firmware: 'f', format: 'imu-csv v1', rateHz: 100, simulated: false, sensors: [] },
  algorithmVersion: 'x',
  appVersion: 'y',
  startedAt: '2026-11-08T10:00:00.000Z',
  endedAt: null,
  status: 'active',
  calibration: null,
  signal: null,
  notes: '',
  createdAt: '2026-11-08T10:00:00.000Z',
  updatedAt: '2026-11-08T10:00:00.000Z',
};

const imu = (angleDeg: number): ImuCapture => ({ angleDeg, method: 'hold', tFrom: 0, tTo: 1, samples: 100, windowSdDeg: 0.3, windowMinDeg: angleDeg - 0.5, windowMaxDeg: angleDeg + 0.5, capturedAt: '2026-11-08T10:00:01.000Z' });

/** Apply a workflow result to an in-memory trial list (upsert by id), like the store does. */
function apply(trials: Trial[], r: Result<Trial[]>): Trial[] {
  if (!r.ok) throw new Error(r.error);
  const byId = new Map(trials.map((t) => [t.id, t]));
  for (const t of r.value) byId.set(t.id, t);
  return [...byId.values()];
}

describe('repetition workflow', () => {
  it('slots are set → repetition → point', () => {
    expect(protocolSlots(def).map((s) => `${s.set}.${s.repetition}.${s.pointId}`)).toEqual(['1.1.p1', '1.1.p2', '1.2.p1', '1.2.p2', '1.3.p1', '1.3.p2']);
  });

  it('pauses after each capture until the goniometer value is saved', () => {
    let trials: Trial[] = [];
    trials = apply(trials, capture(session, trials, imu(82.4), 'A'));
    const c = cursor(def, trials);
    expect(c.pending?.imu?.angleDeg).toBe(82.4);
    // A second capture while one is pending is refused: the session is paused for the reference
    expect(capture(session, trials, imu(83), 'A')).toEqual({ ok: false, error: 'already_pending' });
    trials = apply(trials, saveReference(session, trials, c.pending!.id, 85, ''));
    const t = trials[0]!;
    expect(t.status).toBe('valid');
    expect(t.referenceDeg).toBe(85);
    // Paired with exactly this IMU capture; error derived, not stored
    expect(errorSummary(validPairs(trials)).bias).toBeCloseTo(-2.6, 12);
    expect(cursor(def, trials).slot).toEqual({ set: 1, repetition: 1, pointId: 'p2' });
  });

  it('repeat keeps the old attempt as superseded; invalid and skip need a reason', () => {
    let trials: Trial[] = [];
    trials = apply(trials, capture(session, trials, imu(70), 'A'));
    trials = apply(trials, repeatMeasurement(session, trials, 'participant moved'));
    expect(trials[0]!.status).toBe('superseded');
    expect(cursor(def, trials).pending).toBeNull();
    trials = apply(trials, capture(session, trials, imu(71), 'A'));
    expect(cursor(def, trials).pending!.attempt).toBe(2);
    expect(markInvalid(session, trials, '  ', 'A')).toEqual({ ok: false, error: 'reason_required' });
    trials = apply(trials, markInvalid(session, trials, 'goniometer slipped', 'A'));
    expect(skip(session, trials, '', 'A')).toEqual({ ok: false, error: 'reason_required' });
    trials = apply(trials, skip(session, trials, 'pain reported', 'A'));
    const n = counts(def, trials);
    expect(n).toMatchObject({ slots: 6, valid: 0, invalid: 1, skipped: 1, missing: 4, superseded: 1 });
    expect(validPairs(trials)).toHaveLength(0);
  });

  it('skip after a capture keeps the capture (superseded) and closes the slot', () => {
    let trials: Trial[] = [];
    trials = apply(trials, capture(session, trials, imu(70), 'A'));
    const r = skip(session, trials, 'tremor', 'A');
    expect(r.ok && r.value.map((t) => t.status)).toEqual(['superseded', 'skipped']);
    trials = apply(trials, r);
    expect(cursor(def, trials).index).toBe(1);
  });

  it('rejects an out-of-range or non-numeric reference', () => {
    let trials: Trial[] = [];
    trials = apply(trials, capture(session, trials, imu(70), 'A'));
    const id = cursor(def, trials).pending!.id;
    expect(saveReference(session, trials, id, Number.NaN, '')).toEqual({ ok: false, error: 'invalid_reference' });
    expect(saveReference(session, trials, id, 1000, '')).toEqual({ ok: false, error: 'invalid_reference' });
    expect(saveReference(session, trials, 'other', 80, '')).toEqual({ ok: false, error: 'not_pending' });
    expect(parseReference('82,5')).toBe(82.5);
    expect(parseReference('82.5°')).toBe(82.5);
    expect(parseReference('')).toBeNull();
    expect(parseReference('abc')).toBeNull();
  });

  it('correcting a previous repetition supersedes it; the original value stays in the audit trail', () => {
    let trials: Trial[] = [];
    trials = apply(trials, capture(session, trials, imu(80), 'A'));
    trials = apply(trials, saveReference(session, trials, cursor(def, trials).pending!.id, 90, ''));
    const original = trials[0]!;
    trials = apply(trials, correctTrial(trials, original.id, { referenceDeg: 81 }, 'B'));
    expect(trials.find((t) => t.id === original.id)!.status).toBe('superseded');
    expect(trials.find((t) => t.id === original.id)!.referenceDeg).toBe(90);
    const pairs = validPairs(trials);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.ref).toBe(81);
    expect(pairs[0]!.trial.operator).toBe('B');
  });

  it('completes after the last slot and then refuses captures', () => {
    let trials: Trial[] = [];
    for (let i = 0; i < 6; i++) {
      trials = apply(trials, capture(session, trials, imu(80 + i), 'A'));
      trials = apply(trials, saveReference(session, trials, cursor(def, trials).pending!.id, 80, ''));
    }
    expect(cursor(def, trials).complete).toBe(true);
    expect(capture(session, trials, imu(1), 'A')).toEqual({ ok: false, error: 'session_closed' });
    expect(counts(def, trials).valid).toBe(6);
  });
});

describe('recovery after reload', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('cursor and pending capture are restored from IndexedDB alone', async () => {
    const s1 = await openStorage();
    let trials: Trial[] = [];
    const steps = [capture(session, trials, imu(80), 'A')];
    trials = apply(trials, steps[0]!);
    await s1.putResearchBatch('trials', trials, []);
    trials = apply(trials, saveReference(session, trials, cursor(def, trials).pending!.id, 81, ''));
    trials = apply(trials, capture(session, trials, imu(10), 'A'));
    await s1.putResearchBatch('trials', trials, []);
    await s1.putResearchBatch('vsessions', [session], []);

    // "Reload": a new storage handle, nothing kept in memory
    const s2 = await openStorage();
    const restored = (await s2.getAllResearch('trials')).filter((t) => t.sessionId === session.id);
    const c = cursor((await s2.getAllResearch('vsessions'))[0]!.protocol, restored);
    expect(c.closed).toBe(1);
    expect(c.slot).toEqual({ set: 1, repetition: 1, pointId: 'p2' });
    expect(c.pending?.imu?.angleDeg).toBe(10);
  });

  it('a duplicate submission of the same trial is a no-op (upsert by id)', async () => {
    const s = createMemoryStorage();
    const r = capture(session, [], imu(80), 'A');
    if (!r.ok) throw new Error();
    await s.putResearchBatch('trials', r.value, []);
    await s.putResearchBatch('trials', r.value, []);
    expect(await s.getAllResearch('trials')).toHaveLength(1);
  });
});

describe('protocol versions', () => {
  it('editing creates a new version and never changes the old one', () => {
    const v1 = newVersion([], def, 'clinic', 'A', 'prot_x')!;
    expect(v1.version).toBe(1);
    expect(newVersion([v1], def, 'clinic', 'A', 'prot_x')).toBeNull(); // unchanged → no version
    const v2 = newVersion([v1], { ...def, repetitions: 5 }, 'clinic', 'A', 'prot_x')!;
    expect(v2.version).toBe(2);
    expect(v1.definition.repetitions).toBe(3);
    expect(latestVersions([v1, v2]).map((v) => v.key)).toEqual(['prot_x@2']);
  });
  it('validates definitions', () => {
    expect(checkDefinition(def)).toEqual([]);
    expect(checkDefinition({ ...def, name: '', measurementPoints: [], repetitions: 0 })).toEqual(['name_required', 'points_required', 'repetitions_range']);
  });
});

describe('IMU capture from the live series', () => {
  const view = (angles: number[], inRep?: boolean[]): SeriesView => ({
    size: angles.length,
    t: (i) => i / 100,
    angle: (i) => angles[i] as number,
    inRep: (i) => inRep?.[i] ?? false,
  });
  it('hold capture = median of the last window, with its SD', () => {
    const angles = [...Array(200).fill(10), ...Array(99).fill(90), 500]; // one spike at the end
    const c = holdCapture(view(angles), 1, 30) as ImuCapture;
    expect(c.angleDeg).toBe(90);
    expect(c.samples).toBe(101);
    expect(c.windowMaxDeg).toBe(500);
    expect(c.windowSdDeg).toBeGreaterThan(0);
  });
  it('refuses a capture without enough samples', () => {
    expect(holdCapture(view([]), 1, 30)).toBe('no_samples');
    expect(holdCapture(view([1, 2, 3]), 1, 30)).toBe('too_few_samples');
  });
  it('rep peak = max of the last completed repetition', () => {
    const angles = [0, 0, 20, 60, 95, 60, 20, 0, 0];
    const inRep = [false, false, true, true, true, true, true, false, false];
    expect((repPeakCapture(view(angles, inRep), 'max_flexion', 3) as ImuCapture).angleDeg).toBe(95);
    expect((repPeakCapture(view(angles, inRep), 'max_extension', 3) as ImuCapture).angleDeg).toBe(20);
  });
});
