# Motor Coordination & Strategy Discovery Engine (MCSE) — report

2026-11-08 · engine `nm-lab-coord 1.0.0` · code `website/src/lab/coord` · workspace `#/research/coordination`
(Research → Motor learning lab → Coordination & Strategy Lab).

**Question.** Can synchronised wearable IMU observations reveal reproducible, task-specific coordination patterns,
distinguish strategies that produce similar outcomes, and track how an individual's strategies change with practice?
**Answer so far.** On ground-truth synthetic data generated through NeuroMove's own IMU measurement model: yes, with
quantified limits (16 of 19 pre-specified checks pass; three documented failures). On real children: **not yet
testable** — no real raw multi-sensor recordings were available in this environment, and typical assessment sessions
(3 repetitions per movement) are below the engine's data-sufficiency thresholds by design.

## 1. What NeuroMove can now do that it could not before

| Before | Now |
|---|---|
| One scalar angle per repetition (ROM, SPARC, trunk tilt peak) | Synchronised multi-segment trajectories (trunk pitch/roll, upper-arm and forearm inclination, elbow hinge angle, segment angular rates, estimated humerothoracic elevation), each with a stated observability status |
| One onset per movement (single threshold) | Phase boundaries (onset, peak velocity, arrival, departure, offset) with uncertainty intervals from three thresholds + a change-point estimate; per-segment onsets |
| — | Landmark-registered trajectories, with original time-domain samples and phase durations kept |
| — | Coordination components with a data-driven component count (parallel analysis + bootstrap reproducibility + sufficiency) and alignment sensitivity |
| — | Strategy discovery that can say "single pattern", "inconclusive" or "insufficient data", with neutral labels, posteriors and signatures |
| — | **Performance–Strategy Dissociation Analysis**: equivalence-gated, continuum-wide FWE-controlled comparison of movement organisation between sets with equivalent outcomes, localised to channel and % of movement, with split-half replication and a sensor re-placement guard across sessions |
| — | Two-repetition comparison against outcome-equivalent reference pairs |
| — | Longitudinal strategy measures (distribution, Miller–Madow entropy, coordination variability, distance from baseline, transitions with Dirichlet credible intervals, reappearance) with coordination and performance series fitted separately by the **existing** learning-model comparison |
| Raw frames stored, unverifiable | Raw-stream manifest (SHA-256, placements, sync model, timeline, versions) for every new session; consent-gated raw retention for practice sittings; tampered streams refused |

## 2. Acceptance criteria

| | Criterion | Status | Evidence |
|---|---|---|---|
| A | Multivariate analysis of actual synchronised multi-sensor trajectories | **Met (pipeline), not exercised on real children** | `channels.ts` builds trajectories from stored int16 frames; `recording.test.ts` runs MCSE on frames recorded by the live `SessionEngine` (manifest verified, session calibration window used, repetition counts within ±1 of the clinical counter) |
| B | Interpretable, validated coordination representation | **Met on synthetic data** | V2 channel accuracy (0.4–1.7° RMSE; elbow fails in abduction), V4 PC1 congruence 0.998 with the true difference direction, robust to noise ×6, 2 % drops, 8° misalignment |
| C | Recurring within-person patterns when supported; refusal otherwise | **Met on synthetic data** | V5 power 0.95 / ARI 1.0 at n = 48; V6 0/80 false strategies on single-strategy data; V10 always `insufficient_data` below 12 repetitions; session-confound rule (unit test) |
| D | Similar scalar outcomes, distinguishable coordination (ground truth) | **Met with a power limitation** | V7b 0 false dissociations, V7c outcome differences always flagged; V7a power 0.60 at ≈ 12 per set (FAIL), 0.95 at 24 per set (post-hoc); demo workspace: Δ outcome −1.3° [−3.7, 1.2], p_FWE 0.0005, 93 % of the difference in trunk pitch |
| E | Track coordination change across practice and sessions | **Met with a margin caveat** | V8a 20/20 gradual switches detected; V8b false change 0.15 (FAIL vs 0.10) — provisional re-placement margin |
| F | Ground-truth recovery, robustness tests, documented limitations | **Met** | `validation.ts` (V1–V11), `research/mcse-validation.md`, benchmarks vs NumPy/ahrs/tslearn/scikit-learn/SciPy |
| G | Works with actual NeuroMove recordings; integrated with the research engine | **Integrated; real-data evaluation impossible here** | Workspace analyses every stored session with raw frames and every consent-gated practice sitting; adapters `inputs.ts`; longitudinal models through `lab/fit.ts`. See §3 |
| H | No claims about brain, muscle activation, neural synergies or recovery | **Met** | terminology "kinematic coordination components"; assumptions listed in every result; strategy labels neutral; trunk contribution defined as an observed ratio |

