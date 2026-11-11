# Motor learning observatory

Has this person's level changed, how sure is that, what else could explain it, what happened inside a sitting, and which parts of "learning" can these data separate at all?

Code: `website/src/lab/observatory/` (with `lab/measure/envelope.ts`, `lab/discovery/explanations.ts`, `lab/design/planning.ts`) · interface: `#/research/frontier/observatory` · benchmarks: O1–O9, W1–W4, G01–G02, G05–G06, G13–G17 in [SCIENTIFIC_VALIDATION.md](SCIENTIFIC_VALIDATION.md).

It builds on the existing learning engine ([mathematical-models.md](mathematical-models.md)): the measurement model, the candidate models (no change, linear, exponential, local level, learning–retention), maximum likelihood, profile likelihood, AICc and leave-future-out validation are unchanged, and "no change" remains a candidate everywhere.

## 1. Five things that are not the same

| Term | What it needs | Where |
|---|---|---|
| performance | what was measured in a session | `lab/dataset.ts` |
| change within a sitting | at least 8 repetitions in order | `observatory/withinSession.ts` |
| change between sessions | several sessions against day-to-day variation | `observatory/changeDetection.ts`, `lab/analysis.ts` |
| retention and forgetting | a designated test after an interval without practice; breaks of different length | `lab/learning.ts`, learning–retention model |
| transfer | a task designated as untrained, measured at least twice | `observatory/transfer.ts` |

A change in a metric during practice is performance. It becomes evidence of learning only with retention after a delay (`kantak2012`, `soderstrom2015`). The observatory keeps these apart and says which of them a dataset cannot address.

## 2. Early change detection

The difficulty is the short series: the person's own mean and variability must be learned from the same few sessions that are monitored. A control chart with limits estimated from three to five baseline sessions has a far higher false-alarm rate than its nominal one (`jensen2006`).

The detectors therefore run on **self-starting recursive residuals** (`hawkins1987`):

    T_k = √((k−1)/k) · (y_k − mean of y_1…y_{k−1}) / SD of y_1…y_{k−1}   ~ t(k−2)
    U_k = Φ⁻¹(F_t(T_k; k−2))                                               ~ N(0, 1), exactly, from the third session

under "no change, independent normal session means". On U_k:

| Detector | Definition | Role |
|---|---|---|
| CUSUM (`page1954`) | C⁺_k = max(0, C⁺_{k−1} + U_k − ½), C⁻ likewise; signal above h | **primary** — the verdict uses only this, fixed in advance |
| EWMA (`roberts1959`) | Z_k = ¼U_k + ¾Z_{k−1}; signal beyond ±L·σ_Z(k) | corroboration |
| Shewhart | \|U_k\| beyond the Šidák-adjusted normal quantile | corroboration |
| Bayesian single change point (`gonen2005`) | two-sample Bayes factor for every split, uniform prior over the split, prior probability ½ of a change | retrospective view, reported at three prior scales |

Thresholds h and L were calibrated by simulation for horizons of 10, 20 and 40 sessions and for per-series error levels down to 0.005 (`CALIBRATION`; script in `research/benchmarks/change-detection-calibration.mjs`). When several series are examined together, the level is divided by their number and the next stricter tabulated threshold is used. A change is "corroborated" when the posterior probability of a change is at least 0.9. Fewer than four sessions give `insufficient_data`.

What a signal means: the series is statistically inconsistent with one stable level. It does not say the change is meaningful, that it is recovery, or what caused it.

### What simulation showed

| Situation | Result | Benchmark |
|---|---|---|
| No change, 10 or 20 sessions | false alarms 5.2–5.7 % for each detector | O1 |
| Step of 1 / 1.5 / 2 / 3 day-to-day SDs after session 8 of 20 | found in 26 % / 50 % / 77 % / 97 %; median delay 6 / 6 / 5 / 4 sessions | O2 — **fails its criterion of 0.8 for 2 SD** |
| Step of 2 SD after session 4 of 10 | found in 35 % | O2 |
| 30 % of sessions missing at random | false alarms 2.9 %; power falls from 0.79 to 0.41 | O3 |
| Sessions missing when performance is poor | false alarms 3.6 %; power 0.42 | O3 |
| Day-to-day variation autocorrelated (ρ = 0.5) | false alarms 34 % | O4 |
| Heavy-tailed session noise, t(3) | false alarms 9.6 % | O5 |
| Bayesian change point | wrong "change" 0.4 %; position within one session in 85 %; strong support when a change exists in only 47 % | O6 |
| Five features monitored together | family-wise false alarms 4.7 % | O7 |
| Gradual drift | found in 87 %, median 11 sessions after its start | O8 |
| A step caused by changed measurement conditions | signalled in 58 % — the detector cannot tell it from a change of the movement | O9 |

Three consequences are written into the interface and the notes of every result:

