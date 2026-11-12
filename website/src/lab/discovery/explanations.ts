// Competing explanations and falsification — for every candidate finding, the engine lists the OTHER things that
// could have produced it and says, from the structured evidence that exists, which are excluded, which are not, and
// which cannot even be assessed. It never picks "the most attractive explanation": a genuine change of the movement
// is only what remains when the measurement explanations have been excluded — and it is still not a cause.
//
// Explanations considered for "feature X changed between the baseline and a later session":
//   measurement_noise      within the person's ordinary session-to-session variation (measure/envelope.ts)
//   sensor_error           within the sensor's own uncertainty budget (measure/uncertainty.ts)
//   sensor_placement       strap tilt / calibration posture / axis convention (measure/placement.ts)
//   task_conditions        the two recordings were not the same task condition (tasks/library.ts)
//   algorithm_change       computed by different algorithm versions
//   signal_quality         a quality problem in one of the recordings
//   amplitude_change       a ratio or share changed because the movement amplitude changed, not the organisation
//   within_session_trend   the later session's value is dominated by a trend inside that session (fatigue-like, warm-up)
//   familiarisation        the baseline is the very first session(s): learning the TEST, not the movement
//   genuine_change         what is left — "a change of the measured movement", cause unidentified
//
// Falsification checks for a finding on a series (each is a way the finding could be shown wrong):
//   leave_one_session_out      does it survive the removal of any single session?
//   leave_one_repetition_out   does it rest on one repetition?
//   other_method               does a different reasonable method agree?
//   stricter_threshold         does it survive a stricter error level?
//   sensor_uncertainty         is it larger than the expanded measurement uncertainty?
//   independent_measurement    is it supported by a measurement that does not share its error sources?

import type { PlacementConfidence } from '../measure/placement';
import type { EnvelopeAssessment } from '../measure/envelope';
import { detectChange } from '../observatory/changeDetection';
import type { SittingPattern } from '../observatory/withinSession';
import type { Comparability } from '../tasks/library';

export const EXPLANATIONS = ['measurement_noise', 'sensor_error', 'sensor_placement', 'task_conditions', 'algorithm_change', 'signal_quality', 'amplitude_change', 'within_session_trend', 'familiarisation', 'genuine_change'] as const;
export type ExplanationId = (typeof EXPLANATIONS)[number];

export type ExplanationStatus = 'excluded' | 'not_excluded' | 'sufficient' | 'not_assessable';

export interface ExplanationVerdict {
  id: ExplanationId;
  /**
   * excluded        the evidence rules it out as the explanation of the change
   * sufficient      it alone could account for the whole change
   * not_excluded    it could contribute and the evidence does not rule it out
   * not_assessable  the evidence needed to judge it does not exist
   */
  status: ExplanationStatus;
  evidence: string;
  /** What measurement would decide it. */
  wouldDecide: string;
}

export interface ChangeEvidence {
  feature: string;
  unit: string;
  /** later − baseline. */
  delta: number;
  /** Assessment of the later session against the person's own baseline envelope; null when no envelope exists. */
  envelope: EnvelopeAssessment | null;
  /** Expanded (95 %) measurement uncertainty of the difference from the sensor budgets; null when not propagated. */
  sensorExpandedUncertainty: number | null;
  /** Placement comparison of the later recording against the baseline; null when no raw frames / no reference. */
  placement: PlacementConfidence | null;
  /** Bound below which a difference cannot be attributed across re-attached sessions, for THIS feature; null = unknown. */
  placementBound: number | null;
  comparability: Comparability | null;
  algorithmVersions: { baseline: string; later: string };
  /** Blocking quality issues of either recording (empty = none). */
  qualityIssues: readonly string[];
  /** For ratio/share features: relative change of the movement amplitude between the recordings; null otherwise. */
  amplitudeRelativeChange: number | null;
  isRatioFeature: boolean;
  /** Pattern across the repetitions of the later session; null when it has too few repetitions. */
  withinSession: SittingPattern | null;
  /** The baseline consists of the participant's first session(s) of this task. */
  baselineIsFirstSessions: boolean;
  /** An independently measured outcome (clinical assessment, goniometer) changed in the same direction: true/false; null = none exists. */
  independentSupport: boolean | null;
}

export interface ExplanationReport {
  feature: string;
  delta: number;
  alternatives: ExplanationVerdict[];
  /** Explanations other than a genuine change that are NOT excluded. */
  open: ExplanationId[];
  /**
   * explained_by_measurement   a measurement explanation is sufficient on its own
   * measurement_not_excluded   none is sufficient, but at least one cannot be excluded or assessed
   * measurement_excluded       every measurement explanation is excluded: a change of the measured movement remains
   *                            (its CAUSE is not identified, and clinical meaning is a separate question)
   */
  conclusion: 'explained_by_measurement' | 'measurement_not_excluded' | 'measurement_excluded';
  statement: string;
}

