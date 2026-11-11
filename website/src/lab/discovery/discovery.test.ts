// Discovery layer: multiplicity control, confirmatory/exploratory, competing explanations, falsification,
// hypothesis registry, evidence graph, report builder (acceptance test I), evidence records. Simulated data only.
import { describe, expect, it } from 'vitest';
import { PROTOCOLS, resolveSteps } from '../../core/protocols';
import { createMemoryStorage } from '../../data/db';
import type { Session } from '../../data/models';
import type { RawFrame } from '../../devices/types';
import { createRng } from '../../lib/random';
import { buildSession } from '../../session/buildSession';
import { SessionEngine } from '../../session/SessionEngine';
import { ImuSimulator } from '../../simulation/imuModel';
import { buildProfile } from '../../simulation/profiles';
import { VirtualPatient } from '../../simulation/VirtualPatient';
import { DEFAULT_ANALYSIS_CONFIG } from '../analysis';
import { buildManifest, hashFrames, timelineFromEvents } from '../coord/provenance';
import { buildParticipantSeries } from '../dataset';
import { labRecordProblem } from '../integrity';
import { REGISTRY, registryEntry } from '../measure/registry';
import { emptyProtocol, makeVersion } from '../protocol';
import { isLabRecord } from '../records';
import { createRun } from '../runs';
import { addHypothesis, addRun, emptyGraph, grounding, nodeOf, traceToRaw } from './evidence';
import { EVIDENCE_MAX_BYTES, evidenceAllowed, evidenceRecordProblem, isEvidenceRecord, sealEvidence } from './evidenceRecord';
import { competingExplanations, falsifyChange, type ChangeEvidence } from './explanations';
import { HYPOTHESES, hypothesisStatus, unobservableMeasurements, type DataInventory } from './hypotheses';
import { analysisIntent, benjaminiHochberg, bonferroni, holm, perLookAlpha } from './multiplicity';
import { pseudonymFor } from '../export';
import { REPORT_SECTIONS, buildReport, reportExportMarkdown, reportToMarkdown } from './report';

describe('multiplicity control', () => {
  it('Holm and Benjamini–Hochberg adjusted p-values match a worked example', () => {
    const p = [0.01, 0.04, 0.03, 0.005];
    // Holm: sorted 0.005, 0.01, 0.03, 0.04 → 0.02, 0.03, 0.06, 0.06
    expect(holm(p).map((a) => a.adjusted)).toEqual([0.03, 0.06, 0.06, 0.02].map((x) => expect.closeTo(x, 12)));
    // BH: 0.02, 0.02, 0.04, 0.04
    expect(benjaminiHochberg(p).map((a) => a.adjusted)).toEqual([0.02, 0.04, 0.04, 0.02].map((x) => expect.closeTo(x, 12)));
    expect(bonferroni(p).map((a) => a.adjusted)).toEqual([0.04, 0.16, 0.12, 0.02].map((x) => expect.closeTo(x, 12)));
    expect(holm(p).filter((a) => a.reject)).toHaveLength(2);
  });
  it('ignores tests that could not be computed and keeps the order', () => {
    const a = holm([0.01, NaN, 0.02]);
    expect(Number.isNaN(a[1]!.adjusted)).toBe(true);
    expect(a[0]!.adjusted).toBeCloseTo(0.02, 12);
    expect(a[2]!.adjusted).toBeCloseTo(0.02, 12);
  });
  it('controls the family-wise error rate where unadjusted testing does not (2000 families of 10 nulls)', () => {
    const rng = createRng(3);
    let raw = 0;
    let adj = 0;
    for (let r = 0; r < 2000; r++) {
      const ps = Array.from({ length: 10 }, () => rng.next());
      if (ps.some((x) => x < 0.05)) raw++;
      if (holm(ps).some((x) => x.reject)) adj++;
    }
    expect(raw / 2000).toBeGreaterThan(0.3);
    expect(adj / 2000).toBeLessThan(0.07);
  });
  it('per-look level for repeated looks', () => {
    expect(perLookAlpha(0.05, 1)).toBe(0.05);
    expect(perLookAlpha(0.05, 10)).toBeCloseTo(1 - 0.95 ** 0.1, 12);
  });
  it('an analysis is confirmatory only with a frozen protocol fixed before the first observation', () => {
    const obs = '2026-03-01T10:00:00Z';
    expect(analysisIntent({ protocol: null, matchesProtocol: false, firstObservation: obs }).intent).toBe('exploratory');
    expect(analysisIntent({ protocol: { status: 'draft', createdAt: '2026-01-01T00:00:00Z' }, matchesProtocol: true, firstObservation: obs }).reasons).toContain('the_protocol_was_never_frozen');
    expect(analysisIntent({ protocol: { status: 'frozen', createdAt: '2026-04-01T00:00:00Z' }, matchesProtocol: true, firstObservation: obs }).reasons).toContain('the_protocol_was_fixed_after_data_collection_had_started');
    expect(analysisIntent({ protocol: { status: 'frozen', createdAt: '2026-01-01T00:00:00Z' }, matchesProtocol: false, firstObservation: obs }).intent).toBe('exploratory');
    expect(analysisIntent({ protocol: { status: 'frozen', createdAt: '2026-01-01T00:00:00Z' }, matchesProtocol: true, firstObservation: obs })).toEqual({ intent: 'confirmatory', reasons: [] });
  });
});

