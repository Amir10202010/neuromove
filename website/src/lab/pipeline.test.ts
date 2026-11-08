// Integration tests of the whole computational lab on the existing (labelled, simulated) demo workspace:
// dataset → models → twin → frozen run → verification → export → assistant → readiness.

import { beforeAll, describe, expect, it } from 'vitest';
import type { Session, WorkspaceData } from '../data/models';
import { generateDemoWorkspace } from '../data/seed/demo';
import { makeT } from '../i18n';
import type { PracticeRecord } from '../rehab/model';
import { analyzeSeries, DEFAULT_ANALYSIS_CONFIG } from './analysis';
import { answer, evidencePacket, QUESTIONS } from './copilot';
import { buildParticipantSeries, modelData, practiceDose } from './dataset';
import { dictionaryCsv, modelsCsv, observationsCsv, pseudonymFor, runJson } from './export';
import { canonicalJson, hashOf, sha256Hex } from './hash';
import { analysisConfigFromProtocol, canTransition, emptyProtocol, makeVersion, planPower, protocolIntact, resolveTaskSides, validateProtocol } from './protocol';
import { evaluationParticipants, gates, inventory } from './readiness';
import { createRun, verifyRun } from './runs';
import { nextObservationAdvice, regularScenario, runScenario } from './sandbox';
import { buildTwin, TWIN_SCOPE } from './twin';

let data: WorkspaceData;
const fast = { ...DEFAULT_ANALYSIS_CONFIG, bootstrap: 60 };

beforeAll(async () => {
  data = await generateDemoWorkspace({ now: new Date('2026-11-08T12:00:00Z'), t: makeT('en'), clinician: 'Test operator' });
}, 120_000);

