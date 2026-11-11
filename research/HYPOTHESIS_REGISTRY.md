# Hypothesis registry

> Generated from `website/src/lab/discovery/hypotheses.ts` — do not edit by hand. To change a hypothesis, change the registry and run `HYPOTHESES_WRITE=1 npx vitest run src/lab/discovery/registry-doc.node.test.ts` in `website/`.

The research hypotheses NeuroMove could test, written before any data exist. The registry holds questions, not answers: **no hypothesis here is supported by data from people.** "Simulation only" means that the analysis method was checked on synthetic data with known truth.

Interface: `#/research/frontier/hypotheses`, where each entry is also judged against the real (non-simulated) data in the workspace: `registered`, `not testable with current data` (with what is missing), `testable`, `under test`.

## Rules

- Every hypothesis has a null, a test fixed in advance, and a condition that would falsify it.
- Every NeuroMove measurement it names exists in the observability registry and is observable with three inertial sensors; a test fails otherwise. What must come from outside (clinical assessment, practice log, protocol designation) is listed separately.
- An analysis is **confirmatory** only if a frozen protocol fixed the outcome, the models and the decision rule before the first analysed observation was recorded (`wagenmakers2012`). Everything else is exploratory, however small its p-value, and is labelled so in every report (`analysisIntent` in `discovery/multiplicity.ts`).
- Families of tests are adjusted: Holm for family-wise error (`holm1979`), Benjamini–Hochberg for screening (`benjamini1995`). Checked by simulation in benchmarks D1 and D2.
- A lead in time, a correlation or a model preference is never reported as recovery or as a cause.
- Testing any of these on children requires a documented positive ethics decision and the consent and assent described in [ETHICS_AND_DATA_GOVERNANCE.md](ETHICS_AND_DATA_GOVERNANCE.md). The software does not provide either.

## Overview

| Id | Question | Evidence today |
|---|---|---|
| NM-H001 | Do repetitions of the same task with equivalent task outcomes show reproducibly different intersegment movement strategies within a participant? | simulation only |
| NM-H002 | Do IMU-derived movement features change consistently within a child BEFORE an independently assessed functional outcome changes? | simulation only |
| NM-H003 | Is part of the improvement seen at the end of a practice period lost after an interval without practice, and can the forgetting rate be estimated for an individual? | simulation only |
| NM-H004 | When trunk contribution varies between repetitions of sagittal arm raising, is the task outcome preserved (the arm absorbs the variation) or does the variation pass into the outcome? | simulation only |
| NM-H005 | Does a child have a multivariate movement description that is reproducible across sessions beyond the variation caused by re-attaching the sensors? | simulation only |
| NM-H006 | Does the organisation of a child's arm raise change with the target height beyond what scaling the same movement explains? | simulation only |
| NM-H007 | Is reproducing the calibration posture the dominant source of between-session variation of calibration-referenced angles — larger than strap rotation, sensor position and sensor noise? | simulation only |
| NM-H008 | Within a practice sitting, does performance follow a rise-then-decline pattern, and does the turning point come earlier in longer sittings? | simulation only |
| NM-H009 | When a trained task improves, does a designated untrained task change in the same direction? | none |
| NM-H010 | Can a population model fitted on other children predict a new child's later sessions from their first three with calibrated uncertainty? | simulation only |

## NM-H001

**Question.** Do repetitions of the same task with equivalent task outcomes show reproducibly different intersegment movement strategies within a participant?

**Rationale.** A task can be completed with different contributions of trunk and arm; an outcome value does not show this. A systematic review of instrumented upper-limb assessment in cerebral palsy found 140 different parameters across 76 studies, task duration being the most frequent (Rozaire et al. 2024).

