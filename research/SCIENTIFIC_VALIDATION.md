# Scientific validation of the research-frontier engines

What was tested, how, what passed, what failed, and what none of it shows.

**Everything in this document is simulation.** "Validated" here means: the implementation does what its specification says on synthetic data whose truth is known. It does not mean accurate, reliable or meaningful in children. No real participant's data were used anywhere in this work.

Earlier suites keep their own documents: [model-validation.md](model-validation.md) (learning models, E1–E8, R1) and [mcse-validation.md](mcse-validation.md) (coordination engine, V1–V11).

## 1. Method

- Each algorithm has one or more **benchmark records** (`website/src/lab/benchmark.ts`): purpose, assumptions, ground truth, metric, a criterion fixed **before** the run, the number of cases actually executed, the value obtained, and known failure modes.
- Data are generated at five levels, not by one Gaussian generator: raw joint-angle trajectories passed through body kinematics and the MPU-6050 model to integer sensor frames; session series with day-to-day and repetition noise; repetition sequences of one sitting; populations of participants; strategy labels.
- Every run is deterministic for its seeds. When a failed benchmark led to a change of the engine, the re-run used **new seeds**, so a criterion is never met on the data that suggested the change.
- A failed criterion is a finding. It is reported, kept in the registry, and asserted to still fail (`DOCUMENTED_FAILURES`) so that a change in either direction is noticed. Criteria are not edited after a run; the one criterion added afterwards (M2a2) is labelled post hoc in its own text.

Reproduce (in `website/`; 23 to 40 minutes on the development laptop):

    FRONTIER_FULL=1 FRONTIER_LATEST=1 FRONTIER_OUT=../research/data/frontier-benchmarks.json npx vitest run src/lab/scenario/benchmarks.node.test.ts

## 2. Result of the last full run

Run of 11 November 2026, 06:14–06:54 UTC, Node 24.16, component versions measure 1.0.1, strategy 1.0.1, observatory, twin, scenario, discovery and design 1.0.0. Data: [data/frontier-benchmarks.json](data/frontier-benchmarks.json); the same summary is compiled into the app (`src/lab/scenario/latest.ts`) and shown on the sandbox page.

| | |
|---|---:|
| Benchmark records | 62 |
| with a pass criterion | 54 |
| criterion met | 52 |
| **criterion failed** | **2 (M2a, O2)** |
| descriptive (no criterion: they characterise behaviour under a violated assumption) | 8 |
| simulation runs and test cases executed | 288 521 |

The run was made twice with identical numbers in all 62 records: on 10 November (versions 1.0.0, 23 minutes) and again on 11 November after the two version bumps (40 minutes; the laptop was on battery power when checked shortly afterwards, which slows it). The first is kept in [data/history/](data/history/README.md).

## 3. The two benchmarks that fail

### M2a — features that should not depend on sensor rotation are not exactly invariant

Criterion: the largest change of any calibration-referenced feature after rotating a sensor by up to 20° is at most 0.05 (metric units). Result: **0.196°**, in one repetition of 55 296; the 95th percentile of the angle changes is 0.005°.

Cause: rotating the raw integer frames re-quantises them, which can move a detected movement onset by one 10 ms sample and with it the excursion measured from that onset. The invariance holds in exact arithmetic and to 0.005° in practice, but not to the stated criterion.

Kept as a failure. A second record, M2a2, states what does hold (angles: 95th percentile ≤ 0.01°, largest ≤ 0.25°; durations within one sample) and says in its own criterion that it was written after seeing the data.

### O2 — a lasting change of two day-to-day SDs is found less often than required

Criterion: power of at least 0.8 for a step of two day-to-day standard deviations after session 8 of 20. Result: **0.769**.

Power by step size: 0.26 (1 SD), 0.50 (1.5 SD), 0.77 (2 SD), 0.97 (3 SD); median delay four to six sessions. With 10 sessions and a step after the fourth: 0.35.