describe('competing explanations', () => {
  const base: ChangeEvidence = {
    feature: 'trunk inclination', unit: '°', delta: -9,
    envelope: { t: -4, p: 0.01, outside: true, direction: 'below', interval: { lo: 10, hi: 20, halfWidth: 5, sd: 2, df: 4 } },
    sensorExpandedUncertainty: 2, placement: { level: 'high', reference: 'r0', sensors: [], expectedBias: [], reasons: [] }, placementBound: 7.5,
    comparability: { comparable: true, differing: [], unknown: [], reasons: [] }, algorithmVersions: { baseline: 'nm-core 0.2.0', later: 'nm-core 0.2.0' }, qualityIssues: [],
    amplitudeRelativeChange: 0.02, isRatioFeature: false, withinSession: 'no_trend_detected', baselineIsFirstSessions: false, independentSupport: null,
  };
  it('lists every alternative with its evidence and what would decide it', () => {
    const r = competingExplanations(base);
    expect(r.alternatives.map((a) => a.id)).toEqual(['measurement_noise', 'sensor_error', 'sensor_placement', 'task_conditions', 'algorithm_change', 'signal_quality', 'amplitude_change', 'within_session_trend', 'familiarisation', 'genuine_change']);
    for (const a of r.alternatives) expect(a.evidence.length).toBeGreaterThan(5);
  });
  it('when every measurement explanation is excluded, what remains is a change of the measured movement — not a cause', () => {
    const r = competingExplanations(base);
    expect(r.conclusion).toBe('measurement_excluded');
    expect(r.open).toEqual([]);
    expect(r.statement).toMatch(/cause and its clinical meaning are not established/);
    expect(r.alternatives.find((a) => a.id === 'genuine_change')!.evidence).toMatch(/no independent measurement exists/);
  });
  it('a change inside the personal envelope is explained by measurement, whatever else is true', () => {
    const r = competingExplanations({ ...base, envelope: { ...base.envelope!, outside: false, p: 0.4, direction: 'inside' } });
    expect(r.conclusion).toBe('explained_by_measurement');
    expect(r.alternatives.find((a) => a.id === 'genuine_change')!.status).toBe('excluded');
  });
  it('a reduction of trunk inclination is not attributed to the movement when placement, task set-up or a session trend are open', () => {
    const r = competingExplanations({ ...base, delta: -5, placementBound: 7.5, comparability: { comparable: true, differing: [], unknown: ['support'], reasons: [] }, withinSession: 'decline_like', baselineIsFirstSessions: true });
    expect(r.conclusion).toBe('measurement_not_excluded');
    expect(r.open).toEqual(expect.arrayContaining(['sensor_placement', 'task_conditions', 'within_session_trend', 'familiarisation']));
    expect(r.statement).toMatch(/cannot be attributed to the movement/);
  });
  it('a different task condition or algorithm version is named, and missing evidence is "not assessable", never assumed fine', () => {
    const r = competingExplanations({ ...base, comparability: { comparable: false, differing: ['targetDeg'], unknown: [], reasons: ['constraint_differs:_targetDeg'] }, algorithmVersions: { baseline: 'nm-core 0.1.0', later: 'nm-core 0.2.0' }, placement: null, placementBound: null, sensorExpandedUncertainty: null, envelope: null });
    const by = Object.fromEntries(r.alternatives.map((a) => [a.id, a.status]));
    expect(by.task_conditions).toBe('sufficient');
    expect(by.algorithm_change).toBe('not_excluded');
    expect(by.sensor_placement).toBe('not_assessable');
    expect(by.sensor_error).toBe('not_assessable');
    expect(by.measurement_noise).toBe('not_assessable');
    expect(r.conclusion).toBe('explained_by_measurement');
  });
  it('a share that changed with the movement amplitude is flagged', () => {
    const r = competingExplanations({ ...base, isRatioFeature: true, amplitudeRelativeChange: -0.25 });
    expect(r.alternatives.find((a) => a.id === 'amplitude_change')!.status).toBe('not_excluded');
  });
});

