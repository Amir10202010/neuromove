# Scientific architecture

How the research engines of NeuroMove fit together after the research-frontier expansion of 10–11 November 2026, which rules are fixed in code, and what changed in the existing system.

This document describes code that exists in the repository. The engines are research tools. Nothing in them diagnoses, grades severity, selects or changes treatment, clears anyone for activity, or says anything about the nervous system.

## 1. Layers

```
raw frames (3 × MPU-6050, 100 Hz)                               devices/, session/, data/db.ts
   │  calibration, orientation, channels                         core/, lab/coord/channels.ts
   ▼
repetition features (15)                                         lab/measure/repFeatures.ts
   │                         ┌── observability registry          lab/measure/registry.ts
   │   measurement science ──┼── placement, re-attachment        lab/measure/placement.ts, reattachment.ts
   │                         ├── sensor uncertainty budget       lab/measure/uncertainty.ts
   │                         └── personal envelope, test–retest  lab/measure/envelope.ts, retest.ts
   ▼
strategy                    profile, comparison, variation       lab/coord/profile.ts
                            flexibility, trade-off, signature    lab/coord/flexibility.ts, signature.ts
                            task context and comparability       lab/tasks/library.ts
   ▼
session series  →  learning models (existing)                    lab/dataset.ts, models.ts, fit.ts, analysis.ts, learning.ts
   │
   ├── observatory          change detection, within-session,    lab/observatory/
   │                        estimability, transfer, summary
   ├── twin                 layers, maturity, prediction         lab/twin/
   │                        records, population reference
   ├── design               allocation, information, model       lab/design/planning.ts
   │                        discrimination
   └── discovery            multiplicity, explanations,          lab/discovery/
                            hypotheses, evidence graph, report,
                            evidence records
   ▼
verification                20 ground-truth scenarios,           lab/scenario/, lab/benchmark.ts
                            benchmark registry (62 records)
```

The lower layers existed before (sensor pipeline, coordination engine, learning engine, frozen runs). Everything named in the right-hand column under `lab/measure`, `lab/observatory`, `lab/twin`, `lab/design`, `lab/discovery`, `lab/scenario`, `lab/tasks`, plus `coord/profile.ts`, `flexibility.ts`, `signature.ts`, `frontierJobs.ts` and `benchmark.ts`, is new.

## 2. Module map

| Module | Answers | Document | Tests | Benchmarks |
|---|---|---|---|---|
| `lab/measure` | what is observable; how much is sensor error or placement; is a session outside the person's own variation | [MEASUREMENT_AND_OBSERVABILITY.md](MEASUREMENT_AND_OBSERVABILITY.md) | `measure.test.ts`, `measure.node.test.ts` | M2–M4, U1–U2, E1, R1 |
| `lab/tasks` | may two measurements be compared as the same task | [MOTOR_STRATEGY_INTELLIGENCE.md](MOTOR_STRATEGY_INTELLIGENCE.md) §1 | `coord/strategyLayer.test.ts` | G12 |
| `lab/coord/{profile,flexibility,signature}` | how a movement was organised; whether two recordings differ beyond noise and placement | [MOTOR_STRATEGY_INTELLIGENCE.md](MOTOR_STRATEGY_INTELLIGENCE.md) | `strategyLayer.test.ts`, `strategy.node.test.ts` | S1–S6 |
| `lab/observatory` | has the level changed; what happened inside a sitting; what the data can separate | [MOTOR_LEARNING_OBSERVATORY.md](MOTOR_LEARNING_OBSERVATORY.md) | `observatory.test.ts`, `summary.test.ts`, `observatory.node.test.ts` | O1–O9, W1–W4 |
| `lab/twin` | the layered representation of one participant; predictions that may be refused; population reference | [MOTOR_RECOVERY_DIGITAL_TWIN.md](MOTOR_RECOVERY_DIGITAL_TWIN.md) | `twinLayer.test.ts`, `twin.node.test.ts` | T1–T5 |
| `lab/design` | which additional measurement reduces an uncertainty most | [MOTOR_LEARNING_OBSERVATORY.md](MOTOR_LEARNING_OBSERVATORY.md) §8 | `planning.test.ts` | — |
| `lab/discovery` | what else could explain a finding; formal hypotheses; evidence chain; reports | [HYPOTHESIS_REGISTRY.md](HYPOTHESIS_REGISTRY.md), [SCIENTIFIC_VALIDATION.md](SCIENTIFIC_VALIDATION.md) | `discovery.test.ts`, `registry-doc.node.test.ts` | D1–D2 |
| `lab/scenario` | does the engine do what a correct analysis must on data with known truth | [SCIENTIFIC_VALIDATION.md](SCIENTIFIC_VALIDATION.md) | `scenario.test.ts`, `benchmarks.node.test.ts` | G01–G20 |
| `lab/frontierJobs.ts`, `frontier.worker.ts`, `lib/workerJob.ts` | heavy jobs off the main thread | §7 below | `frontierJobs.test.ts`, `workerJob.test.ts` | — |

