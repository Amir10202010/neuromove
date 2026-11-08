# Movement Foundation Model — long-term research roadmap

**Status: NeuroMove has no movement foundation model, no trained representation model, and no dataset that could train one.**

What exists:
- an evaluation harness;
- readiness gates computed from real workspace data (`#/research/readiness`, `src/lab/readiness.ts`);
- a synthetic baseline experiment (R1);
- this plan.

## 1. Scientific opportunity

Self-supervised learning (SSL) for wearable time series is promising:
- multi-task and transformation-prediction pretext tasks (saeed2019);
- masked reconstruction with transformers (zerveas2021);
- contrastive and hierarchical representations (yue2022);
- benchmarks for wearables (haresamudram2022).

At scale it outperforms supervised training: the reference is 700 000 person-days of accelerometry (yuan2024). For NeuroMove the relevant questions are:

1. Can a representation learned from synchronised multi-segment IMU data (trunk, upper arm, forearm) transfer across children, sessions, tasks and devices?
2. Does it capture **movement quality and its change** better than hand-crafted features (range, speed, SPARC, trunk tilt)?
3. Can it be adapted to a new child with few sessions (domain adaptation, wilson2020)?

## 2. Candidate approaches for NeuroMove's modalities

| Approach | Fit for 3 × 6-axis IMU at 100 Hz | Notes |
|---|---|---|
| Masked reconstruction (time and channel masking) | Good | Learns cross-segment structure; no labels |
| Contrastive (subject-invariant augmentations: rotation within the sensor plane, scaling, time warping) | Good, but augmentations must respect physics: gravity direction is information, not nuisance | Risk of learning device or sensor identity |
| Multi-task SSL (transformation recognition) | Good, small models | Strong baseline for small data |
| Supervised multi-task (exercise, side, phase) | Possible now on simulated or real labels | Labels exist automatically from protocol steps |
| Large pretrained time-series models | Uncertain | Domain mismatch with clinical IMU; licensing and data-transfer rules apply |

## 3. Architecture (design only — not implemented)

- **Input:** windows of 2–4 s × (3 modules × 6 channels) at 100 Hz, calibrated units, per-module gravity-referenced orientation features as optional extra channels.
- **Encoder:** a small 1-D convolutional or transformer encoder. Its size is limited by data (§4), not by ambition.
- **Heads:** SSL head, plus downstream probes (exercise, phase, repetition quality metrics as regression targets).
- **Evaluation:** frozen-encoder linear probes and few-shot adaptation, always **subject-wise** (§5).

## 4. Readiness gates (computed in the app from real data)

| Gate | Requirement | Basis |
|---|---|---|
| Evaluation precision | Participants with raw data ≥ ⌈(1.96·SD_between / h)²⌉. Defaults SD 0.10, h 0.05 → **16**. Both are adjustable assumptions shown on screen. | Statistical (varoquaux2018) |
| Repeated observations | median sessions per participant ≥ 2 | Logical: cross-session consistency is otherwise untestable |
| Signal quality | ≥ 90 % of sessions pass | Logical |
| Consent | 100 % of participants with raw data have active consent covering research use | Ethical (diekema2006) |
| Independent evaluation | a held-out site, device or cohort | Logical (saeb2017, wilson2020) |
| Subject-wise baseline on real data | a supervised baseline exists and is evaluated subject-wise | Logical: SSL must beat something |

**Why no other numeric thresholds.** Representation learning has no defensible "minimum N" from the literature for this population. The gates above are a lower bound for **evaluation**, not for training.

**Training scale is open.** It should be established empirically with learning curves: performance against the number of training participants under subject-wise evaluation. The scale of successful wearable SSL (yuan2024) is orders of magnitude beyond what a single clinic will collect, which suggests multi-site collaboration.

**Hierarchical Bayesian learning models** (mathematical-models.md §10) are revisited at ≥ 15 participants × ≥ 5 sessions. This is the same order of magnitude as the evaluation gate.

## 5. Baseline experiment so far (R1, synthetic)

- 8 virtual patients × 2 sessions, 419 windows, 4 exercises, nearest-centroid on 24 hand-crafted features.
- Record-wise accuracy 0.866; leave-one-subject-out 0.862.
- **Lesson:** simulated subjects are too homogeneous to estimate subject-wise generalisation or leakage. The harness is ready; the measurement needs real data.

## 6. Milestones

| Phase | Milestone | Exit criterion |
|---|---|---|
| I | Reliable measurement | Template C reliability and agreement study completed; MDC per metric |
| II | Motor learning intelligence | ≥ 10 children through Template A; individual models frozen and reported; first group analysis in R (exports) |
| III | Computational motor twin | Practice trials stored (software change); dual-rate model applied where E6-type designs are used; prospective prediction checks (did the next session fall inside the interval?) |
| IV | Representation research | All readiness gates met; supervised subject-wise baseline on real data; SSL learning-curve study |
| V | Foundation model | Multi-site data, independent external validation, datasheet published, governance approved |

## 7. Compute and governance

- **Compute:** small encoders train on a single GPU or a laptop CPU at the expected data scale (< 10⁴ windows). Compute is not the bottleneck; data and consent are.
- **Governance:**
  - pseudonymised exports only;
  - no raw paediatric data to third-party services without explicit authorisation and a privacy review;
  - datasheets (gebru2021) and FAIR metadata (wilkinson2016).
  - See [dataset-specification.md](dataset-specification.md).