| | |
|---|---|
| Null hypothesis | After matching on the task outcome, the multi-segment trajectories of the candidate strategies do not differ beyond repetition-to-repetition variability. |
| Alternative | They differ (family-wise error controlled over the whole trajectory) while the outcome is equivalent within ±5°, and the difference replicates in split halves. |
| Test | Performance–Strategy Dissociation: caliper matching, TOST equivalence of the outcome, permutation max-t over channel × time, split-half replication (lab/coord/dissociation.ts) |
| Falsified by | No dissociation in a session with ≥ 24 repetitions per candidate pattern; or a difference that disappears in split halves or when sensors are re-attached within the session |
| Independent variables | strategy cluster (data-driven, neutral label) |
| Dependent variables | phase-normalised trunk, upper-arm and forearm excursion curves |
| Measured by NeuroMove (registry ids) | `channel.trunk_pitch`, `channel.trunk_roll`, `channel.upper_elev`, `channel.fore_elev`, `coordination.strategy_label`, `coordination.component_score` |
| Needed from outside | — |
| Population | Children with unilateral cerebral palsy, MACS I–III, able to follow the task instruction (inclusion and exclusion criteria to be set by clinical experts and the ethics commission) |
| Task and design | Arm raise forward, one session with ≥ 24 complete repetitions (practice sitting with raw retention), sensors not re-attached |
| Confounders | sensor re-attachment (strategies must co-occur within a session); outcome differences (matched and tested for equivalence); fatigue-like drift within the sitting; instruction changes |
| Assumptions | repetitions exchangeable within a strategy; landmark registration removes timing differences only |
| Sample size | ≈ 24 repetitions per strategy for 0.95 power in simulation (mcse-validation V7 post hoc); participants: to be fixed by a pilot |
| Method benchmarks | V5, V6, V7, S1a, S1b |
| References | `rozaire2024`, `nichols2002`, `schuirmann1987`, `lakens2017` |
| Evidence today | simulation only — the method was checked on synthetic data with known truth; nothing is known about people |
| What blocks it | No real raw multi-sensor recordings of children exist yet; assessment sessions have 3 repetitions per movement |
| Kind of analysis | confirmatory only if pre-registered in a frozen protocol before data collection; exploratory otherwise |

## NM-H002

**Question.** Do IMU-derived movement features change consistently within a child BEFORE an independently assessed functional outcome changes?

**Rationale.** If kinematic change precedes change in clinical scores, it could inform research on early response; if not, the features add no early information.

| | |
|---|---|
| Null hypothesis | The session of the first sensor-feature signal is not earlier than the session of the functional-outcome change (median lead ≤ 0). |
| Alternative | The sensor-feature signal precedes the functional change (median lead > 0 sessions), with a false-alarm rate in children whose outcome does not change no higher than the detector's nominal rate. |
| Test | Self-starting CUSUM per feature with family control (lab/observatory/changeDetection.ts); sign test of lead times across participants; false-alarm share in non-changers |
| Falsified by | Lead times centred on zero or negative; signals as frequent in children without functional change as in those with it |
| Independent variables | time (sessions) |
| Dependent variables | session at which each feature's change is signalled; session at which the functional outcome changes by its MCID/MDC |
| Measured by NeuroMove (registry ids) | `metric.rom`, `metric.peak_velocity`, `metric.sparc`, `metric.trunk`, `feature.time_to_peak_fraction` |
| Needed from outside | a standardised upper-limb outcome assessed by a qualified, blinded assessor at fixed intervals (e.g. Assisting Hand Assessment, Melbourne Assessment 2); practice log |
| Population | Children with unilateral cerebral palsy, MACS I–III, able to follow the task instruction (inclusion and exclusion criteria to be set by clinical experts and the ethics commission) |
| Task and design | Standard assessment protocol at every session, ≥ 12 sessions over an intervention period, identical task conditions |
| Confounders | placement protocol changes; familiarisation; missing sessions when performance is poor; multiple features (family-wise control); assessment schedule coarser than the sensor schedule |
| Assumptions | independent day-to-day variation (violated by slow wander: benchmark O4); the functional outcome is measured without knowledge of the sensor data |
| Sample size | Detector power 0.77 for a 2 SD step in 20 sessions (O2): ≥ 12 sessions per child; number of children from the expected share of responders — to be computed in the protocol |
| Method benchmarks | O1, O2, O3, O4, O7, O9 |
| References | `hawkins1987`, `page1954`, `jensen2006`, `adansdester2020` |
| Evidence today | simulation only — the method was checked on synthetic data with known truth; nothing is known about people |
| What blocks it | Requires prospective longitudinal data WITH independently measured functional outcomes and ethics approval; none exist. A lead in time would still not prove recovery or causation. |
| Kind of analysis | confirmatory only if pre-registered in a frozen protocol before data collection; exploratory otherwise |

