# Mathematical specification of the learning-dynamics models

This file describes the code as implemented: `website/src/lab/models.ts`, `fit.ts`, `learning.ts`, `analysis.ts`, `sandbox.ts`, `dualRate.ts`. Engine version `nm-lab 1.0.0`; component versions are in `lab/version.ts`.

## 1. Data

One **series** is one participant × task (movement × side) × metric:
- included sessions k = 1…K at times t_k (days since the first included session), with gaps Δ_k = t_k − t_{k−1};
- per-repetition values y_{k,r}, r = 1…n_k;
- practice dose D_k in the interval ending at session k.

**Dose D_k** depends on the dose mode:

| Mode | D_k | Status |
|---|---|---|
| practice_minutes | reported minutes from practice records | data |
| practice_sessions | number of practice records | data |
| per_visit | 1 per interval | **assumption** |
| time_on_program | Δ_k | **assumption** |

The default "auto" uses practice minutes when the participant has practice records, otherwise per-visit. The two assumption modes are labelled on every screen.

Sessions that fail a quality rule are **kept** with their reasons and excluded from fitting. An analyst exclusion needs a reason, becomes part of the configuration, and carries the excluded interval's dose to the next included session.

## 2. Measurement model (shared by all candidates)

```
y_{k,r} = z_k + η_k + ε_{k,r},   η_k ~ N(0, σ_s²),   ε_{k,r} ~ N(0, σ_ε²)
```

| Term | Meaning |
|---|---|
| z_k | latent task performance at session k (what the candidates model) |
| η_k | session-level deviation: day-to-day variation in donning, calibration and the child's state |
| ε_{k,r} | repetition-level variability: biological variability plus measurement noise |

**Two-stage estimation.**
1. σ_ε² is estimated once per series from the pooled within-session sum of squares, σ̂_ε² = Σ_k SS_k / Σ_k (n_k − 1), and treated as known.
2. Each session mean then observes z_k with variance R_k = σ_s² + σ̂_ε²/n_k.

**Rationale.** σ_ε has Σ(n_k − 1) degrees of freedom, far more than the series has sessions, so fixing it costs little. Its uncertainty is propagated in the bootstrap through a scaled χ² draw. In leave-future-out folds σ_ε is re-estimated from the training sessions only, so no information leaks from the future (tested).

**Assumptions.**
- Repetitions are exchangeable within a session. Within-session trends are examined separately (§7).
- Errors are Gaussian.
- σ_ε is constant over time; this is untested at small K.

## 3. Candidate models for z_k

| id | Equation | Free parameters (k) | Min. sessions |
|---|---|---|---|
| stationary | z_k = μ | μ, σ_s (2) | 3 |
| linear | z_k = μ₀ + β·t_k/7 | μ₀, β [per week], σ_s (3) | 4 |
| exponential | z_k = A + (z₀ − A)·exp(−t_k/τ), τ ∈ [0.5, 3650] d | A, z₀, τ, σ_s (4) | 5 |
| local_level | z_k = z_{k−1} + w_k, w_k ~ N(0, q·Δ_k); z₁ a parameter | z₁, q, σ_s (3) | 4 |
| learning_retention | dz/dt = −λ(z − z₁) + γ·u(t), λ = ln 2 / h, h ∈ [1, 3650] d | z₁, h, γ, σ_s (4) | 5 |

**Learning–retention model.**
- Dose is spread uniformly within each interval. The exact interval solution is
  `z_k = z₁ + e^{−λΔ}(z_{k−1} − z₁) + γ·D_k·(1 − e^{−λΔ})/(λΔ)`.
- It is adapted from the learning/retention structure of casadio2012. z₁, the first included session, is the level the state relaxes to without practice.
- **Interpretation of h:** the half-life of retained gains without practice.

**Local level.** This is a linear-Gaussian state-space model. The Kalman filter gives the likelihood, and a Rauch–Tung–Striebel smoother gives the latent states. z₁ is estimated as a parameter rather than diffuse, so all candidates share the same likelihood over the same K session means (comparable AICc).

