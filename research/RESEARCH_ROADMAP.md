# Research roadmap

What should happen next, in order of how much scientific uncertainty each step removes. Written on 11 November 2026 after the research-frontier expansion. The earlier [foundation-model-roadmap.md](foundation-model-roadmap.md) remains valid for its topic.

The state today, in one sentence: the engines exist, are tested and behave as specified on synthetic data — and **nothing is known yet about how they behave on children**. The roadmap is therefore mostly about measurements, not about more software.

## 1. The five most valuable next experiments

### 1. Re-donning study (protocol P1)

*Removes:* the two provisional constants behind every between-session comparison (re-placement margin 2.5°, strap-tilt allowance 5°), and tests whether calibration posture really dominates (NM-H007).

*Why first:* it needs no patients — adult volunteers, one or two visits, about 30 block pairs — and its result changes what every later study can conclude. In simulation a posture error shifts angles one-to-one while strap rotation does nothing; if that holds, a simple posture aid during calibration would improve every longitudinal measurement.

### 2. Bench test of the sensor uncertainty budget

*Removes:* the assumption that the MPU-6050 noise, bias and zero-offset values of the simulator describe the real boards.

*How:* static recordings (noise, bias stability), a six-position accelerometer calibration before and after, and a pendulum or turntable with a known angle. Compare the measured spread of each feature with the propagated budget (the physical version of benchmarks U1 and U2). The budget says the accelerometer zero offset limits a session mean to about 0.7–0.9°; if the six-position calibration removes most of it, that is the cheapest accuracy gain available.

### 3. Pilot of long practice sittings with raw frames (protocol P2)

*Removes:* the unknown of whether the strategy analyses are usable at all in children — whether a child completes 24 repetitions, whether distinct organisations occur within a sitting, how large within-sitting trends are (NM-H001, H004, H006, H008).

*How:* a handful of children, one or two sittings each, two target heights interleaved, raw frames kept under consent, a therapist's effort rating. Mostly a feasibility result; it fixes the sample size of anything that follows.

### 4. Longitudinal series with a blinded functional outcome (protocol P3)

*Removes:* the central unknown — whether a change in the sensor features says anything about a change in function, and whether it comes earlier (NM-H002). It also yields the data for the population reference and the movement signature (NM-H010, H005) and, with naturally occurring breaks, for retention (NM-H003).

*What the simulations already say:* fewer than about 12 sessions per child cannot answer it; the detector misses a quarter of two-SD steps even with 20 sessions; and a signal cannot be told from a change of measurement conditions without the placement comparison — so experiment 1 comes first.

### 5. Day-to-day variation of stable children

*Removes:* the assumption of independent day-to-day variation, which the change detector needs and which, when violated, multiplies its false alarms by about seven (benchmark O4).

*How:* repeated sessions of children in a stable period (no change of programme), ideally the baseline phase of experiment 4. Estimate the autocorrelation and the distribution of session means; recalibrate the detector thresholds for what is found, or replace the model of "no change".

## 2. Software that needs no new data

In order of usefulness:

1. **Record task constraints at the source** — block type (unchanged, re-attached, posture aid), speed instruction, support — and a guided study screen for the re-donning protocol. Without this, experiment 1 has to be run from a paper log.
2. **Link external assessments to sensor series** so that a lead–lag analysis (NM-H002) can be computed and pre-registered.
3. **A change detector that does not assume independence** (for example on residuals of a first-order autoregressive "no change" model), benchmarked against O4 and O5.
4. **Population reference in the interface**, visibly separate from the individual estimate, refusing below its minimum and on mixed provenance (the engine exists).
5. **Minimum sensor configuration, quantitatively.** The registry already lists what each configuration loses; the missing part is how much each feature's uncertainty grows without the trunk or forearm sensor.
6. **Biomechanics explorer.** A view of the channels of one repetition with its uncertainty band and observability status, on top of the existing movement lab. Not built.
7. **Study Designer integration.** The planning functions (allocation, information of a schedule, model discrimination) are used on the observatory page; they belong in the designer's power check as well.
8. **Native-speaker review of the Kazakh text** of the lab and frontier pages.

## 3. What should not be built

- Anything that turns a verdict into advice: no "recommended dose", no "ready for discharge", no severity score.
- A closed loop from the twin to a programme.
- A model of recovery, of the brain, or of muscles from these sensors.
- A foundation model before the dataset gates of the existing roadmap are met.
- More analyses on synthetic data in place of the experiments above. The synthetic generator is far simpler than a child; further agreement with it adds confidence in the code, not in the science.

## 4. Known weaknesses to resolve along the way

| Weakness | Evidence | Resolution |
|---|---|---|
| Change detection has low power on short series | O2: 77 % for a two-SD step in 20 sessions, 35 % in 10 | more sessions per child; report "not evidence of stability" (done); test alternatives |
| False alarms under autocorrelation and heavy tails | O4: 34 %; O5: 9.6 % | experiment 5; software item 3 |
| A step caused by measurement conditions is indistinguishable in a session series | O9: signalled in 58 % | placement comparison on raw frames; experiment 1 |
| Feature invariance to sensor rotation is not exact | M2a: one repetition in 55 296 moved by 0.196° through onset re-quantisation | sub-sample onset interpolation, or accept and document |
| Exponential-shaped series under-cover | T3: 0.86 | longer series; report per-series calibration (done) |
| Elbow angle unstable under sensor rotation | M2b: 95th-percentile error 12° at 20° | functional-axis calibration of the elbow hinge |
| Equivalence of outcomes rarely demonstrable with 12 repetitions | S1a: 35 % | more repetitions per block, or a wider pre-specified margin with justification |
| Landing-page colour contrast fails the accessibility test (two labels) | pre-existing on `main`; `e2e/layout-a11y.spec.ts` | darken `.lp-vs__key` — a design decision, left to the owner |
| Seven landing-page end-to-end tests expect the page as it was before its redesign | they fail on `main` too (`e2e/landing.spec.ts`, first test of `e2e/demo-flow.spec.ts`) | update the tests to the current landing page — a decision about that page, left to the owner |
| A fuzz test sits at its 5 s time limit on a throttled machine | `src/verification/fuzz.test.ts`, 5.4 s on battery | give CPU-bound tests an explicit, generous limit |
