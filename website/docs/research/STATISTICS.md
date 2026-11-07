# Agreement statistics

The implementation is in [`src/research/stats.ts`](../../src/research/stats.ts) and the tests are in [`stats.test.ts`](../../src/research/stats.test.ts). The browser and the server run the same code. Nothing is rounded except on screen.

## Definitions (d = IMU − goniometer, in degrees)

| Metric | Formula | Notes |
|---|---|---|
| Signed error | dᵢ = IMUᵢ − refᵢ | |
| Absolute error | \|dᵢ\| | |
| Bias | mean(d) | 95 % CI: bias ± t₀.₉₇₅,ₙ₋₁ · SD/√n (needs n ≥ 2) |
| SD | sample SD of d (n − 1) | |
| MAE | mean \|d\| | |
| RMSE | √mean(d²) | |
| Median \|d\|, min/max d, max \|d\| | | |
| Counts | valid, invalid, skipped, missing (slots with no final trial) | Superseded attempts are kept and counted separately |

## Bland–Altman

- **Standard method (Bland & Altman 1986).** Limits of agreement (LoA) = bias ± 1.96·SD. Needs n ≥ 3.
  - The approximate 95 % CI of each limit uses SE ≈ √(3s²/n) (Bland & Altman 1999).
  - Proportional bias is checked by regressing d on the pair mean; the slope and its 95 % CI are reported.
  - Assumptions: independent pairs, bias and SD constant across the range, approximately normal differences.
- **Repeated measures (Bland & Altman 2007, true value varies).** This is used automatically when two or more participants each contribute repeats.
  - A one-way ANOVA of d by participant gives σ²w = MSwithin and σ²b = max(0, (MSbetween − MSwithin)/λ), with λ = (N² − Σmᵢ²)/((k−1)N).
  - LoA = mean(d) ± 1.96·√(σ²b + σ²w).
  - The bias CI is computed from subject means (conservative).
- **Single-participant session.** Repetitions are not independent observations of a population. The result describes agreement for that participant only, and the report says so.

## Reliability

- **ICC(A,1)** is the two-way random-effects, absolute-agreement, single-measurement ICC (McGraw & Wong 1996; same as Shrout–Fleiss ICC(2,1)). **ICC(C,1)** is the consistency version (Shrout–Fleiss ICC(3,1)). Both come with F-based 95 % CIs, using the Satterthwaite approximation for the A,1 model.
  - Validation uses the Shrout & Fleiss data, cross-checked against psych::ICC: ICC2 = 0.29 [0.019, 0.76] and ICC3 = 0.71 [0.34, 0.95].
- **SEM (agreement)** = √((MSC − MSE)/n + MSE). **MDC95** = 1.96·√2·SEM.
- **What the UI does with ICC.** It shows ICC only as IMU-vs-goniometer agreement across a session's trials, and labels it descriptive because those trials are not independent.
- **Not implemented yet.** Test–retest, inter-rater and intra-rater ICC across sessions, participants or raters need a study design, which comes from a protocol grouping or a cohort filter. The `icc(matrix)` function supports any n × k design; no screen builds such matrices yet.

## Flags and sufficiency

- **Flags never remove data.** A pair is flagged when:
  - it falls outside the LoA,
  - its robust z-score (MAD) exceeds 3.5 (Iglewicz & Hoaglin),
  - its \|d\| is above the protocol's review threshold, or
  - its capture window SD is above the protocol limit (unstable hold).
- **Sufficiency thresholds** are stated conventions, not guarantees:

  | Analysis | Insufficient | Limited | Adequate |
  |---|---|---|---|
  | Session summary | < 5 | 5–14 | ≥ 15 |
  | Bland–Altman and ICC | < 10 | 10–29 | ≥ 30 |

  The ≥ 30 threshold follows Koo & Li (2016). Reports warn below 30 pairs.
- **Range agreement** groups pairs into 30° bins by goniometer angle. **Drift** is the slope of d over trial order, with a 95 % CI.

Agreement with a goniometer is not proof of clinical accuracy, and NeuroMove is a research tool.