Cause: a self-starting detector learns the mean and spread from the same series it monitors, and it absorbs an undetected shift into both. This is the price of an honest false-alarm rate on short series (5.2–5.7 %, O1). The threshold was not loosened to meet the criterion.

Consequence, written into the interface and every result: with fewer than about 12 sessions, "no signal" is not evidence of stability.

## 4. Findings that changed the engine

Each was found by a test or a benchmark, not by inspection. Earlier run files are in [data/history/](data/history/README.md).

| Finding | Evidence | Change |
|---|---|---|
| The elbow angle's propagated uncertainty can be 3 % of its true spread | U1, run 1 (new seed) | trimmed spread, jump share, a validity flag per feature; the elbow is flagged `unstable`, not passed |
| A sensitivity estimated on one movement seed does not generalise | elbow error 4.26° on another seed against a table value of 0.57° | sensitivities are pooled over 12 seeds and confirmed on 12 disjoint ones (M2b) |
| Re-attached sensors were called a change of the movement in 12.5 % | S2, run 1 | strap tilt and posture can cancel in the calibration direction → an allowance in the attribution bound; re-run on new seeds: 0 of 80 |
| A pattern was reported in 12.1 % of trend-free sittings | W1, run 1 | one permutation test per feature, Holm-adjusted; re-run on new seeds: 5.7 % |
| The flexibility index called pure scaling "condition-dependent" in 3 of 8 sessions | development, before any reported run | forearm and elbow channels excluded (their error grows with the square of the speed); reported run on new seeds: 2.5 % |
| A trunk-roll difference was reported that was pitch leaking through an unobservable sensor heading | unit test | trunk heading tolerance rule in the profile comparison |
| Valid forecasts were refused on a skill estimate from 5 forecasts | 5 of 12 linear development series | refusal needs 8 forecasts and a one-sided sign test |
| The profile comparison was anti-conservative with 12 repetitions | scenario 3: outcome called different in 2 of 16 development runs | Welch t quantile instead of 1.96; reported run on other seeds: 3 of 40 |
| The coordination analysis never finished in the built site | end-to-end test of the built site | worker as a site file, main-thread fallback ([SCIENTIFIC_ARCHITECTURE.md](SCIENTIFIC_ARCHITECTURE.md) §7) |
| The report's Markdown export contained participant and session identifiers and dates | review while writing the end-to-end test | pseudonymised export with a unit test and an end-to-end check |
| A literature attribution in a hypothesis was not supported by the source's abstract | re-reading the abstract | the sentence now states what the abstract says |

## 5. Acceptance tests of the mission

| | Requirement | Where it is tested | Result |
|---|---|---|---|
| A | Same outcome, different strategy: the strategy difference is found, the outcome is not called different | `coord/strategyLayer.test.ts` (acceptance test A); benchmarks S1a, S1b; scenario G03 | detected in 40 of 40; outcome called different in 0 of 80 (S1b: an unchanged trunk feature in 5 %); G03 as expected in 37 of 40 [0.80, 0.97] |
| B | No change, sensors re-attached: not reported as a change of the movement | `strategyLayer.test.ts` (acceptance test B); `frontierJobs.test.ts`; S2; G07 | 0 of 80 after the fix (run 1: 12.5 %); G07 40 of 40 |
| C | A real within-person change is detected and its uncertainty reported | `observatory.test.ts`, `summary.test.ts`; E1b, O2, O8; G02 | G02: change signalled in 379 of 400 and the linear model selected in 399; envelope power 0.85; **O2 fails its criterion (0.77 for a two-SD step)** |
| D | One strategy only: no strategies are invented | existing V6a, V6b ([mcse-validation.md](mcse-validation.md)); S1b, S5b, S6a; G01 | V6a 0 of 80 (earlier run); no signature when participants do not differ (0 of 20); strategy-shift false alarms 3.8 % |
| E | Learning and forgetting: retention kept apart from performance | `twinLayer.test.ts`; T5; G15, G16 | retention test recognised in 100 %; half-life interval covers the truth in 92 %; forgetting preferred over saturation in 400 of 400 on a schedule with breaks |
| F | Missing sessions are not interpolated; the evidence weakens | `observatory.test.ts` (acceptance test F); O3 | false alarms 2.9 % with 30 % missing; power falls from 0.79 to 0.41 |
| G | Non-identifiable models are recognised | `twinLayer.test.ts`; T4; existing profile-likelihood tests | regular schedules flagged as confounded in 100 %; open interval reported in 73 %; never a selected non-identifiable model without a warning |
| H | Predictions are calibrated on held-out participants and future sessions | `twinLayer.test.ts` (acceptance test H); T2, T2b, T3 | coverage 0.960 [0.955, 0.964] over 6 300 held-out predictions; individual records 0.90, exponential shape 0.86 |
| I | A report statement can be traced to the raw observations | `discovery/discovery.test.ts` (acceptance test I) | six chains analysis → model → feature → trial → session → raw, each ending at the SHA-256 of the recorded frames; a session without raw frames ends its chain there and says so |
| J | The existing suites still pass | §7 | see §7 |