## 3. Kinds of value

A value keeps the kind it was produced with; software never upgrades it.

| Vocabulary | Values | Where |
|---|---|---|
| measurement status | directly measured · derived · model-estimated · predicted · not observable | `measure/registry.ts` |
| provenance label | real measurement · synthetic simulation · manual entry · external assessment · model estimate · model prediction · hypothetical scenario | `measure/registry.ts` |
| report statement | observation · estimate · model-dependent · hypothesis · method · limitation | `discovery/report.ts` |
| analysis intent | confirmatory (frozen protocol before the first observation) · exploratory | `discovery/multiplicity.ts` |
| twin layer | measurement · kinematic · strategy · learning · predictive · experimental | `twin/layers.ts` |

The report builder throws when asked to emit an observation, estimate or model-dependent statement without an evidence node, so a report contains no unsupported claim by construction. No language model writes any of this text: reports are composed from structured results by fixed templates.

## 4. Decision rules fixed in code

Every threshold that turns a number into a verdict is a named constant, set before the run that tested it:

| Constant | File | Content |
|---|---|---|
| `PLACEMENT_RULE`, `STRAP_TILT_ALLOWANCE_DEG` | `measure/placement.ts` | placement confidence levels; allowance added to the attribution bound (provisional) |
| `ENVELOPE_RULE`, `BASELINE_SESSIONS` | `measure/envelope.ts` | baseline sessions needed; stability test; default baseline length |
| `PROPAGATION_VALIDITY` | `measure/uncertainty.ts` | how far each feature's uncertainty budget can be trusted |
| `TRUNK_HEADING_TOLERANCE_DEG` | `coord/profile.ts` | assumed trunk-sensor heading error (assumption) |
| `FLEXIBILITY_RULE`, `TRADEOFF_RULE`, `SIGNATURE_RULE`, `SHIFT_RULE` | `coord/flexibility.ts`, `signature.ts` | minimum data and decision levels of the exploratory analyses |
| `DETECTION_RULE`, `CALIBRATION` | `observatory/changeDetection.ts` | detector parameters and simulated thresholds |
| `WITHIN_RULE` | `observatory/withinSession.ts` | repetitions needed, permutation count |
| `PREDICTION_RULE` | `twin/prediction.ts` | when a prediction is refused |
| `POPULATION_RULE`, `MATURITY_RULE` | `twin/population.ts`, `layers.ts` | when a population model is fitted; maturity criteria |
| `MEASURE_CRITERIA`, `STRATEGY_CRITERIA`, `OBSERVATORY_CRITERIA`, `TWIN_CRITERIA`, `SCENARIO_CRITERION` | each `validation.ts`, `scenario/benchmarks.ts` | benchmark pass criteria |

The existing rules `STRATEGY_RULE`, `SELECTION_RULE` and `REPLACEMENT_MARGIN_DEG` were not touched. A benchmark that fails its criterion is reported as a finding; the criterion is not edited.

## 5. Data and storage

- **No server change.** No migration was added, the PostgreSQL schema is unchanged, and `api/index.js` is byte-identical (`npm run check:api`).
- **No IndexedDB schema change.** The database stays at version 4.
- **Evidence records** (`discovery/evidenceRecord.ts`) are sealed, insert-only snapshots — a twin snapshot, a research report, a strategy atlas — stored in the existing `lab` object store under kind `evidence_record`, with the list of what they were derived from and a SHA-256 of their content. They are **local to the device and never synced**: each is a deterministic function of records that are synced and immutable (frozen runs, sessions) and of the engine version it names, so a colleague reproduces it instead of trusting a copy. They are written without an outbox operation; the integrity check shared with the server refuses the kind, so one could not be uploaded by mistake; simulated content is refused in the clinic workspace.
- **Exports are pseudonymised.** The report download replaces the participant and session identifiers by run-local pseudonyms (also inside evidence identifiers) and session dates by study days, like every other export of a frozen run.
- Raw measurements, sessions and frozen runs are never modified by any new code.

