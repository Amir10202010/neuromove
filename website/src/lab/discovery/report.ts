// Scientific report builder — a reproducible report assembled from a FROZEN analysis run, in which every substantive
// statement names the evidence it rests on and the kind of statement it is:
//
//   observation      what was recorded or deterministically derived from it
//   estimate         a statistical estimate with its uncertainty
//   model_dependent  an interpretation that holds only if a named model is adequate
//   hypothesis       a registered hypothesis — stated as such, never as a result
//   method           how something was computed
//   limitation       what the report cannot establish
//
// The builder cannot emit an observation, estimate or model-dependent statement without at least one evidence node
// (it throws: a programming error, caught by tests) — so the report contains no unsupported claim by construction.
// No language model is involved: the text is composed from the structured results by fixed templates. If one is
// ever used to polish wording, it may rephrase a statement but not add one: the evidence list is the contract.

import type { Session } from '../../data/models';
import { identifierScrubber, pseudonymFor } from '../export';
import { MODEL_IDS } from '../models';
import type { AnalysisRun } from '../runs';
import { verifyRun } from '../runs';
import type { LearningProtocolVersion } from '../protocol';
import { FRONTIER_VERSIONS, LAB_ENGINE_VERSION } from '../version';
import { falsifyChange, type FalsificationReport } from './explanations';
import { addHypothesis, addRun, emptyGraph, grounding, type EvidenceGraph } from './evidence';
import { hypothesis } from './hypotheses';
import { analysisIntent, holm } from './multiplicity';
import { detectChange } from '../observatory/changeDetection';
import { provenanceOf, type ProvenanceLabel } from '../measure/registry';

export const REPORT_SECTIONS = ['question', 'dataset', 'protocol', 'conditions', 'quality', 'outcomes', 'methods', 'models', 'results', 'uncertainty', 'sensitivity', 'limitations', 'alternatives', 'reproducibility', 'references'] as const;
export type SectionId = (typeof REPORT_SECTIONS)[number];

export const SECTION_TITLES: Record<SectionId, string> = {
  question: '1. Research question',
  dataset: '2. Dataset',
  protocol: '3. Protocol',
  conditions: '4. Measurement conditions',
  quality: '5. Data quality',
  outcomes: '6. Derived outcomes',
  methods: '7. Statistical methods',
  models: '8. Model comparison',
  results: '9. Results',
  uncertainty: '10. Uncertainty',
  sensitivity: '11. Sensitivity analyses',
  limitations: '12. Limitations',
  alternatives: '13. Alternative explanations',
  reproducibility: '14. Reproducibility manifest',
  references: '15. References',
};

export type StatementKind = 'observation' | 'estimate' | 'model_dependent' | 'hypothesis' | 'method' | 'limitation';

export interface Statement {
  text: string;
  kind: StatementKind;
  /** Evidence-graph node ids the statement rests on. */
  evidence: string[];
}

export interface ReportSection {
  id: SectionId;
  title: string;
  statements: Statement[];
}

export interface ScientificReport {
  title: string;
  runId: string;
  intent: 'exploratory' | 'confirmatory';
  intentReasons: string[];
  provenance: ProvenanceLabel;
  sections: ReportSection[];
  graph: EvidenceGraph;
  /** Node id of the analysis in the graph (start of every trace). */
  analysisNode: string;
  manifest: { engine: string; runEngine: string; discovery: string; resultHash: string; snapshotHash: string; configHash: string; verification: string; protocolHash: string | null };
  /** Keys of research/references.bib cited by the methods actually used. */
  references: string[];
}

/** Bibliography keys of the methods a run can use (research/references.bib; all Crossref-verified). */
export const METHOD_REFERENCES = {
  aicc: 'hurvich1989',
  weights: 'burnham2004',
  profile: 'raue2009',
  lfo: 'burkner2020',
  bootstrap: 'stoffer1991',
  performanceLearning: 'kantak2012',
  cusum: 'page1954',
  selfStarting: 'hawkins1987',
  bayesTwoSample: 'gonen2005',
  holm: 'holm1979',
  confirmatory: 'wagenmakers2012',
  reporting: 'collins2024',
} as const;

const NEEDS_EVIDENCE: readonly StatementKind[] = ['observation', 'estimate', 'model_dependent'];