## NM-H003

**Question.** Is part of the improvement seen at the end of a practice period lost after an interval without practice, and can the forgetting rate be estimated for an individual?

**Rationale.** Performance during practice over-states learning; retention must be tested after a delay (Kantak & Winstein 2012; Soderstrom & Bjork 2015).

| | |
|---|---|
| Null hypothesis | The learning–retention model is not preferred over the saturation model (ΔAICc ≤ 2), or the retention ratio is 1. |
| Alternative | The learning–retention model is preferred (ΔAICc > 2), its half-life has a closed 95 % profile interval, and the designated retention test lies below the end-of-practice level by more than the noise. |
| Test | Model comparison with profile likelihood (lab/fit.ts); retention decomposition (lab/learning.ts) |
| Falsified by | Retention after a long break as good as after a short one; saturation model fitting equally well on a schedule with breaks |
| Independent variables | practice dose between sessions (minutes); length of the no-practice interval |
| Dependent variables | session mean of the task metric at a designated retention test |
| Measured by NeuroMove (registry ids) | `metric.rom`, `model.change_parameter` |
| Needed from outside | practice log (reported minutes); protocol-designated retention session |
| Population | Children with unilateral cerebral palsy, MACS I–III, able to follow the task instruction (inclusion and exclusion criteria to be set by clinical experts and the ethics commission) |
| Task and design | Trained task; ≥ 10 sessions with breaks of different length and varying dose; retention test after ≥ 4 weeks without practice |
| Confounders | unreported practice in the delay; growth and maturation; placement variation; regular schedules (forgetting confounded with saturation) |
| Assumptions | single-rate exponential forgetting; dose spread evenly over each interval; no practice in the delay (reported) |
| Sample size | 10 sessions with breaks: forgetting preferred in ≈ all simulated series, half-life coverage reported in T5; regular weekly schedules cannot answer the question (E5, T4) |
| Method benchmarks | E5, T4, T5 |
| References | `kantak2012`, `soderstrom2015`, `casadio2012`, `raue2009` |
| Evidence today | simulation only — the method was checked on synthetic data with known truth; nothing is known about people |
| What blocks it | Needs a protocol with deliberate no-practice intervals — an ethical and clinical decision, not a software one |
| Kind of analysis | confirmatory only if pre-registered in a frozen protocol before data collection; exploratory otherwise |

## NM-H004

**Question.** When trunk contribution varies between repetitions of sagittal arm raising, is the task outcome preserved (the arm absorbs the variation) or does the variation pass into the outcome?

**Rationale.** Trunk motion can enable a task or mask limited arm capacity; which one holds for a child and task is an empirical question (motor abundance; Scholz & Schöner 1999).

| | |
|---|---|
| Null hypothesis | Pass-through = 1 (trunk and arm-relative excursions vary independently). |
| Alternative | Pass-through < 1 with a 95 % interval below 0.5 (outcome preserved) — or > 1 (reinforcing); both are reported, neither is called good or bad. |
| Test | Errors-in-variables regression of outcome on trunk excursion with bootstrap interval (lab/coord/flexibility.ts trunkOutcomeTradeoff) |
| Falsified by | Interval covering both 0 and 1 with ≥ 24 repetitions; pass-through that changes sign between sittings of the same child |
| Independent variables | signed trunk pitch excursion per repetition |
| Dependent variables | task outcome (upper-arm inclination excursion) per repetition |
| Measured by NeuroMove (registry ids) | `channel.trunk_pitch`, `channel.upper_elev`, `coordination.trunk_contribution` |
| Needed from outside | — |
| Population | Children with unilateral cerebral palsy, MACS I–III, able to follow the task instruction (inclusion and exclusion criteria to be set by clinical experts and the ethics commission) |
| Task and design | Arm raise forward to a fixed target, one sitting of ≥ 24 repetitions, movement about one axis (planarity ≥ 0.9) |
| Confounders | out-of-plane arm movement; a common drive (effortful repetitions larger in both); trunk measurement noise (corrected); target not fixed |
| Assumptions | planar chain: outcome = arm relative to trunk − trunk pitch; repetitions independent |
| Sample size | 24 repetitions recover pass-through 0 and 1 within ±0.03 in simulation (S4) |
| Method benchmarks | S4 |
| References | `scholz1999`, `latash2002` |
| Evidence today | simulation only — the method was checked on synthetic data with known truth; nothing is known about people |
| What blocks it | Needs practice sittings with raw retention; validated for sagittal arm raising only |
| Kind of analysis | exploratory |