## 6. All benchmarks

Values as stored; a value of 1 or 0 for a rate means every or no run. "Runs" is the number of cases actually executed.

### Measurement (`lab/measure`)

| Id | Benchmark | Value | Criterion | Result | Runs |
|---|---|---:|---|---|---:|
| M2a | Rotation re-mount: invariant features | 0.1964 | ≤ 0.05 (metric units) | **FAILED** | 55296 |
| M2a2 | Rotation re-mount: invariant features (post hoc criterion) | 0.0047 | angles p95 ≤ 0.01° and max ≤ 0.25°; durations max ≤ 0.01 s (one sample) — POST HOC | met | 55296 |
| M2b | Rotation re-mount: elbow hinge | 0.968 | ratio ≤ 1.25 at every tabulated offset (the stored table still describes the error) | met | 576 |
| M2c | Rotation re-mount: trunk pitch/roll cross-talk | 0.18 | descriptive | descriptive | 8 |
| M3 | Calibration posture not reproduced | 1.387 | all slopes within [0.8, 1.4] and ≤ the stored bound 1.4 | met | 12 |
| M4 | Sensor moved along the bone | 0.401 | ≤ 0.5° | met | 12 |
| U1 | Noise propagation vs independent realisations | 1 | every core feature within [0.7, 1.4] and every "approximate" feature within [0.5, 2] (confirmatory, run 3) | met | 300 |
| U2 | Systematic budget vs re-mounted sensors | 1 | outcome, upper-arm excursion and peak rate within [0.5, 2] (confirmatory, run 3) | met | 120 |
| E1a | Personal envelope: coverage under no change | 0.966 | every design within [0.93, 0.97] | met | 25000 |
| E1b | Personal envelope: power for a shifted session | 0.85 | ≥ 0.8 for a 15-unit shift with 5 baseline sessions | met | 20000 |
| R1 | Test–retest variance components | 0.01 | ≤ 0.15 | met | 300 |

### Strategy (`lab/coord`)

| Id | Benchmark | Value | Criterion | Result | Runs |
|---|---|---:|---|---|---:|
| S1a | Same outcome, different strategy: detection | 1 | ≥ 0.9 | met | 40 |
| S1b | Same outcome, different strategy: the outcome is not called different | 0.05 | ≤ 0.1 | met | 80 |
| S2 | No change, sensors re-attached | 0 | ≤ 0.1 | met | 80 |
| S3a | Flexibility index: no false adaptation under pure scaling | 0.025 | ≤ 0.1 | met | 40 |
| S3b | Flexibility index: power for a real change of organisation | 1 | ≥ 0.8 | met | 40 |
| S4 | Trunk–outcome trade-off: recovery of the pass-through | 0.027 | ≤ 0.25 | met | 80 |
| S5a | Movement signature: identification across re-attached sessions | 0.956 | ≥ 0.6 | met | 20 |
| S5b | Movement signature: no signature when participants do not differ | 0 | ≤ 0.1 | met | 20 |
| S6a | Strategy shift: false alarms under a stable mixture | 0.038 | ≤ 0.1 | met | 400 |
| S6b | Strategy shift: power for a switch | 0.963 | ≥ 0.8 | met | 400 |

