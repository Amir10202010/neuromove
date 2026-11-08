# MCSE validation

Engine: `website/src/lab/coord` (`nm-lab-coord 1.0.0`). Suite: `src/lab/coord/validation.ts`.
Run: `npm run coord:validate` → `research/data/mcse-validation.json`. All data in this document are
**SYNTHETIC** (generator `synthetic.ts`, participants `SYN-*`), produced through the full MPU-6050 measurement model of
the app's simulator. Nothing here describes a real child.

## 1. Pre-specified criteria (written before the first run, 2026-11-08)

| ID | What | Criterion |
|---|---|---|
| V1a | Madgwick 6-axis filter, analytic rotations | inclination error ≤ 1° |
| V1b | same, no gyroscope bias | heading drift ≤ 0.5° per 10 s |
| V2a–d | channel accuracy vs kinematic ground truth, nominal noise, both arms, flexion and abduction | RMSE upper_elev ≤ 2°, trunk_pitch ≤ 1.5°, humerothoracic (within repetitions) ≤ 3°, elbow_flex ≤ 4° |
| V3a–b | segmentation vs noise-free 5 %-of-peak-velocity boundaries | detection ≥ 0.95; median \|onset error\| ≤ 30 ms |
| V4 | coordination components, two-strategy data | PC1 congruence with the true strategy-difference direction ≥ 0.9 |
| V5a–b | strategy recovery, n = 48, 50/50 | power (verdict `multiple_strategies`) ≥ 0.8; median ARI ≥ 0.8 |
| V6a | false discovery, single-strategy data, n = 24 and 48 | false `multiple_strategies` rate ≤ 0.05 |
| V6b | single strategy, two outcome levels, performance-adjusted representation | false rate ≤ 0.10 |
| V7a | dissociation, equal outcome, arm vs trunk-assisted, 10 per group | power ≥ 0.8 |
| V7b | dissociation, two sets of the same strategy | false rate ≤ 0.05 |
| V7c | same strategy, outcome 120° vs 96° | flagged `outcome_not_equivalent` ≥ 0.95 |
| V8a | gradual strategy switch over 5 sessions | last-session change from baseline detected ≥ 0.8 |
| V8b | stationary participants | false change-from-baseline rate ≤ 0.10 |
| V10 | n < 12 repetitions | always `insufficient_data` |

Characterisation without a pass/fail criterion: noise ×3/×6, 2 % dropped frames, 8° extra misalignment, gyroscope
bias random walk, missing trunk sensor (V2, V4), timing-only strategies (V7), unbalanced strategies and n = 12/24
(V5), absolute vs performance-adjusted representation (V6), participant-wise vs record-wise generalisation (V9).

**Development note (disclosed).** Two engine rules were set while developing on ONE synthetic example (three sessions of
arm-dominant vs trunk-assisted repetitions), before this suite existed: (1) components and strategies use the
performance-adjusted representation by default — the example showed PC1 mixing movement amplitude with organisation;
(2) the mixture order is the smallest K within ΔBIC ≤ 6 of the minimum. No threshold was changed after the suite was run.

## 2. Run history (everything that changed the engine is listed)