## NM-H005

**Question.** Does a child have a multivariate movement description that is reproducible across sessions beyond the variation caused by re-attaching the sensors?

**Rationale.** Only person-specific, reproducible features can carry information about individual change.

| | |
|---|---|
| Null hypothesis | A later session is matched to the same child's first session no more often than chance. |
| Alternative | Identification above chance (permutation p < 0.05), carried by placement-robust features. |
| Test | Nearest-neighbour identification with participant-label permutation; per-feature ICC(1,1) (lab/coord/signature.ts) |
| Falsified by | Identification at chance; or carried only by placement-sensitive features |
| Independent variables | participant |
| Dependent variables | session feature vector (standardised) |
| Measured by NeuroMove (registry ids) | `channel.upper_elev`, `channel.trunk_pitch`, `channel.elbow_flex`, `coordination.trunk_contribution`, `feature.duration`, `feature.peak_speed` |
| Needed from outside | — |
| Population | Children with unilateral cerebral palsy, MACS I–III, able to follow the task instruction (inclusion and exclusion criteria to be set by clinical experts and the ethics commission) |
| Task and design | ≥ 2 sessions per child with the standard tasks, sensors re-attached each session, ≥ 5 children |
| Confounders | a child always wearing a sensor the same wrong way (placement masquerading as signature); age and size differences in speed |
| Assumptions | features standardised over all sessions; sessions of a child exchangeable |
| Sample size | 8 synthetic participants: identification 0.96 vs chance 0.125 (S5); real children: unknown |
| Method benchmarks | S5a, S5b |
| References | `saeb2017` |
| Evidence today | simulation only — the method was checked on synthetic data with known truth; nothing is known about people |
| What blocks it | Needs repeated sessions of several real children |
| Kind of analysis | exploratory |

## NM-H006

**Question.** Does the organisation of a child's arm raise change with the target height beyond what scaling the same movement explains?

**Rationale.** Adapting coordination to task demands differs from producing the same pattern larger; minimising variability is not the same as flexibility.

| | |
|---|---|
| Null hypothesis | Motor Flexibility Index = 0 (condition labels exchangeable within the session). |
| Alternative | Index > 0 (permutation p < 0.05, bootstrap interval excluding 0), reproducible in split halves. |
| Test | Within-session permutation test of the between-condition difference of share curves (lab/coord/flexibility.ts motorFlexibility) |
| Falsified by | Index indistinguishable from 0 with ≥ 12 repetitions per target; or a difference that reverses with the order of conditions |
| Independent variables | target height (two or more levels, interleaved within a session) |
| Dependent variables | share curves of trunk pitch, trunk roll and upper-arm inclination |
| Measured by NeuroMove (registry ids) | `channel.trunk_pitch`, `channel.trunk_roll`, `channel.upper_elev` |
| Needed from outside | protocol with randomised or balanced target order |
| Population | Children with unilateral cerebral palsy, MACS I–III, able to follow the task instruction (inclusion and exclusion criteria to be set by clinical experts and the ethics commission) |
| Task and design | Arm raise forward to targets set by the professional, ≥ 8 repetitions per target in ONE session |
| Confounders | conditions in separate sessions (refused); speed differences between targets (distal channels excluded for that reason); order effects; fatigue-like drift |
| Assumptions | repetitions exchangeable within a condition; the outcome scales the whole movement under the null |
| Sample size | 12 repetitions per target: false alarms 2.5 %, power 1.0 for an 18° trunk difference in simulation (S3) |
| Method benchmarks | S3a, S3b |
| References | `stergiou2011` |
| Evidence today | simulation only — the method was checked on synthetic data with known truth; nothing is known about people |
| What blocks it | The index is new and exploratory: its reproducibility across sessions in real children must be shown before any interpretation |
| Kind of analysis | exploratory |

