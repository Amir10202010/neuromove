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
| Coordination & strategy engine (MCSE) | [mcse-report.md](mcse-report.md), [coordination-feasibility.md](coordination-feasibility.md), [mcse-validation.md](mcse-validation.md), [data/mcse-validation.json](data/mcse-validation.json) | `website/src/lab/coord/`, `#/research/coordination` |
| MCSE guide for developers and testers (RU) | [../website/docs/MCSE_GUIDE.md](../website/docs/MCSE_GUIDE.md) | — |
| MCSE prior art and dependencies | [open-source-landscape.md](open-source-landscape.md), [prior-art-analysis.md](prior-art-analysis.md), [algorithm-benchmarking.md](algorithm-benchmarking.md), [software-dependency-decisions.md](software-dependency-decisions.md) | `research/benchmarks/` |
| Final report of the motor-learning lab (8 Nov 2026) | [FINAL_REPORT.md](FINAL_REPORT.md) | — |

### Research frontier (10–11 Nov 2026)

| Topic | Document | Code |
|---|---|---|
| How the engines fit together; rules fixed in code; what changed | [SCIENTIFIC_ARCHITECTURE.md](SCIENTIFIC_ARCHITECTURE.md) | `website/src/lab/` |
| Observability registry, placement, sensor uncertainty, personal envelope, test–retest | [MEASUREMENT_AND_OBSERVABILITY.md](MEASUREMENT_AND_OBSERVABILITY.md) | `website/src/lab/measure/`, `#/research/frontier/measurement` |
| Strategy profiles, comparison, flexibility, trade-off, signature, task context | [MOTOR_STRATEGY_INTELLIGENCE.md](MOTOR_STRATEGY_INTELLIGENCE.md) | `website/src/lab/coord/{profile,flexibility,signature}.ts`, `lab/tasks/`, `#/research/frontier/strategy` |
| Change detection, within-sitting patterns, estimability, transfer | [MOTOR_LEARNING_OBSERVATORY.md](MOTOR_LEARNING_OBSERVATORY.md) | `website/src/lab/observatory/`, `#/research/frontier/observatory` |
| Twin layers, maturity, prediction records, population reference | [MOTOR_RECOVERY_DIGITAL_TWIN.md](MOTOR_RECOVERY_DIGITAL_TWIN.md) | `website/src/lab/twin/`, `#/research/frontier/twin` |
| Benchmarks, documented failures, acceptance tests, run history | [SCIENTIFIC_VALIDATION.md](SCIENTIFIC_VALIDATION.md), [data/frontier-benchmarks.json](data/frontier-benchmarks.json), [data/history/](data/history/README.md) | `website/src/lab/scenario/`, `lab/benchmark.ts`, `#/research/frontier/sandbox` |
| Formal hypotheses (generated from code) | [HYPOTHESIS_REGISTRY.md](HYPOTHESIS_REGISTRY.md) | `website/src/lab/discovery/hypotheses.ts`, `#/research/frontier/hypotheses` |
| Study designs for real data | [EXPERIMENTAL_PROTOCOLS.md](EXPERIMENTAL_PROTOCOLS.md) | `website/src/lab/design/` |
| What the engines never do; data handling; what must exist outside the software | [ETHICS_AND_DATA_GOVERNANCE.md](ETHICS_AND_DATA_GOVERNANCE.md) | `website/src/lab/discovery/evidenceRecord.ts`, `lab/export.ts` |
| Next experiments and open weaknesses | [RESEARCH_ROADMAP.md](RESEARCH_ROADMAP.md) | — |
| Report of the expansion: what was done, measured, and not done | [FINAL_EXECUTION_REPORT.md](FINAL_EXECUTION_REPORT.md) | — |

## Running

```bash
cd website
npm run dev                # app; the lab is under Research → Motor learning lab (#/research/lab)
npm test                   # all unit and integration tests, including fast-mode lab experiments
npm run lab:experiments    # full Monte Carlo validation → research/data/model-validation.json
npx playwright test e2e/motorlab.spec.ts
npx playwright test e2e/frontier.spec.ts   # research-frontier workspaces in the built site

# full research-frontier benchmark registry (≈ 23 min) → research/data/frontier-benchmarks.json + src/lab/scenario/latest.ts
FRONTIER_FULL=1 FRONTIER_LATEST=1 FRONTIER_OUT=../research/data/frontier-benchmarks.json npx vitest run src/lab/scenario/benchmarks.node.test.ts
```

## Rules this lab follows

- Measured, calculated, estimated, predicted and hypothetical values are labelled differently on every screen.
- "No change" is always a candidate model, and "the data cannot answer" is always a possible answer.
- Simulated data are labelled and never enter clinic analyses.
- Results are frozen with hashes; algorithm changes never rewrite them.
- No participant data go to any external service; exports are pseudonymised by default.
- Nothing here is a clinical measurement, diagnosis or treatment recommendation.
- A benchmark that fails its criterion is reported and kept; the criterion is not edited afterwards.
- Every validation result so far is from synthetic data. Nothing is known yet about children.
