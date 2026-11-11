# Final execution report — research frontier expansion

Branch `research-frontier`, 10–11 November 2026. This report states what was built, how, what was actually measured, what is not established, and the state of the repository. Detail is in the documents it links to.

**The one sentence to keep:** the engines exist, are tested, and behave as specified on synthetic data; nothing has been learned about children, and two benchmarks fail their criteria.

## Time actually worked

Not ten hours. The session ran from about 21:30 to 23:55 on 10 November and from about 08:05 to 12:30 on 11 November (local time), roughly six and a half to seven hours of wall-clock time including waits for benchmark and test runs, with an eight-hour gap overnight when the session was not running. One model, one session, no subagents, no delegated or parallel agents.

## A. What was implemented

All in `website/src/lab/` unless stated. 52 new source files (about 10 700 lines), 18 new test files (about 2 100 lines), 21 existing files modified; `git diff main` for `website/`: 92 files, +15 780 −40.

**Priority 1 — measurement integrity** (`measure/`) → [MEASUREMENT_AND_OBSERVABILITY.md](MEASUREMENT_AND_OBSERVABILITY.md)
- Observability registry of 58 quantities with status, method, assumptions, error model and limits; 16 are "not observable" and produce no estimate.
- Fifteen repetition features; virtual re-mounting of sensors; mount diagnostics; placement confidence with an attribution bound.
- Sensor uncertainty propagated by Monte Carlo through the real pipeline, random and systematic parts kept apart, with a validity flag per feature.
- Personal measurement envelope with exact small-sample intervals; test–retest variance components, SEM, MDC and ICC as different properties.

**Priority 2 — motor strategy intelligence** (`coord/profile.ts`, `flexibility.ts`, `signature.ts`, `tasks/`) → [MOTOR_STRATEGY_INTELLIGENCE.md](MOTOR_STRATEGY_INTELLIGENCE.md)
- Motor Strategy Profile per recording; comparison with four verdicts and separate equivalence testing; partition of variation into its kinds.
- Motor Flexibility Index and trunk–outcome trade-off (both exploratory, with refusal rules); movement signature; strategy shift.
- Task context, comparability and a research task library that states what the sensors cannot record.

**Priority 3 — motor learning observatory** (`observatory/`) → [MOTOR_LEARNING_OBSERVATORY.md](MOTOR_LEARNING_OBSERVATORY.md)
- Self-starting CUSUM (primary), EWMA, Shewhart and a Bayesian change point, with thresholds calibrated by simulation.
- Within-sitting patterns with a permutation test; estimability of nine learning terms; Task Transfer Matrix; one-call summary for a series.

**Priority 4 — digital twin** (`twin/`) → [MOTOR_RECOVERY_DIGITAL_TWIN.md](MOTOR_RECOVERY_DIGITAL_TWIN.md)
- Six layers with a hash; maturity levels 0–4 (level 4 never met by software evidence).
- Prediction records that combine models by Akaike weight, report their own calibration, and are refused under six fixed rules.
- Population reference (mixed model by EM, participant-wise validation only). No closed loop.

**Priority 5 — simulation and discovery** (`scenario/`, `discovery/`, `design/`, `benchmark.ts`) → [SCIENTIFIC_VALIDATION.md](SCIENTIFIC_VALIDATION.md), [HYPOTHESIS_REGISTRY.md](HYPOTHESIS_REGISTRY.md)
- Twenty ground-truth scenarios at five generation levels with Monte Carlo; a registry of 62 benchmark records with documented failures.
- Ten formal hypotheses (generated document); competing-explanations engine; falsification checks; Holm and Benjamini–Hochberg; confirmatory versus exploratory from the protocol and the dates.
- Evidence graph from question to raw frames; report builder with fifteen sections and typed, evidence-linked statements; sealed local evidence records.
- Measurement planning: repetitions versus sessions, Fisher information of a schedule, model-discrimination design.

**Priority 6 — interface** (`features/motorlab/frontier/`, `#/research/frontier/…`)
- Seven workspaces: measurement & observability, learning observatory, strategy atlas, twin workspace, scientific sandbox, hypotheses, report builder. English, Russian and Kazakh; heavy work in a worker; each view a lazy chunk.

