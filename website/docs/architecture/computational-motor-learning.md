# Computational motor-learning lab — architecture

Added on 8 November 2026 on top of the existing platform. Nothing existing was replaced. Hardware and firmware were not touched.

## 1. Layers

```mermaid
flowchart TB
  subgraph existing["Existing (unchanged)"]
    dev["devices/ — imu-csv v1, Serial, BLE, Simulator, Replay"]
    core["core/ — calibration, complementary filter, angles, reps, SPARC, metrics"]
    eng["session/SessionEngine — per-repetition metrics, raw frames"]
    rehab["rehab/ — practice records, consent, studies; rehab/movement.ts metric definitions"]
    store[("IndexedDB v1–v3 + PostgreSQL (sync)")]
  end
  subgraph lab["New: src/lab (pure TypeScript, no React)"]
    sig["signals.ts — physical units, |ω|, inclination (reuses core/orientation)"]
    qc["quality.ts — per-sensor QC"]
    ev["events.ts — velocity events"]
    ft["features.ts — movement features"]
    ds["dataset.ts — learning series (reuses rehab/movement.measureSession)"]
    md["models.ts + fit.ts — 5 candidates, ML, profiles, AICc, LFO, bootstrap"]
    dr["dualRate.ts — trial-level model (identifiability study)"]
    ln["learning.ts — performance vs learning decomposition"]
    an["analysis.ts — one deterministic series analysis"]
    tw["twin.ts — Motor Twin"]
    sb["sandbox.ts — scenarios, next-observation design"]
    pr["protocol.ts — learning protocols, power, plan → config"]
    rn["runs.ts + hash.ts — frozen runs, SHA-256 lineage"]
    ex["export.ts — pseudonymised JSON/CSV"]
    cp["copilot.ts — grounded deterministic assistant"]
    rd["readiness.ts + representation.ts — foundation-model gates and harness"]
  end
  subgraph ui["New: features/motorlab (React, lazy chunk)"]
    pages["Overview · Explorer · Twin · Movement Lab · Study Designer · Reports · Readiness"]
  end
  dev --> eng --> store
  core --> eng
  store --> ds
  rehab --> ds
  core --> sig --> qc & ev --> ft
  ds --> md --> an
  ln --> an --> tw & rn
  md --> sb
  pr --> an
  an --> cp & ex
  pages --> lab
  rn --> labstore[("IndexedDB v4 store 'lab'")]
```

**Rules:**
- **Computation is pure and deterministic.** `src/lab` imports no React; every random draw is seeded; the same code runs in the browser and in Node tests.
- **The computation engine owns every number.** The UI and the assistant only display and select.
- **No new orientation algorithm.** The lab reuses the existing complementary filter, unit conversion and SPARC, and the per-repetition metrics that `core/metrics.ts` stored in each session.
- **Lazy loading.** The UI is a separate build chunk (`MotorLabRoute`, about 117 kB), so the existing workspace chunk does not grow.

## 2. Routes

| Route | Page |
|---|---|
| `#/research/lab` | Research overview: longitudinal coverage, quality, raw availability, runs |
| `#/research/learning?p=&task=&metric=` | Motor Learning Explorer |
| `#/research/twin/:participantId` | Computational Motor Twin |
| `#/research/movement[/:sessionId]` | Movement Analysis Lab (stored raw or imu-csv file) |
| `#/research/designer` | Study Designer (learning protocols) |
| `#/research/runs`, `#/research/runs/:id` | Research reports (frozen runs) |
| `#/research/readiness` | Foundation-model readiness |

## 3. Storage

**IndexedDB schema v4 (additive).**
- It adds one store, `lab` (keyPath `id`; indexes workspace, kind, participantId), for `learning_protocol` versions and `analysis_run` records.
- Earlier stores are untouched; `src/data/storage.test.ts` tests v3 → v4.

**Lab records are local to the browser in this version.** They are not part of team sync: no outbox ops, no server table. Reasons:
- frozen runs are derived data, reproducible from their own snapshot;
- adding a synced entity requires a server migration, validators and the API bundle, which is the next step;
- the UI says "stored on this device".

**Write path.**
1. A pure builder runs (`makeVersion`, `createRun`).
2. `putResearch('lab', …)` writes the record.
3. Only then does the in-memory state change.

A protocol version may change only its status (draft → frozen → archived, `canTransition`); a frozen definition never changes.

## 4. Privacy and AI boundary

- The assistant is deterministic. No language model is called, and nothing is sent anywhere.
- `copilot.evidencePacket()` defines a future integration boundary: de-identified, aggregated facts only. Using it with an external model requires explicit configuration and a privacy review. The existing optional Gemini route for rehab summaries is not used by the lab.
- Exports are pseudonymised by default (participant and session pseudonyms, study days).

## 5. Decisions

| Decision | Choice | Alternative rejected | Why |
|---|---|---|---|
| Where to compute | Browser (pure TS) | Python service | Offline-first app, no server dependency for analysis, same code in tests; exports allow Python/R re-analysis |
| Estimation | ML + profile likelihood + parametric bootstrap | MCMC / hierarchical Bayes | Too few participants for justified priors; deterministic and fast; honest intervals |
| σε | Two-stage pooled estimate | Joint estimation | Many more degrees of freedom; comparable likelihoods across models; propagated in the bootstrap |
| Twin scope | Per task × metric statistical models | Musculoskeletal or "neural" simulation | Not observable with 3 IMUs; would overclaim |
| Persistence of results | Frozen immutable runs with hashes | Recompute on view | Algorithm changes must not rewrite history |
| Hash stability | Results rounded to 8 significant digits, versioned hash scheme | Exact bytes | Last-bit floating-point differences between JS engines |
