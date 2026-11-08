# Model validation — what was tested, how, and the actual results

Raw results: [`data/model-validation.json`](data/model-validation.json), produced by `npm run lab:experiments` in `website/`, full mode, Node 24, 2026-11-08.

## 0. Levels of validation

| Level | Status |
|---|---|
| 1. Software correctness (code does what is specified) | ✅ unit, integration and e2e tests below |
| 2. Mathematical correctness on synthetic ground truth | ✅ recovery tests and Monte Carlo experiments E1–E8 |
| 3. Reliability of real sensor measurements | ⛔ not established here (needs real repeated sessions) |
| 4. Agreement with a reference instrument | ⛔ not established (the goniometer module collects it; no real data analysed) |
| 5. Clinical validity | ⛔ not established |
| 6. Generalisation to new participants | ⛔ not established |

**No real participant data were available or analysed.** Every number below is from simulation, so the results bound what the methods *can* do; they say nothing about children.

## 1. Deterministic tests (run on every `npm test`)

Files:
- `src/lab/models.test.ts`: 19 tests
- `src/lab/signals.test.ts`: 11
- `src/lab/pipeline.test.ts`: 19
- `src/lab/experiments.node.test.ts`: 3

| Area | What is checked (tolerance) |
|---|---|
| Numeric core | Nelder–Mead reaches the Rosenbrock optimum (1, 1) to 1e-4; Hessian and inverse exact for a quadratic; Φ(1.96) = 0.975 (1e-6); Φ⁻¹(0.975), Φ⁻¹(0.001) to 1e-8 / 1e-7; transforms round-trip |
| Measurement model | Pooled σε recovered (true 4 → 3–5, df 48). LFO folds do not see a corrupted future session's SS. |
| Stationary | μ recovered within ±5 of 120; profile interval covers the truth; stationary selected |
| Linear | Slope 3/week recovered within [2.2, 3.8]; linear beats stationary by ΔAICc > 4 |
| Exponential | A = 150 within ±5, τ = 20 d within [14, 28] from 24 sessions; identifiable. A nearly linear 6-session curve is flagged **not identifiable** (open τ interval). |
| Local level | Drift q = 2/day recovered in [0.5, 8]; smoothed states within mean absolute error 3 of the truth |
| Learning–retention | With breaks and varying dose: h = 21 d within [12, 40], gain 0.4 within [0.3, 0.55], interval covers truth. On a regular weekly schedule with constant dose and slow forgetting: **not identifiable**. |
| Validation logic | LFO predictions for earlier folds are unchanged when a later session is corrupted. With 3 sessions, all complex models report "insufficient data" and none draws a curve. |
| Prediction intervals | Bootstrap and corrected plug-in widths agree (ratio 0.7–1.5) and both cover a held-out truth |
| Determinism | Identical bootstrap output for an identical seed |
| Raw signals | Zero-phase filter: DC gain 1, gain 0.47–0.53 at the cut-off, zero phase. Peak counter: 1 peak for a bell, 3 for a three-hump profile. QC detects 15 % loss + 0.8 s gap, per-axis saturation, stuck axes. A slow rotation is not taken as stillness. Simulated session: one raise + one lower per engine repetition; raw time base aligned with engine windows; raise inclination within 15° of engine ROM; no false bias-drift flags. |
| Lineage | SHA-256 matches FIPS vectors (including a 1000-character input); canonical JSON is key-order independent. A frozen run reproduces itself, also after a JSON round trip. Tampering with snapshot, configuration or results is detected. Later edits to source sessions do not change a frozen run. |
| Privacy | JSON and CSV exports contain no participant id, name or ISO dates by default. Session ids are pseudonymised; demo session ids embed the participant id, which was found by this test and fixed. |
| Protocols | Validation rules; content hash detects edits; frozen versions only archive; a protocol maps to the analysis configuration (transfer side resolved from the affected side, never guessed) |
| Assistant | Every question returns evidence or an explicit "cannot answer". Numbers equal the engine's to 1e-10. The evidence packet has no participant id. |
| Readiness | The evaluation gate equals ⌈(1.96·0.1/0.05)²⌉ = 16. The inventory never counts simulated sessions in the clinic. |

## 2. Monte Carlo experiments (full mode)

**Design common to E1–E8 unless stated:**
- weekly sessions;
- 3 repetitions per session;
- repetition SD σε = 4 and session SD σs = 2.5, a ROM-like **assumption**.

Criteria were written into `experiments.ts` before the reported run. Revisions after the 12-seed pilot are disclosed in §3.