## 3. Real-data evaluation

Compatible recordings available in this environment: **none**.
- The repository's only device-format files are 5 firmware test fixtures (3–30 frames of bench counter patterns,
  not human movement). MCSE refuses all 5 (`fixtures.node.test.ts`).
- Clinic data live in each clinic browser's IndexedDB; none were accessible. The demo workspace has 9 seeded
  sessions per participant, all aggregate-only (`hasRaw: false`).
- Therefore no statement about real children's coordination is made. Running the engine on real data requires a
  device session (or a consent-gated practice sitting) recorded after this change; the workspace's "Analyse
  recordings" does it, and the provenance table states for each recording whether its raw stream was verified.

Data sufficiency for a real study (from V5/V7 and the post-hoc run): ≥ 24 complete repetitions of one movement per
participant for strategy discovery (power ≈ 0.65–0.95 depending on balance), ≈ 24 per compared set for PSDA power
0.95. Assessment sessions give 3 per movement — strategy questions need practice sittings with raw retention.

## 4. Established technology reused, adapted, and what NeuroMove developed

### Reused (existing methods and libraries, unchanged)
- **SVD / eigendecomposition**: ml-matrix 6.15.1 (MIT).
- **NeuroMove's own validated components**: gravity tracker (complementary filter), elbow hinge algorithm, accelerometer
  calibration and gyroscope-bias handling, still-period detection, zero-phase Butterworth filter, hysteresis repetition
  detector, signal-quality assessment, learning-model comparison (`lab/fit.ts`), SHA-256 hashing.
- **Standard statistics**: PCA (Daffertshofer et al. 2004), Gaussian mixtures by EM (Dempster et al. 1977), BIC
  (Schwarz 1978; Kass & Raftery 1995), Ward clustering, adjusted Rand index (Hubert & Arabie 1985), Jaccard cluster
  recovery (Hennig 2007), parallel analysis (Horn 1965), Tucker congruence (Lorenzo-Seva & ten Berge 2006),
  Miller–Madow entropy, Dirichlet–multinomial posteriors, bootstrap, equivalence testing via CIs.
- **Benchmark references** (not shipped): NumPy, SciPy, scikit-learn, tslearn, ahrs.

### Adapted (existing methods modified for NeuroMove's measurement configuration)
- Madgwick IMU filter (Madgwick et al. 2011), ported to TypeScript; heading aligned per sensor by the mount rule at the
  calibration pose; used only within repetitions for the estimated humerothoracic channel.
- Velocity-based movement onset (Balasubramanian et al. 2015 convention) extended to three thresholds + a change-point
  estimate → boundary uncertainty intervals; per-segment onsets.
- Landmark registration (Ramsay & Silverman 2005) on velocity-defined landmarks (onset, arrival, departure, offset).
- Discretised functional PCA on registered multi-segment excursion curves, residualised on the task outcome.
- Non-parametric SPM (Nichols & Holmes 2002; Pataky 2010) applied to multi-channel IMU-derived curves.
- DTW (Sakoe & Chiba 1978) implemented and benchmarked; used for sensitivity, not for the representation.
- New data structures: raw-stream manifest, channel catalogue with observability status, repetition/phase records with
  boundary uncertainty, strategy signatures, dissociation results with provenance.

### Original NeuroMove engineering (combinations and workflows; no claim to new base algorithms)
- An **observability-first multi-segment representation** for 3 six-axis IMUs: every channel carries a measured /
  observable / estimated status and an explicit reason when unavailable; an unobservable elbow sample is NaN, never an
  estimate.
- A **component-count rule** combining parallel analysis, bootstrap loading reproducibility and data sufficiency, with
  alignment sensitivity reported.