## NM-H007

**Question.** Is reproducing the calibration posture the dominant source of between-session variation of calibration-referenced angles — larger than strap rotation, sensor position and sensor noise?

**Rationale.** In simulation a posture difference shifts angles ≈ 1:1 while strap rotation and a 4 cm shift do not; if true in children, a posture aid would improve every longitudinal measurement.

| | |
|---|---|
| Null hypothesis | Between-block SD after re-attachment equals the within-mount SD. |
| Alternative | Re-attachment increases the between-block SD, and the posture aid reduces it. |
| Test | Variance components by block type (lab/measure/retest.ts); ratio of between-block variances with bootstrap interval |
| Falsified by | No increase of between-block variation after re-attachment; no effect of the posture aid |
| Independent variables | re-attachment (sensors removed and strapped on again); calibration posture aid (with / without) |
| Dependent variables | range of motion of a standard movement |
| Measured by NeuroMove (registry ids) | `metric.rom`, `channel.upper_elev` |
| Needed from outside | goniometer reference of the calibration posture; photographs of strap positions (no faces) |
| Population | Typically developing volunteers first (no clinical risk), then children with CP |
| Task and design | One session: movement recorded three times — unchanged, after re-attaching the sensors, after re-attaching with a posture aid |
| Confounders | true movement variation between blocks (repeat blocks); fatigue-like drift (order balanced) |
| Assumptions | blocks within a session share the child's state |
| Sample size | To estimate an SD within ±25 % (95 %) about 30 block pairs are needed (χ² interval) — e.g. 10 participants × 3 pairs |
| Method benchmarks | M2a2, M2b, M3, M4, U2 |
| References | `mokkink2026`, `weir2005` |
| Evidence today | simulation only — the method was checked on synthetic data with known truth; nothing is known about people |
| What blocks it | A re-donning study is the single most important missing measurement: it replaces two provisional constants (re-placement margin, strap allowance) |
| Kind of analysis | confirmatory only if pre-registered in a frozen protocol before data collection; exploratory otherwise |

## NM-H008

**Question.** Within a practice sitting, does performance follow a rise-then-decline pattern, and does the turning point come earlier in longer sittings?

**Rationale.** Separating practice-related improvement from decline within a session matters for interpreting end-of-session performance.

| | |
|---|---|
| Null hypothesis | No feature departs from a constant level across the repetitions (permutation, Holm-adjusted). |
| Alternative | A rise-then-decline pattern in amplitude or rate, concordant across features. |
| Test | Constant / linear / broken-stick comparison with a permutation test per feature (lab/observatory/withinSession.ts) |
| Falsified by | No pattern in sittings of ≥ 24 repetitions; a decline that does not recover after rest would be consistent with fatigue but is not proof of it |
| Independent variables | repetition number within the sitting |
| Dependent variables | amplitude, peak rate, duration, smoothness per repetition |
| Measured by NeuroMove (registry ids) | `metric.rom`, `feature.peak_speed`, `feature.duration`, `feature.sparc` |
| Needed from outside | perceived effort or fatigue rating after the sitting (not currently collected); rest intervals |
| Population | Children with unilateral cerebral palsy, MACS I–III, able to follow the task instruction (inclusion and exclusion criteria to be set by clinical experts and the ethics commission) |
| Task and design | Practice sitting with trial recording, ≥ 12 repetitions |
| Confounders | attention, boredom, discomfort (same kinematic pattern as fatigue); target changes within the sitting |
| Assumptions | repetition order is the only time variable; independent repetition noise |
| Sample size | 24–30 repetitions: false patterns 5.7 %, power 0.86–0.98 for 2–2.5 SD changes in simulation (W1–W4) |
| Method benchmarks | W1, W2, W3, W4 |
| References | `kantak2012` |
| Evidence today | simulation only — the method was checked on synthetic data with known truth; nothing is known about people |
| What blocks it | Without a perceived-fatigue rating the pattern cannot be attributed to fatigue — the app does not collect one |
| Kind of analysis | exploratory |

