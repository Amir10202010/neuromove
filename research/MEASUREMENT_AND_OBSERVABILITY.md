# Measurement and observability

What three six-axis inertial sensors on the trunk, upper arm and forearm can and cannot observe, what every number NeuroMove shows rests on, and how much of a number is sensor error or sensor placement.

Code: `website/src/lab/measure/` · interface: `#/research/frontier/measurement` · benchmarks: M2–M4, U1–U2, E1, R1 in [SCIENTIFIC_VALIDATION.md](SCIENTIFIC_VALIDATION.md).

**Status of every number in this document: simulation.** The values come from synthetic movements passed through the app's model of the MPU-6050. None has been measured on physical sensors or on children. They describe how the software behaves under stated assumptions; they are not accuracy claims.

The hardware is unchanged: ESP32 + 3 × MPU-6050, 100 Hz, ±4 g, ±1000 °/s, low-pass 44 Hz, no magnetometer.

## 1. Observability registry

`measure/registry.ts` is one list of every quantity the app shows or models. It does not redefine anything: channels, repetition metrics and movement features are imported from where they are computed (`coord/channels.ts`, `rehab/movement.ts`, `lab/features.ts`), and the registry adds the measurement fields those definitions lack. A test fails when a metric, feature or channel exists without an entry.

Each entry states: physical meaning, unit, sensors and channels required, coordinate frame, method, assumptions, status, when it is valid and when it fails, error model, limits of interpretation, and how it reacts to putting the sensors on again.

| Status | Meaning | Entries |
|---|---|---:|
| `directly_measured` | a sensor output after unit conversion only | 5 |
| `derived` | computed from measured quantities by a deterministic algorithm | 31 |
| `model_estimated` | depends on a fitted statistical model; changes if the model changes | 5 |
| `predicted` | a model statement about observations not yet made | 1 |
| `not_observable` | cannot be obtained with these sensors — no estimate is produced | 16 |

A status is never upgraded by software. The entries that are `not_observable` are listed so that the interface can say so instead of staying silent: brain activity, corticospinal tract integrity, neural activation or recovery, muscle electrical activity, muscle force and joint torque, spasticity and tone, absolute hand trajectory and endpoint accuracy, object contact and grip force, scapular motion independent of trunk and humerus, full clinical shoulder biomechanics (plane of elevation, axial rotation, glenohumeral versus scapulothoracic share), heading and trunk rotation about the vertical, wrist, hand and finger kinematics, pain, effort, fatigue and attention, function in daily life, the cause of a change, and standardised clinical assessment scores (which can only be entered from outside).

`observableWith(roles)` returns what a sensor configuration keeps and loses. A quantity is lost when any sensor it needs is not worn; nothing is estimated in its place.

Every value shown carries one of seven provenance labels (`PROVENANCE_LABELS`): real measurement, synthetic simulation, manual entry, external assessment, model estimate, model prediction, hypothetical scenario.

## 2. Repetition features

`measure/repFeatures.ts` computes fifteen features per repetition from the multi-segment channels of the coordination engine:

| Feature | Unit |
|---|---|
| outcome (peak angle of the task) | ° |
| excursion of trunk pitch, trunk roll, upper-arm elevation, forearm elevation, elbow flexion, arm relative to trunk | ° |
| trunk contribution (trunk excursion ÷ arm excursion) | — |
| outbound duration, return duration | s |
| peak angular rate | °/s |
| time to peak rate as a share of the outbound phase | — |
| smoothness of the outbound phase (SPARC) | — |
| onset of the trunk relative to the arm, onset of the forearm relative to the upper arm | ms |

## 3. Sensor placement

### What a recording can and cannot tell

Three facts, each shown by re-mounting sensors virtually (`virtualRemount` rotates the raw frames of one sensor, so the movement is identical and every difference is the placement alone):

1. **Calibration-referenced quantities do not depend on how a sensor is rotated on the limb.** Segment inclination, rate norms and durations are computed relative to the direction recorded during the still calibration, in the same rotated frame.
2. **Quantities that use a sensor axis by convention do depend on it:** elbow flexion (the hinge axis is taken from the upper-arm sensor) and the split of trunk movement into pitch and roll (forward is taken from the trunk sensor).
3. **A calibration posture that is not reproduced shifts every calibration-referenced angle** by about the posture difference, and the sensors cannot tell a different posture from a tilted strap.

So a recording yields bounds, not corrections. Nothing in the app "normalises" a session to hide placement.

### Measured sensitivities (simulation)

| Source | Effect | Benchmark |
|---|---|---|
| Rotation of the upper-arm or forearm sensor by up to 20° | invariant features change by 0.005° (95th percentile); largest single value 0.196°, when re-quantisation moves a detected onset by one 10 ms sample | M2a (fails its criterion of 0.05°), M2a2 |
| Rotation of the forearm sensor about the limb by 2° / 5° / 10° / 20° | elbow angle error, 95th percentile: 0.35° / 1.01° / 3.00° / 11.86°; single repetitions up to 20° | M2b |
| Rotation of the trunk sensor about the vertical, in movements with about 18° of trunk pitch | the roll excursion changes by 0.18° per degree of rotation (1.78° at 10°); this rotation cannot be seen in a recording | M2c |
| Calibration posture off by 1° | angles shift by 0.99–1.39° | M3 |
| Sensor moved 4 cm along the limb | angles change by at most 0.40° | M4 |

The calibration posture is the dominant placement error, and it is the one the recording cannot see.

### Placement confidence

`mountDiagnostics` extracts what is observable per recording: the tilt of the calibration direction from its nominal axis (strap tilt and posture, confounded) and the functional rotation axis of the moving segment (rotation about the bone and out-of-plane movement, confounded). `comparePlacement(reference, current)` compares two recordings:

