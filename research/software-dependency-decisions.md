# Software dependency decisions for MCSE

Constraint: the engine runs inside the offline-first browser app (TypeScript, IndexedDB, lazy "lab" chunk, inline
Web Worker). A Python package cannot be called at runtime without shipping a Python interpreter (Pyodide adds tens of
MB and a network fetch) — rejected for an offline clinical tool. Python packages are therefore used as **benchmark
references**, not runtime dependencies. No external service is called; no participant data leaves the device.

| Need | Decision | Chosen | Why | Alternatives rejected |
|---|---|---|---|---|
| SVD / symmetric eigendecomposition | **REUSE + WRAP** | `ml-matrix` 6.15.1 (mljs, MIT, last release 2026-10) behind `lab/coord/linalg.ts` | well-tested numerical code; the wrapper fixes ordering, sign convention and thin decomposition | own SVD (unjustified), numeric.js (unmaintained), TensorFlow.js (very large, GPU-oriented, not needed) |
| Gravity-referenced inclination | **REUSE** | existing `core/orientation.ts` GravityTracker | already validated against an independent reference | new filter for the same quantity |
| Full 6-axis orientation (one channel) | **ADAPT** | Madgwick IMU update, ported from the reference equations (as in gaitmap MIT part / ahrs) | ~60 lines; agreement 3 × 10⁻⁶ ° with ahrs | VQF (no JS port; recommended next), Kalman filters (no added value without magnetometer) |
| Elbow hinge angle | **REUSE** + new observability guard | existing `core/pipeline.ts elbowFlexion` | validated clinical definition | — |
| Signal QC, still-period detection, zero-phase filter, rep hysteresis | **REUSE** | `lab/quality.ts`, `lab/signals.ts`, `core/reps.ts` | existing, tested | — |
| DTW | **IMPLEMENT** (small) | `align.dtw` | ~40 lines; no maintained, tested JS package found; benchmark-equal to tslearn | npm `dynamic-time-warping`-style packages (untested, unmaintained), tslearn (Python) |
| Landmark registration, fPCA on a grid | **IMPLEMENT** (on reused SVD) | `align.ts`, `components.ts` | straightforward given SVD; the selection rule is NeuroMove-specific | scikit-fda (Python) |
| GMM (diag) + BIC, Ward, ARI, Jaccard | **IMPLEMENT** | `strategy.ts`, `stats.ts` | no maintained JS GMM with BIC; implementations benchmark-equal to scikit-learn / SciPy | ml-kmeans (no mixtures), TensorFlow.js |
| Functional permutation inference | **ADAPT** (method) | `dissociation.ts` | method of Nichols & Holmes 2002 / Pataky 2010; spm1d is GPL-3.0 and Python | spm1d (licence and runtime) |
| HMM / switching LDS | **NOT IMPLEMENTED** | Markov chain with Dirichlet posteriors | data cannot support them (≈ 3 repetitions per movement per session) | hmmlearn, ssm (kept as candidates for dense practice data) |
| Web Worker bundling | **REUSE** Vite `?worker&inline` | inline worker blob | works in the single-file demo build | separate worker chunk (breaks single-file build) |

## Licences of everything touched

| Package | Licence | Role |
|---|---|---|
| ml-matrix 6.15.1 (+ is-any-array, ml-array-rescale) | MIT | runtime |
| NumPy 2.5.4, SciPy 1.18.1, scikit-learn 1.9.1 | BSD-3-Clause | benchmark only |
| tslearn 0.10.0 | BSD-2-Clause | benchmark only |
| ahrs 0.4.0 | MIT | benchmark only |
| gaitmap (MIT part read; `gaitmap_mad` AGPL-3.0 not used) | MIT / AGPL-3.0 | method reference |
| spm1d | GPL-3.0 | method reference only (no code used) |
| VQF | MIT (per documentation; GitHub API reports no licence file metadata) | evaluated, not used |