## 4. Estimation and uncertainty (`fit.ts`)

**Maximum likelihood.**
- Optimised in unconstrained parameters: log for scales, a bounded-log logistic map for τ and h.
- Nelder–Mead from several model-specific starting points, then restarted from the best point.
- A weak barrier keeps σ_s within [10⁻⁶, 10³] × the data scale.

**Profile likelihood for every interpretable parameter** (raue2009).
- Step outward from the MLE in the free parameter, re-optimising all other parameters at each step.
- The interval ends where 2·(ℓ̂ − ℓ_p) = χ²₁(0.95) = 3.84; crossings are refined by bisection.
- A side that never crosses before the parameter bound is reported as **open**: these data do not determine the parameter on that side.
- A variance parameter whose interval reaches 0 is *not* open; it is bounded above.
- A model is **identifiable** when all its interpretable parameters have closed intervals.

**Wald SE.** Computed in free parameters from a numerical Hessian, for the design module (§9).

**Parametric bootstrap** (stoffer1991), B = 200 by default.
- Simulate session means from the MLE at the observed design, and draw σ_ε² ~ σ̂_ε² χ²_ν/ν.
- Refit, starting from the MLE.
- The replicates give:
  - latent-trajectory bands;
  - prediction intervals that include parameter uncertainty;
  - reference distributions for the residual checks.

**Small-sample correction for prediction intervals.** The ML session variance is biased low by about (K − p)/K, where p is the number of mean-structure parameters.
- Prediction intervals use σ_s²·K/(K − p).
- The plug-in interval uses a Student t quantile with K − p degrees of freedom.
- **Empirical justification (E7).** In the pilot, uncorrected intervals covered 0.77 (plug-in) and 0.85 (bootstrap). With the correction, 100 seeds gave plug-in 0.93 and bootstrap 0.92.

## 5. Trial-level two-state model (`dualRate.ts`) — implemented, not applied to assessments

```
x_f(n+1) = A_f x_f(n) + B_f e(n),  x_s(n+1) = A_s x_s(n) + B_s e(n)
x = x_f + x_s,  e(n) = p(n) − x(n)  (error clamp: e = 0)
y(n) = x(n) + v
0 < A_f < A_s < 1,  0 < B_s < B_f < 1
```

This is smith2006, fitted by maximum likelihood with an ordered parameterisation.

**Decision D4.** It needs a trial-wise error signal and dense observation. Current NeuroMove sessions are assessments without a target, so the model is used only in the identifiability study. In E6, all four rates were identifiable in 83 % of dense datasets (235 trials of a Smith-type paradigm) and in 0 % with 10 sparse observations. It becomes applicable when practice trials with targets are stored; child practice mode already gives live feedback but does not save trials.

## 6. Model comparison and the selection rule (fixed before any data were seen)

**Criteria.**
- **AICc** = −2ℓ + 2k + 2k(k+1)/(K − k − 1), with K = included sessions. σ_ε is shared by all models and not counted. AICc is undefined when K ≤ k + 1.
- **Akaike weights** over the models with defined AICc.
- **Leave-future-out (LFO)** on folds common to all fitted models: for each target session m ≥ max(3, largest minimum), fit on sessions 1…m−1 (refit, σ_ε re-estimated) and predict session m. Reported:
  - expected log predictive density;
  - MAE;
  - 95 % coverage;
  - the MAE of the naive forecast "same as last session" (persistence), which every model is expected to beat.

**Selection rule.**
1. Keep the fitted models within ΔAICc ≤ 2 of the best.
2. Among them, prefer models whose interpretable parameters are all identifiable. The stationary model counts as identifiable.
3. Then choose the fewest parameters, then the lowest AICc.
4. If no model has a defined AICc, choose the simplest fitted model, with the reason "aicc_not_computable".
5. **"No change" (stationary) is always a candidate, and it is required in every Study Designer protocol.**

**Properties measured by simulation** ([model-validation.md](model-validation.md)):
- false "change" rate 0.5 % at 8 sessions (E1);
- power 0.71 for 2 units/week with all five candidates (E2), versus 0.81 with three candidates (E8). More candidates make the rule more conservative.