- **Strategy discovery with a right to refuse**: BIC parsimony + bootstrap stability + Jaccard recovery + Ward
  agreement + separation + **within-session co-occurrence** (a guard against sensor re-placement confounds found in
  validation).
- **Performance–Strategy Dissociation Analysis**: outcome caliper matching → equivalence gate → continuum-wide
  FWE-controlled trajectory test → channel/phase/component attribution with CIs → split-half replication → a
  **sensor re-placement margin** for cross-session comparisons.
- **Performance-adjusted coordination representation**, shown in validation to prevent performance differences from
  appearing as "strategies" (V6: 10/20 false strategies without it at n = 48, 0/40 with it).
- **Longitudinal strategy layer integrated with the existing learning engine** (coordination metrics fitted by the same
  pre-specified model comparison as performance, kept as separate series).
- **Ground-truth validation through the app's own IMU measurement model** (strategy specifications → body kinematics →
  MPU-6050 simulator → raw int16 frames), with pre-specified criteria, disjoint calibration seeds and a run history that
  records every change.
- **Verifiable raw-data retention** (manifest + hash, refused on mismatch) and consent-gated raw retention for practice.

## 5. Limitations

1. No real-child data analysed (§3). All performance figures are synthetic.
2. Elbow flexion is not observable when the arm is abducted (V2d FAIL) — excluded from the abduction representation.
3. PSDA power is 0.60 at ≈ 12 repetitions per set (V7a FAIL); ≈ 24 are needed.
4. The sensor re-placement margin (2.5°) is simulation-derived and gives 0.15 false longitudinal change (V8b FAIL)
   for a single stationary strategy; a real re-donning reliability study must set it.
5. Heading is unobservable; the humerothoracic channel is an estimate inside repetitions only.
6. Within-frame sensor skew (≈ 2–4 ms) is estimated from bus timing, not measured; lag estimates have 10 ms resolution.
7. The synthetic movement model (minimum-jerk, discrete strategies) is simpler than pathological movement.
8. Raw frames of practice sittings stay on the device (the server accepts raw chunks for sessions only), and they are
   not removed by the demo workspace reset (keyed by trial-set id).
9. GMM fitting can stop in a worse local optimum for larger K (benchmark: K = 4); the effect is conservative.
10. Kazakh UI strings need native-speaker review.

## 6. Next steps (in order of scientific value)

1. A re-donning reliability study (same child, sensors re-attached within a session) to replace the provisional
   re-placement margin and to estimate the minimal detectable coordination change.
2. Consent-gated practice sittings with raw retention (implemented) to reach ≥ 24 repetitions per movement.
3. Port VQF (basic, 6D) if relative orientation is to become a representation channel; re-validate V2c.
4. Independent methodological check of strategy discovery on U-Limb kinematics reduced to three segments
   (methodology only; never mixed with NeuroMove data).

## 7. Files

`website/src/lab/coord/`: `channels.ts` (observability + channels), `quat.ts` (orientation), `segment.ts`,
`align.ts`, `components.ts`, `coordination.ts`, `strategy.ts`, `dissociation.ts`, `longitudinal.ts`, `engine.ts`,
`provenance.ts`, `inputs.ts`, `synthetic.ts`, `demo.ts`, `validation.ts`, `mcse.worker.ts`, `linalg.ts`, `stats.ts`;
tests `coord.test.ts`, `recording.test.ts`, `validation.node.test.ts`, `bench.node.test.ts`, `fixtures.node.test.ts`.
UI: `website/src/features/motorlab/coordination/`. Documents: `coordination-feasibility.md`, `mcse-validation.md`,
`open-source-landscape.md`, `prior-art-analysis.md`, `algorithm-benchmarking.md`, `software-dependency-decisions.md`.
Data: `data/mcse-validation.json`, `data/mcse-posthoc-v7-n24.json`, `benchmarks/results.json`.

Run the full validation (≈ 12 min) from `website/` (bash; the npm script uses POSIX env syntax):

```bash
COORD_VALIDATE_FULL=1 COORD_VALIDATE_NOASSERT=1 COORD_VALIDATE_OUT=../research/data/mcse-validation.json npx vitest run src/lab/coord/validation.node.test.ts
```
