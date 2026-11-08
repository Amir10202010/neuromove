# Research questions NeuroMove can investigate

Each question lists what it needs and which part of the platform answers it. "Ready" means the software exists; it does **not** mean an answer exists. No real participant data were analysed in this work.

## Individual learning dynamics (Motor Learning Explorer, Motor Twin)

| # | Question | Data required | Platform support | Status |
|---|---|---|---|---|
| Q1 | For a given child and task, does the IMU-derived metric change beyond repetition and day-to-day variability across an assessment series? | ≥ 3 included sessions, ≥ 2 repetitions each | Decomposition: overall change vs SE; model selection with "no change" as a candidate | Ready |
| Q2 | Is that change better described as linear, saturating (exponential), stochastic (random-walk state) or dose-driven with retention? | ≥ 5 sessions; dose varying, or breaks for the retention model | Model comparison (AICc, leave-future-out, identifiability) | Ready; power limits in model-validation.md |
| Q3 | Is there evidence of forgetting during breaks, as opposed to saturation? | Schedule with breaks ≥ the retention delay; practice log | Forgetting-vs-saturation test (E5 shows it works only with variable schedules) | Ready |
| Q4 | Does repetition variability (σε) or its change predict later gains? | Many children (group-level question) | Per-series σε exported | Data collection needed |
| Q5 | Do within-session (online) and between-session (offline) changes differ, and do offline changes depend on the interval? | Sessions with ≥ 4 repetitions (current protocols record 3) | Online/offline decomposition; Study Designer can specify more repetitions | Needs a protocol change, not hardware |
| Q6 | Across children, how do individual learning parameters vary, and with what (age band, GMFCS, MACS, dose)? | ≥ 15 children with ≥ 5 sessions each (to justify a hierarchical model) | Exports for lme4/statsmodels; hierarchical model deferred | Data collection needed |

## Practice and dose (Study Designer, practice records)

| # | Question | Required | Support |
|---|---|---|---|
| Q7 | Does reported home-practice dose between assessments relate to the size of the next change? | Practice log and sensor assessments | Dose attached per interval; learning–retention gain parameter |
| Q8 | Does random versus blocked practice, or reduced feedback frequency, change retention (not acquisition) in children with CP? | Randomised study with designated retention tests | Protocol fields (practice structure, feedback, retention delay); retention-test classification |
| Q9 | Does improvement in a trained task transfer to an untrained task or side? | Protocol designating trained and transfer tasks | Transfer status per series |

## Measurement (Movement Analysis Lab, validation module)

| # | Question | Required | Support |
|---|---|---|---|
| Q10 | How do velocity-defined movement boundaries and features compare with the angle-threshold repetition detector in children's real recordings? | Raw 100 Hz sessions | Processing comparison view |
| Q11 | What is the agreement and test–retest reliability (SEM, MDC) of each metric in the target population? | Goniometer pairs and repeated sessions | Existing validation module; external MDC field in protocols |
| Q12 | How much does signal quality (gaps, saturation, bias drift) affect the derived metrics? | Raw sessions with varying quality | Per-sensor QC (quality.ts) |

## Study design (Study Designer, Motor Twin)

| # | Question | Support |
|---|---|---|
| Q13 | For a planned schedule, what change per week is detectable, and what is the false-change rate? | Simulation-based power (planPower) using noise estimated from the workspace |
| Q14 | Which next observation (delay, with or without practice) most reduces the uncertainty of a learning parameter? | Expected Fisher information (nextObservationAdvice) |

## Representation learning (long term)

| # | Question | Required |
|---|---|---|
| Q15 | Do subject-wise evaluated movement representations generalise across children, sessions and devices? | Readiness gates met ([foundation-model-roadmap.md](foundation-model-roadmap.md)) |
| Q16 | How large is the record-wise versus subject-wise performance gap in real paediatric IMU data? | ≥ 16 participants with raw data. In simulation the gap was negligible (0.866 vs 0.862) because virtual patients are too homogeneous, so the answer must come from real data. |
