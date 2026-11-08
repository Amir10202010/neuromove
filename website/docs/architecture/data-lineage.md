# Data lineage and reproducibility

## 1. Chain

| Step | Record | Immutable? | Version recorded |
|---|---|---|---|
| Study | rehab `study` (ethics, status) | status changes only | — |
| Protocol version | lab `learning_protocol` | definition frozen after "freeze"; SHA-256 `defHash` | protocolId, version |
| Participant | `patients` (pseudonymous) | edits allowed (existing) | — |
| Session | `sessions` (steps, per-repetition metrics, quality, calibration, device) | yes, per existing rule | `algorithmVersion` (core), `appVersion` |
| Raw | `raw` chunks / `nm_raw_chunks` | write-once (SHA-256 on the server) | firmware in the passport |
| Quality, events, features | computed on demand | — | `nm-lab-quality/events/features` versions |
| Learning series | built from sessions + practice records | frozen into the run snapshot | `nm-lab-dataset` |
| Model fit and results | `SeriesAnalysis` | frozen into the run | `nm-lab-models`, `nm-lab-learning` |
| Run | lab `analysis_run` | insert-only | engine + all component versions, configHash, snapshotHash, resultHash, hashScheme |
| Report and exports | rendered from the run | exports carry the hashes in the manifest | export schema version |

## 2. Guarantees (each tested in `src/lab/pipeline.test.ts`)

- **A run never changes when its sources change.** It keeps its own snapshot of the observations, including repetitions, exclusions, doses and per-session algorithm versions.
- **Integrity.** `verifyRun` checks the snapshot, configuration and result hashes. Any mismatch is reported as tampering, naming what changed.
- **Reproducibility.** `verifyRun` recomputes from the snapshot and configuration with the current engine.
  - **reproduced**: same result hash.
  - **differs**: names the changed series and whether the engine version changed.
  - The stored run is never overwritten. Re-running creates a new run.
- **Version discipline.** Any change that can alter numbers for the same input must bump the component version in `lab/version.ts`. Example: on 8 November the still-period fix bumped quality, events and features to 1.1.0.
- **Hash scheme.** Results are hashed through canonical JSON with numbers rounded to 8 significant digits, excluding version labels (compared separately). The scheme number is stored, so a future scheme cannot make old runs look tampered.

## 3. Reproducing a result outside the app

1. Export the run: JSON plus `observations.csv`.
2. Re-fit with the formulas of `research/mathematical-models.md` in Python or R from `observations.csv`: included rows, session means, pooled within-session variance.
3. Compare with `models.csv`: log-likelihoods, AICc, and parameters with profile intervals.

Expect agreement to optimiser tolerance; profile intervals depend on the optimiser.