### Observatory (`lab/observatory`)

| Id | Benchmark | Value | Criterion | Result | Runs |
|---|---|---:|---|---|---:|
| O1 | Change detection: false alarms under no change | 0.057 | ≤ 0.06 (nominal 0.05) | met | 8000 |
| O2 | Change detection: power and delay for a step | 0.769 | ≥ 0.8 | **FAILED** | 20000 |
| O3 | Change detection: missing sessions | 0.029 | ≤ 0.06 | met | 20000 |
| O4 | Change detection: autocorrelated day-to-day variation | 0.341 | descriptive | descriptive | 4000 |
| O5 | Change detection: heavy-tailed session noise | 0.096 | descriptive | descriptive | 4000 |
| O6 | Bayesian change point: calibration and position | 0.004 | ≤ 0.05 and ≥ 0.7 | met | 4000 |
| O7 | Change detection: five features monitored together | 0.047 | ≤ 0.06 | met | 2000 |
| O8 | Change detection: gradual drift | 0.865 | descriptive | descriptive | 4000 |
| O9 | Change detection: a step caused by measurement conditions | 0.583 | descriptive | descriptive | 4000 |
| W1 | Within-session pattern: none | 0.057 | ≤ 0.1 | met | 400 |
| W2 | Within-session pattern: practice-like | 0.855 | ≥ 0.8 | met | 400 |
| W4 | Within-session pattern: decline-like | 0.858 | ≥ 0.8 | met | 400 |
| W3 | Within-session pattern: rise then decline | 0.978 | ≥ 0.6 | met | 400 |

### Twin (`lab/twin`)

| Id | Benchmark | Value | Criterion | Result | Runs |
|---|---|---:|---|---|---:|
| T1 | Population model: parameter recovery | 0.04 | ≤ 0.15 | met | 200 |
| T2 | Held-out participants, future sessions: calibration | 0.96 | coverage within [0.9, 0.98], calibration slope within [0.85, 1.15], MAE below the individual-only line | met | 6300 |
| T2b | Held-out participants, future sessions: misspecified shape | 0.973 | descriptive | descriptive | 5691 |
| T3 | Prediction engine: coverage of issued intervals | 0.899 | within [0.88, 0.99] and every 4-session series refused | met | 950 |
| T4 | Identifiability is detected, not hidden | 1 | (a) = 1; (b) ≥ 0.6; no selected model with an open interval without a warning | met | 120 |
| T5 | Learning with forgetting: retention kept apart from performance | 0.917 | coverage ≥ 0.8; retention test recognised in 100 % | met | 60 |

### Ground-truth scenarios (`lab/scenario`)

