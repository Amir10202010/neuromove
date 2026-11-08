# Measurement model — what NeuroMove's sensors can observe

Code: `website/src/core` (existing pipeline, unchanged), `website/src/lab/{signals,quality,events,features}.ts` (new). Hardware and firmware are frozen and were only read.

## 1. Instrument (verified in firmware and code)

| Property | Value | Source |
|---|---|---|
| Sensors | 3 × MPU-6050 (3-axis accelerometer + 3-axis gyroscope, **no magnetometer**) on one ESP32, two I²C buses | `firmware/README.md`, `research/capabilities.ts` |
| Placement | trunk + upper arm + forearm of **one** arm (the contract also names the other arm; with 3 modules one arm at a time) | `devices/types.ts`, `capabilities.ts` |
| Sampling | 100 Hz, one imu-csv v1 line per sample containing every module | `devices/contract.ts`, firmware |
| Ranges | ±4 g (8192 LSB/g), ±1000 °/s (32.8 LSB/(°/s)) | `core/imu.ts` |
| On-chip filter | DLPF_CFG 3: about 44 Hz accelerometer, 42 Hz gyroscope | firmware (engineering report §10) |
| Calibration | stand-still pose (3 s, gyro bias and reference "up") per session; optional six-position accelerometer offset/scale per module (firmware) | `core/pipeline.ts` Calibrator, `core/imu.ts` |

**Inter-sensor timing.** The modules are read sequentially in one firmware loop and emitted as one line, so they share one timestamp by construction. The within-sample skew is bounded by the I²C read time of the three modules: an estimate of a few milliseconds, **not measured**. NeuroMove does not estimate synchronisation offsets; the QC reports the share of frames that carry every module.

## 2. Sensor-to-measurement capability table

Provenance classes:
- **measured**: a physical quantity after unit conversion only;
- **derived**: calculated from measured signals by a documented algorithm;
- **estimated**: a model output;
- **predicted**: a model output at a future time;
- **hypothetical**: a model output under a counterfactual scenario.

| Quantity | Source | Raw / processing | Frame | Unit | Class | Expected uncertainty | Unreliable when |
|---|---|---|---|---|---|---|---|
| Specific force | accelerometer | int16 ÷ 8192 (± six-position calibration) | sensor | g | measured | uncalibrated offset up to about ±50 mg ≈ 3° of tilt (`core/imu.ts`); noise about 0.01 g | saturation beyond 4 g; strong linear acceleration |
| Angular rate | gyroscope | int16 ÷ 32.8 − bias (still period) | sensor | °/s | measured | bias residual after a 3 s still period of about 0.1–0.5 °/s (simulation); bias drifts with temperature | saturation beyond 1000 °/s; no still period → bias not removed (flagged) |
| Angular speed \|ω\| | gyroscope | magnitude; zero-phase Butterworth 6 Hz for events | — | °/s | derived | dominated by the bias residual at rest | as above |
| Segment inclination ("elevation") | accelerometer + gyroscope | existing complementary filter (α = 0.98, τ ≈ 0.5 s), angle of the sensor X axis from "down" | gravity-referenced | ° | derived | a few degrees; to be established by the goniometer study | fast movement with large linear acceleration; strap slip; sensor axis not along the bone |
| Joint angles (shoulder elevation, elbow flexion, forearm rotation) | 2–3 sensors | existing pipeline, relative to the calibration pose | anatomical (approx.) | ° | derived | measured by the validation module (bias, LoA); not established in children | shoulder plane not separable from elevation; elbow needs a pinned upper arm; rotation needs a horizontal forearm (existing flags) |
| Trunk tilt | trunk sensor | angle between the current "up" and the "up" at the first still period | gravity-referenced | ° | derived | as inclination | trunk **rotation about vertical** is not observable |
| Heading / yaw | — | **not computed** | — | — | — | — | always (no magnetometer) |
| Position, displacement | — | **not computed** (double integration drifts quadratically, kok2017) | — | — | — | — | always |
| Per-repetition ROM, peak velocity, duration, SPARC, trunk | stored per session | existing `core/metrics.ts` (angle-threshold repetitions) | — | °, °/s, s | derived | repetition SD (σε) estimated per series | flagged steps (saturation, gaps, sensor lost, flipped mount, calibration movement) |
| Movement onset/offset, peak | gyroscope | velocity thresholds (§5) | — | s | derived | ±1 sample (10 ms) plus threshold dependence | slow tremor-like movement; gaps |
| Session latent state, learning parameters | session means | models (mathematical-models.md) | — | metric unit | estimated | profile-likelihood intervals | few sessions; non-identifiable designs |

## 3. Measurement ontology (layers kept separate in code)

| Layer | Content | Where | Mutability |
|---|---|---|---|
| Raw signals | seq, t, int16 × 6 per module, passport, calibration | IndexedDB `raw` (10 s chunks), PostgreSQL `nm_raw_chunks` | immutable (write-once, SHA-256 on the server) |
| Signal quality | completeness, gaps, sampling irregularity, saturation per axis, stuck axes, rest \|a\|, bias drift, frames with all sensors | `lab/quality.ts` (computed on demand) | recomputable |
| Movement events | onset / peak / offset, direction, pauses, incomplete | `lab/events.ts` | recomputable |
| Movement features | §6 | `lab/features.ts` | recomputable |
| Stored repetition metrics | per repetition, per step, with `algorithmVersion` | `Session.steps[].summary.reps` | immutable per session (the existing rule) |
| Learning observations | repetitions per session, inclusion and exclusion reasons, dose before session | `lab/dataset.ts` | derived; frozen into runs |
| Learning variables | session estimate, within- and between-session change, retention, transfer | `lab/learning.ts` | derived |
| Model outputs | latent state, parameters with profile intervals, predictions, diagnostics | `lab/fit.ts`, `lab/analysis.ts` | estimated; frozen into runs |