| ID | Question | Seeds | Result | Criterion | Pass |
|---|---|---|---|---|---|
| E1 | False "change" when nothing changes (8 sessions) | 200 | **0.5 %** (1/200, linear) | ≤ 15 % | ✅ |
| E2 | Power vs weekly change, 8 sessions, all 5 candidates | 100 | 0.5/wk: 0.03 · 1/wk: 0.22 · **2/wk: 0.71** · 3/wk: 0.99 | power ≥ 0.8 at 2/wk | ❌ **finding** |
| E3 | Coverage of 95 % profile interval for the slope (10 sessions) | 200 | **0.955**; mean bias +0.02/wk | 0.88–0.99 | ✅ |
| E4 | Identifiability of a slow learning curve (τ = 60 d) | 40 | 8 weekly: **25 %** identifiable (τ coverage 0.93) · 24 every 4 d: 95 % (0.98) · 16 weekly: **95 %** (1.00) | 16 > 8 sessions | ✅ |
| E5 | Forgetting vs saturation (truth: h = 21 d) | 40 | Regular weekly, constant dose: learning–retention preferred in **0 %**. Breaks + variable dose: **100 %**. Half-life coverage 0.975 / 0.95; median relative error 0.21 / 0.10. | ≥ 50 % with breaks, ≤ 20 % regular | ✅ |
| E6 | Dual-rate identifiability (Smith paradigm, 235 trials) | 12 | Dense: all 4 rates identifiable **83 %**, B_s relative error 0.05 · 10 sparse observations: **0 %**, error 0.33 | dense > sparse | ✅ |
| E7 | 95 % interval for the next session mean | 100 | Plug-in (t, corrected): **0.93** · bootstrap B = 150: **0.92** | bootstrap 0.88–0.99 | ✅ |
| E8 | Planning: power at 2/wk (3 candidates) | 100 | 8 sessions × 3 reps: 0.81 · 8 × 6: 0.90 · 12 × 3: 1.00 · 12 × 6: 1.00 | descriptive | — |

**Interpretation.**
- **E1/E2.** The selection rule is conservative: it almost never invents change, and it pays for that with power. With the current schedule (8 weekly assessments, 3 repetitions), a true change of 2 units/week (≈ 14 over the series) is missed about 29 % of the time with the full candidate set. More sessions help much more than more repetitions (E8). This is a **design finding** to put into study protocols, not a defect to tune away.
- **E4.** Typical assessment series cannot pin down the time constant of a slow learning curve. About twice as many sessions are needed.
- **E5.** "Forgetting" can be estimated **only** when the schedule varies. On regular schedules the platform reports the confound instead of a half-life.
- **E6.** Multi-rate learning models are not estimable from assessment data. This justifies not applying them.
- **E7.** Prediction intervals are calibrated after the small-sample correction.

### R1 — representation-learning evaluation harness (synthetic)

**Design.**
- 8 virtual patients × 2 sessions, upper_standard protocol, right arm, 419 windows of 2 s.
- Task: 4-class exercise recognition with a nearest-centroid classifier on hand-crafted window features.

| Split | Accuracy |
|---|---|
| Random windows (record-wise) | 0.866 |
| Leave-one-subject-out | **0.862** (per subject 0.79–0.91) |

**Finding.** In simulation the record-wise/subject-wise gap is negligible, because virtual patients differ only in severity and sway and are far more homogeneous than real children. The harness is correct (a unit test confirms that subject-specific features inflate record-wise accuracy), but **simulated subjects cannot be used to estimate leakage or generalisation**. That measurement needs real data (Q16).

## 3. Disclosed changes after pilot runs (12–20 seeds)

1. **E4.** The pilot used τ = 21 d; both designs were identifiable in every seed, so the experiment did not discriminate. It was redesigned to τ = 60 d with a 16-session arm before the reported run.
2. **E5.** In the pilot the half-life was "identifiable" even on a regular schedule. Analysis showed the structural re-parameterisation (forgetting ≡ saturation curvature). The question was changed to the scientifically relevant one: do the data prefer learning–retention over exponential?
3. **E7.** Pilot coverage was 0.77 (plug-in) and 0.85 (bootstrap). The cause was the downward small-sample bias of ML σs. A degrees-of-freedom correction was added to the prediction code (not to the criterion) and the unit test was updated accordingly.
4. **E2.** It failed its criterion in pilot and in the full run. The criterion was **not** changed; the result is reported as a finding.

## 4. Defects found by the validation itself and fixed

| Found by | Defect | Fix |
|---|---|---|
| E7 pilot | Prediction intervals under-covered | Small-sample variance correction + t quantile |
| Export test | Demo session ids contain the participant id, so a pseudonymised export leaked it | Session ids pseudonymised per run |
| Assistant test | "No poor-quality sessions" was answered with no evidence | The number of sessions examined is attached |
| Browser test, Movement Lab | Gyro bias drift falsely flagged on moving segments: a slow rotation was accepted as a still period, and sway inside 1 s windows | Gravity-direction stability condition + 3 s bias windows; regression tests; component versions bumped to 1.1.0 |
| e2e, 320 px | Lab entry button and wide tables pushed pages sideways; scroll areas not keyboard-focusable | Entry moved into the page body, grid children may shrink, scroll regions focusable |

## 5. What remains unvalidated

- All metrics on real children: agreement, reliability, MDC.
- The measurement-model assumptions on real data: exchangeable repetitions, constant σε, Gaussian errors.
- Whether dose from caregiver reports is accurate enough to drive the learning–retention model.
- The noise values assumed in E1–E8, which should be replaced with workspace estimates once real data exist. The Study Designer's power check already does this automatically.
- Cross-browser numeric reproducibility. Hashes round to 8 significant digits to tolerate last-bit differences; only Chromium was tested.