export function competingExplanations(e: ChangeEvidence): ExplanationReport {
  const v: ExplanationVerdict[] = [];
  const abs = Math.abs(e.delta);
  // measurement noise (the person's own variation)
  if (!e.envelope) v.push({ id: 'measurement_noise', status: 'not_assessable', evidence: 'no baseline envelope: fewer than 3 stable baseline sessions', wouldDecide: 'at least 3 baseline sessions under stable conditions' });
  else if (!e.envelope.outside) v.push({ id: 'measurement_noise', status: 'sufficient', evidence: `inside the person's own 95 % envelope (p ${e.envelope.p.toFixed(3)})`, wouldDecide: 'more sessions at the new level' });
  else v.push({ id: 'measurement_noise', status: 'excluded', evidence: `outside the person's own 95 % envelope (p ${e.envelope.p.toFixed(3)})`, wouldDecide: '—' });
  // sensor error
  if (e.sensorExpandedUncertainty === null) v.push({ id: 'sensor_error', status: 'not_assessable', evidence: 'sensor uncertainty not propagated (no raw frames, or not run)', wouldDecide: 'raw 100 Hz frames of both recordings' });
  else if (abs <= e.sensorExpandedUncertainty) v.push({ id: 'sensor_error', status: 'sufficient', evidence: `|Δ| ${abs.toFixed(2)} ≤ expanded sensor uncertainty ${e.sensorExpandedUncertainty.toFixed(2)} ${e.unit}`, wouldDecide: 'accelerometer 6-position calibration; more repetitions' });
  else v.push({ id: 'sensor_error', status: 'excluded', evidence: `|Δ| ${abs.toFixed(2)} > expanded sensor uncertainty ${e.sensorExpandedUncertainty.toFixed(2)} ${e.unit}`, wouldDecide: '—' });
  // placement
  if (!e.placement || e.placement.level === 'unknown' || e.placementBound === null) v.push({ id: 'sensor_placement', status: 'not_assessable', evidence: 'no placement comparison (needs raw frames of both recordings and the same exercise)', wouldDecide: 'raw frames; a re-donning reliability study' });
  else if (abs <= e.placementBound) v.push({ id: 'sensor_placement', status: 'not_excluded', evidence: `|Δ| ${abs.toFixed(2)} ≤ attribution bound ${e.placementBound.toFixed(2)} ${e.unit} (placement confidence ${e.placement.level}); strap tilt and calibration posture cannot be told apart`, wouldDecide: 'repeat the recording after re-attaching the sensors in the same session; photograph strap positions' });
  else v.push({ id: 'sensor_placement', status: 'excluded', evidence: `|Δ| ${abs.toFixed(2)} > attribution bound ${e.placementBound.toFixed(2)} ${e.unit}`, wouldDecide: '—' });
  // task conditions
  if (!e.comparability) v.push({ id: 'task_conditions', status: 'not_assessable', evidence: 'task context of the recordings not available', wouldDecide: 'a protocol that records the task constraints' });
  else if (!e.comparability.comparable) v.push({ id: 'task_conditions', status: 'sufficient', evidence: `not the same task condition: ${e.comparability.reasons.join(', ')}`, wouldDecide: 'repeat under identical constraints' });
  else if (e.comparability.unknown.length) v.push({ id: 'task_conditions', status: 'not_excluded', evidence: `recorded constraints agree; not recorded: ${e.comparability.unknown.join(', ')}`, wouldDecide: 'record these constraints in the protocol' });
  else v.push({ id: 'task_conditions', status: 'excluded', evidence: 'every constraint recorded and equal', wouldDecide: '—' });
  // algorithm
  v.push(e.algorithmVersions.baseline === e.algorithmVersions.later
    ? { id: 'algorithm_change', status: 'excluded', evidence: `both computed by ${e.algorithmVersions.later}`, wouldDecide: '—' }
    : { id: 'algorithm_change', status: 'not_excluded', evidence: `${e.algorithmVersions.baseline} vs ${e.algorithmVersions.later}`, wouldDecide: 'recompute both from raw frames with one version' });
  // quality
  v.push(e.qualityIssues.length
    ? { id: 'signal_quality', status: 'not_excluded', evidence: `quality issues: ${e.qualityIssues.join(', ')}`, wouldDecide: 'a recording without these issues' }
    : { id: 'signal_quality', status: 'excluded', evidence: 'no blocking quality issue in either recording', wouldDecide: '—' });
  // amplitude
  if (!e.isRatioFeature) v.push({ id: 'amplitude_change', status: 'excluded', evidence: 'not a ratio or share', wouldDecide: '—' });
  else if (e.amplitudeRelativeChange === null) v.push({ id: 'amplitude_change', status: 'not_assessable', evidence: 'movement amplitude of the recordings not available', wouldDecide: 'the task outcome of both recordings' });
  else if (Math.abs(e.amplitudeRelativeChange) > 0.1) v.push({ id: 'amplitude_change', status: 'not_excluded', evidence: `movement amplitude changed by ${(100 * e.amplitudeRelativeChange).toFixed(0)} %: a share can change without a change of organisation`, wouldDecide: 'compare repetitions of equal outcome (performance–strategy dissociation)' });
  else v.push({ id: 'amplitude_change', status: 'excluded', evidence: `movement amplitude changed by ${(100 * e.amplitudeRelativeChange).toFixed(0)} % only`, wouldDecide: '—' });
  // within-session trend
  if (e.withinSession === null || e.withinSession === 'insufficient_repetitions') v.push({ id: 'within_session_trend', status: 'not_assessable', evidence: 'too few repetitions in the later session to see a trend inside it', wouldDecide: 'a session with ≥ 8 repetitions' });
  else if (e.withinSession === 'no_trend_detected') v.push({ id: 'within_session_trend', status: 'excluded', evidence: 'no trend across the repetitions of the later session', wouldDecide: '—' });
  else v.push({ id: 'within_session_trend', status: 'not_excluded', evidence: `pattern across the repetitions of the later session: ${e.withinSession}`, wouldDecide: 'compare the first repetitions of both sessions; record rest and perceived effort' });
  // familiarisation
  v.push(e.baselineIsFirstSessions
    ? { id: 'familiarisation', status: 'not_excluded', evidence: 'the baseline is the first session(s) of this task: the child may have learned the test', wouldDecide: 'a familiarisation session before the baseline; a control task' }
    : { id: 'familiarisation', status: 'excluded', evidence: 'the baseline does not include the first session', wouldDecide: '—' });
  const measurement = v.filter((x) => x.id !== 'genuine_change');
  const sufficient = measurement.filter((x) => x.status === 'sufficient');
  const open = measurement.filter((x) => x.status === 'not_excluded' || x.status === 'not_assessable' || x.status === 'sufficient').map((x) => x.id);
  const conclusion: ExplanationReport['conclusion'] = sufficient.length ? 'explained_by_measurement' : open.length ? 'measurement_not_excluded' : 'measurement_excluded';
  const indep = e.independentSupport === null ? 'no independent measurement exists' : e.independentSupport ? 'an independent measurement changed in the same direction' : 'an independent measurement did NOT change in the same direction';
  v.push({
    id: 'genuine_change',
    status: conclusion === 'measurement_excluded' ? 'not_excluded' : conclusion === 'explained_by_measurement' ? 'excluded' : 'not_assessable',
    evidence: conclusion === 'measurement_excluded' ? `every measurement explanation is excluded; ${indep}` : conclusion === 'explained_by_measurement' ? `a measurement explanation is sufficient (${sufficient.map((x) => x.id).join(', ')})` : `cannot be separated from: ${open.join(', ')}; ${indep}`,
    wouldDecide: 'an independently measured functional outcome; replication in further sessions; a controlled design for the cause',
  });
  const statement =
    conclusion === 'explained_by_measurement'
      ? `The change of ${e.feature} is accounted for by ${sufficient.map((x) => x.id.replace(/_/g, ' ')).join(' and ')}.`
      : conclusion === 'measurement_not_excluded'
        ? `The change of ${e.feature} cannot be attributed to the movement: ${open.map((x) => x.replace(/_/g, ' ')).join(', ')} ${open.length === 1 ? 'is' : 'are'} not excluded.`
        : `The change of ${e.feature} is not explained by any of the measurement checks. This is a change of the measured movement; its cause and its clinical meaning are not established by this analysis.`;
  return { feature: e.feature, delta: e.delta, alternatives: v, open, conclusion, statement };
}