describe('falsification', () => {
  const rng = createRng(8);
  const sess = (mu: number) => {
    const reps = Array.from({ length: 4 }, () => mu + 4 * rng.normal());
    return { mean: reps.reduce((a, b) => a + b, 0) / 4, reps };
  };
  it('returns nothing when there is no finding to falsify', () => {
    expect(falsifyChange({ sessions: Array.from({ length: 10 }, () => sess(100)), sensorExpandedUncertainty: null, independentSupport: null })).toBeNull();
  });
  it('a robust step survives every runnable check and lists the ones that could not be run', () => {
    const f = falsifyChange({ sessions: [...Array.from({ length: 8 }, () => sess(100)), ...Array.from({ length: 8 }, () => sess(125))], sensorExpandedUncertainty: 2, independentSupport: null })!;
    expect(f.fragile).toBe(false);
    expect(f.checks.find((c) => c.id === 'leave_one_session_out')!.result).toBe('survived');
    expect(f.checks.find((c) => c.id === 'sensor_uncertainty')!.result).toBe('survived');
    expect(f.untested).toEqual(['independent_measurement']);
  });
  it('a finding that an independent measurement contradicts, or that sensor error can explain, is fragile', () => {
    const sessions = [...Array.from({ length: 8 }, () => sess(100)), ...Array.from({ length: 8 }, () => sess(125))];
    expect(falsifyChange({ sessions, sensorExpandedUncertainty: 2, independentSupport: false })!.fragile).toBe(true);
    expect(falsifyChange({ sessions, sensorExpandedUncertainty: 60, independentSupport: true })!.fragile).toBe(true);
  });
});

