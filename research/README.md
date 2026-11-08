# NeuroMove — Computational Motor Learning Lab

A research programme with three linked initiatives:

1. **Motor Learning Intelligence.** Individual learning dynamics from repeated IMU observations, with performance, within- and between-session change, retention and transfer kept apart.
2. **Computational Motor Twin.** Individual, task-specific statistical-dynamical models with uncertainty, diagnostics, predictions and a hypothetical-only scenario sandbox.
3. **Movement Foundation Model.** A long-term research direction. Today it consists of readiness gates, an evaluation harness and a roadmap. **No such model exists.**

Hardware (ESP32 + 3 × MPU-6050) and firmware were not changed.

## Where things are

| Topic | Document | Code |
|---|---|---|
| Repository audit | [system-audit.md](system-audit.md) | — |
| Literature | [literature-review.md](literature-review.md), [evidence-matrix.md](evidence-matrix.md), [references.bib](references.bib) | — |
| Gaps and questions | [research-gaps.md](research-gaps.md), [research-questions.md](research-questions.md) | — |
| What the sensors measure | [measurement-model.md](measurement-model.md) | `website/src/lab/{signals,quality,events,features}.ts` |
| Models | [mathematical-models.md](mathematical-models.md) | `website/src/lab/{models,fit,learning,analysis,sandbox,dualRate}.ts` |
| Validation results | [model-validation.md](model-validation.md), [data/model-validation.json](data/model-validation.json) | `website/src/lab/*.test.ts`, `experiments.ts` |
| Study design | [experimental-protocols.md](experimental-protocols.md) | `website/src/lab/protocol.ts`, `#/research/designer` |
| Foundation model | [foundation-model-roadmap.md](foundation-model-roadmap.md), [dataset-specification.md](dataset-specification.md), [model-evaluation-plan.md](model-evaluation-plan.md) | `website/src/lab/{readiness,representation}.ts` |
| Architecture and lineage | [../website/docs/architecture/computational-motor-learning.md](../website/docs/architecture/computational-motor-learning.md), [data-lineage.md](../website/docs/architecture/data-lineage.md) | `website/src/lab/runs.ts`, `hash.ts` |
| Final report | [FINAL_REPORT.md](FINAL_REPORT.md) | — |

## Running

```bash
cd website
npm run dev                # app; the lab is under Research → Motor learning lab (#/research/lab)
npm test                   # all unit and integration tests, including fast-mode lab experiments
npm run lab:experiments    # full Monte Carlo validation → research/data/model-validation.json
npx playwright test e2e/motorlab.spec.ts
```

## Rules this lab follows

- Measured, calculated, estimated, predicted and hypothetical values are labelled differently on every screen.
- "No change" is always a candidate model, and "the data cannot answer" is always a possible answer.
- Simulated data are labelled and never enter clinic analyses.
- Results are frozen with hashes; algorithm changes never rewrite them.
- No participant data go to any external service; exports are pseudonymised by default.
- Nothing here is a clinical measurement, diagnosis or treatment recommendation.