| Id | Benchmark | Value | Criterion | Result | Runs |
|---|---|---:|---|---|---:|
| G01 | Scenario 1: No actual motor change | 0.96 | ≥ 0.8 | met | 400 |
| G02 | Scenario 2: True movement improvement | 1 | ≥ 0.8 | met | 400 |
| G03 | Scenario 3: True coordination change at equal outcome | 0.925 | ≥ 0.8 | met | 40 |
| G04 | Scenario 4: Strategy transition across sessions | 0.975 | ≥ 0.8 | met | 400 |
| G05 | Scenario 5: Trunk contribution increases while the outcome stays | 0.983 | ≥ 0.8 | met | 400 |
| G06 | Scenario 6: Trunk contribution decreases while the outcome stays | 0.983 | ≥ 0.8 | met | 400 |
| G07 | Scenario 7: Sensor re-attachment, no change | 1 | ≥ 0.8 | met | 40 |
| G08 | Scenario 8: Gyroscope drift | 1 | ≥ 0.8 | met | 40 |
| G09 | Scenario 9: Accelerometer and gyroscope noise ×6 | 1 | ≥ 0.8 | met | 40 |
| G10 | Scenario 10: Missing packets | 1 | ≥ 0.8 | met | 40 |
| G11 | Scenario 11: Sensor dropout (trunk sensor absent) | 1 | ≥ 0.8 | met | 40 |
| G12 | Scenario 12: Task-condition change between sessions | 1 | ≥ 0.8 | met | 400 |
| G13 | Scenario 13: Fatigue-like within-session deterioration | 0.828 | ≥ 0.8 | met | 400 |
| G14 | Scenario 14: Practice-related within-session improvement | 0.873 | ≥ 0.8 | met | 400 |
| G15 | Scenario 15: Between-session retention | 1 | ≥ 0.8 | met | 400 |
| G16 | Scenario 16: Forgetting | 1 | ≥ 0.8 | met | 400 |
| G17 | Scenario 17: Measurement variance changes, level does not | — | descriptive | descriptive | 400 |
| G18 | Scenario 18: Different participant baselines | 0.983 | ≥ 0.8 | met | 400 |
| G19 | Scenario 19: Heterogeneous learning trajectories | 0.975 | ≥ 0.8 | met | 40 |
| G20 | Scenario 20: Model misspecification (wandering level) | — | descriptive | descriptive | 400 |

### Statistical safeguards (`lab/discovery`)

| Id | Benchmark | Value | Criterion | Result | Runs |
|---|---|---:|---|---|---:|
| D1 | Holm: family-wise error over ten true nulls | 0.051 | ≤ 0.055 | met | 20000 |
| D2 | Benjamini–Hochberg: false discovery rate with real effects present | 0.038 | ≤ 0.055 | met | 20000 |

## 7. Software verification

Run on the final code, 11 November 2026, on the development laptop (Windows 11, Node 24.16, Chrome through Playwright).

| Check | Command | Result |
|---|---|---|
| Type check | `npx tsc -b` | clean |
| Lint | `npx eslint .` | clean |
| Unit, integration and quick-mode simulation tests | `npx vitest run` | 633 tests in 62 files: 630 passed, 2 skipped, **1 failed by its time limit** (below) |
| Server bundle | `npm run check:api` | `api/index.js` up to date — unchanged by this work |
| Production build | `npm run build` | succeeds; the main bundles keep their size, the new code is in lazy chunks and two worker files |
| End-to-end in Chrome, built site with the production content policy | `npx playwright test` | 49 tests (desktop and Pixel 7): 41 passed, **8 failed — all 8 fail identically on an untouched checkout of `main`** (below) |
| Single-file demo opened from disk | `npm run build:demo`, then `file://…/NeuroMove.html` | builds; the coordination analysis and the strategy atlas complete on the main thread (13 s for the coordination demonstration, on battery). The tracked demo file was restored afterwards and not updated |

**Tests of this work.** 18 new test files; the suite went from 474 executed tests at the start of the session to 631 (157 new), plus two skipped. `e2e/frontier.spec.ts`: three tests on desktop and one on the phone profile, all passing — the seven workspaces, the coordination analysis under the production content policy, and the Kazakh and English interface. The seven new routes pass the no-horizontal-scroll check at 320–1440 px (and at 320 and 390 px in Kazakh and English); the four new routes in the accessibility list have no serious or critical violation.

**Failures that this work did not cause** (each checked against `main` or shown to be independent of the changes):