describe('hashing', () => {
  it('SHA-256 matches the FIPS test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    expect(sha256Hex('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  });
  it('canonical JSON is key-order independent', () => {
    expect(hashOf({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(hashOf({ b: [1, { d: 3, c: 2 }], a: 1 }));
    expect(canonicalJson({ x: Infinity, y: undefined })).toBe('{"x":null}');
  });
});

describe('learning dataset from stored sessions', () => {
  it('keeps every repetition, keeps excluded sessions visible, never mixes simulated data into a clinic analysis', () => {
    const p = data.patients.find((x) => x.id === 'demo-p03')!;
    const series = buildParticipantSeries(p.id, data.sessions, { includeSimulated: true });
    const rom = series.find((s) => s.exercise === 'shoulder_flexion' && s.side === 'right' && s.metric === 'rom')!;
    expect(rom.sessions.length).toBe(data.sessions.filter((s) => s.patientId === p.id).length);
    for (const o of rom.sessions) expect(o.n).toBe(o.reps.length);
    expect(buildParticipantSeries(p.id, data.sessions, { includeSimulated: false })).toEqual([]);
  });
  it('analyst exclusions are recorded with the reason and the dose before them is carried forward', () => {
    const p = data.patients[0]!;
    const sessions = data.sessions.filter((s) => s.patientId === p.id).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const practice: PracticeRecord[] = sessions.slice(0, -1).map((s, i) => ({ id: `pr${i}`, kind: 'practice', participantId: p.id, date: new Date(Date.parse(s.startedAt) + 2 * 86400_000).toISOString(), durationMin: 10, completion: 'completed' }) as unknown as PracticeRecord);
    const series = buildParticipantSeries(p.id, data.sessions, { includeSimulated: true, practice }).find((s) => s.metric === 'rom' && s.exercise === 'shoulder_flexion' && s.side === 'right')!;
    expect(series.doseSource).toBe('practice_records');
    expect(series.sessions[1]!.doseBefore).toBe(10);
    const victim = series.sessions[2]!.sessionId;
    const a = analyzeSeries(series, { ...fast, excluded: { [victim]: 'strap slipped' } });
    expect(a.excluded).toBe(1);
    const d = a.comparison.prepared;
    expect(d.sessionIds).not.toContain(victim);
    // the session after the excluded one now carries both intervals' practice
    expect(d.dose[2]).toBe(20);
    expect(practiceDose(practice, p.id, null, sessions[1]!.startedAt).count).toBe(1);
  });
});

describe('motor twin on the demo workspace (simulated, labelled)', () => {
  it('P01 (scripted steady improvement of the right arm) — a model of change is selected for right shoulder flexion with a positive slope', () => {
    const twin = buildTwin('demo-p01', data.sessions, { includeSimulated: true, metrics: ['rom'], tasks: ['shoulder_flexion:right'], config: fast });
    const a = twin.tasks[0]!.analyses[0]!;
    expect(a.selected).not.toBe('stationary');
    expect(a.warnings).toContain('simulated_data');
    expect(a.warnings).toContain('dose_assumed_per_visit');
    const lin = a.comparison.rows.find((r) => r.model === 'linear')!.fit;
    const slope = lin.profiles.find((p) => p.param === 'slope_per_week')!;
    expect(slope.lo).toBeGreaterThan(0);
    expect(a.forecast.length).toBe(3);
    expect(a.forecast[0]!.obsHi).toBeGreaterThan(a.forecast[0]!.obsLo);
    expect(twin.simulated).toBe(true);
  });
  it('a participant with a single session gets no model — "insufficient data", never a curve', () => {
    const twin = buildTwin('demo-p05', data.sessions, { includeSimulated: true, metrics: ['rom'], config: fast });
    for (const t of twin.tasks) for (const a of t.analyses) {
      expect(a.selected).toBeNull();
      expect(a.forecast).toEqual([]);
      expect(a.warnings).toContain('no_model_selected');
    }
  });
  it('declares what it represents and what it cannot observe', () => {
    expect(TWIN_SCOPE.cannotObserve).toContain('neural_activity');
    expect(TWIN_SCOPE.cannotObserve).toContain('causes_of_change');
  });
  it('the counterfactual sandbox refuses models without a dose term and labels its output hypothetical', () => {
    const series = buildParticipantSeries('demo-p04', data.sessions, { includeSimulated: true }).find((s) => s.metric === 'rom' && s.exercise === 'shoulder_flexion' && s.side === 'right')!;
    const a = analyzeSeries(series, fast);
    const lr = a.comparison.rows.find((r) => r.model === 'learning_retention')!.fit;
    const st = a.comparison.rows.find((r) => r.model === 'stationary')!.fit;
    expect(runScenario(st, a.comparison.prepared, null, regularScenario('x', 3, 7, 1)).supported).toBe(false);
    const res = runScenario(lr, a.comparison.prepared, null, regularScenario('weekly', 4, 7, 1));
    expect(res.supported).toBe(true);
    expect(res.t.length).toBe(4);
    const longer = runScenario(lr, a.comparison.prepared, null, { ...regularScenario('break', 1, 42, 0) });
    // no practice for 6 weeks: the model can only predict decay toward baseline
    expect(longer.mle[0]!).toBeLessThanOrEqual(res.mle[0]! + 1e-9);
    const adv = nextObservationAdvice(lr, a.comparison.prepared);
    expect(adv?.options.some((o) => o.label === 'no_practice_probe')).toBe(true);
  });
});

describe('frozen analysis runs: reproducibility and integrity', () => {
  const mk = () => {
    const series = buildParticipantSeries('demo-p01', data.sessions, { includeSimulated: true }).filter((s) => s.metric === 'rom' && s.side === 'right' && s.exercise === 'shoulder_flexion');
    return createRun({ id: 'run_1', workspace: 'demo', participantId: 'demo-p01', title: 'test', now: '2026-11-08T12:00:00Z', author: 'tester', series, config: fast, protocol: null });
  };
  it('a run is reproduced by the current engine from its own snapshot', () => {
    const run = mk();
    expect(verifyRun(run)).toEqual({ status: 'reproduced' });
    // survives a JSON round trip (export → import)
    expect(verifyRun(JSON.parse(JSON.stringify(run)))).toEqual({ status: 'reproduced' });
  });
  it('detects tampering with the snapshot, the configuration or the results', () => {
    const r1 = mk();
    r1.snapshot[0]!.sessions[0]!.reps[0] = 999;
    expect(verifyRun(r1)).toEqual({ status: 'tampered', what: 'snapshot' });
    const r2 = mk();
    r2.config.bootstrap = 1;
    expect(verifyRun(r2)).toEqual({ status: 'tampered', what: 'config' });
    const r3 = mk();
    r3.results[0]!.selected = 'stationary';
    expect(verifyRun(r3)).toEqual({ status: 'tampered', what: 'results' });
  });
  it('later changes to the source sessions do not change a frozen run', () => {
    const run = mk();
    const before = run.resultHash;
    const s = data.sessions.find((x) => x.id === run.inputs[0]!.sessionId) as Session;
    const orig = s.steps[0]!.summary.reps[0]!.rom;
    s.steps[0]!.summary.reps[0]!.rom = orig + 50;
    expect(verifyRun(run)).toEqual({ status: 'reproduced' });
    expect(run.resultHash).toBe(before);
    s.steps[0]!.summary.reps[0]!.rom = orig;
  });
});

describe('exports are pseudonymised by default', () => {
  it('no participant id, name or dates in JSON/CSV; the pseudonym is stable per run', () => {
    const series = buildParticipantSeries('demo-p01', data.sessions, { includeSimulated: true }).filter((s) => s.metric === 'rom' && s.exercise === 'shoulder_flexion');
    const run = createRun({ id: 'run_x', workspace: 'demo', participantId: 'demo-p01', title: 't', now: '2026-11-08T12:00:00Z', author: 'a', series, config: fast, protocol: null });
    const name = data.patients.find((p) => p.id === 'demo-p01')!.code;
    const json = runJson(run);
    const csv = observationsCsv(run) + modelsCsv(run);
    for (const text of [json, csv]) {
      expect(text).not.toContain('demo-p01');
      expect(text).not.toContain(name);
      expect(text).not.toMatch(/20\d\d-\d\d-\d\dT/);
    }
    expect(json).toContain(pseudonymFor(run));
    expect(JSON.parse(json).manifest.pseudonymised).toBe(true);
    expect(observationsCsv(run).split('\n')[0]).toContain('study_day');
    expect(dictionaryCsv()).toContain('observations,value');
    expect(runJson(run, { includeDates: true })).toMatch(/20\d\d-\d\d-\d\dT/);
  });
});

describe('study protocols', () => {
  it('validation requires a question, hypothesis and the no-change model', () => {
    const d = emptyProtocol();
    expect(validateProtocol(d)).toEqual(expect.arrayContaining(['title_required', 'question_required', 'hypothesis_required']));
    const ok = { ...d, title: 'ROM acquisition', researchQuestion: 'Q', hypothesis: 'H' };
    expect(validateProtocol(ok)).toEqual([]);
    expect(validateProtocol({ ...ok, analysisPlan: { ...ok.analysisPlan, candidateModels: ['linear'] } })).toContain('stationary_model_required');
    expect(validateProtocol({ ...ok, schedule: { ...ok.schedule, retentionDelayDays: 7 } })).toContain('retention_delay_not_longer_than_interval');
  });
  it('versions are content-hashed; frozen versions can only be archived', () => {
    const d = { ...emptyProtocol(), title: 'T', researchQuestion: 'Q', hypothesis: 'H' };
    const v1 = makeVersion(null, d, { workspace: 'demo', author: 'a', now: '2026-11-08', id: 'lp_1' });
    expect(protocolIntact(v1)).toBe(true);
    expect(protocolIntact({ ...v1, def: { ...v1.def, hypothesis: 'changed' } })).toBe(false);
    const v2 = makeVersion(v1, { ...d, hypothesis: 'H2' }, { workspace: 'demo', author: 'a', now: '2026-11-09', id: 'lp_2' });
    expect(v2.version).toBe(2);
    expect(v2.protocolId).toBe(v1.protocolId);
    expect(canTransition('frozen', 'draft')).toBe(false);
    expect(canTransition('frozen', 'archived')).toBe(true);
  });
  it('a frozen protocol pre-specifies the analysis: models, dose, retention delay, transfer tasks resolved per participant', () => {
    const d = { ...emptyProtocol(), title: 'T', researchQuestion: 'Q', hypothesis: 'H', tasks: [{ exercise: 'shoulder_flexion' as const, side: 'affected' as const, role: 'trained' as const }, { exercise: 'shoulder_flexion' as const, side: 'less_affected' as const, role: 'transfer' as const }] };
    d.analysisPlan = { ...d.analysisPlan, candidateModels: ['stationary', 'linear'], externalMdc: 6 };
    d.schedule = { ...d.schedule, retentionDelayDays: 21 };
    const v = { ...makeVersion(null, d, { workspace: 'demo', author: 'a', now: '2026-11-08', id: 'lp_9' }), status: 'frozen' as const };
    const cfg = analysisConfigFromProtocol(v, 'right', DEFAULT_ANALYSIS_CONFIG);
    expect(cfg.models).toEqual(['stationary', 'linear']);
    expect(cfg.learning.retentionDelayDays).toBe(21);
    expect(cfg.learning.transferTasks).toEqual(['shoulder_flexion:left']);
    expect(cfg.learning.externalMdc).toBe(6);
    expect(resolveTaskSides('affected', 'both')).toEqual([]);
    const series = buildParticipantSeries('demo-p01', data.sessions, { includeSimulated: true }).find((s) => s.metric === 'rom' && s.exercise === 'shoulder_flexion' && s.side === 'left')!;
    expect(analyzeSeries(series, { ...cfg, bootstrap: 0 }).decomposition.transfer.status).toBe('transfer_task');
  });

  it('power planning separates a large effect from no effect', () => {
    const d = { ...emptyProtocol(), title: 'T', researchQuestion: 'Q', hypothesis: 'H', analysisPlan: { ...emptyProtocol().analysisPlan, smallestEffectPerWeek: 4 } };
    const plan = planPower(d, { sigmaE: 4, sigmaS: 2.5, source: 'assumed' }, 15)!;
    expect(plan.power).toBeGreaterThan(0.8);
    expect(plan.falseChange).toBeLessThan(0.3);
  });
});

describe('research assistant is grounded', () => {
  it('answers every question with evidence or says the data cannot answer', () => {
    const series = buildParticipantSeries('demo-p01', data.sessions, { includeSimulated: true }).filter((s) => s.metric === 'rom' && s.exercise === 'shoulder_flexion');
    const analyses = series.map((s) => analyzeSeries(s, fast));
    for (const q of QUESTIONS) {
      const a = answer(q, { series, analyses }, analyses[1]?.seriesKey ?? null);
      expect(['answered', 'insufficient_data', 'not_answerable']).toContain(a.status);
      if (a.status === 'answered') expect(a.evidence.length).toBeGreaterThan(0);
    }
    const one = analyses.find((a) => a.seriesKey.includes('right'))!;
    const cmp = answer('change_vs_noise', { series, analyses }, one.seriesKey);
    expect(cmp.finding?.values.delta).toBeCloseTo(one.decomposition.overall!.delta, 10);
    expect(JSON.stringify(evidencePacket(analyses))).not.toContain('demo-p01');
  });
});

describe('foundation-model readiness', () => {
  it('derives the evaluation gate from a stated precision requirement and reports the real inventory', () => {
    expect(evaluationParticipants(0.1, 0.05)).toBe(16);
    const inv = inventory(data.sessions, [], true);
    expect(inv.participants).toBe(data.patients.filter((p) => data.sessions.some((s) => s.patientId === p.id)).length);
    expect(inv.sessionsWithRaw).toBe(0); // demo history stores no raw frames
    const g = gates(inv);
    expect(g.find((x) => x.id === 'evaluation_precision')!.met).toBe(false);
    expect(g.find((x) => x.id === 'consent')!.met).toBe(false);
    expect(inventory(data.sessions, [], false).sessions).toBe(0);
  });
});

describe('model data', () => {
  it('times start at the first included session', () => {
    const s = buildParticipantSeries('demo-p01', data.sessions, { includeSimulated: true })[0]!;
    const d = modelData(s);
    expect(d.t[0]).toBe(0);
  });
});
