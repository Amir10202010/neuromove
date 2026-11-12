// Hypothesis registry — every research hypothesis NeuroMove's engine can be asked to test is written down in one
// form BEFORE data are analysed: question, rationale, variables, operational definitions tied to the observability
// registry, the null and alternative, the test, its assumptions, what data it needs, what would falsify it, and the
// evidence that exists today.
//
// Two rules are enforced by tests (hypotheses.test.ts):
//   • a hypothesis may only name measurements that the current sensors can provide (registry status ≠ not_observable)
//     or that are declared as EXTERNAL assessments — nothing unobservable is silently assumed;
//   • "evidence" is one of: none, simulation only, pilot data, confirmatory data. Simulation shows that the test
//     behaves as specified; it is never evidence that the hypothesis is true of children.
// The registry is code, versioned with the engine. Results attach to a hypothesis as evidence records
// (discovery/evidence.ts); the registry itself never contains a result.

import { registryEntry } from '../measure/registry';

export type EvidenceLevel = 'none' | 'simulation_only' | 'pilot_data' | 'confirmatory_data';
export type HypothesisStatus = 'registered' | 'not_testable_with_current_data' | 'testable' | 'under_test';

export interface Hypothesis {
  id: string;
  question: string;
  rationale: string;
  independent: string[];
  dependent: string[];
  /** Operational definitions: registry ids (measure/registry.ts) of every NeuroMove quantity the test uses. */
  measurements: string[];
  /** Measurements that must come from outside NeuroMove (assessor, protocol, another instrument). */
  external: string[];
  population: string;
  taskContext: string;
  confounders: string[];
  null: string;
  alternative: string;
  /** Statistical test and where it is implemented. */
  test: string;
  assumptions: string[];
  sampleSize: string;
  falsifiedBy: string;
  /** Benchmarks (research/SCIENTIFIC_VALIDATION.md) that characterise the test's behaviour on synthetic data. */
  benchmarks: string[];
  /** Keys of research/references.bib. */
  references: string[];
  evidence: EvidenceLevel;
  /** Why confirmatory work is not yet possible, or what protocol it needs. */
  blocker: string;
  intent: 'exploratory' | 'confirmatory_when_preregistered';
}

const CP = 'Children with unilateral cerebral palsy, MACS I–III, able to follow the task instruction (inclusion and exclusion criteria to be set by clinical experts and the ethics commission)';

