# Experimental protocols for the research frontier

Designs of the studies that would turn the simulation results of [SCIENTIFIC_VALIDATION.md](SCIENTIFIC_VALIDATION.md) into evidence about people, one per group of hypotheses in [HYPOTHESIS_REGISTRY.md](HYPOTHESIS_REGISTRY.md).

**None of these studies has been run, approved or scheduled.** They are designs. Running any of them with children requires a documented positive decision of a bioethics commission, written informed consent of the legal representative, the child's assent, and clinical supervision ([ETHICS_AND_DATA_GOVERNANCE.md](ETHICS_AND_DATA_GOVERNANCE.md)). The software does not provide and cannot replace any of these.

The earlier document [experimental-protocols.md](experimental-protocols.md) covers the learning-study designs of the Study Designer; this one adds what the new engines need.

## Common requirements

- **Pre-registration.** Outcome, models, decision rule and sample size are fixed in a protocol that is frozen in the Study Designer before the first session. Only then is an analysis labelled confirmatory; otherwise it is exploratory (`analysisIntent`).
- **Raw frames.** Strategy, placement and uncertainty analyses need the raw 100 Hz frames of all three sensors, which are kept for practice sittings only under a recorded consent.
- **Task conditions.** Target, speed instruction, start position and support are recorded per block; a dimension that is not recorded makes two measurements non-comparable.
- **Stop rules.** A session stops on request, on pain or distress; the existing stop, discomfort and incident records are used and are never overridden by a protocol.
- **No change of care.** No study result changes a child's programme; decisions stay with the clinician and the family.
- **Missing sessions** are recorded as missing with the reason. They are never interpolated (benchmark O3 shows what missingness does to power).

## P1. Re-donning study — the first study to run

*Hypothesis NM-H007. Replaces two provisional constants: the 2.5° re-placement margin and the 5° strap-tilt allowance.*

**Question.** How much do calibration-referenced angles vary when the sensors are taken off and put on again, and is reproducing the calibration posture the dominant source?

**Why first.** Every comparison between sessions rests on this number, and it is currently a constant from simulation. The study needs no patients: it is a question about straps, posture and sensors.

**Participants.** Adult volunteers first (the question is about the measurement procedure). A second stage with children is needed before the constants are used for children, because limb size, compliance during calibration and soft tissue differ.

**Design.** One visit, three block types, each 12 repetitions of arm raise forward to a fixed target:

| Block | Sensors | Calibration |
|---|---|---|
| A, A′ | unchanged | repeated |
| B | removed and re-attached by the same operator | repeated |
| C | removed and re-attached | repeated with a posture aid (arm against a vertical reference) |

Order randomised; a second visit at least two days later repeats the blocks. The block type is recorded for every block.

**Analysis (fixed).** Variance components of the block means by block type (`measure/retest.ts`); the ratio of between-block variances B versus A (re-attachment) and C versus B (posture aid) with bootstrap intervals; the functional-axis and tilt differences of `comparePlacement` against the observed angle shifts.

**Sample size.** To estimate a standard deviation within about ±25 % (95 % χ² interval) roughly 30 block pairs are needed — for example 10 participants × 3 pairs per block type.

**Falsified by.** Re-attachment variance not larger with free posture than with the posture aid.

**Software.** Recording, features, variance components and the placement comparison exist. Missing: a field for the block type (it would be entered as a task constraint) and a study screen for this design.

## P2. Organisation within one sitting

*Hypotheses NM-H001 (different strategies at equal outcome), NM-H004 (trunk–outcome trade-off), NM-H006 (flexibility with target height), NM-H008 (rise then decline).*

**Design.** One practice sitting per child with raw frames kept, sensors not re-attached during the sitting:

- two target heights, at least 12 repetitions each, **interleaved within the sitting**. Conditions recorded in separate sittings cannot be told apart from sensor re-attachment — the flexibility analysis then returns `confounded_by_session`;
- or one target with at least 24 repetitions for the strategy and trade-off questions.

A rating of perceived effort or fatigue after the sitting, entered by the therapist, is needed for NM-H008; without it a decline can only be called fatigue-like. The app does not collect such a rating today.

**Analysis (fixed).** Performance–strategy dissociation with equivalence of the outcome (existing engine); motor flexibility on share curves with a within-session permutation test; errors-in-variables pass-through with bootstrap interval; constant / linear / broken-stick comparison with a permutation test per feature, Holm-adjusted.