function st(kind: StatementKind, text: string, evidence: string[] = []): Statement {
  if (NEEDS_EVIDENCE.includes(kind) && !evidence.length) throw new Error(`report statement without evidence: ${text.slice(0, 60)}`);
  return { text, kind, evidence };
}

const f1 = (x: number | null | undefined, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? 'n/a' : x.toFixed(d));

export interface ReportInput {
  run: AnalysisRun;
  /** Sessions of the workspace (for raw availability and quality); the run's own snapshot supplies the analysed values. */
  sessions: readonly Session[];
  /** The frozen protocol version the run names, when it is available. */
  protocol?: LearningProtocolVersion | null;
  /** Registered hypothesis the report addresses (discovery/hypotheses.ts), or a free-text question. */
  hypothesisId?: string | null;
  question?: string;
}

export function buildReport(i: ReportInput): ScientificReport {
  const { run } = i;
  const g = emptyGraph();
  const an = addRun(g, run, i.sessions);
  const hn = i.hypothesisId ? addHypothesis(g, i.hypothesisId) : null;
  if (hn) g.edges.push({ from: an, to: hn, relation: 'tests' });
  const h = i.hypothesisId ? hypothesis(i.hypothesisId) : null;
  const firstObs = run.inputs[0]?.startedAt ?? null;
  const matches = !!i.protocol && i.protocol.defHash === run.protocol?.defHash && JSON.stringify(run.config.models) === JSON.stringify(i.protocol.def.analysisPlan.candidateModels);
  const intent = analysisIntent({ protocol: i.protocol ? { status: i.protocol.status, createdAt: i.protocol.createdAt } : null, matchesProtocol: matches, firstObservation: firstObs });
  const refs = new Set<string>([METHOD_REFERENCES.aicc, METHOD_REFERENCES.weights, METHOD_REFERENCES.profile, METHOD_REFERENCES.lfo, METHOD_REFERENCES.performanceLearning, METHOD_REFERENCES.confirmatory, METHOD_REFERENCES.reporting]);
  if (h) for (const r of h.references) refs.add(r);
  const sec: Record<SectionId, Statement[]> = Object.fromEntries(REPORT_SECTIONS.map((s) => [s, [] as Statement[]])) as Record<SectionId, Statement[]>;
  const sim = run.simulated;
  const sessionIds = run.inputs.map((x) => `session:${x.sessionId}`);

  // 1 question
  if (h && hn) {
    sec.question.push(st('hypothesis', `${h.id}. ${h.question}`, [hn]));
    sec.question.push(st('hypothesis', `Null: ${h.null} Alternative: ${h.alternative}`, [hn]));
    sec.question.push(st('limitation', `Evidence for this hypothesis before this report: ${h.evidence.replace(/_/g, ' ')}. ${h.blocker}.`));
  } else sec.question.push(st('hypothesis', i.question?.trim() ? i.question.trim() : 'No research question was registered for this analysis: it is a descriptive, exploratory analysis of one participant\'s series.'));
  sec.question.push(st('method', `This analysis is ${intent.intent.toUpperCase()}${intent.reasons.length ? ` (${intent.reasons.map((r) => r.replace(/_/g, ' ')).join('; ')})` : ' — a frozen protocol fixed the outcome, models and decision rule before the first analysed session'}.`));

  // 2 dataset
  sec.dataset.push(st('observation', `${run.inputs.length} sensor session${run.inputs.length === 1 ? '' : 's'} of one participant between ${firstObs?.slice(0, 10) ?? 'n/a'} and ${run.inputs[run.inputs.length - 1]?.startedAt.slice(0, 10) ?? 'n/a'}; ${run.snapshot.length} series (task × metric).`, sessionIds.length ? sessionIds : [an]));
  sec.dataset.push(st('observation', sim ? 'ALL DATA ARE SYNTHETIC (simulator). The results describe the software, not a child.' : 'Data are real sensor recordings of the clinic workspace; the participant is identified by a pseudonymous id only.', [an]));
  const ground = grounding(g, an);
  sec.dataset.push(st('observation', `Evidence chains from this analysis: ${ground.chains}; ${ground.reachingRaw} reach a stored raw 100 Hz stream${ground.chains > ground.reachingRaw ? `; ${ground.chains - ground.reachingRaw} end at stored repetition metrics (no raw frames kept)` : ''}.`, [an]));

  // 3 protocol
  if (run.protocol) sec.protocol.push(st('observation', `Analysis configuration pre-specified by protocol ${run.protocol.protocolId} version ${run.protocol.version} (definition hash ${run.protocol.defHash.slice(0, 12)}…).`, [`protocol:${run.protocol.id}`]));
  else sec.protocol.push(st('limitation', 'No study protocol is attached to this run: outcomes, models and thresholds were not fixed in advance by a protocol.'));
  if (i.protocol) sec.protocol.push(st('observation', `Protocol "${i.protocol.def.title}": ${i.protocol.def.schedule.acquisitionSessions} acquisition sessions every ${i.protocol.def.schedule.intervalDays} days, ${i.protocol.def.trial.repetitionsPerAssessment} repetitions per assessment, retention delay ${i.protocol.def.schedule.retentionDelayDays} days; status ${i.protocol.status}.`, [`protocol:${i.protocol.id}`]));

  // 4 conditions
  const algs = [...new Set(run.inputs.map((x) => x.algorithmVersion))];
  sec.conditions.push(st('observation', `Angles and repetition metrics computed by ${algs.join(', ')}${algs.length > 1 ? ' — MORE THAN ONE algorithm version: values are not strictly comparable across them' : ''}.`, sessionIds.length ? sessionIds : [an]));
  sec.conditions.push(st('limitation', 'Three six-axis IMUs (trunk, upper arm, forearm), 100 Hz, no magnetometer: heading, hand position, muscle activity and forces are not observed. Angles are relative to the calibration pose of each session; sensors are re-attached every session.'));

  // 5 quality
  const excl = run.snapshot.flatMap((s) => s.sessions.filter((x) => !x.included).map((x) => ({ s, x })));
  if (excl.length) {
    const why: Record<string, number> = {};
    for (const e of excl) for (const r of e.x.exclusions) why[r] = (why[r] ?? 0) + 1;
    sec.quality.push(st('observation', `${excl.length} session-observation${excl.length === 1 ? '' : 's'} excluded by pre-set quality rules (kept in the snapshot, shown with the reason): ${Object.entries(why).map(([k, v]) => `${k} × ${v}`).join(', ')}.`, [...new Set(excl.map((e) => `session:${e.x.sessionId}`))]));
  } else sec.quality.push(st('observation', 'No session was excluded by the quality rules.', [an]));
  const sig = run.snapshot.flatMap((s) => s.sessions.map((x) => x.signalPercent));
  if (sig.length) sec.quality.push(st('observation', `Signal completeness of the analysed sessions: ${f1(Math.min(...sig), 0) === f1(Math.max(...sig), 0) ? f1(Math.min(...sig), 0) : `${f1(Math.min(...sig), 0)}–${f1(Math.max(...sig), 0)}`} %.`, sessionIds.length ? sessionIds : [an]));

  // 6–10 per series
  const changeP: number[] = [];
  const perSeries: { key: string; falsification: FalsificationReport | null }[] = [];
  run.snapshot.forEach((series, k) => {
    const res = run.results[k];
    if (!res) return;
    const fid = `feature:${run.id}:${series.key}`;
    const mid = `model:${run.id}:${series.key}`;
    const name = `${series.metric} · ${series.exercise} · ${series.side}`;
    const inc = series.sessions.filter((s) => s.included);
    const first = inc[0];
    const last = inc[inc.length - 1];
    sec.outcomes.push(st('observation', `${name}: ${inc.length} included sessions, ${inc.reduce((a, s) => a + s.n, 0)} repetitions; first session mean ${f1(first?.mean)} ${series.unit}, last ${f1(last?.mean)} ${series.unit}.`, [fid]));
    // models
    const rows = res.comparison.rows.filter((r) => r.fit.status === 'ok');
    if (rows.length) {
      sec.models.push(st('estimate', `${name}: ${rows.map((r) => `${r.model} ΔAICc ${f1(r.deltaAicc)}, weight ${f1(r.weight, 2)}${r.fit.identifiable || r.model === 'stationary' ? '' : ' (a parameter is not bounded by the data)'}`).join('; ')}. Selected by the pre-specified rule: ${res.selected ?? 'none'} (${res.comparison.selectionReason.join(', ')}).`, [mid]));
      const lfo = res.comparison.rows.find((r) => r.model === res.selected)?.lfo;
      if (lfo && lfo.folds.length) sec.models.push(st('estimate', `${name}: one-step-ahead leave-future-out error of the selected model ${f1(lfo.mae, 2)} ${series.unit} over ${lfo.folds.length} forecasts ("same as last session": ${f1(res.comparison.persistenceMae, 2)}); ${lfo.folds.filter((f) => f.inside95).length} of ${lfo.folds.length} inside their 95 % interval.`, [mid]));
    } else sec.models.push(st('limitation', `${name}: no model could be fitted (${inc.length} included sessions).`));
    // results
    const ov = res.decomposition.overall;
    if (ov) {
      sec.results.push(st('estimate', `${name}: change first → last included session ${f1(ov.delta)} ${series.unit} (SE ${f1(ov.se)}, includes day-to-day and repetition variability); ${ov.exceedsNoise ? 'exceeds' : 'does not exceed'} 1.96 SE${ov.exceedsExternalMdc === null ? '; no external MDC is available for this metric' : ov.exceedsExternalMdc ? '; exceeds the external MDC' : '; does not exceed the external MDC'}.`, [fid, mid]));
      changeP.push(ov.se > 0 ? 2 * (1 - normalCdf(Math.abs(ov.delta / ov.se))) : NaN);
    }
    if (res.selected && res.selected !== 'stationary') sec.results.push(st('model_dependent', `${name}: IF the ${res.selected} model is adequate, the series is better described by change than by a constant level. This describes the measured metric over the sessions; it does not identify a cause and is not evidence of recovery.`, [mid]));
    else if (res.selected === 'stationary') sec.results.push(st('model_dependent', `${name}: "no change" is the selected description. With ${inc.length} sessions this is not evidence that nothing changed (limited power).`, [mid]));
    for (const r of res.decomposition.retention) sec.results.push(st('estimate', `${name}: ${r.kind === 'retention_test' ? 'retention test' : 'delayed observation (NOT a retention test)'} after ${f1(r.days, 0)} days: change ${f1(r.delta)} ${series.unit} (SE ${f1(r.se)}); practice in the delay: ${r.practiceInDelay.replace(/_/g, ' ')}.`, [fid]));
    if (!res.decomposition.retention.length) sec.results.push(st('limitation', `${name}: no retention observation exists — retained learning is not estimable from this series.`));
    // uncertainty
    const row = res.comparison.rows.find((r) => r.model === res.selected);
    if (row) for (const p of row.fit.profiles) sec.uncertainty.push(st('estimate', `${name}: ${p.param} ${f1(p.estimate, 2)}, 95 % profile-likelihood interval [${p.loOpen ? 'open' : f1(p.lo, 2)}; ${p.hiOpen ? 'open' : f1(p.hi, 2)}]${p.loOpen || p.hiOpen ? ' — NOT identifiable from these data' : ''}.`, [mid]));
    sec.uncertainty.push(st('estimate', `${name}: repetition SD ${f1(res.decomposition.sigmaE, 2)} ${series.unit}, day-to-day SD ${f1(res.decomposition.sigmaS, 2)} ${series.unit} (the latter includes re-attachment and calibration posture; it is not separated from the participant's own variation).`, [fid, mid]));
    for (const fc of res.forecast.slice(0, 1)) sec.uncertainty.push(st('model_dependent', `${name}: predicted mean of the next session ${f1(fc.mean)} ${series.unit}, 95 % interval [${f1(fc.obsLo)}; ${f1(fc.obsHi)}] — conditional on the selected model and unchanged conditions; a prediction, not an observation.`, [mid]));
    // sensitivity: change detection + falsification
    const det = detectChange(inc.map((s) => s.mean), { family: run.snapshot.length });
    refs.add(METHOD_REFERENCES.cusum);
    refs.add(METHOD_REFERENCES.selfStarting);
    if (det.bayes) refs.add(METHOD_REFERENCES.bayesTwoSample);
    sec.sensitivity.push(st('estimate', `${name}: independent check by sequential change detection (self-starting CUSUM, family of ${run.snapshot.length}): ${det.status.replace(/_/g, ' ')}${det.bayes ? `; posterior probability of a change of level ${f1(det.bayes.pChange, 2)} (prior scale 0.5/1/2: ${det.bayes.sensitivity.map((x) => f1(x.pChange, 2)).join('/')})` : ''}.`, [fid]));
    const fal = falsifyChange({ sessions: inc.map((s) => ({ mean: s.mean, reps: s.reps })), sensorExpandedUncertainty: null, independentSupport: null });
    perSeries.push({ key: series.key, falsification: fal });
    if (fal) sec.sensitivity.push(st('estimate', `${name}: attempts to overturn the signalled change — ${fal.checks.map((c) => `${c.id.replace(/_/g, ' ')}: ${c.result.replace(/_/g, ' ')}`).join('; ')}. ${fal.fragile ? 'The finding is FRAGILE.' : 'No check overturned it.'}${fal.untested.length ? ` Untested: ${fal.untested.map((x) => x.replace(/_/g, ' ')).join(', ')}.` : ''}`, [fid]));
    for (const w of res.warnings) if (w !== 'simulated_data') sec.limitations.push(st('limitation', `${name}: ${w.replace(/_/g, ' ')}.`));
  });
  // multiplicity over the series of this report
  if (changeP.filter(Number.isFinite).length > 1) {
    refs.add(METHOD_REFERENCES.holm);
    const adj = holm(changeP);
    sec.sensitivity.push(st('estimate', `Multiplicity: ${changeP.length} series were examined. Holm-adjusted p-values of the first → last change: ${adj.map((a) => (Number.isFinite(a.adjusted) ? a.adjusted.toFixed(3) : 'n/a')).join(', ')} — ${adj.filter((a) => a.reject).length} remain below 0.05 after adjustment.`, [an]));
  }

  // 7 methods
  sec.methods.push(st('method', `Measurement model: session mean = latent level + day-to-day deviation + repetition noise. Candidate models (${run.config.models.join(', ')}; "stationary" must be a candidate) fitted by maximum likelihood; comparison by AICc and Akaike weights; selection: smallest model within ΔAICc ≤ 2 whose parameters are identifiable; uncertainty by profile likelihood${run.config.bootstrap > 0 ? ` and parametric bootstrap (${run.config.bootstrap} replicates, seed ${run.config.seed})` : ''}; validation by exact leave-future-out one-step-ahead prediction.`));
  sec.methods.push(st('method', 'Sequential change detection: self-starting recursive residuals with a CUSUM calibrated to a 5 % series-wise false-alarm probability (divided by the number of series examined); retrospective Bayesian single change point at three prior scales. Falsification: leave-one-session-out, leave-one-repetition-out, agreement of a second method, a stricter threshold.'));
  if (MODEL_IDS.some((m) => !run.config.models.includes(m))) sec.methods.push(st('method', `Not all engine models were candidates: ${MODEL_IDS.filter((m) => !run.config.models.includes(m)).join(', ')} excluded by the configuration.`));

  // 12 limitations (general)
  sec.limitations.push(st('limitation', 'No metric of this device has been validated against a reference standard in children; no test–retest reliability or minimal detectable change in children is established. Every value is an IMU-derived measurement, not a clinical score.'));
  sec.limitations.push(st('limitation', 'One participant, observational repeated measures: nothing here supports a causal claim about practice, treatment or recovery, or a statement about other children.'));
  if (sim) sec.limitations.push(st('limitation', 'Synthetic data: a passing analysis shows that the software behaves as specified; it is not evidence about any real participant.'));

  // 13 alternatives
  sec.alternatives.push(st('limitation', 'For any change reported above, these explanations are NOT excluded by this run and must be checked before interpretation: sensor placement and calibration posture (no placement comparison is part of a stored-metrics run), task conditions not recorded, familiarisation with the test when the baseline is the first session, a trend within the later session, growth and maturation over the period. See the competing-explanations workspace for the checks that can be run when raw frames exist.'));
  sec.alternatives.push(st('limitation', 'No independently measured functional outcome is part of this analysis: whether a change of the metric corresponds to a change of function is not addressed.'));

  // 14 reproducibility
  const ver = verifyRun(run);
  sec.reproducibility.push(st('observation', `Frozen run ${run.id}: snapshot ${run.snapshotHash.slice(0, 16)}…, configuration ${run.configHash.slice(0, 16)}…, results ${run.resultHash.slice(0, 16)}…; recomputation with the current engine: ${ver.status}${ver.status === 'differs' ? ` (${ver.changed.length} series differ${ver.engineChanged ? '; the engine version changed' : ''})` : ''}.`, [an]));
  sec.reproducibility.push(st('method', `Engine ${run.engine} (run) / ${LAB_ENGINE_VERSION} (now); discovery layer ${FRONTIER_VERSIONS.discovery}; random seed ${run.config.seed}. The run stores the exact observations analysed: later edits of sessions cannot change it.`));

  // 15 references
  const references = [...refs].sort();
  sec.references.push(st('method', references.join('; ')));

  return {
    title: run.title || `Analysis ${run.id}`,
    runId: run.id,
    intent: intent.intent,
    intentReasons: intent.reasons,
    provenance: provenanceOf('model_estimated', { simulated: sim }),
    sections: REPORT_SECTIONS.map((id) => ({ id, title: SECTION_TITLES[id], statements: sec[id] })),
    graph: g,
    analysisNode: an,
    manifest: { engine: LAB_ENGINE_VERSION, runEngine: run.engine, discovery: FRONTIER_VERSIONS.discovery, resultHash: run.resultHash, snapshotHash: run.snapshotHash, configHash: run.configHash, verification: ver.status, protocolHash: run.protocol?.defHash ?? null },
    references,
  };
}