export const HYPOTHESES: readonly Hypothesis[] = [
  {
    id: 'NM-H001',
    question: 'Do repetitions of the same task with equivalent task outcomes show reproducibly different intersegment movement strategies within a participant?',
    rationale: 'A task can be completed with different contributions of trunk and arm; an outcome value does not show this. A systematic review of instrumented upper-limb assessment in cerebral palsy found 140 different parameters across 76 studies, task duration being the most frequent (Rozaire et al. 2024).',
    independent: ['strategy cluster (data-driven, neutral label)'],
    dependent: ['phase-normalised trunk, upper-arm and forearm excursion curves'],
    measurements: ['channel.trunk_pitch', 'channel.trunk_roll', 'channel.upper_elev', 'channel.fore_elev', 'coordination.strategy_label', 'coordination.component_score'],
    external: [],
    population: CP,
    taskContext: 'Arm raise forward, one session with ≥ 24 complete repetitions (practice sitting with raw retention), sensors not re-attached',
    confounders: ['sensor re-attachment (strategies must co-occur within a session)', 'outcome differences (matched and tested for equivalence)', 'fatigue-like drift within the sitting', 'instruction changes'],
    null: 'After matching on the task outcome, the multi-segment trajectories of the candidate strategies do not differ beyond repetition-to-repetition variability.',
    alternative: 'They differ (family-wise error controlled over the whole trajectory) while the outcome is equivalent within ±5°, and the difference replicates in split halves.',
    test: 'Performance–Strategy Dissociation: caliper matching, TOST equivalence of the outcome, permutation max-t over channel × time, split-half replication (lab/coord/dissociation.ts)',
    assumptions: ['repetitions exchangeable within a strategy', 'landmark registration removes timing differences only'],
    sampleSize: '≈ 24 repetitions per strategy for 0.95 power in simulation (mcse-validation V7 post hoc); participants: to be fixed by a pilot',
    falsifiedBy: 'No dissociation in a session with ≥ 24 repetitions per candidate pattern; or a difference that disappears in split halves or when sensors are re-attached within the session',
    benchmarks: ['V5', 'V6', 'V7', 'S1a', 'S1b'],
    references: ['rozaire2024', 'nichols2002', 'schuirmann1987', 'lakens2017'],
    evidence: 'simulation_only',
    blocker: 'No real raw multi-sensor recordings of children exist yet; assessment sessions have 3 repetitions per movement',
    intent: 'confirmatory_when_preregistered',
  },
  {
    id: 'NM-H002',
    question: 'Do IMU-derived movement features change consistently within a child BEFORE an independently assessed functional outcome changes?',
    rationale: 'If kinematic change precedes change in clinical scores, it could inform research on early response; if not, the features add no early information.',
    independent: ['time (sessions)'],
    dependent: ['session at which each feature\'s change is signalled', 'session at which the functional outcome changes by its MCID/MDC'],
    measurements: ['metric.rom', 'metric.peak_velocity', 'metric.sparc', 'metric.trunk', 'feature.time_to_peak_fraction'],
    external: ['a standardised upper-limb outcome assessed by a qualified, blinded assessor at fixed intervals (e.g. Assisting Hand Assessment, Melbourne Assessment 2)', 'practice log'],
    population: CP,
    taskContext: 'Standard assessment protocol at every session, ≥ 12 sessions over an intervention period, identical task conditions',
    confounders: ['placement protocol changes', 'familiarisation', 'missing sessions when performance is poor', 'multiple features (family-wise control)', 'assessment schedule coarser than the sensor schedule'],
    null: 'The session of the first sensor-feature signal is not earlier than the session of the functional-outcome change (median lead ≤ 0).',
    alternative: 'The sensor-feature signal precedes the functional change (median lead > 0 sessions), with a false-alarm rate in children whose outcome does not change no higher than the detector\'s nominal rate.',
    test: 'Self-starting CUSUM per feature with family control (lab/observatory/changeDetection.ts); sign test of lead times across participants; false-alarm share in non-changers',
    assumptions: ['independent day-to-day variation (violated by slow wander: benchmark O4)', 'the functional outcome is measured without knowledge of the sensor data'],
    sampleSize: 'Detector power 0.77 for a 2 SD step in 20 sessions (O2): ≥ 12 sessions per child; number of children from the expected share of responders — to be computed in the protocol',
    falsifiedBy: 'Lead times centred on zero or negative; signals as frequent in children without functional change as in those with it',
    benchmarks: ['O1', 'O2', 'O3', 'O4', 'O7', 'O9'],
    references: ['hawkins1987', 'page1954', 'jensen2006', 'adansdester2020'],
    evidence: 'simulation_only',
    blocker: 'Requires prospective longitudinal data WITH independently measured functional outcomes and ethics approval; none exist. A lead in time would still not prove recovery or causation.',
    intent: 'confirmatory_when_preregistered',
  },
  {
    id: 'NM-H003',
    question: 'Is part of the improvement seen at the end of a practice period lost after an interval without practice, and can the forgetting rate be estimated for an individual?',
    rationale: 'Performance during practice over-states learning; retention must be tested after a delay (Kantak & Winstein 2012; Soderstrom & Bjork 2015).',
    independent: ['practice dose between sessions (minutes)', 'length of the no-practice interval'],
    dependent: ['session mean of the task metric at a designated retention test'],
    measurements: ['metric.rom', 'model.change_parameter'],
    external: ['practice log (reported minutes)', 'protocol-designated retention session'],
    population: CP,
    taskContext: 'Trained task; ≥ 10 sessions with breaks of different length and varying dose; retention test after ≥ 4 weeks without practice',
    confounders: ['unreported practice in the delay', 'growth and maturation', 'placement variation', 'regular schedules (forgetting confounded with saturation)'],
    null: 'The learning–retention model is not preferred over the saturation model (ΔAICc ≤ 2), or the retention ratio is 1.',
    alternative: 'The learning–retention model is preferred (ΔAICc > 2), its half-life has a closed 95 % profile interval, and the designated retention test lies below the end-of-practice level by more than the noise.',
    test: 'Model comparison with profile likelihood (lab/fit.ts); retention decomposition (lab/learning.ts)',
    assumptions: ['single-rate exponential forgetting', 'dose spread evenly over each interval', 'no practice in the delay (reported)'],
    sampleSize: '10 sessions with breaks: forgetting preferred in ≈ all simulated series, half-life coverage reported in T5; regular weekly schedules cannot answer the question (E5, T4)',
    falsifiedBy: 'Retention after a long break as good as after a short one; saturation model fitting equally well on a schedule with breaks',
    benchmarks: ['E5', 'T4', 'T5'],
    references: ['kantak2012', 'soderstrom2015', 'casadio2012', 'raue2009'],
    evidence: 'simulation_only',
    blocker: 'Needs a protocol with deliberate no-practice intervals — an ethical and clinical decision, not a software one',
    intent: 'confirmatory_when_preregistered',
  },
  {
    id: 'NM-H004',
    question: 'When trunk contribution varies between repetitions of sagittal arm raising, is the task outcome preserved (the arm absorbs the variation) or does the variation pass into the outcome?',
    rationale: 'Trunk motion can enable a task or mask limited arm capacity; which one holds for a child and task is an empirical question (motor abundance; Scholz & Schöner 1999).',
    independent: ['signed trunk pitch excursion per repetition'],
    dependent: ['task outcome (upper-arm inclination excursion) per repetition'],
    measurements: ['channel.trunk_pitch', 'channel.upper_elev', 'coordination.trunk_contribution'],
    external: [],
    population: CP,
    taskContext: 'Arm raise forward to a fixed target, one sitting of ≥ 24 repetitions, movement about one axis (planarity ≥ 0.9)',
    confounders: ['out-of-plane arm movement', 'a common drive (effortful repetitions larger in both)', 'trunk measurement noise (corrected)', 'target not fixed'],
    null: 'Pass-through = 1 (trunk and arm-relative excursions vary independently).',
    alternative: 'Pass-through < 1 with a 95 % interval below 0.5 (outcome preserved) — or > 1 (reinforcing); both are reported, neither is called good or bad.',
    test: 'Errors-in-variables regression of outcome on trunk excursion with bootstrap interval (lab/coord/flexibility.ts trunkOutcomeTradeoff)',
    assumptions: ['planar chain: outcome = arm relative to trunk − trunk pitch', 'repetitions independent'],
    sampleSize: '24 repetitions recover pass-through 0 and 1 within ±0.03 in simulation (S4)',
    falsifiedBy: 'Interval covering both 0 and 1 with ≥ 24 repetitions; pass-through that changes sign between sittings of the same child',
    benchmarks: ['S4'],
    references: ['scholz1999', 'latash2002'],
    evidence: 'simulation_only',
    blocker: 'Needs practice sittings with raw retention; validated for sagittal arm raising only',
    intent: 'exploratory',
  },
  {
    id: 'NM-H005',
    question: 'Does a child have a multivariate movement description that is reproducible across sessions beyond the variation caused by re-attaching the sensors?',
    rationale: 'Only person-specific, reproducible features can carry information about individual change.',
    independent: ['participant'],
    dependent: ['session feature vector (standardised)'],
    measurements: ['channel.upper_elev', 'channel.trunk_pitch', 'channel.elbow_flex', 'coordination.trunk_contribution', 'feature.duration', 'feature.peak_speed'],
    external: [],
    population: CP,
    taskContext: '≥ 2 sessions per child with the standard tasks, sensors re-attached each session, ≥ 5 children',
    confounders: ['a child always wearing a sensor the same wrong way (placement masquerading as signature)', 'age and size differences in speed'],
    null: 'A later session is matched to the same child\'s first session no more often than chance.',
    alternative: 'Identification above chance (permutation p < 0.05), carried by placement-robust features.',
    test: 'Nearest-neighbour identification with participant-label permutation; per-feature ICC(1,1) (lab/coord/signature.ts)',
    assumptions: ['features standardised over all sessions', 'sessions of a child exchangeable'],
    sampleSize: '8 synthetic participants: identification 0.96 vs chance 0.125 (S5); real children: unknown',
    falsifiedBy: 'Identification at chance; or carried only by placement-sensitive features',
    benchmarks: ['S5a', 'S5b'],
    references: ['saeb2017'],
    evidence: 'simulation_only',
    blocker: 'Needs repeated sessions of several real children',
    intent: 'exploratory',
  },
  {
    id: 'NM-H006',
    question: 'Does the organisation of a child\'s arm raise change with the target height beyond what scaling the same movement explains?',
    rationale: 'Adapting coordination to task demands differs from producing the same pattern larger; minimising variability is not the same as flexibility.',
    independent: ['target height (two or more levels, interleaved within a session)'],
    dependent: ['share curves of trunk pitch, trunk roll and upper-arm inclination'],
    measurements: ['channel.trunk_pitch', 'channel.trunk_roll', 'channel.upper_elev'],
    external: ['protocol with randomised or balanced target order'],
    population: CP,
    taskContext: 'Arm raise forward to targets set by the professional, ≥ 8 repetitions per target in ONE session',
    confounders: ['conditions in separate sessions (refused)', 'speed differences between targets (distal channels excluded for that reason)', 'order effects', 'fatigue-like drift'],
    null: 'Motor Flexibility Index = 0 (condition labels exchangeable within the session).',
    alternative: 'Index > 0 (permutation p < 0.05, bootstrap interval excluding 0), reproducible in split halves.',
    test: 'Within-session permutation test of the between-condition difference of share curves (lab/coord/flexibility.ts motorFlexibility)',
    assumptions: ['repetitions exchangeable within a condition', 'the outcome scales the whole movement under the null'],
    sampleSize: '12 repetitions per target: false alarms 2.5 %, power 1.0 for an 18° trunk difference in simulation (S3)',
    falsifiedBy: 'Index indistinguishable from 0 with ≥ 12 repetitions per target; or a difference that reverses with the order of conditions',
    benchmarks: ['S3a', 'S3b'],
    references: ['stergiou2011'],
    evidence: 'simulation_only',
    blocker: 'The index is new and exploratory: its reproducibility across sessions in real children must be shown before any interpretation',
    intent: 'exploratory',
  },
  {
    id: 'NM-H007',
    question: 'Is reproducing the calibration posture the dominant source of between-session variation of calibration-referenced angles — larger than strap rotation, sensor position and sensor noise?',
    rationale: 'In simulation a posture difference shifts angles ≈ 1:1 while strap rotation and a 4 cm shift do not; if true in children, a posture aid would improve every longitudinal measurement.',
    independent: ['re-attachment (sensors removed and strapped on again)', 'calibration posture aid (with / without)'],
    dependent: ['range of motion of a standard movement'],
    measurements: ['metric.rom', 'channel.upper_elev'],
    external: ['goniometer reference of the calibration posture', 'photographs of strap positions (no faces)'],
    population: 'Typically developing volunteers first (no clinical risk), then children with CP',
    taskContext: 'One session: movement recorded three times — unchanged, after re-attaching the sensors, after re-attaching with a posture aid',
    confounders: ['true movement variation between blocks (repeat blocks)', 'fatigue-like drift (order balanced)'],
    null: 'Between-block SD after re-attachment equals the within-mount SD.',
    alternative: 'Re-attachment increases the between-block SD, and the posture aid reduces it.',
    test: 'Variance components by block type (lab/measure/retest.ts); ratio of between-block variances with bootstrap interval',
    assumptions: ['blocks within a session share the child\'s state'],
    sampleSize: 'To estimate an SD within ±25 % (95 %) about 30 block pairs are needed (χ² interval) — e.g. 10 participants × 3 pairs',
    falsifiedBy: 'No increase of between-block variation after re-attachment; no effect of the posture aid',
    benchmarks: ['M2a2', 'M2b', 'M3', 'M4', 'U2'],
    references: ['mokkink2026', 'weir2005'],
    evidence: 'simulation_only',
    blocker: 'A re-donning study is the single most important missing measurement: it replaces two provisional constants (re-placement margin, strap allowance)',
    intent: 'confirmatory_when_preregistered',
  },
  {
    id: 'NM-H008',
    question: 'Within a practice sitting, does performance follow a rise-then-decline pattern, and does the turning point come earlier in longer sittings?',
    rationale: 'Separating practice-related improvement from decline within a session matters for interpreting end-of-session performance.',
    independent: ['repetition number within the sitting'],
    dependent: ['amplitude, peak rate, duration, smoothness per repetition'],
    measurements: ['metric.rom', 'feature.peak_speed', 'feature.duration', 'feature.sparc'],
    external: ['perceived effort or fatigue rating after the sitting (not currently collected)', 'rest intervals'],
    population: CP,
    taskContext: 'Practice sitting with trial recording, ≥ 12 repetitions',
    confounders: ['attention, boredom, discomfort (same kinematic pattern as fatigue)', 'target changes within the sitting'],
    null: 'No feature departs from a constant level across the repetitions (permutation, Holm-adjusted).',
    alternative: 'A rise-then-decline pattern in amplitude or rate, concordant across features.',
    test: 'Constant / linear / broken-stick comparison with a permutation test per feature (lab/observatory/withinSession.ts)',
    assumptions: ['repetition order is the only time variable', 'independent repetition noise'],
    sampleSize: '24–30 repetitions: false patterns 5.7 %, power 0.86–0.98 for 2–2.5 SD changes in simulation (W1–W4)',
    falsifiedBy: 'No pattern in sittings of ≥ 24 repetitions; a decline that does not recover after rest would be consistent with fatigue but is not proof of it',
    benchmarks: ['W1', 'W2', 'W3', 'W4'],
    references: ['kantak2012'],
    evidence: 'simulation_only',
    blocker: 'Without a perceived-fatigue rating the pattern cannot be attributed to fatigue — the app does not collect one',
    intent: 'exploratory',
  },
  {
    id: 'NM-H009',
    question: 'When a trained task improves, does a designated untrained task change in the same direction?',
    rationale: 'Transfer distinguishes learning a movement from learning a test.',
    independent: ['task role (trained / untrained), fixed by the protocol'],
    dependent: ['change of the task metric first → last session'],
    measurements: ['metric.rom'],
    external: ['protocol designating the untrained task', 'practice log showing it was not practised'],
    population: CP,
    taskContext: 'Trained and untrained task measured at every assessment session under identical conditions',
    confounders: ['maturation and familiarisation (affect both tasks)', 'placement changes (affect both)', 'practice of the "untrained" task at home'],
    null: 'The untrained task does not change beyond its noise.',
    alternative: 'It changes beyond noise in the same direction as the trained task; a control task unrelated to the trained one does not.',
    test: 'Change against day-to-day and repetition noise per task (lab/learning.ts); Task Transfer Matrix (lab/observatory/transfer.ts)',
    assumptions: ['noise model of each task estimated from its own series'],
    sampleSize: 'Per-task change detection needs ≥ 8 sessions for moderate effects (E2, O2)',
    falsifiedBy: 'No change in the untrained task with adequate power; or an equal change in an unrelated control task',
    benchmarks: ['E2', 'O2'],
    references: ['kantak2012', 'soderstrom2015'],
    evidence: 'none',
    blocker: 'No protocol with a designated transfer task has been run',
    intent: 'confirmatory_when_preregistered',
  },
  {
    id: 'NM-H010',
    question: 'Can a population model fitted on other children predict a new child\'s later sessions from their first three with calibrated uncertainty?',
    rationale: 'Individual forecasts from few sessions are wide; a population reference can narrow them only if children are exchangeable enough — which must be tested, not assumed.',
    independent: ['participant (held out)', 'time'],
    dependent: ['session mean of the task metric, sessions 4 onwards'],
    measurements: ['metric.rom', 'prediction.next_session'],
    external: [],
    population: CP,
    taskContext: 'Same task, protocol and schedule in every child; ≥ 9 children with ≥ 4 sessions',
    confounders: ['site and operator differences', 'heterogeneous impairment levels (non-exchangeability)', 'non-linear individual trajectories'],
    null: 'Coverage of the 95 % prediction intervals for held-out children is 0.95 and the error is no smaller than that of the child\'s own line.',
    alternative: 'Coverage compatible with 0.95 AND a smaller error than the individual-only line.',
    test: 'Leave-one-participant-out, future-only validation of the mixed model (lab/twin/population.ts validatePopulation)',
    assumptions: ['linear individual trajectories over the period', 'normal random effects'],
    sampleSize: 'Coverage within ±0.05 needs ≈ 300 held-out predictions (binomial); e.g. 30 children × 10 sessions',
    falsifiedBy: 'Coverage outside [0.90, 0.98]; error not below the individual-only line; under-coverage for a subgroup',
    benchmarks: ['T1', 'T2', 'T2b'],
    references: ['laird1982', 'collins2024', 'efthimiou2024', 'saeb2017'],
    evidence: 'simulation_only',
    blocker: 'Needs a multi-participant longitudinal dataset; synthetic participants are far more homogeneous than children',
    intent: 'confirmatory_when_preregistered',
  },
];