## NM-H009

**Question.** When a trained task improves, does a designated untrained task change in the same direction?

**Rationale.** Transfer distinguishes learning a movement from learning a test.

| | |
|---|---|
| Null hypothesis | The untrained task does not change beyond its noise. |
| Alternative | It changes beyond noise in the same direction as the trained task; a control task unrelated to the trained one does not. |
| Test | Change against day-to-day and repetition noise per task (lab/learning.ts); Task Transfer Matrix (lab/observatory/transfer.ts) |
| Falsified by | No change in the untrained task with adequate power; or an equal change in an unrelated control task |
| Independent variables | task role (trained / untrained), fixed by the protocol |
| Dependent variables | change of the task metric first → last session |
| Measured by NeuroMove (registry ids) | `metric.rom` |
| Needed from outside | protocol designating the untrained task; practice log showing it was not practised |
| Population | Children with unilateral cerebral palsy, MACS I–III, able to follow the task instruction (inclusion and exclusion criteria to be set by clinical experts and the ethics commission) |
| Task and design | Trained and untrained task measured at every assessment session under identical conditions |
| Confounders | maturation and familiarisation (affect both tasks); placement changes (affect both); practice of the "untrained" task at home |
| Assumptions | noise model of each task estimated from its own series |
| Sample size | Per-task change detection needs ≥ 8 sessions for moderate effects (E2, O2) |
| Method benchmarks | E2, O2 |
| References | `kantak2012`, `soderstrom2015` |
| Evidence today | none |
| What blocks it | No protocol with a designated transfer task has been run |
| Kind of analysis | confirmatory only if pre-registered in a frozen protocol before data collection; exploratory otherwise |

## NM-H010

**Question.** Can a population model fitted on other children predict a new child's later sessions from their first three with calibrated uncertainty?

**Rationale.** Individual forecasts from few sessions are wide; a population reference can narrow them only if children are exchangeable enough — which must be tested, not assumed.

| | |
|---|---|
| Null hypothesis | Coverage of the 95 % prediction intervals for held-out children is 0.95 and the error is no smaller than that of the child's own line. |
| Alternative | Coverage compatible with 0.95 AND a smaller error than the individual-only line. |
| Test | Leave-one-participant-out, future-only validation of the mixed model (lab/twin/population.ts validatePopulation) |
| Falsified by | Coverage outside [0.90, 0.98]; error not below the individual-only line; under-coverage for a subgroup |
| Independent variables | participant (held out); time |
| Dependent variables | session mean of the task metric, sessions 4 onwards |
| Measured by NeuroMove (registry ids) | `metric.rom`, `prediction.next_session` |
| Needed from outside | — |
| Population | Children with unilateral cerebral palsy, MACS I–III, able to follow the task instruction (inclusion and exclusion criteria to be set by clinical experts and the ethics commission) |
| Task and design | Same task, protocol and schedule in every child; ≥ 9 children with ≥ 4 sessions |
| Confounders | site and operator differences; heterogeneous impairment levels (non-exchangeability); non-linear individual trajectories |
| Assumptions | linear individual trajectories over the period; normal random effects |
| Sample size | Coverage within ±0.05 needs ≈ 300 held-out predictions (binomial); e.g. 30 children × 10 sessions |
| Method benchmarks | T1, T2, T2b |
| References | `laird1982`, `collins2024`, `efthimiou2024`, `saeb2017` |
| Evidence today | simulation only — the method was checked on synthetic data with known truth; nothing is known about people |
| What blocks it | Needs a multi-participant longitudinal dataset; synthetic participants are far more homogeneous than children |
| Kind of analysis | confirmatory only if pre-registered in a frozen protocol before data collection; exploratory otherwise |
