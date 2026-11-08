# Literature review — computational investigation of individual motor learning with wearable IMUs

NeuroMove Computational Motor Learning Lab · 8 November 2026 · keys refer to [`references.bib`](references.bib)

## 1. Method and its limits (read this first)

**What was done.**
1. Candidate sources were drawn from the research team's knowledge of the field, across five domains: motor learning, movement measurement, computational modelling, machine learning for movement, and paediatric rehabilitation and ethics.
2. Every candidate DOI was resolved against the Crossref REST API (`api.crossref.org/works/{doi}`) on 2026-11-08. Title, year, venue and author family names (up to the first six) were compared with the citation.
3. Of 86 candidates, 79 resolved on the first query. Six "not found" results were transient; a bibliographic search confirmed each of them.
4. **One DOI recalled from memory was wrong.** Kantak & Winstein (2012) is `10.1016/j.bbr.2011.11.028`, not `…020`. It is corrected in the bibliography.
5. One candidate was dropped because it could not be verified: a "digital twin in cardiology" review.
6. For two book-chapter or consensus records, Crossref holds no author list: `kitago2013` and `rosenbaum2007`. Their authors in the bibliography are not Crossref-verified.

**What was not done.**
- Full texts were **not re-read** in this session. The findings attributed below are summaries of well-known results. Check them against the full text before quoting them externally.
- No systematic search protocol (PRISMA) was run, and no risk-of-bias assessment was made.
- This is a **targeted narrative review** that supports design decisions. It is not a systematic review.
- 78 sources are cited, more than the 30–50 the mandate asked for. Not all are equally central. [`evidence-matrix.md`](evidence-matrix.md) marks the ones that carry a design decision.

## 2. Motor learning: what is established

### 2.1 Performance is not learning

The most consequential distinction for a measurement platform is this one.

- **Performance** is what is observed during or right after practice.
- **Learning** is a relatively permanent change in the *capability* to perform. It is inferred from **retention** after a delay, and from **transfer** to an untrained variant.

Practice conditions that depress performance during acquisition can improve retention. Examples are reduced feedback frequency (`winstein1990`, `salmoni1984`) and random rather than blocked practice, called contextual interference (`shea1979`). Immediate performance therefore *mis-ranks* conditions for learning (`soderstrom2015`, `kantak2012`).

**Design consequence.** NeuroMove never labels an immediate change as learning. "Retention" is reserved for a delay the protocol designates, with no practice recorded in it. Every other delay is a "delayed observation", and transfer needs a protocol that designates untrained tasks. This is in `src/lab/learning.ts`.

### 2.2 Multiple processes, multiple time scales

**Sensorimotor adaptation.** Behaviour is well described by state-space models in which the error on one trial updates an internal estimate (`thoroughman2000`).

- Two interacting processes, a fast one that learns and forgets quickly and a slow one that learns and retains slowly, explain savings and spontaneous recovery (`smith2006`; `kording2007` gives a normative account).
- Use-dependent and reinforcement components add to error-based learning (`diedrichsen2010`, `huang2011`).
- Consolidation can protect or disrupt memories (`brashers1996`).

**Skill learning differs from adaptation.**
- It shifts the speed–accuracy trade-off rather than cancelling a perturbation (`shmuelof2012`).
- It shows within-session ("online") and between-session ("offline") components (`reis2009`), including rapid offline gains during rest periods (`bonstrup2019`).
- Reviews: `krakauer2019`, `kitago2013`.

**Identifiability is the binding constraint.** Albert & Shadmehr (`albert2018`) show that fast/slow parameters are reliably estimated only from paradigms that probe them. That means dense trial-by-trial data with an error signal, and ideally error-clamp or reversal phases.

Our simulation E6 reproduces this:

| Design | All four rates identifiable |
|---|---|
| Dense paradigm | 83 % of datasets |
| 10 sparse observations of the same process | 0 % |

### 2.3 Learning curves

At the level of the **individual**, practice curves are better described by exponential than by power functions. A power law can arise from averaging exponentials across people (`heathcote2000`).

**Design consequence.** The exponential approach to an asymptote is NeuroMove's parametric learning-curve candidate. It is fitted per person, never on group means.

### 2.4 Variability

Motor variability is not only noise. Its temporal structure relates to learning rate (`wu2014`, `herzfeld2014`), and in pathology the structure of variability carries information (`stergiou2011`).

**Design consequence.** The measurement model separates repetition-level variability (σε) from session-level variability (σs) and keeps both as reported quantities. It does not average them away. Whether σε predicts learning in children is a **research question** (Q4), not a feature.