export function hypothesis(id: string): Hypothesis | null {
  return HYPOTHESES.find((h) => h.id === id) ?? null;
}

/** Measurements of a hypothesis that the current sensors cannot provide (must be empty for every registered hypothesis). */
export function unobservableMeasurements(h: Hypothesis): string[] {
  return h.measurements.filter((m) => {
    const e = registryEntry(m);
    return !e || e.status === 'not_observable';
  });
}

export interface DataInventory {
  /** Participants with real (non-simulated) sessions. */
  realParticipants: number;
  /** Largest number of real sessions of one participant. */
  maxSessions: number;
  /** Real sessions with raw 100 Hz frames. */
  rawSessions: number;
  /** Largest number of complete repetitions of one movement in one real recording with raw frames. */
  maxRepetitionsInARecording: number;
  externalAssessments: number;
  practiceLog: boolean;
  /** A frozen protocol designates retention sessions / transfer tasks / several task conditions. */
  designatesRetention: boolean;
  designatesTransfer: boolean;
  variesTaskCondition: boolean;
}

/**
 * Whether the data in this workspace could support a test of the hypothesis — a statement about DATA, never about
 * the hypothesis. 'testable' means the minimum structure exists, not that the test would have adequate power.
 */
export function hypothesisStatus(h: Hypothesis, inv: DataInventory): { status: HypothesisStatus; missing: string[] } {
  const missing: string[] = [];
  const need = (ok: boolean, what: string) => {
    if (!ok) missing.push(what);
  };
  need(inv.realParticipants >= 1, 'real (non-simulated) sessions');
  switch (h.id) {
    case 'NM-H001':
    case 'NM-H004':
      need(inv.rawSessions >= 1, 'a recording with raw 100 Hz frames');
      need(inv.maxRepetitionsInARecording >= 24, '≥ 24 complete repetitions of the movement in one recording');
      break;
    case 'NM-H002':
      need(inv.maxSessions >= 12, '≥ 12 sessions of one participant');
      need(inv.externalAssessments >= 2, 'repeated, independently assessed functional outcomes');
      break;
    case 'NM-H003':
      need(inv.maxSessions >= 10, '≥ 10 sessions of one participant');
      need(inv.practiceLog, 'a practice log');
      need(inv.designatesRetention, 'a frozen protocol designating a retention test');
      break;
    case 'NM-H005':
      need(inv.realParticipants >= 5, '≥ 5 participants');
      need(inv.rawSessions >= 10, 'raw frames of ≥ 2 sessions of each');
      break;
    case 'NM-H006':
      need(inv.variesTaskCondition, 'two task conditions recorded within one session');
      need(inv.maxRepetitionsInARecording >= 16, '≥ 8 repetitions per condition in one recording');
      break;
    case 'NM-H007':
      need(inv.rawSessions >= 3, 'repeated blocks with and without re-attachment (a re-donning protocol)');
      need(inv.variesTaskCondition, 'a protocol that records the block type (unchanged / re-attached / posture aid)');
      break;
    case 'NM-H008':
      need(inv.maxRepetitionsInARecording >= 12, 'a sitting with ≥ 12 repetitions');
      break;
    case 'NM-H009':
      need(inv.designatesTransfer, 'a frozen protocol designating an untrained task');
      need(inv.maxSessions >= 8, '≥ 8 sessions');
      break;
    case 'NM-H010':
      need(inv.realParticipants >= 9, '≥ 9 participants');
      need(inv.maxSessions >= 4, '≥ 4 sessions each');
      break;
    default:
      break;
  }
  return { status: missing.length ? 'not_testable_with_current_data' : 'testable', missing };
}
