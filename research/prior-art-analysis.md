# Prior art behind each MCSE method

For every stage: the established method, its assumptions, whether NeuroMove's measurements satisfy them, and what
was done. DOIs verified against Crossref on 2026-11-08 (keys in `references.bib`, section "MCSE").

## 1. Orientation and relative orientation

| Method | Assumptions | Fit to NeuroMove | Decision |
|---|---|---|---|
| Complementary gravity tracking (existing `core/orientation.ts`) | gravity dominates the accelerometer on average; τ ≈ 0.5 s | yes — validated earlier against an independent reference (COORDINATES.md) | **Reused** for every inclination channel |
| Madgwick IMU gradient-descent filter (Madgwick et al. 2011) | 6-axis: corrects inclination only; heading = gyroscope integration | yes, for full orientation over seconds | **Adapted** (TypeScript port of the reference update, as in gaitmap/ahrs) for the humerothoracic channel only; agreement with `ahrs` 3 × 10⁻⁶ ° |
| VQF (Laidig & Seel 2023) | 6D/9D, rest/motion bias estimation | yes | Not ported now (no JS implementation; current use is display-only). First candidate if relative orientation enters the representation |
| OpenSense IMU inverse kinematics (Al Borno et al. 2022) | fused orientations per segment, static pose registration, heading reference | **no** — no magnetometer, no pelvis/scapula/hand sensors | Not used; static-pose registration idea already in the app |
| Hinge-joint axis methods (Seel et al. 2014) | joint ≈ hinge; enough excitation | elbow ≈ hinge; existing code uses the mount-defined axis | **Reused** existing `elbowFlexion`; **new guard**: undefined when the hinge axis is within 30° of vertical (validation V2d) |

Heading/yaw and segment positions are **not** estimated (no magnetometer; double integration drifts; Kok, Hol & Schön 2017).

## 2. Movement segmentation

| Method | Note | Decision |
|---|---|---|
| Hysteresis on the task angle (existing `core/reps.ts`) | the clinical definition of a repetition | **Reused** for coarse windows |
| Velocity threshold at 5 % of peak (Balasubramanian et al. 2015 convention; existing `lab/events.ts`) | single threshold is fragile | **Adapted**: boundaries at 3/5/10 % → uncertainty interval |
| Change-point detection (Killick et al. 2012; review Truong et al. 2020) | PELT for many change points | One least-squares mean-shift change point per onset as a **second method**; disagreement reported (`onsetMethodDiffMs`) |
| Multi-signal event fusion | — | Per-segment onsets from each segment's own angular speed → intersegment timing |

## 3. Temporal alignment

| Method | Assumptions / risks | Decision |
|---|---|---|
| Linear time normalisation | removes duration only; misaligns phases | kept for **sensitivity** analysis |
| Landmark registration (Ramsay & Silverman 2005, ch. 7) | landmarks must be reliably located | **Primary**: onset, arrival, departure, offset (velocity-defined). The angle maximum was rejected after validation run 1 (unstable on plateaus) |
| Dynamic time warping (Sakoe & Chiba 1978; tslearn) | warps freely — can align *different* coordination patterns onto each other and hide timing strategies | implemented and benchmarked; **not** used to build the representation, because intersegment timing is part of what is studied |
| Soft-DTW / barycentres (Cuturi & Blondel 2017; tslearn) | differentiable averaging | not needed (no learned model) |

Durations removed by normalisation are kept as separate per-repetition quantities, and the original time-domain
samples are kept for inspection.

## 4. Coordination components