## 3. Computational neurorehabilitation

**Models with practice dose.** Several groups model recovery and learning as dynamical systems driven by practice:

- Casadio & Sanguineti (`casadio2012`) model learning, retention ("forgetting") and slacking in robot therapy, with individual parameters.
- Hidaka et al. (`hidaka2012`) model the interaction of arm function and use.
- Schweighofer et al. (`schweighofer2018`) dissociate learning from recovery with models.
- Reinkensmeyer et al. (`reinkensmeyer2016`) set out the agenda for computational neurorehabilitation.

Practice dose in therapy is low and variable (`lang2009`), and dose–response relationships are an open question (`lohse2014`). Experience-dependent plasticity principles (`kleim2008`) motivate modelling dose explicitly.

**Design consequence.** NeuroMove's mechanistic candidate is a single-rate *learning–retention* model, after `casadio2012`. Practice dose drives it; the dose comes from practice records or, when there are none, from an explicit assumption.

The validation found a **structural confound**: with a regular schedule and constant dose, the model's "forgetting" is mathematically the curvature of an exponential approach. Simulation E5 measured it:

| Schedule | Data favour learning–retention over saturation |
|---|---|
| Regular | 0 % of datasets |
| With breaks and varied dose | 100 % |

The platform therefore reports retention evidence only when the schedule can carry it.

**Longitudinal statistics.** Lohse et al. (`lohse2020`) contrast mixed-effects and other approaches for motor learning data, and `lme4` (`bates2015`) is the standard mixed-model tool. NeuroMove fits **individual** state-space and regression models. Group-level mixed models are a documented next step (research-questions.md, Q6), with exports ready for R and Python.

## 4. Measuring movement with IMUs

### 4.1 What an IMU can and cannot observe

**What it observes.** An accelerometer measures specific force: gravity plus linear acceleration. A gyroscope measures angular rate.

**Orientation.** Orientation follows from fusion:
- Kok et al. (`kok2017`) give the authoritative tutorial.
- Madgwick's filter (`madgwick2011`) is a common practical choice.
- NeuroMove's existing complementary filter is the same family.

**What it cannot observe.**
- **Heading** is unobservable without a magnetometer: the MPU-6050 has none.
- **Position** from double integration drifts quadratically.
- **Joint angles** depend on sensor-to-segment alignment.

**Evidence on accuracy.** Systematic reviews report good validity and reliability for joint angles in many settings, with errors that depend strongly on method, joint and task (`poitras2019`, `picerno2017`). Upper-body wearable rehabilitation systems are reviewed in `wang2017`, and everyday-life applications in `rast2020`.

**Design consequence.** NeuroMove computes no position and no heading, and every metric states its validity condition ([measurement-model.md](measurement-model.md)). The device's agreement with a goniometer is **measured by the existing validation module, not assumed**.

### 4.2 Kinematic quality metrics

**Smoothness.** Balasubramanian et al. analysed smoothness metrics:
- `balasubramanian2012` proposes SPARC.
- `balasubramanian2015` compares metrics and recommends SPARC and log-dimensionless jerk under conditions.
- Melendez-Calderon et al. (`melendez2021`) show that IMU-based smoothness needs care. Accelerometer-based jerk is contaminated by gravity, and angular-velocity SPARC is preferred.
- Submovement counts track recovery (`rohrer2002`).

**Consensus recommendations** for kinematic assessment of upper-limb quality favour a small set of metrics: movement time, smoothness, peak velocity and trunk displacement (`kwakkel2019`). A systematic review shows great heterogeneity in metrics (`schwarz2019`).

**Compensation.** Trunk recruitment during reaching is the classic compensation (`cirstea2000`), and recovery must be distinguished from compensation (`levin2009`).

**Design consequence.**
- The Analysis Lab computes gyroscope-based SPARC and speed-peak counts.
- Trunk tilt (from gravity only) and trunk/arm ratio are labelled as tilt, not as full trunk kinematics.
- A trunk–arm lag is computed only with sufficient samples and correlation.

### 4.3 Reliability and change

- Agreement between methods: Bland & Altman (`bland1986`).
- Reliability: ICC and the standard error of measurement (`weir2005`, `koo2016`).
- Interpreting change: minimal detectable change (`haley2006`).

**Design consequence.** NeuroMove computes an **internal** noise estimate from repetitions and sessions. It never calls this an MDC. A published or study-measured MDC can be entered in the protocol, and changes are then compared with it as well.