**Found and fixed on the way**
- The existing coordination analysis never finished in the built site: its worker was created from a `blob:` URL, which the site's content security policy blocks. Workers are now site files with a main-thread fallback; the policy was not changed. An end-to-end test covers it.
- The report's Markdown export contained participant and session identifiers and dates; it is now pseudonymised like the other exports.
- Server tests timed out intermittently (in-process PostgreSQL and password hashing near the 5 s default); their limit is 20 s, for `server/` only, with no assertion changed.

**Documents**: the eleven requested ([SCIENTIFIC_ARCHITECTURE.md](SCIENTIFIC_ARCHITECTURE.md) is the entry point), plus [data/history/README.md](data/history/README.md) and 39 new entries in [references.bib](references.bib).

**Not changed**: firmware, hardware, the server, the database schema (no migration), `api/index.js`, raw data, sessions, frozen runs, the existing models and their selection rules.

## B. Methods

Each method is described where it is implemented and in the document of its layer. In brief: GUM Supplement 1 Monte Carlo propagation; Student-t prediction intervals with Satterthwaite degrees of freedom; nested variance components; Welch tests and two one-sided tests for equivalence; permutation tests within sessions; errors-in-variables regression; self-starting recursive residuals with CUSUM, EWMA and Shewhart limits calibrated by simulation; a Bayesian single change point with prior sensitivity; AICc model comparison with a permutation test over the break position; a linear mixed model by EM with BLUP prediction; exact leave-future-out and leave-one-participant-out validation; Akaike-weighted mixtures; Holm and Benjamini–Hochberg adjustment; Fisher information with D- and A-criteria.

Working rules that were kept: criteria fixed before a run; a failed run changes the engine, never the criterion; re-runs on new seeds; every failure recorded ([data/history/](data/history/README.md)); no language model writes any analysis text.

## C. Measured results

All from synthetic data. Full tables: [SCIENTIFIC_VALIDATION.md](SCIENTIFIC_VALIDATION.md).

**Benchmark registry, final run (11 Nov 2026, 06:14–06:54 UTC):** 62 records, 54 with a criterion, **52 met, 2 failed**, 8 descriptive, 288 521 simulation cases. Identical numbers in the run of 10 November.

**Failed, and kept as failures**
- M2a — features that should not depend on sensor rotation moved by up to 0.196° (criterion 0.05) in one repetition of 55 296, through re-quantisation of a movement onset.
- O2 — a lasting step of two day-to-day SDs is signalled in 77 % of 20-session series (criterion 80 %); in 35 % with 10 sessions.

**Selected results**
- Calibration posture off by 1° shifts angles by 1.0–1.4°; sensor rotation leaves them unchanged to 0.005°; a 4 cm shift along the limb changes them by at most 0.4°.
- Sensor uncertainty of a session mean of the outcome: 0.7–0.9°, from the accelerometer zero offset. Sensor noise explains under 1 % of repetition variance.
- Personal envelope coverage 0.94–0.97; power 0.85 for a 15-unit shift with five baseline sessions, 0.55 with three.
- Different organisation at equal outcome found in 40 of 40; re-attached sensors called a change in 0 of 80 (12.5 % before the fix).
- Change detection false alarms 5.2–5.7 %; with autocorrelated day-to-day variation 34 %; a step caused by measurement conditions is signalled in 58 %.
- Held-out participants, future sessions: coverage 0.960 [0.955, 0.964] over 6 300 predictions, error 4.2 against 9.0 for the participant's own line. Exponential-shaped individual series under-cover (0.86).
- Scenarios G01–G20: 18 with a criterion, all at or above 0.8 (lowest: fatigue-like pattern 0.83 [0.79, 0.86]); 2 descriptive.
- Family-wise error over ten true nulls: 5.1 % with Holm against 40 % unadjusted.

**Software checks on the final code (11 Nov 2026)**

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

## D. Limitations