| Method | Assumptions | Decision |
|---|---|---|
| PCA of joint-angle trajectories (Daffertshofer et al. 2004; Bockemühl, Troje & Dürr 2010) | linear structure; same units or scaling | **Reused** (SVD via ml-matrix) on degrees-only curves |
| Functional PCA (Ramsay & Silverman 2005, ch. 8) | smooth curves on a common grid | discretised fPCA on 101-sample registered curves |
| Component count: parallel analysis (Horn 1965) + loading reproducibility (Tucker congruence; Lorenzo-Seva & ten Berge 2006) + data sufficiency | — | **NeuroMove rule** combining the three; CV reconstruction error reported |
| NMF (synergy literature; Tresch, Cheung & d'Avella 2006) | non-negative data (e.g. EMG envelopes) | **Rejected**: excursion curves are signed |
| Uncontrolled-manifold analysis (Scholz & Schöner 1999; Latash et al. 2002) | an explicit task variable and a Jacobian from joint angles to it | **Not applicable as such**: the clinical outcome (upper-arm inclination) is measured directly and the segment angles do not form a full kinematic chain with known geometry. The *idea* — same outcome, different joint configurations — is what PSDA tests empirically |

Performance adjustment (residualising every feature on the task outcome) is a NeuroMove choice motivated in
validation (V6: without it, outcome differences alone produced false "strategies").

## 5. Strategy discovery

| Method | Assumptions | Decision |
|---|---|---|
| Gaussian mixtures + EM (Dempster et al. 1977), BIC (Schwarz 1978) | Gaussian clusters; BIC consistent for large n | **Adapted** (diagonal covariances; parsimony within ΔBIC ≤ 6, Kass & Raftery 1995) |
| Cluster stability: bootstrap ARI (Hubert & Arabie 1985), Jaccard recovery (Hennig 2007) | — | **Reused** as refusal criteria |
| Ward hierarchical clustering | spherical clusters | cross-check of the mixture partition |
| Density-based clustering (DBSCAN/HDBSCAN) | enough points to estimate density; ε/min-samples choice | **Not used**: unstable with tens of points, and its parameters would be arbitrary here |
| Confound check: clusters vs sessions | — | **NeuroMove rule** (co-occurrence within a session), from validation run 1 |

## 6. Strategy transitions and longitudinal change

| Method | Data needed | Decision |
|---|---|---|
| Hidden Markov models (Rabiner 1989; hmmlearn) | long sequences, many transitions per state | **Not fitted**: ≈ 3 repetitions per movement per assessment session |
| Switching linear dynamical systems (ssm) | dense continuous trajectories over many repetitions | not fitted |
| First-order Markov chain with Dirichlet(1) posterior | counts of transitions between confident labels | **Implemented**; credible intervals from posterior sampling; persistence tested by within-session permutation |
| Entropy with Miller–Madow correction | small-sample bias | **Implemented** with bootstrap CI |
| Learning-curve models for coordination metrics | — | **Integrated**: per-session coordination metrics go through the existing `lab/fit.ts` model comparison (stationary always a candidate) instead of new curve fitting |

## 7. Performance–strategy dissociation inference

| Method | Decision |
|---|---|
| Equivalence testing (two one-sided tests via a 90 % CI) | **Reused** for the outcome-equivalence gate (±5°) |
| Continuum inference with non-parametric SPM (Nichols & Holmes 2002; Pataky 2010; spm1d, GPL — code not used) | **Adapted**: Welch t over channel × time, family-wise error by the max-|t| permutation distribution, supra-threshold regions |
| Caliper matching on the outcome | **Implemented** to compare sets at overlapping performance |
| Split-half replication | **Implemented** as the reproducibility measure |
| Sensor re-placement margin for cross-session comparisons | **NeuroMove addition** (validation run 1 showed re-attachment alone produces significant differences); provisional, simulation-derived |

## 8. Related findings that bound interpretation

- Trunk displacement during reaching is a documented compensation in adult stroke (Cirstea & Levin 2000). NeuroMove
  reports trunk contribution only as an **observed ratio** and never labels a strategy compensatory: a child may use
  trunk motion for many reasons, and the engine cannot tell them apart.
- Kinematic synergy analyses with PCA (Bockemühl et al. 2010) describe *joint-angle co-variation*; they do not
  measure neural synergies. MCSE uses the term "coordination components" throughout.