| Run | What | Outcome |
|---|---|---|
| dev | one synthetic example (3 sessions, arm vs trunk-assisted) | PC1 mixed movement amplitude with organisation → performance-adjusted representation adopted; mixture order → parsimony rule. Set **before** any suite run. |
| 1 (quick, 2 replicates) | first execution of the suite | Failures traced to **four engine defects**, none fixed by moving a threshold: (a) the task-angle maximum on the flat endpoint plateau was a landmark → bimodal registration → spurious "strategies"; now arrival/departure (velocity-defined) are the landmarks; (b) elbow flexion was computed where the hinge axis is near vertical (abduction) → now NaN there; (c) every session re-mounts the simulated sensors with a new 2–5° misalignment, which alone produced "significant" session differences and session-aligned clusters → strategies must co-occur within a session, and cross-session changes must exceed a sensor re-placement margin; (d) V7 compared sets from different sessions, confounding (c) → V7 sets now come from one session, plus an explicit cross-session case. Also: non-overlapping outcomes now give `outcome_not_equivalent` instead of `insufficient_data`. |
| margin | `calibrateReplacementMargin` on **disjoint** seeds (50 000+), 2 × 20 participants × 4 session comparisons | 95th percentile **2.50°** (median 1.36°, max 5.34°) → `REPLACEMENT_MARGIN_DEG = 2.5`, provisional |
| 2 (full, 20 replicates) | `research/data/mcse-validation.json` | results below |
| eval fix | V7b formula counted `outcome_not_equivalent` as a false dissociation; corrected to the share of `dissociation` verdicts and re-applied to the stored run-2 data (`evaluationNotes` in the JSON) | V7b 0.45 → 0.00 (data unchanged) |
| post-run | `elbow_flex` excluded from the shoulder-abduction representation because it failed V2d for that movement (display only) | does not affect any run-2 metric (all strategy/dissociation experiments use flexion) |
| workspace testing | (1) the two-repetition comparison's reference distribution now uses only outcome-equivalent pairs — mixing outcome differences into "typical variability" hid a clear organisation difference; (2) the residual-bias (heading-drift) diagnostic now uses a strict 2 s still window — the calibration rule accepted slow trunk motion as bias (2.78 °/s reported instead of ≈ 0.02 °/s) | neither quantity is part of any criterion |
| quick mode | `npm test` runs only the deterministic checks (V1–V4, V10; V2d asserted as still failing); rate experiments run in the full suite only | — |

## 3. Results — run 2 (20 replicates; synthetic)

| ID | Value | Criterion | |
|---|---|---|---|
| V1a | 0.39° max inclination error | ≤ 1° | PASS |
| V1b | 0.22° heading drift / 10 s | ≤ 0.5° | PASS |
| V2a | upper_elev RMSE 0.88–1.14° | ≤ 2° | PASS |
| V2b | trunk_pitch RMSE 0.37–0.39° | ≤ 1.5° | PASS |
| V2c | humerothoracic RMSE 1.05–1.72° (within repetitions) | ≤ 3° | PASS |
| V2d | elbow_flex RMSE 2.5–2.7° (flexion), **7.06°** (abduction) | ≤ 4° | **FAIL** |
| V3a | detection 36/36 at noise ×1, ×3, ×6; 0 false positives | ≥ 0.95 | PASS |
| V3b | median \|onset error\| 20 ms (p95 20 ms) | ≤ 30 ms | PASS |
| V4 | PC1 congruence with the true difference direction 0.998 | ≥ 0.9 | PASS |
| V5a/b | n = 48, 50/50: power 0.95, median ARI 1.00 | ≥ 0.8 / ≥ 0.8 | PASS |
| V6a | 0 / 80 single-strategy datasets called "multiple strategies" | ≤ 0.05 | PASS |
| V6b | 0 / 40 (performance-adjusted, two outcome levels) | ≤ 0.10 | PASS |
| V7a | dissociation detected in 12/20; the other 8 stopped at `outcome_not_equivalent` | ≥ 0.8 | **FAIL** |
| V7b | 0 / 20 false dissociations | ≤ 0.05 | PASS |
| V7c | 20 / 20 outcome difference flagged | ≥ 0.95 | PASS |
| V8a | 20 / 20 gradual switches detected at the last session | ≥ 0.8 | PASS |
| V8b | false change: 1/20 (50/50 mix), **3/20** (single strategy) | ≤ 0.10 | **FAIL** (0.15) |
| V10 | 20 / 20 at n = 6 and 9 → `insufficient_data` | always | PASS |

**16 of 19 pre-specified checks pass; 3 fail (V2d, V7a, V8b).**

### Characterisation (no criterion)

- **Robustness of components (V4):** PC1 congruence 0.996–0.998 with noise ×3/×6, 2 % dropped frames, 8° extra
  misalignment + gyroscope bias walk; landmark vs linear alignment congruence 0.96–0.97. **Missing trunk sensor:**
  congruence 0.29 — the strategies differ in trunk motion, which then is unobservable; the engine reports the trunk
  channels as unavailable, it does not substitute them.