function normalCdf(z: number): number {
  // Abramowitz–Stegun 26.2.17 (|error| < 7.5e-8) — local to keep this module's imports to the lab's own layers
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

const KIND_TAG: Record<StatementKind, string> = { observation: 'observation', estimate: 'estimate', model_dependent: 'model-dependent', hypothesis: 'hypothesis', method: 'method', limitation: 'limitation' };

/** Plain Markdown: each statement is tagged with its kind and lists its evidence nodes. */
export function reportToMarkdown(r: ScientificReport): string {
  const out: string[] = [`# ${r.title}`, '', `*${r.intent.toUpperCase()} analysis · data: ${r.provenance.replace(/_/g, ' ')} · run ${r.runId} · result hash ${r.manifest.resultHash.slice(0, 16)}…*`, ''];
  for (const s of r.sections) {
    out.push(`## ${s.title}`, '');
    if (!s.statements.length) out.push('_Nothing to report._', '');
    for (const x of s.statements) out.push(`- **[${KIND_TAG[x.kind]}]** ${x.text}${x.evidence.length ? `  \n  _evidence: ${x.evidence.slice(0, 6).join(', ')}${x.evidence.length > 6 ? ` … (+${x.evidence.length - 6})` : ''}_` : ''}`);
    out.push('');
  }
  return out.join('\n');
}

/**
 * The report as Markdown FOR EXPORT, pseudonymised like every other export of a frozen run (lab/export.ts): the
 * participant id and the session ids are replaced by run-local pseudonyms (also inside the evidence node ids), and
 * the calendar dates of the analysed sessions by study days. The report shown inside the app keeps the real ids and
 * dates; a file that leaves the app does not.
 */
export function reportExportMarkdown(r: ScientificReport, run: AnalysisRun): string {
  const scrub = identifierScrubber(run);
  const t0 = Math.min(...run.inputs.map((x) => Date.parse(x.startedAt)));
  const dayOf = new Map(run.inputs.map((x) => [x.startedAt.slice(0, 10), Math.floor((Date.parse(x.startedAt) - t0) / 86_400_000)]));
  const body = scrub(reportToMarkdown(r)).replace(/\d{4}-\d{2}-\d{2}/g, (d) => (dayOf.has(d) ? `study day ${dayOf.get(d)}` : d));
  const note = `> Pseudonymised export: participant ${pseudonymFor(run)}. Participant and session identifiers are run-local pseudonyms; session dates are study days (day 0 = the first analysed session). Small samples can still be re-identifiable.`;
  const [head = '', ...rest] = body.split('\n');
  return [head, '', note, ...rest].join('\n');
}