describe('hypothesis registry', () => {
  it('has a complete, formal entry for every hypothesis', () => {
    expect(HYPOTHESES.length).toBeGreaterThanOrEqual(10);
    expect(new Set(HYPOTHESES.map((h) => h.id)).size).toBe(HYPOTHESES.length);
    for (const h of HYPOTHESES) {
      expect(h.id).toMatch(/^NM-H\d{3}$/);
      for (const k of ['question', 'rationale', 'population', 'taskContext', 'null', 'alternative', 'test', 'sampleSize', 'falsifiedBy', 'blocker'] as const) expect(h[k].length, `${h.id}.${k}`).toBeGreaterThan(15);
      expect(h.independent.length && h.dependent.length && h.confounders.length && h.assumptions.length, h.id).toBeTruthy();
    }
  });
  it('no hypothesis depends on something the sensors cannot observe: every NeuroMove measurement exists and is observable', () => {
    for (const h of HYPOTHESES) {
      expect(unobservableMeasurements(h), h.id).toEqual([]);
      for (const m of h.measurements) expect(registryEntry(m), `${h.id} ${m}`).not.toBeNull();
    }
    // sanity: the check does catch an unobservable quantity
    expect(unobservableMeasurements({ ...HYPOTHESES[0]!, measurements: ['unobservable.muscle_activity'] })).toEqual(['unobservable.muscle_activity']);
    expect(REGISTRY.some((e) => e.id === 'unobservable.muscle_activity')).toBe(true);
  });
  it('no hypothesis claims more than simulation evidence, and none is "testable" in an empty workspace', () => {
    const empty: DataInventory = { realParticipants: 0, maxSessions: 0, rawSessions: 0, maxRepetitionsInARecording: 0, externalAssessments: 0, practiceLog: false, designatesRetention: false, designatesTransfer: false, variesTaskCondition: false };
    for (const h of HYPOTHESES) {
      expect(['none', 'simulation_only']).toContain(h.evidence);
      const s = hypothesisStatus(h, empty);
      expect(s.status).toBe('not_testable_with_current_data');
      expect(s.missing.length).toBeGreaterThan(0);
    }
  });
  it('early-change detection needs an independently assessed functional outcome', () => {
    const h2 = HYPOTHESES.find((h) => h.id === 'NM-H002')!;
    const inv: DataInventory = { realParticipants: 3, maxSessions: 14, rawSessions: 0, maxRepetitionsInARecording: 3, externalAssessments: 0, practiceLog: true, designatesRetention: false, designatesTransfer: false, variesTaskCondition: false };
    expect(hypothesisStatus(h2, inv).missing).toEqual(['repeated, independently assessed functional outcomes']);
    expect(hypothesisStatus(h2, { ...inv, externalAssessments: 3 }).status).toBe('testable');
    expect(h2.external.join(' ')).toMatch(/blinded assessor/);
  });
});

// ── acceptance test I: Report → Analysis → Model → Feature → Trial → Session → Raw ───────────────────────

function recordSession(seed: number, day: number, severity: number): { session: Session; frames: readonly RawFrame[] } {
  const rate = 100;
  const imu = new ImuSimulator(seed, rate);
  const patient = new VirtualPatient(buildProfile({ left: 0.05, right: severity }, 0.5), seed ^ 0x5bd1e995);
  const steps = resolveSteps(PROTOCOLS.upper_standard, 'right').filter((s) => s.side === 'right');
  const engine = new SessionEngine({ steps, rateHz: rate, autoAdvance: true, recordRaw: true });
  engine.onInstruction((ins, t) => patient.instruct(ins, t));
  engine.start();
  for (let seq = 0; seq < 600 * rate && !engine.isFinished; seq++) engine.process([imu.frame(patient.poseAt(seq / rate), seq)]);
  if (!engine.isFinished) engine.stop();
  const result = engine.result();
  const frames = engine.rawFrames;
  const session = buildSession({ id: `s-prov-${day}`, workspace: 'demo', patientId: 'SYN-PROV', protocolId: 'upper_standard', result, startedAt: new Date(Date.UTC(2026, 0, 5 + day)), device: { kind: 'simulator', name: 'sim', firmware: '-', format: 'imu-csv v1', rateHz: rate, simulated: true }, clinician: 'test', demo: true, hasRaw: true });
  const manifest = buildManifest(frames, { rateHz: rate, sync: 'simulated', accCalibrated: false, timeline: timelineFromEvents(result.events, steps), algorithm: session.algorithmVersion, app: session.appVersion });
  if (manifest) session.rawManifest = manifest;
  return { session, frames };
}