**Of the science**
- Every validation result is from simulation. The generator is smooth, planar and regular; children with cerebral palsy are not. The generator and the analyses share assumptions, so their agreement is weak evidence.
- No sensor constant was measured on hardware. The re-placement margin (2.5°), strap-tilt allowance (5°) and trunk heading tolerance (20°) are provisional.
- No metric has a known measurement error in children; no result relates any quantity to function.
- The change detector has low power on short series and is not robust to autocorrelation or heavy tails.
- The flexibility index, trade-off and signature are new and exploratory; their reproducibility in real data is unknown.
- Literature: bibliographic records were verified for all new entries; abstracts were read for six sources; no full text was read. One attribution that the abstract did not support was found and corrected.

**Of the software**
- Not built: a biomechanics explorer; the population reference in the interface; a quantitative minimum-sensor-configuration analysis (the registry lists what each configuration loses, not by how much uncertainty grows); planning functions inside the Study Designer; entry fields for task constraints and block type; a perceived-effort rating; a link between external assessments and sensor series.
- Demo sessions have no raw frames, so the strategy atlas can be shown only on synthetic recordings there.
- Engine prose (registry entries, explanations, report statements, benchmark and hypothesis texts) is English only. The Kazakh interface text was not reviewed by a native speaker.
- Evidence records are local to one device by design; they are not backed up by sync.
- In the single-file demo opened from disk no worker can start, so analyses run on the main thread and the page does not respond for their duration (13 s for the coordination demonstration on battery). The tracked `demo/NeuroMove.html` is a build from October that predates the lab pages; it was not updated.
- Component versions were bumped twice during the work (measure and strategy to 1.0.1); earlier commits on the branch carry 1.0.0 with different numerics.

**Known failing checks that this work did not cause and did not fix**
- End-to-end: seven landing-page tests (`e2e/landing.spec.ts`, first test of `e2e/demo-flow.spec.ts`) that still expect the landing page as it was before its redesign, and the colour contrast of two landing labels in `e2e/layout-a11y.spec.ts`. All eight fail identically on an untouched checkout of `main`. Updating them is a decision about the landing page, left to the owner.
- `src/verification/fuzz.test.ts` exceeded its 5 s limit (5.4 s) while the laptop ran on battery, also when run alone. The file is unchanged since the repository was created.

## E. The five most valuable next experiments

Detail in [RESEARCH_ROADMAP.md](RESEARCH_ROADMAP.md) and [EXPERIMENTAL_PROTOCOLS.md](EXPERIMENTAL_PROTOCOLS.md).

1. **Re-donning study** with adult volunteers: how much do angles vary when sensors are put on again, and does calibration posture dominate? Replaces two provisional constants that every between-session comparison uses.
2. **Bench test of the sensor budget**: noise, bias and zero offset of the real boards, before and after a six-position calibration, against the propagated uncertainty.
3. **Pilot of long practice sittings with raw frames** in a few children: are 24 repetitions feasible, do distinct organisations occur, how large are within-sitting trends?
4. **Longitudinal series with a blinded functional outcome**, at least 12 sessions per child: does a change in sensor features precede a change in function? Needs ethics approval and consent.
5. **Day-to-day variation of stable children**: its autocorrelation and distribution, to recalibrate or replace the change detector.

## F. Git state

- Branch `research-frontier`, created from `main` at `7bb9a60`. `main` is untouched. **Nothing was pushed**; no remote operation was made.
- Local commits on the branch, oldest first:
  - `f539163` measurement-science layer
  - `3557e6a` strategy profiles, flexibility, trade-off, signature, task framework, learning observatory
  - `dc3af9d` twin layers, prediction records, population reference (also carries the move of two earlier run files into `research/data/history/`)
  - `5702c85` discovery layer, measurement planning, scenarios, benchmark registry; Welch t in the profile comparison
  - `95fd122` workers as site files with a main-thread fallback
  - `d83c871` research-frontier workspaces
  - `4b34eca` time limit of the server tests
  - the commit that contains this report: the documents, the final benchmark data and the run history
- Working tree after that commit: clean, **except one untracked folder, `website/.claude/`** — a local launch configuration that existed before this work. It is not mine and was not committed.
- Temporary things created and removed: a second checkout of `main` (used twice to check which failing tests already fail there); the state folder of the browser tool and the line it added to `.gitignore`; a test build of the single-file demo (the tracked `website/demo/NeuroMove.html` was restored byte for byte).
