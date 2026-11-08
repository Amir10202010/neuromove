# Research gaps and NeuroMove's opportunity

## 1. What is established
- Learning has to be inferred from retention and transfer, not from performance during practice (kantak2012, soderstrom2015).
- Individual practice curves are exponential rather than power-law (heathcote2000).
- Adaptation shows multiple time scales (smith2006). Their hidden states are poorly estimated by deterministic least-squares fits (albert2018), and in our simulation (E6) they were identifiable only from dense, error-driven trials.
- Dose-driven dynamical models with retention can describe recovery in robot therapy (casadio2012).
- SPARC is recommended over LDLJ (balasubramanian2015), and is appropriate on rotational (gyroscope) IMU kinematics but not on translational data (melendez2021).
- Leakage-free, subject-wise evaluation is essential (saeb2017).

## 2. Where existing systems fall short

| Gap | Why it matters | What NeuroMove does |
|---|---|---|
| **G1. Clinical sensor dashboards plot a number per visit and compare it with the previous one.** | They ignore repetition noise, day-to-day noise and multiple comparisons, so a change "looks" real. | A repetition-level measurement model (σε and σs). Every change is shown with its SE, and "within variability" is a valid answer. |
| **G2. Learning is reported from performance.** | Immediate gains are not retained learning. | Explicit decomposition with retention and transfer only when the protocol makes them observable. |
| **G3. Mechanistic models are fitted without identifiability analysis.** | A parameter such as a "forgetting rate" can be an artefact of the model form. | Profile-likelihood intervals. Forgetting is tested *against* saturation; a regular schedule is flagged as confounded (E5). |
| **G4. Practice dose is rarely linked to measured kinematics in home-based paediatric programmes.** | Dose–response is the central practical question. | Practice records (minutes and count) attach to sensor sessions, and the dose enters the learning–retention model. |
| **G5. Small studies validate with random splits.** | This inflates performance. | Leave-future-out validation for individual series. Subject-wise splits for representation models. |
| **G6. "Digital twins" are often visual avatars or unvalidated simulations.** | They overclaim. | The twin is a model with stated scope, uncertainty, diagnostics and a hypothetical-only sandbox. |
| **G7. Results drift silently when algorithms change.** | Analyses cannot be reproduced. | Frozen runs with snapshot, configuration and result hashes, component versions and a re-check against the current engine. |

## 3. What the current sensor setup can and cannot support

**Can support:**
- longitudinal individual trajectories of range, speed, duration, smoothness and trunk tilt;
- noise-aware change detection;
- model comparison;
- dose relationships, when practice is logged;
- retention, when designated delays exist;
- design optimisation.

**Cannot support, today:**
- neural inference of any kind;
- heading or position;
- fast/slow learning rates, because they need dense, error-driven trials, which assessment sessions are not;
- population generalisation;
- clinical validity of metrics in children, because no reference-standard study exists yet;
- any foundation model.

## 4. Claims that would need more instrumentation or much more data

| Claim | What would be required |
|---|---|
| "The child's fast and slow learning rates are X and Y" | Saved trial-by-trial practice data with a target and an error signal (child practice mode with live feedback exists but does not store trials); dense sessions; error-clamp-like probes |
| "Joint angle X is accurate within Y° in children with CP" | A reference-standard agreement study, with goniometer or optical capture, in the target population. The validation module exists to collect it. |
| "Shoulder rotation / heading" | A magnetometer or optical reference. That is a hardware change, out of scope. |
| "This practice schedule improves retention" | A controlled study with randomised schedules. Model simulations are only hypotheses. |
| "A general movement representation" | Many participants, tasks, sites and devices, with consent ([foundation-model-roadmap.md](foundation-model-roadmap.md)) |

## 5. The research opportunity

> Can repeated, task-specific IMU observations of one child be used to estimate that child's motor learning dynamics, and to build a personalised computational model that explains how their movement changes over time?

**What the platform can do.** It can now investigate this question for *one person at a time*, with honest uncertainty, and it can *design* the data collection that would make the answer informative. The simulation results set the realistic bounds:

- **Detecting change.** 8 weekly sessions × 3 repetitions detect a change of 2 units/week with probability 0.71–0.81, depending on the candidate set (E2, E8). With 12 sessions this rises to 1.0.
- **Learning curves.** A slow learning curve (τ = 60 d) is identifiable in only 25 % of 8-session series, but in 95 % of 16-session series (E4).
- **Forgetting.** It can be separated from saturation only if the schedule contains breaks and the dose varies (E5).