- level **high** when the largest bias the observed differences could produce (1.4 × the tilt difference, or the elbow bound from the functional-axis difference) is at most 2.5°, **medium** up to 5°, **low** beyond, **unknown** without a reference. "High" means consistent with unchanged placement, not proof of it;
- for each quantity an **attribution bound**: 1.4 × (observed tilt difference + 5°). A difference of an angle between two recordings is attributed to the movement only if it exceeds this bound.

The 5° strap-tilt allowance (`STRAP_TILT_ALLOWANCE_DEG`) exists because strap tilt and calibration posture can cancel in the calibration direction, so the observed tilt difference can be near zero while the angles are shifted. It was added after strategy benchmark S2 failed (run 1: 12.5 % of re-attachments were reported as a change of the movement). Both the allowance and the 2.5° margin are **provisional constants**: they must be replaced by the result of a re-donning study on real sensors ([EXPERIMENTAL_PROTOCOLS.md](EXPERIMENTAL_PROTOCOLS.md), protocol P1).

## 4. Sensor uncertainty

`measure/uncertainty.ts` propagates the stated uncertainty of the sensor inputs through the actual processing pipeline by Monte Carlo, in the sense of GUM Supplement 1 (`jcgm101`): inputs are sampled, the pipeline is run on every sample, and the spread of each output is its standard uncertainty.

Inputs (type B; defaults follow the simulator's MPU-6050 model and the data sheet's order of magnitude):

| Input | Default | Kind |
|---|---|---|
| accelerometer noise per sample | 0.004 g | random |
| gyroscope noise per sample | 0.08 °/s | random |
| gyroscope residual bias after calibration | 0.05 °/s | systematic |
| accelerometer zero offset | 0.01 g | systematic |

Random and systematic parts are propagated separately because they combine differently over the n repetitions of a session:

    u(session mean)² = u_random² / n + u_systematic²

Results on synthetic recordings:

- The uncertainty of the session mean of the task outcome is 0.68–0.88°, almost entirely from the accelerometer zero offset. More repetitions do not reduce it. A six-position accelerometer calibration is the way to reduce it; its effect on this budget has not been measured.
- Random sensor noise explains less than 1 % of the repetition-to-repetition variance of the outcome. Repetition variability is the child's movement, not the sensor.
- The budget is a **lower bound** of the total measurement uncertainty: calibration posture and soft-tissue movement are not in it.

Each feature carries a flag for how far its budget can be trusted (`PROPAGATION_VALIDITY`), from comparing the propagated uncertainty with the spread over independent noise realisations (U1) and over re-mounted sensors (U2):

| Flag | Features |
|---|---|
| validated | outcome, trunk pitch and roll excursion, upper-arm excursion, arm relative to trunk, trunk contribution, return duration, peak rate, time to peak |
| approximate | forearm excursion, outbound duration |
| underestimates | smoothness (SPARC) |
| unstable | elbow flexion excursion (branch jumps of the hinge angle) |
| quantised, conservative | onset lags (10 ms samples) |

## 5. Personal measurement envelope

`measure/envelope.ts` answers one question without a population norm: is this session outside this person's ordinary session-to-session variation?

Model (the lab's shared measurement model): session mean = level + day-to-day deviation (SD σs) + mean repetition error (SD σε). With K baseline sessions and a new session of m repetitions:

    Var(new session mean − baseline mean) = σs²(1 + 1/K) + σε²(1/m + h/K),   h = mean of 1/n over the baseline sessions
    estimate  V = S²(1 + 1/K) + σε²(1/m − h),   S² = variance of the baseline session means
    interval  baseline mean ± t(0.975; ν)·√V

ν is K − 1 when the new session is at least as long as the baseline sessions, and Satterthwaite's approximation (`satterthwaite1946`) when it is shorter. The uncertainty of σs from few sessions is inside the interval: with three baseline sessions it is 2.2 times wider than a normal-theory interval.

Status rule, fixed in code: `insufficient` below 3 baseline sessions (no interval), `baseline_not_stable` when 4 or more sessions show a linear trend with p < 0.05, `provisional` when K ≤ 4, `usable` otherwise. Where no protocol designates a baseline, the first five included sessions are used and the interface says so.

Checked by simulation (E1): coverage 0.937–0.966 over five designs (25 000 runs); with five baseline sessions a shift of 15 units is found in 85 % of runs, with three sessions in 55 %.

Outside the envelope means "not explained by this person's usual variation". It does not mean the movement improved, and it does not say why.

## 6. Test–retest: reliability and measurement error are different properties

`measure/retest.ts` follows the COSMIN distinction (`mokkink2026`): reliability (ICC) is the ability to tell people apart and depends on how different the people in the sample are; measurement error (SEM, MDC) is the precision of one person's value and does not.

Nested model: value = mean + participant (σp) + session within participant (σs) + repetition (σε). From the variance components:

    SEM(n)   = √(σs² + σε²/n)
    MDC95(n) = 1.96 · √2 · SEM(n)
    ICC(n)   = σp² / (σp² + σs² + σε²/n)

Also reported: χ² interval of the SEM, MDC relative to the between-person SD, the existing two-way ICC for the first two occasions, Bland–Altman limits of agreement (`bland1999`), a test of systematic change between occasions, and Kendall's τ for error that grows with the level. The component estimates are within 1 % of the truth in simulation (R1).

No such study has been run with NeuroMove. Until one is, no metric has a known SEM or MDC in children, and the interface says so wherever a change is shown.

## 7. What this layer does not establish

- Validity against an optical or goniometric reference in children (the existing validation module collects such data; none exists yet).
- The size of soft-tissue artefact.
- Any number for real sensors: every constant above is from the simulator.
- Whether a change is clinically meaningful.