## 5. Statistical and computational modelling methods

**State-space models.**
- Kalman filtering and smoothing: `kalman1960`, `durbin2012`.
- Maximum likelihood, including EM: `shumway1982`.
- Parametric bootstrap for state-space models: `stoffer1991`.

**Identifiability.** Profile likelihood separates structural from practical non-identifiability (`raue2009`). NeuroMove reports every interpretable parameter with a profile interval and flags open ones.

**Model comparison.**
- Small-sample AIC (AICc): `hurvich1989`.
- Multimodel inference and Akaike weights: `burnham2004`.

**Validation of time series.**
- Leave-future-out prediction respects time order (`burkner2020`).
- Random splits leak information in structured data (`roberts2017`).

**Workflow.**
- Simulate-and-recover is the core of trustworthy behavioural modelling (`wilson2019`).
- Visual and predictive checks: `gabry2019`.

**Optimiser.** Nelder–Mead (`lagarias1998`).

**Bayesian hierarchical models were considered and deferred.**
- With one to six real participants and 3–10 sessions each, priors would dominate the posteriors.
- A hierarchical model needs justified population priors that do not exist for this device and population.
- Profile likelihood plus parametric bootstrap gives honest, prior-free uncertainty for individuals.
- The decision is revisited at the gate in [foundation-model-roadmap.md](foundation-model-roadmap.md) §4 (≥ 15 participants with ≥ 5 sessions).

## 6. Machine learning and foundation models for movement

**Human activity recognition** with deep learning is surveyed in `wang2019`.

**Self-supervised representation learning for wearables:**
- multi-task self-supervision: `saeed2019`;
- masked/transformer approaches: `zerveas2021`;
- contrastive universal representations: `yue2022`;
- benchmarking: `haresamudram2022`.

**The strongest wearable foundation-style result.** It used about 700,000 person-days of accelerometry from a large cohort (`yuan2024`), several orders of magnitude beyond any rehabilitation dataset.

**Evaluation.** Record-wise splits overestimate performance; subject-wise evaluation approximates the use case (`saeb2017`). Leakage takes many forms (`kaufman2012`), and small samples give large error bars on cross-validated performance (`varoquaux2018`). Domain shift across people and devices is the norm (`wilson2020`). Sample-size reasoning for prediction models is formalised in `riley2020`.

**Design consequence.**
- No foundation model is claimed.
- NeuroMove builds a subject-wise evaluation harness and statistically derived readiness gates, with a dataset specification that follows FAIR (`wilkinson2016`) and datasheet (`gebru2021`) practice.

## 7. Paediatric rehabilitation and research ethics

**Clinical context.**
- Cerebral palsy definition and classification: `rosenbaum2007`.
- Function classifications: GMFCS (`palisano1997`) and MACS (`eliasson2006`).
- Intervention evidence: `novak2020`, `jackman2022`.
- Dose thresholds for intensive training: `sudati2024`.

**Upper-limb quantitative measurement in hemiplegic CP** is reviewed by Jaspers et al. (`jaspers2009`).

**Motor learning in children** differs from adults, for example in feedback frequency effects (`sullivan2008`). It differs again in children with hemiplegic CP (`burtner2014`, `robert2017`).

**Research with minors.** It requires guardian permission and child assent, with special protections (`diekema2006`). The existing Functional Progression System already enforces ethics approval and guardian permission for study enrolment.

**Design consequence.**
- Pseudonymised exports by default.
- No participant names or dates in exports.
- No language model receives data.
- The readiness gate for any dataset-level model includes 100 % consent coverage.

## 8. Synthesis: what NeuroMove can investigate

**Feasible with the current sensors and software**
- **Individual longitudinal trajectories** of IMU-derived range, speed, duration, smoothness and trunk tilt, with repetition-level noise models and honest uncertainty.
- **Model comparison** between no change, linear change, exponential saturation, a stochastic latent state and dose-driven learning–retention. Each model has identifiability diagnostics.
- **Practice–dose relationships** when practice is logged, and **retention** when schedules contain designated delays.
- **Design of better studies.** Power planning and next-observation design make future data more informative.

**Not feasible without other instruments or more data**
- Neural mechanisms or "brain state": none are observable.
- Heading and position: no magnetometer, and integration drift.
- Fast/slow learning rates: they need dense, error-driven trial data, which current assessments are not.
- Population-level generalisation and any movement foundation model: they need far more participants, independent cohorts and consent coverage.
- Clinical validity of any metric in children: it needs a reference-standard study.
