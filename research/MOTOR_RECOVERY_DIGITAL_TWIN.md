# Motor recovery digital twin

A layered computational representation of one participant's measured movement over time — with an honest label of how far it has got.

Code: `website/src/lab/twin/` (with the existing `lab/twin.ts`, `lab/sandbox.ts`) · interface: `#/research/frontier/twin` and the existing `#/research/twin/<participant>` · benchmarks: T1–T5, G18–G19 in [SCIENTIFIC_VALIDATION.md](SCIENTIFIC_VALIDATION.md).

## 1. What "twin" means here, and what it does not

The word is used in many ways (a recent narrative review of digital twins in orthopaedics distinguishes several functional categories: `glinkowski2026`). Here it means: an individual, task-specific statistical description of **observed movement performance** and its change, built only from that person's recorded sessions, with stated uncertainty.

It is not an avatar, not a biomechanical or neural model, and not a model of recovery in the biological sense: the name of this document follows the project's working title, but nothing in the software observes or infers neural recovery. It selects no treatment and changes no programme. There is no closed loop: the twin never acts.

## 2. Six layers

`buildLayers(input)` → `TwinLayers`:

| Layer | Content | Kind of value |
|---|---|---|
| 1 measurement | sessions, dates, raw availability and manifest verification, signal quality, algorithm versions, external assessments entered | observation |
| 2 kinematic | each task and metric with its registry entry and latest session mean | deterministic derivation |
| 3 strategy | movement organisation — available only when raw frames exist and a profile was computed; otherwise "not available" with the reason | estimate |
| 4 learning | per series: baseline envelope and where the latest session lies, selected model and estimated state, change detection, retention status, which learning terms are and are not estimable, warnings | estimate |
| 5 predictive | prediction records, issued or refused | prediction |
| 6 experimental | whether hypothetical schedule scenarios have a fitted basis; scenarios themselves are run in the existing sandbox and always labelled hypothetical | hypothesis |

A value never moves to a "more certain" layer than the one it was computed in. The whole structure is hashed; a snapshot can be sealed as a local evidence record so that a prediction can later be checked against what was observed.

## 3. Maturity

`assessMaturity` evaluates fixed criteria from the data that exist. The software cannot promote itself, and a level counts only if every lower level is met.

| Level | Name | Criterion |
|---:|---|---|
| 0 | reproducible measurement representation | at least one recorded sensor session; analyses deterministic and hashed |
| 1 | individualised descriptive longitudinal model | a series with at least 5 included sessions, a model selected against "no change", and a usable or provisional baseline |
| 2 | predictive model with evaluated uncertainty and calibration | at least 30 out-of-sample forecasts of this participant, with the Wilson interval of the 95 % coverage reaching from at least 0.80 up to 0.95 — on real sessions |
| 3 | research simulation of explicitly defined hypothetical conditions | a dose–response model with identifiable parameters, supported against saturation, with a practice log |
| 4 | clinically validated decision-support system | **never met by software evidence**: needs prospective validation against independently measured functional outcomes, ethics approval, and regulatory assessment — and closed-loop or autonomous treatment selection is outside NeuroMove's scope |

Levels reached on simulated data are marked "synthetic only". On the demo participants the twin reaches level 1; level 2 is not met (too few forecasts, and they are simulated).

## 4. Prediction records

A prediction is a record, not a line on a chart (`twin/prediction.ts`): what is predicted (the mean of a future session of a stated number of repetitions), from which sessions (with their data hash), how far ahead, by which models with which weights, the point value and 95 % interval, how such predictions fared on this person's own past, whether it extrapolates, and what it cannot account for.

**Combination.** Every fitted candidate model gives a predictive distribution by parametric bootstrap (parameter uncertainty, day-to-day and repetition noise). The record carries each and their Akaike-weighted mixture (`burnham2004`): when the data do not separate "no change" from "linear change", the interval spans both instead of following whichever model happened to win.

**Calibration.** Exact leave-future-out: each later session is predicted from the earlier ones. Reported: number of forecasts, share inside their 95 % interval with a Wilson interval, mean absolute error, and the same for "same as last session".

**Refusal** (`PREDICTION_RULE`, fixed before any data). A refused record still lists its reasons and per-model values.