Every derived value keeps a link to its session (`sessionId`) and to the algorithm version that produced the stored metric. Every model output carries the component versions of `lab/version.ts`.

## 4. Signal-quality rules (`lab/quality.ts`, `QC_LIMITS`)

These are conditions for valid processing, **not clinical norms**.

| Check | Rule | Rationale |
|---|---|---|
| Completeness | ≥ 98 % high; 90–98 % medium; < 90 % low | 90 % is the existing session-level eligibility rule (`rehab/movement.ts`) |
| Longest gap | > 0.5 s → medium | the orientation filter restarts after 0.5 s (`core/pipeline.ts`) |
| Saturation | > 0.5 % of samples → medium; > 2 % → low | saturated samples clip peaks (±4 g, ±1000 °/s) |
| Stuck axis | min = max over more than 1 s → low | a disconnected or failed axis |
| Rest \|a\| | deviates from 1 g by > 0.03 g → medium | accelerometer offset/scale error (about 2° of tilt) |
| Gyro bias drift | first vs last still period (3 s windows) differ by > 1 °/s → medium | temperature drift; residual bias integrates into inclination |
| Still period | 3 s with per-axis gyro range ≤ 16 °/s, \|a\| within 0.15 g of 1 g, **and** gravity direction change ≤ 1° | the first two are the Calibrator's rule. The gravity condition was added after a defect was found: a slow steady rotation passes the range test, and its rate was read as bias (regression test in `signals.test.ts`) |
| Irregular sampling | > 5 % of intervals deviate from nominal by > 50 % → medium | timing jitter or packet bursts |

## 5. Movement events (`lab/events.ts`)

1. Take the angular speed of the selected segment (bias removed) and apply a zero-phase 2nd-order Butterworth low-pass at 6 Hz, run forward and backward.
   - Its gain is 0.5 at the cut-off; this is verified analytically in tests.
2. **High threshold** = max(20 °/s, 15 % of the recording's 99th-percentile speed). Runs above it are candidate movements.
3. Extend each run **back and forward** to where speed falls below max(3 °/s, 5 % of its own peak). The 5 % convention follows the smoothness literature.
4. Merge runs closer than 0.12 s, and discard runs shorter than 0.25 s.
5. **Direction**: the inclination change over the movement is > +10° for raise, < −10° for lower, otherwise "other".
6. **Incomplete**: the movement touches the recording edge or a gap > 0.5 s; its features are marked missing.
7. **Pauses** are gaps of ≥ 1 s between movements. **Repetitions** are raise → next lower pairs.

**Validation** (`signals.test.ts`):
- On a simulated session, the method finds exactly one raise and one lower per engine repetition.
- The inclination change of each raise is within 15° of the engine's ROM for shoulder flexion.

These are software checks against simulated ground truth, **not** a validation on children.

## 6. Movement features (`lab/features.ts`, `FEATURES`)

| Feature | Definition | Valid when |
|---|---|---|
| duration | offset − onset | movement complete |
| peak_speed, mean_speed | max / mean of filtered \|ω\| | no gyroscope saturation in the movement |
| time_to_peak_fraction | (t_peak − onset) / duration | complete |
| speed_peaks | local maxima with prominence ≥ 10 % of peak (submovements, rohrer2002) | complete; depends on the low-pass cut-off |
| sparc | SPARC of unfiltered \|ω\| (fc 10 Hz, threshold 0.05) — existing `core/sparc.ts` | complete, ≥ 8 samples |
| inclination_change | inclination at offset − at onset | heading not involved; strong accelerations degrade it |
| trunk_tilt | max trunk tilt from its first still orientation within the movement | trunk sensor present and a still reference |
| trunk_ratio | trunk_tilt / \|inclination_change\| | arm change ≥ 20° |
| trunk_arm_correlation | Pearson r of trunk tilt and arm inclination | ≥ 20 samples; describes co-variation, not causation |
| trunk_lag | lag (±0.5 s) maximising the cross-correlation of tilt rate and inclination rate | ≥ 50 samples and r ≥ 0.5 |

**Not computed:**
- accelerometer-based jerk metrics: SPARC/LDLJ are inappropriate for translational IMU data and the acceleration variant depends on orientation accuracy (melendez2021);
- angular acceleration from the 20 Hz trace;
- elbow inter-segment kinematics in the lab layer, because the existing pipeline's calibrated elbow angle is used for elbow tasks.

## 7. Known measurement limitations

1. **Sensor-to-segment alignment** is assumed (X axis along the bone). Strap slip changes every angle and is detected only indirectly (calibration-pose warnings, flipped-mount detection).
2. **Linear acceleration contaminates gravity-referenced angles** during fast movements. The complementary filter limits but does not remove this.
3. **Gyroscope bias** is removed from one still period; residual bias and drift are reported, not corrected over time.
4. **Rotation about vertical** (heading) is unobservable: shoulder horizontal adduction/abduction and trunk rotation cannot be measured.
5. **No reference-standard agreement in children exists yet.** The goniometer validation module collects it; until then every metric is "calculated from IMU", not "validated".
6. **Synchronisation** between modules is by construction, with a small unmeasured skew. There is no synchronisation with external devices or video.
