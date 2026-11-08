# Evidence matrix

Each row links one source (or a tight group of sources) to what it establishes and to the NeuroMove design decision it supports.

- **Design** gives the study type as generally known: experiment, review, methods paper.
- **D#** is the decision number used in [mathematical-models.md](mathematical-models.md) and [measurement-model.md](measurement-model.md).
- **Bibliography:** every DOI was verified in [references.bib](references.bib) (§1 of the literature review gives the limits).

## A. Learning versus performance; acquisition, retention and transfer

| Source | Design | What it establishes (summary) | Limitation | NeuroMove decision |
|---|---|---|---|---|
| kantak2012, soderstrom2015 | Reviews | Performance during practice is a poor index of learning. Learning is inferred from retention and transfer. | Mostly adult laboratory tasks | **D1.** Separate immediate performance, within- and between-session change, retention and transfer. "Retention" requires a designated delay with no recorded practice. |
| shea1979 | Experiment | Random practice lowers acquisition performance and improves retention and transfer (contextual interference). | Laboratory task; healthy adults | **D2.** The Study Designer records practice structure (constant / blocked / random) as a design variable. |
| winstein1990, salmoni1984 | Experiment; review | Reduced feedback frequency improves retention despite worse acquisition (the guidance hypothesis). | Adults | **D2.** Feedback type and frequency are protocol fields. |
| sullivan2008, burtner2014, robert2017 | Experiments; review in children (TD and hemiplegic CP) | Children differ from adults: reduced feedback harmed children's retention (sullivan2008). Children with hemiplegic CP used feedback like typically developing children, with lower accuracy (burtner2014). No consistent paediatric guidance (robert2017). | Small samples | **D2.** No feedback schedule is assumed optimal. Feedback is a study variable, never a default recommendation. |
| reis2009, bonstrup2019 | Experiments | Skill gains split into online (within-session) and offline (between-session) components. | Specific sequence and skill tasks | **D3.** Online/offline decomposition from first and last repetitions, labelled noisy with 3 repetitions. |
| schmidt1975 | Theory | Schema theory: variability of practice builds generalisable rules. | Theoretical | Transfer tasks are designated in the protocol (D1). |

## B. Computational models of learning

| Source | Design | Establishes | Limitation | Decision |
|---|---|---|---|---|
| thoroughman2000, smith2006 | Experiment + model | A trial-by-trial state-space learning model; two time-scale (fast/slow) processes explain savings and spontaneous recovery. | Needs a perturbation or error signal and dense trials | **D4.** The dual-rate model is implemented, but applied only in the identifiability study, not to assessment data. |
| albert2018 | Methods / simulation | Least-squares fits of deterministic fast/slow models give unrealistic hidden-state estimates; modelling learning and production as stochastic (EM) fits better. | Adaptation paradigms. NeuroMove's dual-rate fit is the least-squares kind: its estimates are conditional on that simplification | **D4.** Confirmed by our E6: 83 % identifiable with dense trials, 0 % with 10 sparse observations. |
| kording2007 | Normative model | Multiple time scales arise from optimal adaptation to a changing body. | Theoretical | Motivates time-scale parameters, not used directly. |
| diedrichsen2010, huang2011 | Experiments | Use-dependent and reinforcement components exist beside error-based learning. | Adults | Limitation stated: IMU assessment data cannot separate these mechanisms. |
| heathcote2000 | Data re-analysis | Individual practice curves are exponential. Power laws arise from averaging. | Cognitive and motor speed tasks | **D5.** An exponential learning curve is a candidate, always fitted per person. |
| casadio2012 | Model + robot-therapy data | Learning, retention and slacking dynamics with individual parameters. | Robot therapy, adults post-stroke | **D6.** Dose-driven learning–retention model (single rate). |
| hidaka2012, schweighofer2018, reinkensmeyer2016 | Models + data; position paper | Function and use interact. Learning can be dissociated from recovery by modelling. The agenda for computational neurorehabilitation. | Adult stroke | D6; research questions Q2–Q3. |
| lohse2014, lang2009, sudati2024 | Meta-analysis; observational; systematic review | Practice dose is low and variable; in adult stroke, more scheduled therapy time predicts more improvement; minimum effective dose of intensive mobility training in CP. | Heterogeneous studies | **D7.** Dose is a first-class variable from practice records; when absent, the assumption is stated. |
| lohse2020, bates2015 | Methods | Mixed-effects versus other longitudinal models for motor learning. | — | Group models are deferred until there are enough participants (Q6). Exports are tidy for lme4. |

## C. Measurement with IMUs and kinematic metrics