## 6. Versions and reproducibility

`lab/version.ts` holds two sets:

- `LAB_VERSIONS` — components whose change alters a frozen learning-analysis run (unchanged by this work; frozen runs are not flagged).
- `FRONTIER_VERSIONS` — measure, strategy, observatory, twin, scenario, discovery, design. Kept apart because none of them changes a number of a frozen run. A component is bumped whenever its numbers can change for the same input: `measure 1.0.1` (attribution bound with strap allowance) and `strategy 1.0.1` (Welch t in the profile comparison).

Every stochastic procedure takes a seed; results are deterministic per seed. The benchmark registry is the scientific regression suite: `npm test` runs it in quick mode (every benchmark executes and returns finite values), and

    FRONTIER_FULL=1 FRONTIER_LATEST=1 FRONTIER_OUT=../research/data/frontier-benchmarks.json npx vitest run src/lab/scenario/benchmarks.node.test.ts

runs it in full (23 to 40 minutes on the development laptop), writes all records to `research/data/frontier-benchmarks.json` and the summary the app shows to `src/lab/scenario/latest.ts`. In full mode every criterion must pass except the documented failures, which must still fail — so that a change in either direction is noticed. The sandbox page warns when the stored run was produced by an earlier engine version.

`research/HYPOTHESIS_REGISTRY.md` is generated from the code, and a test fails when the file differs from the registry or when a cited literature key is missing from `references.bib`.

## 7. Execution

Jobs that take seconds (twin layers, strategy atlas, scenarios) run in a Web Worker through `lib/workerJob.ts`.

A defect was found while testing the built site: the coordination analysis, added earlier, created its worker from a `blob:` URL (`?worker&inline`). The site's content security policy allows scripts from its own origin only, so the browser blocked the worker and the page stayed at "analysing…" forever. Workers are now files of the site (`?worker`), which the policy allows without any change to it; where no worker can be started (the single-file demo opened from disk) the same job function runs on the main thread. An end-to-end test covers this in the built site.

## 8. Interface

Seven workspaces under `#/research/frontier/<view>`, linked from the lab overview: measurement, observatory, strategy, twin, sandbox, hypotheses, reports (`features/motorlab/frontier/`). The shell and each view are separate lazily loaded chunks, so the main application bundle is unchanged apart from route names.

Interface strings exist in English, Russian and Kazakh (`frontier/i18n.ts`, 379 strings and 183 engine codes; a missing translation is a build or test error). The Kazakh text was written without native-speaker review. Engine prose — registry entries, explanations, report statements, benchmark and hypothesis texts — is shown in its canonical English wording, and the pages say so.

Every page carries a statement that it is a research tool and not clinical decision support, and the demo workspace is labelled as synthetic.

## 9. Changes to existing code

All additive; default behaviour is unchanged.

| File | Change |
|---|---|
| `simulation/imuModel.ts` | optional sensor position shift and a separate noise seed (same output as before when unused) |
| `lab/coord/synthetic.ts` | optional perturbations: sensor shift, calibration posture, mount and noise seeds |
| `lab/version.ts` | `FRONTIER_VERSIONS` |
| `lab/export.ts` | the identifier scrubber is exported for reuse |
| `lab/coord/mcse.worker.ts`, `coordination/CoordinationPage.tsx`, new `coord/mcseJob.ts` | worker as a site file with main-thread fallback (defect fix, §7) |
| `coordination/charts.tsx` | a marker label near the right edge is written to the left of its line |
| `data/db.ts`, `features/motorlab/store.ts` | the `lab` store type admits local evidence records; `saveEvidence`, `useEvidence` |
| `app/router.ts`, `App.tsx`, `Workspace.tsx`, `layout/AppShell.tsx`, `MotorLabRoute.tsx`, `LabOverviewPage.tsx`, lab dictionaries | the `labFrontier` route and overview tiles |
| `vite.config.ts`, new `server/vitest.setup.ts` | a longer time limit for the server tests only (they start an in-process PostgreSQL and hash passwords; they timed out intermittently on this machine even when run alone); no assertion changed |
| `e2e/layout-a11y.spec.ts` | the new routes added to the overflow and accessibility checks |
| quick-mode replicate counts in the validation suites | reduced so that `npm test` stays light; full-mode runs are unaffected |