// ── falsification ─────────────────────────────────────────────────────────────────────────────────────────

export interface FalsificationCheck {
  id: 'leave_one_session_out' | 'leave_one_repetition_out' | 'other_method' | 'stricter_threshold' | 'sensor_uncertainty' | 'independent_measurement';
  /** survived = the finding stands; failed = the check overturns it; not_assessable = the check could not be run. */
  result: 'survived' | 'failed' | 'not_assessable';
  detail: string;
}

export interface FalsificationReport {
  finding: string;
  checks: FalsificationCheck[];
  /** At least one check overturns the finding. */
  fragile: boolean;
  /** Checks that could not be run: the finding is untested against them. */
  untested: FalsificationCheck['id'][];
}

export interface SeriesFinding {
  /** Session means in time order and the repetitions behind each. */
  sessions: { mean: number; reps: readonly number[] }[];
  /** Expanded sensor uncertainty of a difference of two session means; null when unknown. */
  sensorExpandedUncertainty: number | null;
  independentSupport: boolean | null;
}

/**
 * Try to overturn the finding "the level of this series changed" (primary detector: self-starting CUSUM).
 * Returns null when the primary detector did not signal — there is no finding to falsify.
 */
export function falsifyChange(f: SeriesFinding): FalsificationReport | null {
  const y = f.sessions.map((s) => s.mean);
  const base = detectChange(y);
  if (base.status !== 'change_signalled') return null;
  const checks: FalsificationCheck[] = [];
  // leave one session out
  {
    const lost: number[] = [];
    for (let i = 0; i < y.length; i++) if (detectChange(y.filter((_, j) => j !== i)).status !== 'change_signalled') lost.push(i + 1);
    checks.push({ id: 'leave_one_session_out', result: lost.length ? 'failed' : 'survived', detail: lost.length ? `the signal disappears without session ${lost.join(', ')}` : 'signalled with every single session removed' });
  }
  // leave one repetition out (the most influential repetition of each session)
  {
    const multi = f.sessions.some((s) => s.reps.length >= 3);
    if (!multi) checks.push({ id: 'leave_one_repetition_out', result: 'not_assessable', detail: 'no session has three or more repetitions' });
    else {
      let lost = 0;
      f.sessions.forEach((s, i) => {
        if (s.reps.length < 3) return;
        for (let r = 0; r < s.reps.length; r++) {
          const m = s.reps.filter((_, k) => k !== r).reduce((a, b) => a + b, 0) / (s.reps.length - 1);
          if (detectChange(y.map((v, j) => (j === i ? m : v))).status !== 'change_signalled') lost++;
        }
      });
      checks.push({ id: 'leave_one_repetition_out', result: lost ? 'failed' : 'survived', detail: lost ? `the signal disappears when one of ${lost} single repetitions is removed` : 'no single repetition carries the signal' });
    }
  }
  // other method
  {
    const b = base.bayes;
    const others = [base.ewma.alarmAt !== null ? 'EWMA' : null, base.shewhart.alarmAt !== null ? 'prediction interval' : null, b && b.pChange >= 0.9 ? `Bayesian change point (P = ${b.pChange.toFixed(2)})` : null].filter((x): x is string => x !== null);
    checks.push({ id: 'other_method', result: others.length ? 'survived' : 'failed', detail: others.length ? `also indicated by: ${others.join(', ')}` : `no other method agrees (Bayesian posterior of a change ${b ? b.pChange.toFixed(2) : 'n/a'})` });
  }
  // stricter threshold (α 0.01 = a family of five at 0.05)
  {
    const strict = detectChange(y, { family: 5 });
    checks.push({ id: 'stricter_threshold', result: strict.status === 'change_signalled' ? 'survived' : 'failed', detail: strict.status === 'change_signalled' ? 'still signalled at a false-alarm level of 0.01' : 'not signalled at a false-alarm level of 0.01' });
  }
  // sensor uncertainty
  {
    const b = base.bayes;
    if (f.sensorExpandedUncertainty === null || !b) checks.push({ id: 'sensor_uncertainty', result: 'not_assessable', detail: 'sensor uncertainty not propagated for this series' });
    else checks.push({ id: 'sensor_uncertainty', result: Math.abs(b.shift) > f.sensorExpandedUncertainty ? 'survived' : 'failed', detail: `estimated shift ${b.shift.toFixed(2)} vs expanded sensor uncertainty ${f.sensorExpandedUncertainty.toFixed(2)}` });
  }
  // independent measurement
  checks.push(f.independentSupport === null
    ? { id: 'independent_measurement', result: 'not_assessable', detail: 'no independently measured outcome exists for this period' }
    : { id: 'independent_measurement', result: f.independentSupport ? 'survived' : 'failed', detail: f.independentSupport ? 'an independent measurement changed in the same direction' : 'an independent measurement did not change in the same direction' });
  return { finding: `level of the series changed (${base.cusum.direction}) at session ${(base.cusum.alarmAt ?? 0) + 1}`, checks, fragile: checks.some((c) => c.result === 'failed'), untested: checks.filter((c) => c.result === 'not_assessable').map((c) => c.id) };
}