1. No signal on a short series is not evidence of stability.
2. The detector assumes independent day-to-day variation; slow wander inflates false alarms about sevenfold. A self-starting chart also absorbs an undetected shift into its own mean and spread, so a small step that is missed early is missed for good.
3. A signal says the level moved. Whether measurement conditions moved it is a separate question (§4).

Missing sessions are never interpolated; the residuals are computed on the sessions that exist.

## 3. The personal envelope

The latest session is compared with the range expected from the person's own baseline sessions ([MEASUREMENT_AND_OBSERVABILITY.md](MEASUREMENT_AND_OBSERVABILITY.md) §5). Where no protocol designates a baseline, the first five included sessions are used and the page says so.

## 4. Competing explanations and falsification

For the difference between the latest session and the baseline, `competingExplanations` lists what else could have produced it and says, from the evidence that exists, whether each is excluded, not excluded, sufficient on its own, or not assessable:

measurement noise · sensor error · sensor placement · task conditions · algorithm version · signal quality · amplitude change (for ratios) · trend within the session · familiarisation with the test · a genuine change of the measured movement.

The conclusion is one of `explained_by_measurement`, `measurement_not_excluded`, `measurement_excluded`. A genuine change is only what remains when the measurement explanations have been excluded — and it still names no cause. From stored session summaries the sensor budget and the placement comparison are not available, so the usual honest conclusion is "measurement not excluded".

When the CUSUM signals, `falsifyChange` tries to break the finding: leave one session out, leave one repetition out, a different method, a stricter threshold, the sensor uncertainty, an independent measurement. Checks that cannot be run are listed as untested. A finding that fails any runnable check is marked fragile.

## 5. Within a sitting

Per feature, in repetition order, three nested least-squares models are compared by AICc with the lab's parsimony rule: constant, linear, and a broken stick with one change of slope. Whether a feature departs from a constant level at all is decided by one permutation test per feature (the statistic is the largest AICc improvement over the constant model; permuting the repetition order accounts for searching over the break position), Holm-adjusted across the features of the sitting (`holm1979`).

Directions are expressed on a common axis — larger amplitude, higher peak rate, shorter duration, smoother = "up" — which orders the axis and is not a statement that "up" is better for a given child. The sitting gets a pattern: `practice_like`, `decline_like`, `rise_then_decline`, `mixed`, `no_trend_detected`, or `insufficient_repetitions`.

Rules (`WITHIN_RULE`): 8 repetitions for a trend, 12 for a change of slope. A clinic assessment step of three repetitions is therefore always insufficient; this analysis needs a practice sitting.

**A decline is called fatigue-like, not fatigue.** Tiredness, loss of attention, pain and boredom are not recorded and cannot be told apart from it.

Simulation: a pattern is reported in 5.7 % of trend-free sittings (run 1, when shapes were chosen by AICc alone: 12.1 % — the permutation test was added for that reason); practice-like and decline-like patterns of 2 repetition-SDs over 24 repetitions are recognised in 86 %; a rise and fall of 2.5 SD over 30 repetitions in 98 % (W1–W4). With 8–12 repetitions the power is much lower.

## 6. What can be estimated from this dataset

`assessEstimability` treats

    observed movement = baseline state + practice response + retained learning + task effect + fatigue-like effect + measurement error

as a framework, not a model every dataset identifies. For each of nine terms — measurement error, baseline state, practice response, fatigue-like effect, between-session change, retained learning, forgetting, transfer, task effect — it returns `estimable`, `partly_estimable` or `not_estimable`, what supports it, what is missing, the assumptions, and what would falsify the interpretation.

Nothing is inferred from a design that does not contain it: no retention from a single session, no forgetting from a regular schedule (it is confounded with saturation), no transfer without a designated untrained task, no practice response without a sitting long enough to show one. Fatigue is never more than partly estimable, because perceived fatigue is not recorded.

## 7. Transfer

`transferMatrix` has tasks as nodes and directed edges describing what was observed in task B over the period in which task A changed. An edge is a `transfer_candidate` only when the protocol designates B as untrained and both tasks were measured at least twice; otherwise the edge says why transfer cannot be assessed. No edge is drawn to a task that was not measured. "Candidate" is deliberately weak: a change in an untrained task can also be maturation, familiarisation, or a change of measurement conditions that affects every task alike.

In stored data no task is designated, so the observatory page shows the change of each task and states that two tasks changing together is co-change, never transfer.

## 8. Planning

The page ends with what more data would buy (`lab/design/planning.ts`): the standard error of the level and of the weekly slope and the smallest detectable change between two sessions for 1, 3, 5 and 10 repetitions; whether more repetitions or more sessions help more (the day-to-day part sets a floor repetitions cannot go below); and the sessions needed per phase to detect a chosen difference. These are projections under the variance components estimated from the series — for designing a measurement schedule, not statements about the participant.

## 9. Limits

- All properties above are from simulation with independent normal noise unless a benchmark says otherwise.
- Day-to-day variation in children is unlikely to be independent; O4 shows what that does.
- No independently assessed functional outcome is linked to any series. Whether a detected change corresponds to a change of function is not addressed by anything here.