describe('evidence graph and report (acceptance test I)', () => {
  const recorded = [0, 7, 14, 21, 28, 35].map((d, k) => recordSession(900 + k, d, 0.5 - 0.05 * k));
  const sessions = recorded.map((r) => r.session);
  const series = buildParticipantSeries('SYN-PROV', sessions, { includeSimulated: true }).filter((s) => s.metric === 'rom' && s.exercise === 'shoulder_flexion');
  const protocol = { ...makeVersion(null, { ...emptyProtocol(), title: 'Provenance test', researchQuestion: 'q', hypothesis: 'no change' }, { workspace: 'demo', author: 'test', now: '2025-12-01T00:00:00.000Z', id: 'lp_prov' }), status: 'frozen' as const };
  const run = createRun({ id: 'run_prov', workspace: 'demo', participantId: 'SYN-PROV', title: 'Provenance run', now: '2026-03-01T00:00:00.000Z', author: 'test', series, config: { ...DEFAULT_ANALYSIS_CONFIG, bootstrap: 0 }, protocol });
  const report = buildReport({ run, sessions, protocol, hypothesisId: 'NM-H002' });

  it('every displayed conclusion traces back to the raw observations, and each link can be inspected', () => {
    const g = report.graph;
    const traces = traceToRaw(g, report.analysisNode);
    expect(traces.length).toBe(sessions.length);
    for (const t of traces) {
      expect(t.reachesRaw).toBe(true);
      // analysis → model → feature → trial → session → raw
      expect(t.path.map((id) => nodeOf(g, id)!.type)).toEqual(['analysis', 'model', 'feature', 'trial', 'session', 'raw']);
    }
    // the raw node carries the SHA-256 of exactly the frames that were recorded
    for (const r of recorded) expect(nodeOf(g, `raw:${r.session.id}`)!.hash).toBe(hashFrames(r.frames));
    // the analysis node carries the run's result hash, the feature node the hash of the analysed observations
    expect(nodeOf(g, report.analysisNode)!.hash).toBe(run.resultHash);
    expect(nodeOf(g, `feature:${run.id}:${series[0]!.key}`)!.hash).toBe(run.results[0]!.dataHash);
    // the trial node holds the repetitions the feature was computed from
    const trial = nodeOf(g, `trial:${run.id}:${series[0]!.key}:${sessions[0]!.id}`)!;
    expect(trial.detail.repetitions).toBe(series[0]!.sessions[0]!.n);
    expect(grounding(g, report.analysisNode)).toEqual({ chains: 6, reachingRaw: 6, stopped: {} });
  });

  it('the report states the hypothesis, the protocol and the literature it rests on', () => {
    const g = report.graph;
    expect(g.edges.some((e) => e.relation === 'tests' && e.to === 'hypothesis:NM-H002')).toBe(true);
    expect(g.edges.some((e) => e.relation === 'pre_specified_by' && e.to === 'protocol:lp_prov')).toBe(true);
    expect(g.edges.filter((e) => e.relation === 'cites').length).toBeGreaterThan(2);
    expect(report.references).toEqual(expect.arrayContaining(['hurvich1989', 'raue2009', 'hawkins1987']));
  });

  it('a session stored without raw frames ends its chain there, and says so', () => {
    const g = emptyGraph();
    const an = addRun(g, run, sessions.map((s, i) => (i === 0 ? { ...s, hasRaw: false, rawManifest: undefined } : s)));
    const stopped = traceToRaw(g, an).filter((t) => !t.reachesRaw);
    expect(stopped).toHaveLength(1);
    expect(stopped[0]!.stoppedBecause).toMatch(/without raw 100 Hz frames/);
    // a run whose sessions left the workspace is still self-contained
    const g2 = emptyGraph();
    const an2 = addRun(g2, run, []);
    expect(traceToRaw(g2, an2).every((t) => /no longer in this workspace/.test(t.stoppedBecause ?? ''))).toBe(true);
    expect(addHypothesis(g2, 'NM-H999')).toBeNull();
  });

  it('has all fifteen sections, tags every statement, and contains no unsupported observation or estimate', () => {
    expect(report.sections.map((s) => s.id)).toEqual([...REPORT_SECTIONS]);
    for (const s of report.sections) {
      expect(s.statements.length, s.id).toBeGreaterThan(0);
      for (const x of s.statements) {
        if (x.kind === 'observation' || x.kind === 'estimate' || x.kind === 'model_dependent') {
          expect(x.evidence.length, x.text).toBeGreaterThan(0);
          for (const id of x.evidence) expect(nodeOf(report.graph, id), `${id} (${x.text.slice(0, 40)})`).not.toBeNull();
        }
      }
    }
    expect(report.provenance).toBe('synthetic_simulation');
    const md = reportToMarkdown(report);
    expect(md).toMatch(/ALL DATA ARE SYNTHETIC/);
    expect(md).toMatch(/## 14\. Reproducibility manifest/);
    expect(md).toMatch(/\[model-dependent\]/);
    expect(md).not.toMatch(/recovery has occurred|diagnos/i);
  });

  it('the exported Markdown is pseudonymised: no participant id, no session id, no session date', () => {
    const inApp = reportToMarkdown(report);
    expect(inApp).toContain(sessions[0]!.id);
    expect(inApp).toContain(sessions[0]!.startedAt.slice(0, 10));
    const md = reportExportMarkdown(report, run);
    expect(md).not.toContain('SYN-PROV');
    for (const s of sessions) {
      expect(md).not.toContain(s.id);
      expect(md).not.toContain(s.startedAt.slice(0, 10));
    }
    expect(md).toContain(pseudonymFor(run));
    expect(md).toMatch(/study day 0/);
    expect(md).toMatch(/study day 35/);
    expect(md).toMatch(/Pseudonymised export/);
    // nothing else is lost: same statements, same sections
    expect(md.split('\n').filter((l) => l.startsWith('- **[')).length).toBe(inApp.split('\n').filter((l) => l.startsWith('- **[')).length);
    expect(md).toMatch(/ALL DATA ARE SYNTHETIC/);
  });

  it('is confirmatory only because a frozen protocol preceded the data; without it the same report is exploratory', () => {
    expect(report.intent).toBe('confirmatory');
    const expl = buildReport({ run: { ...run, protocol: null }, sessions });
    expect(expl.intent).toBe('exploratory');
    expect(expl.sections.find((s) => s.id === 'protocol')!.statements[0]!.kind).toBe('limitation');
    expect(report.manifest.verification).toBe('reproduced');
  });
});

describe('evidence records', () => {
  const rec = sealEvidence({ id: 'ev_1', workspace: 'demo', participantId: 'SYN-1', type: 'twin_snapshot', title: 'Twin snapshot', createdAt: '2026-11-10T00:00:00.000Z', createdBy: 'test', versions: { twin: 'nm-lab-twin 1.0.0' }, derivedFrom: [{ kind: 'analysis_run', id: 'run_1', hash: 'abc' }, { kind: 'session', id: 's1', hash: null }], body: { level: 1 }, simulated: true });
  it('are sealed with a content hash and refused when altered', () => {
    expect(isEvidenceRecord(rec)).toBe(true);
    expect(evidenceRecordProblem({ ...rec, body: { level: 2 } })).toBe('content_hash_mismatch');
    expect(evidenceRecordProblem({ ...rec, derivedFrom: [] })).toBe('content_hash_mismatch');
    expect(evidenceRecordProblem({ ...rec, type: 'nonsense' })).toBe('bad_shape');
    expect(evidenceRecordProblem({ ...rec, kind: 'analysis_run' })).toBe('not_an_evidence_record');
    expect(evidenceRecordProblem(null)).toBe('not_an_object');
  });
  it('refuse an oversized body and simulated content in the clinic workspace', () => {
    const big = sealEvidence({ ...rec, id: 'ev_big', body: { blob: 'x'.repeat(EVIDENCE_MAX_BYTES) } });
    expect(evidenceRecordProblem(big)).toBe('too_large');
    expect(evidenceAllowed(rec)).toBe(true);
    expect(evidenceAllowed(sealEvidence({ ...rec, workspace: 'clinic' }))).toBe(false);
  });
  it('are stored beside lab records without an outbox op: never queued for the server, invisible to lab-record readers', async () => {
    const st = createMemoryStorage();
    const real = sealEvidence({ ...rec, id: 'ev_2', workspace: 'clinic', simulated: false });
    await st.putResearchBatch('lab', [rec, real], []);
    const all = await st.getAllResearch('lab');
    expect(all).toHaveLength(2);
    expect(all.filter(isLabRecord)).toHaveLength(0);
    expect(all.filter(isEvidenceRecord).map((e) => e.id).sort()).toEqual(['ev_1', 'ev_2']);
    expect(await st.listOutbox()).toEqual([]);
    // the integrity check shared with the server refuses the kind, so it could not be uploaded by mistake either
    expect(labRecordProblem(real)).not.toBeNull();
  });
});