**What simulation says about size.** About 24 repetitions per pattern for the dissociation test; 12 per target for flexibility (false alarms 2.5 %, power 1.0 for an 18° change of trunk involvement); 24 repetitions for the trade-off; 24–30 for the within-sitting pattern. The number of children is to be fixed by a pilot.

**Limits.** Sagittal arm raising only for the trade-off. A child may not tolerate 24 repetitions; the sitting stops when the child or therapist says so, and a short sitting is analysed as what it is.

## P3. Does kinematic change precede functional change?

*Hypothesis NM-H002. The question that decides whether the sensor features carry early information at all.*

**Design.** Prospective, observational, during an intervention period that the clinic runs anyway:

- the standard sensor assessment at every session, at least 12 sessions per child, identical task conditions;
- a standardised upper-limb outcome assessed at fixed intervals by a qualified assessor **who does not see the sensor data**;
- a practice log.

The period should be long enough for function to change at all. For orientation: a systematic review of 74 trials estimated that about 40 hours of practice were needed to improve upper-limb motor ability in unilateral cerebral palsy, and 14–25 hours for individual goals with goal-directed practice (`jackman2020`, abstract).

**Analysis (fixed).** Self-starting CUSUM per feature with family-wise control; session of the first sensor signal against session of the functional change (by its MCID or MDC); sign test of the lead across children; share of signals among children whose outcome did not change.

**What simulation says about size.** With 20 sessions a step of two day-to-day SDs is signalled in 77 % of series, with a median delay of five sessions; with 10 sessions in 35 % (benchmark O2). A design with fewer than about 12 sessions per child cannot answer the question.

**Falsified by.** Lead times centred on zero or negative; signals as frequent in children without functional change as in those with it.

**What it would not show.** A lead in time is not recovery and not causation.

## P4. Retention and forgetting

*Hypothesis NM-H003.*

**Design.** A trained task measured over at least 10 sessions with intervals of different length and a practice log; one session designated in advance as a retention test after an interval without practice.

**Ethical constraint.** Withholding practice to create such an interval is a clinical and ethical decision, not a software one. The design should use intervals that occur anyway — holidays, scheduled breaks between blocks of therapy.

**Analysis (fixed).** Learning–retention model against the saturation model (ΔAICc > 2), with a closed profile interval of the half-life; the designated retention test against the end-of-practice level.

**What simulation says.** A regular weekly schedule cannot separate forgetting from saturation (flagged in 100 % of simulated regular schedules, T4); with breaks of four and six weeks the half-life interval covers the truth in 92 % (T5).

## P5. Transfer

*Hypothesis NM-H009. No simulation evidence exists yet for this one.*

**Design.** The protocol designates a trained task, an untrained task that shares the trained movement, and a control task that does not. All three are measured at every assessment session, at least eight sessions.

**Analysis (fixed).** Change of each task against its own day-to-day and repetition noise; the Task Transfer Matrix. A change in the untrained task that also appears in the control task is not transfer.

## P6. Population reference

*Hypotheses NM-H010 (population model) and NM-H005 (movement signature); both fall out of the data of P3.*

**Design.** The longitudinal data of P3 from several children on the same protocol.

**Analysis (fixed).** Leave-one-participant-out: each child's later sessions predicted from their first three by a model fitted on the other children. Coverage of the 95 % intervals, calibration slope, and the error against "the child's own line" and "same as last session". Nearest-neighbour identification across sessions with a permutation test.

**Size.** Judging coverage within ±0.05 needs about 300 held-out predictions — for example 30 children × 10 sessions. The population model refuses to fit below 8 participants with 3 sessions each.

## What the software supports today

| Need | State |
|---|---|
| Versioned, frozen protocol with task roles and retention tests | exists (Study Designer) |
| Confirmatory / exploratory label from the protocol and the dates | exists |
| Raw frames of practice sittings under consent | exists |
| Entry of external clinical assessments | exists (manual entry); not yet linked to a sensor series for a lead–lag analysis |
| Block type, speed instruction, support as recorded task constraints | modelled; no entry field yet |
| Perceived effort or fatigue rating | not collected |
| Screens for P1, P3 and P5 as guided studies | not built |
