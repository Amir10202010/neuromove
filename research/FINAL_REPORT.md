# Final engineering and research report — NeuroMove Computational Motor Learning Lab

Date: 8 November 2026 · branch `research-platform` · uncommitted working tree at time of writing.

## 1. What was found in the original codebase

The full audit is in [system-audit.md](system-audit.md). In short:

**A mature offline-first rehabilitation app.**
- IMU pipeline: calibration, complementary filter, angles, repetition detection, SPARC, per-repetition metrics with an algorithm version.
- A validation module for goniometer agreement, a Functional Progression System (practice records with minutes, studies with consent gates) and an optional PostgreSQL sync server.
- Baseline: `tsc` and `eslint` clean, **377 unit tests passing**.

**Hardware.** ESP32 + 3 × MPU-6050 (no magnetometer), 100 Hz, ±4 g, ±1000 °/s. Not modified.

**Missing before this work.**
- Longitudinal modelling with a noise model.
- The learning/performance distinction.
- Reproducible analysis records.
- A raw-signal analysis view.
- A learning-study design tool.

## 2. What was implemented

| Layer | Implementation | Files |
|---|---|---|
| Signal quality | Per-sensor completeness, gaps, sampling irregularity, saturation per axis, stuck axes, rest \|a\|, gyro bias drift; recording sync share | `src/lab/quality.ts` |
| Signals | Physical units, bias-removed \|ω\|, gravity-referenced inclination and trunk tilt (existing filter reused), zero-phase Butterworth | `src/lab/signals.ts` |
| Events | Velocity onset, peak and offset; direction; pauses; incomplete movements; raise→lower pairing | `src/lab/events.ts` |
| Features | Duration, peak and mean speed, time to peak, speed peaks, SPARC (gyro), inclination change, trunk tilt, ratio, correlation, lag — each with validity conditions | `src/lab/features.ts` |
| Learning dataset | Series per participant × task × metric with every repetition, exclusions with reasons, practice dose | `src/lab/dataset.ts` |
| Models | Stationary, linear, exponential, local-level (Kalman/RTS), dose-driven learning–retention; shared repetition-level measurement model | `src/lab/models.ts` |
| Inference | ML (multi-start Nelder–Mead), profile-likelihood intervals and identifiability, AICc and Akaike weights, exact leave-future-out, parametric bootstrap, small-sample-corrected prediction intervals, residual checks | `src/lab/fit.ts`, `numeric.ts` |
| Learning decomposition | Immediate performance, within-session slope, online/offline, between-session change vs noise, retention (test vs delayed observation), transfer, forgetting-vs-saturation test | `src/lab/learning.ts`, `analysis.ts` |
| Motor Twin | Per-task models, states, parameters, predictions, warnings, explicit scope | `src/lab/twin.ts` |
| Sandbox and design | Hypothetical schedules with bootstrap bands and half-life sensitivity; next-observation design by expected Fisher information | `src/lab/sandbox.ts` |
| Trial-level dual-rate model | Smith et al. model with profile identifiability (used in the identifiability study) | `src/lab/dualRate.ts` |
| Study Designer | Versioned, content-hashed learning protocols; validation rules; frozen protocol → analysis configuration; simulation-based power | `src/lab/protocol.ts` |
| Lineage | SHA-256 (FIPS-tested), canonical JSON, frozen runs with snapshot, configuration and result hashes, versioned hash scheme, `verifyRun` | `src/lab/hash.ts`, `runs.ts` |
| Exports | Pseudonymised JSON, observations CSV, models CSV, data dictionary, Python snippet | `src/lab/export.ts` |
| Research assistant | Deterministic, grounded answers to 8 questions with evidence and "cannot conclude"; de-identified evidence packet as the future LLM boundary | `src/lab/copilot.ts` |
| Foundation-model groundwork | Inventory and evidence-based readiness gates; subject-wise evaluation harness and synthetic baseline | `src/lab/readiness.ts`, `representation.ts` |
| Storage | IndexedDB v4 store `lab` (additive, tested) | `src/data/db.ts`, `src/lab/records.ts` |
| UI (lazy chunk) | Lab overview, Motor Learning Explorer, Motor Twin, Movement Analysis Lab, Study Designer, Research Reports, Readiness; RU translations; the charts follow one-axis, legend and hover rules; palette validated | `src/features/motorlab/*`, `src/styles/motorlab.css` |
| Docs | 14 research and architecture documents + bibliography + validation data | `research/`, `website/docs/architecture/` |

The full chain works end to end in the app and the e2e test (§6): stored sessions → quality rules → repetition-level observations → models → twin → frozen run → report and export. **Raw** frames reach the Analysis Lab from stored live sessions or imu-csv files.

## 3. Methods selected, and why

Each method is in [mathematical-models.md](mathematical-models.md) and [evidence-matrix.md](evidence-matrix.md).

- **Repetition-level measurement model (σε, σs).** Change must be judged against repetition and day-to-day noise. Two-stage σε gives comparable likelihoods across models.
- **Five candidate models, "no change" always included.** They cover no change, steady change, saturation (heathcote2000), stochastic drift (Kalman) and dose-driven learning with forgetting (casadio2012).
- **Profile likelihood** (raue2009). It makes non-identifiability visible instead of producing confident-looking numbers.
- **AICc + exact leave-future-out + persistence baseline.** Small-sample comparison that respects time order (hurvich1989, burkner2020).
- **Parametric bootstrap with a small-sample correction.** Calibrated prediction intervals: coverage 0.92 (E7).
- **Gyroscope-based smoothness and velocity events.** IMU-appropriate (melendez2021, balasubramanian2015).
- **Frozen, hashed runs.** Reproducibility and an audit trail.

