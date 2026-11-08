# Model evaluation plan

## 1. Individual learning-dynamics models (implemented)

| Aspect | Method | Where |
|---|---|---|
| Fit | maximised log-likelihood; standardised residuals | `fit.ts` |
| Predictive performance | exact leave-future-out one-step-ahead: ELPD, MAE, 95 % coverage; persistence baseline | `leaveFutureOut`, comparison table |
| Model comparison | AICc and Akaike weights; pre-specified selection rule | `compareModels`, `selectModel` |
| Parameter uncertainty | profile likelihood; parametric bootstrap | `profileAll`, `bootstrap` |
| Identifiability | open or closed profile intervals; schedule-confound check for retention | `identifiable`, `scheduleVariation` |
| Model adequacy | bootstrap p-values for residual lag-1 autocorrelation and maximum \|r\| | `diagnostics` |
| Sensitivity to missing observations | analyst exclusions recompute everything (configuration-level); LFO shows sensitivity to series length | Explorer |
| Stability across sessions | LFO folds: the parameter path as sessions are added | future: plot parameter trajectories over folds |
| Against simpler baselines | "no change" is always a candidate; persistence forecast reported | comparison table |

**Never used:** random splits of one person's sessions, or a group mean in place of individual curves.

## 2. Prospective evaluation (planned)

For each frozen run with forecasts, the next real session is compared with the stored prediction interval. A coverage table across participants is the first real-data test of the twin's calibration. This needs only time (runs are immutable).

## 3. Representation models (future; harness implemented)

- **Splits:** leave-one-subject-out by default. Leave-one-session-out within a subject only for the explicit "within-person" question. Leave-one-site/device-out for external validation.
- **Leakage checks:** normalisation statistics from training folds only (implemented in `standardise`); no windows of one recording in both train and test; a report of the record-wise vs subject-wise gap (`randomWindowSplit` vs `leaveOneSubjectOut`).
- **Baselines:** hand-crafted features with nearest-centroid or logistic regression. SSL must beat them under subject-wise evaluation.
- **Uncertainty:** per-subject accuracies and their spread, not only the mean (varoquaux2018).
- **Learning curves:** performance against the number of training participants, to estimate the data scale actually needed.

## 4. Reporting

Every evaluation reports:
- data provenance (run or snapshot hashes);
- versions;
- the split scheme;
- per-subject results;
- what was not evaluated.

The Research Reports page prints a structured report per frozen run: measured → processed → models → observed → estimated → predicted → limitations → what cannot be concluded.