| Source | Design | Establishes | Limitation | Decision |
|---|---|---|---|---|
| kok2017 | Tutorial | Orientation is from fusion. Heading needs a magnetometer. Position from integration drifts. | — | **M1.** No position and no heading. Inclination and tilt only. |
| madgwick2011 | Methods | Practical orientation filter. | — | The existing complementary filter is kept (same family), not replaced. |
| poitras2019, picerno2017 | Systematic reviews | IMUs are valid for whole-body range of motion; validity is higher for simple tasks and lower-limb joints; reliability evidence is too limited for conclusions. | Few paediatric studies | **M2.** Accuracy is measured by the existing goniometer module, never assumed. |
| balasubramanian2012, 2015 | Methods | SPARC is valid, sensitive and robust; the 2015 review recommends SPARC over LDLJ. | Adult reaching | **M3.** SPARC on angular speed, with segmentation documented. |
| melendez2021 | Methods | SPARC and LDLJ are inappropriate for translational IMU data but good candidates for rotational (gyroscope) kinematics; the acceleration variant depends on orientation accuracy. | — | **M3.** No accelerometer jerk metric. |
| rohrer2002 | Longitudinal | Smoothness and submovement counts change with recovery. | Robot-measured, adults | **M4.** Speed-peak (submovement) count is a derived feature. |
| kwakkel2019, schwarz2019 | Consensus; systematic review | Standardised kinematic protocols (2D reaching, finger individuation, grip, precision grip, 3D drinking task; metric list not verified, full text inaccessible). Metrics in the literature are very heterogeneous. | Stroke | **M5.** Features are limited to this core set plus range. |
| cirstea2000, levin2009 | Experiment; definitions | Trunk compensation during reaching; recovery versus compensation. | Stroke | **M6.** Trunk tilt (gravity-only), trunk/arm ratio, and lag with sufficiency rules. |
| jaspers2009 | Review, hemiplegic CP | Longer durations, slower speed, less straight trajectories; trunk flexion compensates reduced elbow extension and supination. | Mostly optical motion capture; 17 studies | **M5/M6.** Paediatric support for duration, speed and trunk metrics. |
| stergiou2011, wu2014, herzfeld2014 | Review; experiments | Variability carries information about control and learning. | Adults | **D8.** σε and σs are reported quantities; their predictive value is Q4. |
| bland1986, weir2005, koo2016, haley2006 | Methods | Agreement, ICC/SEM, MDC. | — | **M7.** Internal noise ≠ MDC. An external MDC can be entered per protocol. |

## D. Statistics, identifiability, validation

| Source | Establishes | Decision |
|---|---|---|
| kalman1960, durbin2012, shumway1982 | State-space estimation, smoothing, maximum likelihood | **S1.** Local-level model with a Kalman filter and RTS smoother |
| stoffer1991 | Bootstrap (of innovations) for the precision of state-space ML estimates | **S2.** Prediction intervals include parameter uncertainty (bootstrap) |
| raue2009 | Profile likelihood for structural and practical identifiability | **S3.** Every interpretable parameter has a profile interval; open = "not determined by these data" |
| hurvich1989, burnham2004 | AICc in small samples; Akaike weights | **S4.** Comparison by AICc with a pre-specified parsimony and identifiability rule |
| burkner2020, roberts2017 | Leave-future-out validation; structured cross-validation | **S5.** Only time-respecting validation for a person's series |
| wilson2019, gabry2019 | Simulate–recover; predictive checks | **S6.** Simulation experiments E1–E8; bootstrap residual checks |
| lagarias1998 | Nelder–Mead convergence | Optimiser with restarts and multiple starts |

## E. Machine learning, foundation models, data governance

| Source | Establishes | Decision |
|---|---|---|
| saeb2017, kaufman2012 | Record-wise splits overestimate performance; leakage | **F1.** Subject-wise evaluation harness (representation.ts) |
| varoquaux2018, riley2020 | Small samples give large error bars; sample-size formalism | **F2.** Readiness gate derived from a precision requirement |
| yuan2024, haresamudram2022, saeed2019, zerveas2021, yue2022, wang2019 | SSL for wearables at scale; methods; benchmarks | **F3.** A foundation model is a long-term direction; scale is orders of magnitude beyond NeuroMove |
| wilson2020 | Domain shift across subjects and devices | **F4.** The external-evaluation gate is required |
| wilkinson2016, gebru2021 | FAIR data; datasheets | **F5.** The dataset specification follows them |

## F. Paediatric context and ethics

| Source | Establishes | Decision |
|---|---|---|
| rosenbaum2007, palisano1997, eliasson2006 | CP definition; GMFCS; MACS | Stored as participant characteristics (existing) |
| novak2020, jackman2022 | Intervention evidence and guideline | NeuroMove never recommends interventions; the sandbox is labelled hypothetical |
| diekema2006 | Paediatric research ethics: permission and assent | **E1.** Consent gate; pseudonymised exports; no external AI |