| Reason | Rule |
|---|---|
| `too_few_sessions` | fewer than 5 included sessions |
| `no_model_fitted` | — |
| `horizon_beyond_observed_span` | the forecast lies further ahead than the series is long (a warning from a quarter of the span) |
| `interval_uninformative` | the 95 % interval is wider than twice the range of all observed session means |
| `no_predictive_skill_demonstrated` | at least 8 forecasts and the selected model further off than "same as last session" in significantly more of them (one-sided sign test, p < 0.05) |
| `undercoverage` | at least 8 forecasts and the upper Wilson bound of the coverage below 0.85 |

The skill rule was first applied from 5 forecasts; on truly linear development series the estimated skill was negative in 5 of 12 by chance, which would have discarded valid forecasts. With fewer than 8 forecasts a negative skill is now only noted.

Every record carries its limitations: conditional on unchanged protocol, sensors, placement procedure and circumstances; a statement about a measured metric, not a prognosis and not a treatment recommendation.

## 5. Population reference

`twin/population.ts` keeps what is known about participants in general strictly apart from what is known about one participant.

Model: linear mixed-effects with a random intercept and slope per participant (`laird1982`), maximum likelihood by EM. For a participant with m own observations the conditional (BLUP) distribution gives the prediction; with m = 0 it is the population reference, with growing m it converges to the individual's own line. The two are reported as different kinds: `population_reference` and `individual_given_population`.

Rules: never fitted on a mix of simulated and real participants; refused below 8 participants with at least 3 sessions each; every performance figure is from participant-wise validation — the held-out participant contributes nothing to the model that predicts them, and their later sessions are predicted from their earlier ones. Record-wise splits are not offered, because they leak a participant into their own test set (`saeb2017`).

It is a description of the sample it was fitted on: not a norm and not a reference interval for children. The interface does not expose it yet; it is engine code with tests.

## 6. Hypothetical scenarios

The existing sandbox (`lab/sandbox.ts`, on the twin page) runs "what if the schedule were different" under a fitted dose–response model, labelled hypothetical on every chart. The experimental layer adds the missing honesty check: scenarios have a fitted basis only when the learning–retention model is supported against saturation with identifiable parameters and a practice log exists; otherwise they rest on an assumption and the page says so. Scenarios are model consequences. They are never recommendations and never evidence that a schedule works.

## 7. What simulation showed (all synthetic)

| Question | Result | Benchmark |
|---|---|---|
| Mixed-model parameters recovered | largest relative error 4 % over 200 replicates | T1 |
| New participants, later sessions predicted from their first three | coverage 0.960 [0.955, 0.964] over 6 300 predictions; mean absolute error 4.15 against 8.99 for the participant's own line, 6.98 for "same as last session", 8.50 for the population alone; calibration slope 0.985 | T2 |
| The same when individual trajectories level off but the model assumes straight lines | coverage 0.973 overall (descriptive): the misfit is absorbed into wider intervals, and a linear model extrapolates a saturating child upwards, so late sessions are the ones at risk | T2b |
| Individual prediction records | coverage 0.899 (no change 0.92, linear 0.91, exponential 0.86); every 4-session series refused | T3 |
| Non-identifiable designs | regular schedules flagged as confounded in 100 %; open interval of the time constant reported in 73 %; never a selected non-identifiable model without a warning | T4 |
| Learning with forgetting | half-life interval covers the truth in 92 %; the designated retention test always recognised | T5 |

The exponential case (0.86) is below nominal: short series do not pin down a saturating curve, and the interval is too narrow there. This is why every record reports its own calibration and why undercoverage is a refusal reason.

## 8. Reporting standard

A prediction record reports what reporting guidance for prediction models asks for in general terms: the predicted quantity and horizon, the data used, the models and how they are combined, out-of-sample performance with calibration, comparison with a trivial baseline, and limitations. The relevant guidance is TRIPOD+AI (`collins2024`; see also `efthimiou2024`); only its bibliographic record was checked in this work, and no item-by-item audit was made. The records do not constitute a clinical prediction model: there is no target population, no external validation and no outcome of clinical relevance.

## 9. Limits

- No real participant has enough sessions for any calibration statement.
- Predictions concern a sensor-derived metric under unchanged conditions; a child's growth, health, motivation and programme are not in any model.
- The population model has never seen a real child; synthetic participants are far more homogeneous.
- Nothing here predicts function, participation or recovery.
