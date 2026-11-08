# Open-source landscape for MCSE

Investigated 2026-11-08 for the Motor Coordination & Strategy Discovery Engine (`website/src/lab/coord`).
Metadata from the GitHub API and package registries on that date; algorithm claims from the source files read
(paths given). NeuroMove runs in the browser (TypeScript, offline-first), so a Python package can be **used as a
reference** (benchmarks) but cannot be imported into the app without shipping a Python runtime.

## Candidates required by the brief

| Project | What it is | License | Status (2026-11-08) | Relevant parts read | Fit for NeuroMove |
|---|---|---|---|---|---|
| **OpenSim / OpenSense** (opensim.stanford.edu; Al Borno et al. 2022, doi:10.1186/s12984-022-01001-x) | Musculoskeletal modelling; OpenSense = IMU-driven inverse kinematics | Apache-2.0 (OpenSim core) | maintained | OpenSense user guide (Confluence page in the brief) | **Not applicable as a dependency.** Expects *already fused orientations* (rotation matrices from Xsens/APDM files), one IMU per tracked segment, a static calibration pose registered to the model's default pose and an optional heading correction with a base IMU. NeuroMove has no fused 9-axis orientations, 3 IMUs on one arm + trunk, no magnetometer, no pelvis/scapula/hand sensor. Fitting a generic upper-extremity model to 3 six-axis IMUs would produce joint angles the measurement cannot identify (e.g. glenohumeral plane of elevation). Adopted idea: **static-pose sensor-to-segment registration**, which NeuroMove already uses (calibration pose). |
| **gaitmap** (github.com/mad-lab-fau/gaitmap; Küderle et al. 2024, doi:10.1109/OJEMB.2024.3356791) | Foot-IMU gait pipeline + benchmarking ecosystem | MIT, except sub-package `gaitmap_mad` AGPL-3.0 | active (pushed 2026-10-23, 95★) | `trajectory_reconstruction/orientation_methods/_madgwick.py` | **Adapted (method only).** Its Madgwick IMU implementation (scalar-last API, scalar-first maths, β default 0.2, numba) was read line by line; NeuroMove's filter follows the same reference equations. Gait event detection, stride segmentation and ZUPT trajectory reconstruction assume foot-mounted sensors and gait cycles — **not transferable** to upper-limb discrete movements. The benchmarking design (algorithm + reference + dataset as separate pieces) informed `validation.ts`. AGPL part not used. |
| **scikit-digital-health** (github.com/PfizerRD/scikit-digital-health; Adamowicz et al. 2022, doi:10.2196/36762) | Wearable IMU pipelines: gait, sit-to-stand, activity, sleep | MIT | active (pushed 2026-11-04, 109★) | module list (docs) | **Not used.** Lumbar/wrist free-living pipelines (activity counts, bout detection); no multi-segment upper-limb kinematics. Its preprocessing (calibration, wear detection) duplicates checks NeuroMove already has (`lab/quality.ts`). |
| **pyomeca** (github.com/pyomeca/pyomeca; Martinez et al. 2020, doi:10.21105/joss.02431) | Biomechanics data containers, filtering, rototranslation | Apache-2.0 | maintained (pushed 2026-08-11, 142★) | project description, API overview | **Not used.** Its rotation/filter utilities are equivalent to code NeuroMove already has (`lib/vec3.ts`, zero-phase Butterworth in `lab/signals.ts`); it targets marker/EMG data containers. |
| **tslearn** (github.com/tslearn-team/tslearn; Tavenard et al. 2020, JMLR 21(118)) | Time-series ML: DTW, soft-DTW, barycentres, k-means | BSD-2-Clause | active (v0.10.0, 2026-10-21) | `tslearn/metrics/dtw_variants.py`, `tslearn/metrics/_masks.py` | **Reference for benchmarking.** DTW local cost = squared Euclidean, value = √(accumulated cost); Sakoe–Chiba mask for unequal lengths uses width = \|n−m\| + r around the *unscaled* diagonal. NeuroMove's DTW agrees to 0.0 for unconstrained and equal-length banded cases (benchmark). DTW is used only for alignment-sensitivity checks: landmark registration is the primary alignment (see prior-art-analysis.md). |