## 7. Learning decomposition (`learning.ts`)

| Quantity | Definition | Shown when |
|---|---|---|
| Immediate performance | session mean, SE = σ̂_ε/√n, t-interval (df of σ_ε) | always |
| Within-session change | OLS slope over the repetition index, SE from residuals (df n − 2); inverse-variance pooled over sessions | sessions with ≥ 4 repetitions (configurable) |
| Online / offline | last − first repetition; first of the next session − last of the previous; mean ± SE across sessions | ≥ 2 sessions with ≥ 2 repetitions. Labelled noisy (single repetitions, regression to the mean, fatigue). |
| Between-session change | Δ of consecutive or first-to-last session means; SE = √(σ_ε²/n₁ + σ_ε²/n₂ + 2σ_s²); "exceeds variability" if \|Δ\| > 1.96·SE; optional external-MDC comparison | ≥ 2 included sessions |
| Retention | a delay ≥ retentionDelayDays (default 14; protocol-defined) **or** a designated session. Called a **retention test** only if designated and no practice was recorded; otherwise a **delayed observation**. Retention ratio = (after − first)/(before − first) when the gain before exceeds 2 SE. | delays exist |
| Transfer | change in a task the protocol designates as transfer | protocol designates tasks |
| Forgetting vs saturation | ΔAICc(exponential − learning–retention). **supported**: > 2 and learning–retention within ΔAICc ≤ 2 of the best overall. **relative_only**: > 2 only. **confounded_by_schedule**: CV of intervals and of doses both < 0.25 (regular schedule ⇒ the two models are re-parameterisations, E5). | both models fitted |

## 8. Predictions and the counterfactual sandbox (`sandbox.ts`)

**Forecast.** The default forecast uses the next 3 sessions at the median observed interval and median dose, with the shown interval for a new session mean of n = 3 repetitions. It is conditional on the selected model.

**Scenarios.** These are **hypothetical** and use only learning–retention, the only candidate with a dose term. The user sets:
- number of sessions, interval and dose per interval;
- a gain multiplier;
- a half-life override, for sensitivity within the profile interval.

The output is the bootstrap median with a 95 % band of the latent state, plus the plug-in trajectory. If learning–retention is not the selected model, the screen says so and shows its ΔAICc. Scenarios are never recommendations.

## 9. Next-observation design (`nextObservationAdvice`)

**Method.** Expected Fisher information of the mean-structure parameters, in free parameters, at the MLE:

```
I(θ) = Σ_k J_kᵀ J_k / R_k,   J_k = ∂m_k/∂θ
```

For each candidate delay {7, 14, 21, 28, 42, 56, 84} d — with continued practice and, for learning–retention, a no-practice "retention probe" — one row is added to J, and the relative reduction of the focus parameter's asymptotic SE is reported.

The focus parameter depends on the model: weekly slope, τ, or retention half-life.

**Limits.** This is local and asymptotic, and it is conditional on the model. It answers a design question, not a clinical one.

## 10. Rejected or deferred methods

| Method | Decision | Reason |
|---|---|---|
| Fitting dual-rate models to assessment sessions | Rejected for current data | Not identifiable (E6, albert2018); no error signal |
| Power-law learning curves | Not a candidate | Individual curves are exponential; power laws are averaging artefacts (heathcote2000) |
| Bayesian hierarchical models | Deferred | With 1–6 participants priors would dominate; no justified population priors yet; revisit at ≥ 15 participants × ≥ 5 sessions |
| Random train/test splits of sessions | Rejected | Leakage across time in one person's series (roberts2017) |
| Separate estimation of state noise and session noise in the dose model | Not included | It adds a parameter that 5–10 sessions cannot identify; the local-level model covers stochastic drift |
| Normality tests of residuals | Not run | No power with < 20 sessions; bootstrap checks of autocorrelation and maximum residual are run instead |
| Group-level mixed models in the app | Deferred | Too few participants; exports are tidy for lme4 / statsmodels |