## 4. Methods rejected or deferred, and why

- **Dual-rate models on assessment data:** not identifiable. E6 gives 0 % with sparse observations (albert2018).
- **Bayesian hierarchical models:** too few participants for justified priors. Revisit at ≥ 15 participants × ≥ 5 sessions.
- **Power-law curves:** averaging artefacts.
- **Random splits:** leakage.
- **Accelerometer jerk:** gravity contamination.
- **Position and heading:** not observable.
- **Normality tests:** no power at small K.
- **An LLM assistant:** the deterministic version is implemented; an external model would need authorisation and a privacy review.
- **A "foundation model":** no adequate data; replaced by gates and a roadmap.

## 5. Hypotheses the system can now investigate

[research-questions.md](research-questions.md) lists them. The ones it can address now:
- Q1–Q3: individual change beyond noise; the shape of change; forgetting versus saturation.
- Q7–Q9: practice dose; feedback and structure, given a study design; transfer.
- Q10–Q14: measurement comparisons, quality effects, study power and next-observation design.

Q4–Q6 and Q15–Q16 need more participants.

## 6. Validation actually executed (results)

| Check | Result |
|---|---|
| `tsc -b` (app, node, server) | pass |
| `eslint .` | pass |
| `vitest run` | **430 passed in 34 files** (baseline 377 in 30; +53 new) |
| `vite build` | pass; lab chunk `MotorLabRoute` ≈ 117 kB (36 kB gzip); workspace chunk unchanged in size |
| `npm run check:api` | server bundle up to date (no server change needed) |
| Monte Carlo E1–E8, R1 (full mode) | see [model-validation.md](model-validation.md): E1 0.5 % false change; E3 coverage 0.955; E4 25 % vs 95 % identifiable; E5 0 % vs 100 %; E6 83 % vs 0 %; E7 coverage 0.92; **E2 failed its criterion** (power 0.71); **R1 showed no leakage gap on synthetic subjects** |
| Playwright `motorlab.spec.ts` | pass on desktop (1440 × 900) and mobile (Pixel 7) |
| Playwright `layout-a11y.spec.ts` with the lab routes added | pass (no overflow 320–1440 px in RU, KK, EN; no serious or critical WCAG 2.1/2.2 AA axe violations) |
| Full Playwright suite (all specs, desktop + Pixel 7, built site with production CSP) | **45 passed** (4.4 min; previous report: 39), so the existing app still works |
| Manual browser inspection (in-app browser) | Explorer, Twin, Movement Lab (simulated imu-csv), Reports (reproduced after IndexedDB round trip), Designer, Readiness; defects found and fixed are listed in model-validation.md §4 |

## 7. What works with real data

Everything runs on real data with identical code:
- clinic sessions (stored repetition metrics);
- practice records (dose);
- raw frames of live sessions;
- imu-csv files from the device or bench;
- protocols and frozen runs.

**No real participant data were present or analysed in this environment.** Nothing here reports a real result.

## 8. What currently depends on synthetic data

| Item | Synthetic source |
|---|---|
| Demo workspace analyses | virtual patients, labelled "synthetic demonstration data" |
| All validation experiments E1–E8 and R1 | simulation |
| Noise assumptions in power planning | assumed until the workspace has ≥ 3 series; then estimated automatically |

## 9. Limitations that remain

- **No validity in children.** No reference-standard agreement, reliability or MDC exists yet, so every metric is "calculated from IMU", not validated.
- **Assessment protocols are weak for learning questions.**
  - 3 repetitions and weekly sessions give low power for small changes (E2).
  - A slow learning curve's time constant is unidentifiable at 8 sessions (E4).
  - Forgetting is unidentifiable on regular schedules (E5).
- **Dose comes from caregiver reports**, or is an explicit assumption.
- **Lab records are local to one browser.** No team sync or server table yet.
- **No trial-level practice data are stored,** so multi-rate learning models cannot be applied.
- **Only Chromium was tested.** Cross-engine floating-point differences are tolerated by 8-digit hashing, but untested.
- **Kazakh strings fall back to Russian** for the lab, as for the research module.
- **The literature review is targeted, not systematic.** Full texts were not re-read in this session; metadata were verified.

## 10. Next research milestones

1. **Reliability and agreement study** (Template C): MDC per metric. This is the prerequisite for any change claim.
2. **Template A pilot**: 12 weekly sessions × 5 repetitions, a designated no-practice retention delay and a practice log. Freeze the protocol first.
3. **Software**:
   - sync lab records (server table, migration, outbox entity);
   - store practice trials with target and feedback (enables dual-rate models and Q5, Q8);
   - prospective forecast-coverage table;
   - Kazakh translation review.
4. **Group analysis** in R or Python from the exports. A hierarchical model once ≥ 15 participants × ≥ 5 sessions exist.
5. **Representation research** only after the readiness gates are met (foundation-model-roadmap.md).