## Additional projects identified

| Project | License | What was checked | Decision |
|---|---|---|---|
| **VQF** (github.com/dlaidig/vqf; Laidig & Seel 2023, doi:10.1016/j.inffus.2022.10.014) | MIT (per docs) | docs: 6D/9D, rest + motion bias estimation, offline variant; C++/Python/Matlab, **no JavaScript** | Strongest modern 6D filter. Not ported in this release: NeuroMove's inclination channels already come from the existing, validated gravity tracker, and the only full-orientation channel (humerothoracic) is display-only. **Recommended next step** if relative orientation becomes a representation channel (port the "basic" variant; its rest-bias estimation addresses the drift diagnostic directly). |
| **ahrs** (PyPI `ahrs` 0.4.0) | MIT | `ahrs/filters/madgwick.py` `updateIMU` | **Benchmark reference** for the Madgwick port (max orientation difference 3 × 10⁻⁶ °). |
| **scikit-learn** 1.9.1 | BSD-3 | `GaussianMixture(covariance_type='diag')`, `adjusted_rand_score` | **Benchmark reference** for GMM/BIC and ARI. |
| **SciPy** 1.18.1 | BSD-3 | `scipy.cluster.hierarchy.linkage(method='ward')` | **Benchmark reference** for Ward clustering. |
| **NumPy** 2.5.4 | BSD-3 | `numpy.linalg.svd` | **Benchmark reference** for SVD. |
| **ml-matrix** (mljs, npm 6.15.1) | MIT | `SingularValueDecomposition`, `EigenvalueDecomposition` (JAMA-derived) | **Reused** (the only new runtime dependency). |
| **spm1d** (github.com/0todd0000/spm1d; Pataky 2010, doi:10.1016/j.jbiomech.2010.03.008) | GPL-3.0 | description, method | **Method adapted, code not used** (GPL): non-parametric 1-D SPM (max-statistic permutation inference over the continuum) is the inference used by PSDA. |
| **hmmlearn** | BSD-3 | maintenance (last push 2024-10-31) | Not used: an HMM over strategy labels needs far more repetitions than NeuroMove sessions provide; a first-order Markov model with Dirichlet posteriors is used instead (prior-art-analysis.md §6). |
| **ssm** (lindermanlab, switching linear dynamical systems) | MIT | maintenance (last push 2025-05-09) | Not used for the same data-sufficiency reason; listed as the candidate if dense practice recordings (hundreds of repetitions) accumulate. |
| **ruptures** (Truong, Oudre & Vayatis 2020, doi:10.1016/j.sigpro.2019.107299) | BSD-2 | method review | Not imported: only a single change point in a short velocity segment is needed (least-squares mean shift, `segment.ts`); PELT (Killick et al. 2012) would be the choice for multiple change points. |

## Datasets

| Dataset | Modality / placement | Rate | Participants | Tasks | Access | Compatibility |
|---|---|---|---|---|---|---|
| **U-Limb** (Averta et al. 2021, GigaScience, doi:10.1093/gigascience/giab043) | optical motion capture (Vicon/PhaseSpace), Xsens IMU suit (17 IMUs, 60 Hz in one group), EMG, EEG | 60–500 Hz (kinematics) | 91 healthy, 65 post-stroke (abstract) | 30 ADL tasks (intransitive, transitive, tool use) | Harvard Dataverse, CC BY (per article page) | **Closest public data for upper-limb coordination**, but adult stroke, different sensors (9-axis, fused orientations), ADL reaching rather than the NeuroMove clinical test movements. Usable later for an *independent methodological* check of strategy discovery on real multi-segment kinematics after resampling to NeuroMove's three segments and gravity-referenced inclinations; **not usable to validate NeuroMove measurements** and not mixed with NeuroMove data. Not downloaded in this work (36 GB; no approval sought for a large download). |
| Gait datasets (gaitmap benchmarks, etc.) | foot IMUs | — | — | walking | various | **Not used**: gait cycles cannot validate discrete upper-limb coordination. |

No public dataset with NeuroMove's sensor set (3 × MPU-6050 on sternum, upper arm, forearm; children with CP) was found.