- `src/verification/fuzz.test.ts` › "2 000 random sequences…" took 5.4 s against Vitest's 5 s default while the laptop was running on battery; it fails the same way when run alone in that state. The file is unchanged since the repository was created. At the start of the session the suite executed 474 tests: 473 passed and one server test timed out under load.
- `e2e/landing.spec.ts` (four tests, one of them also on the phone profile) and the first test of `e2e/demo-flow.spec.ts` (desktop and phone) look for landing-page text and elements that are no longer in the source (`.lp-contrast`, `#lp-families-title`, the caption about the concept photo) or that have changed (the menu items, the dial of the families section). The landing page was changed after the initial commit (`8303741`, `4445045`); the specs were not. The same seven tests fail on `main`.
- `e2e/layout-a11y.spec.ts`, accessibility: colour contrast of two labels on the landing page (`.lp-vs__key`). The same failure on `main`.

None of these was "fixed" by editing a test. The server tests' time limit was raised from 5 s to 20 s for files under `server/` only ([SCIENTIFIC_ARCHITECTURE.md](SCIENTIFIC_ARCHITECTURE.md) §9); no assertion was changed.

## 8. Literature: what was verified

The bibliographic record (DOI, title, year, venue, authors) of every new entry in [references.bib](references.bib) was resolved against the Crossref API on 10 and 11 November 2026; one journal article has no DOI and is marked so, and three legal or regulatory documents are listed with a note on what was checked. This establishes that the sources exist as cited. It does not establish that they were read.

| Source | What was read in this work | Facts used |
|---|---|---|
| `rozaire2024` | abstract (publisher page, 11 Nov 2026) | 76 studies, 1 293 patients; 51 of 76 used reach or reach-and-grasp; 140 different parameters, task duration the most frequent |
| `jackman2020` | abstract (Europe PMC) | 74 trials; about 40 h of practice to improve upper-limb motor ability in unilateral cerebral palsy; 14–25 h for individual goals with goal-directed practice |
| `li2024` | abstract (Europe PMC) | concurrent validity of inertial sensors for upper-limb range of motion **in adults**: 51 articles, 16 pooled; caution for shoulder rotation |
| `fang2023` | abstract (Europe PMC) | 52 studies; differences to optical motion capture of about 4° for humerothoracic angles, 2° at best for elbow flexion with functional calibration, more than 10° for scapulothoracic motion |
| `bagesteiro2023` | abstract (Europe PMC) | reaching in nine children with cerebral palsy, measured with a motion tracker |
| `kz_health_code` | Articles 227 and 228, unofficial Russian text | see [ETHICS_AND_DATA_GOVERNANCE.md](ETHICS_AND_DATA_GOVERNANCE.md) §4 |
| all method papers (`hawkins1987`, `page1954`, `roberts1959`, `gonen2005`, `holm1979`, `benjamini1995`, `schuirmann1987`, `lakens2017`, `laird1982`, `satterthwaite1946`, `bland1999`, `atkinson1975`, `jcgm101`, …) | bibliographic record only | none quoted; each method is implemented from its standard formulation and checked against a closed form or a simulation in the tests |
| `glinkowski2026` | abstract, earlier in this work | a narrative review that distinguishes functional categories of digital twins |
| `collins2024`, `efthimiou2024`, `mokkink2026`, `adansdester2020`, `kok2026`, `teixeira2022`, `ich_e6r3`, `fda_cds2026` | bibliographic record or status only | none quoted beyond the title-level description |

Two of these bear directly on what NeuroMove can claim: the validity evidence for inertial range of motion is from adults (`li2024`), and scapular motion — which contributes to every arm raise — is not well captured by skin-mounted sensors (`fang2023`). NeuroMove does not measure it at all and says so in its registry.

## 9. What this validation does not show

- **Nothing about children.** Synthetic movements are smooth, planar and far more regular than those of a child with cerebral palsy.
- **Nothing about the real sensors.** The noise, bias and offset values are those of the simulator.
- **Nothing about clinical meaning.** No benchmark relates any quantity to function.
- **Independence.** Most benchmarks draw independent normal noise; O4 and O5 show what happens when that is wrong, and real data are likely to be worse.
- **The generator and the analysis share assumptions** (the measurement model, the planar chain). Agreement between them is weaker evidence than agreement with an independent reference.
- **Kazakh interface text** was not reviewed by a native speaker.