- **Minimum data (V5):** n = 12: power 0.40 (50/50), 0 (75/25 — the minority pattern has 3 members, below the
  minimum cluster size); n = 24: 0.65 (50/50), 0.95 (75/25); n = 48: 0.95 / 1.00. When recovered, median ARI = 1.
- **Why performance adjustment (V6):** on the ABSOLUTE representation, one strategy at two outcome levels was
  called two "strategies" in 3/20 (n = 24) and 10/20 (n = 48) datasets — performance differences masquerading as
  coordination. Performance-adjusted: 0/40.
- **Timing-only strategies (V7):** trunk-leading vs trunk-assisted (same amplitudes, 450 ms different trunk onset):
  dissociation in 14/20, 6/20 stopped at outcome equivalence.
- **Cross-session rule (V7):** two sessions of the same strategy with re-attached sensors: 18/20
  `within_replacement_margin`, 2/20 `outcome_not_equivalent`, 0 dissociations.
- **Generalisation (V9):** reconstruction error of held-out repetitions, 6 synthetic participants with individual
  coordination: participant-wise 3.30° vs record-wise 2.09° — leaking repetitions of a participant into training
  under-states error by 37 % (×1.58). All generalisation claims must use participant-wise splits.
- **Re-placement margin stability (V11):** recomputed on 10 further disjoint participants: 2.71° (vs 2.50° used).

### Reading the failures

- **V2d** — the elbow hinge angle is not observable from gravity when the upper arm is abducted (hinge axis near
  vertical). Known from FINDINGS F3; the engine now keeps it out of the abduction representation.
- **V7a** — the weak step is the *outcome-equivalence* test, not trajectory detection: with ≈ 12 repetitions per
  set and an outcome SD ≈ 6°, the 90 % CI of the mean difference often exceeds ±5°. PSDA refuses to call a
  dissociation it cannot show at equivalent performance; it needs more repetitions (post-hoc §4).
- **V8b** — the provisional re-placement margin (2.5°) is at the edge: false change 3/20 for a single strategy.
  The margin comes from a simulated re-placement model; a real re-donning study must replace it before any
  longitudinal coordination claim.

## 4. Post-hoc (not pre-specified): PSDA with 24 repetitions per set

`research/data/mcse-posthoc-v7-n24.json`. Same design as V7, 20 replicates, 24 repetitions per set. This is a
characterisation run AFTER V7a failed; it does not change V7a's FAIL.

| Condition | Verdicts (of 20) | Rate of the expected verdict |
|---|---|---|
| equal outcome, arm vs trunk-assisted | 19 dissociation, 1 outcome_not_equivalent | 0.95 |
| equal outcome, timing only (trunk leads by 450 ms) | 19 dissociation, 1 outcome_not_equivalent | 0.95 |
| same strategy, two random sets | 19 no_coordination_difference, 1 outcome_not_equivalent | 0 false dissociations |
| same strategy, 120° vs 96° | 20 outcome_not_equivalent | 1.00 |
| same strategy, two sessions, re-attached sensors | 19 within_replacement_margin, 1 outcome_not_equivalent | 0 false dissociations |

Interpretation: with ≈ 24 repetitions per pattern (≈ 2 practice sittings, or 8 assessment sessions of 3
repetitions), PSDA reaches 0.95 power in this synthetic setting without false dissociations. The assessment
protocol alone (3 repetitions per movement per session) is far below this.

## 5. What this validation does NOT show

- Anything about real children. The generator's movement model (minimum-jerk, two discrete strategies, Gaussian
  jitter) is far simpler than pathological movement; real strategies may be continuous, mixed or drifting.
- That the provisional re-placement margin (2.5°) holds for real strap placement — it is derived from the
  simulator's 2–5° misalignment model.
- That heading-dependent quantities are valid over a session: the humerothoracic channel is validated only
  inside repetitions and is never part of the representation.

