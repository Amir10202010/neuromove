# Experimental protocols for motor-learning research with NeuroMove

These are **templates** for the Study Designer (`#/research/designer`), not approved studies. Every study involving children needs:
- ethics approval;
- guardian permission and child assent (enforced by the existing study enrolment, `rehab/study.ts`);
- a frozen protocol version **before** the first session.

## 1. Lifecycle (what the software enforces)

```
Study (rehab Study: ethics, enrolment, consent)
  → Learning protocol version (Study Designer; content-hashed, frozen before data collection)
    → Participant (pseudonymous code)
      → Sensor sessions (stored per-repetition metrics + raw 100 Hz frames; core algorithm version)
        → Quality rules (lab/quality.ts, rehab/movement.ts) — failures kept and flagged
          → Learning series (lab/dataset.ts) + practice dose (practice records)
            → Model fitting under the protocol's analysis plan (lab/analysis.ts)
              → Frozen analysis run (snapshot + config + versions + result hash)
                → Report + pseudonymised exports
```

**What a frozen protocol fixes, and how it is used.**
- It fixes the **candidate models**, **dose mode**, **retention delay**, **transfer tasks**, **external MDC** and **bootstrap size** (`analysisConfigFromProtocol`).
- In the Explorer the researcher chooses it as the "analysis plan". The frozen run then records the protocol id, version and definition hash.
- The rule "no change must remain a candidate model" cannot be disabled.

## 2. Template A — Acquisition and retention of a trained movement (feasible now)

| Field | Value |
|---|---|
| Question | Does the IMU-derived ROM of the trained movement change during an 8-week practice programme, and is the change retained after a 4-week pause? |
| Hypothesis | ROM increases during acquisition and is at least partly retained (H₀: no change, and no retention) |
| Tasks | trained: shoulder flexion, more affected side; transfer: shoulder abduction, more affected side; assessment only: shoulder flexion, less affected side (control for measurement drift) |
| Primary metric | range of motion; secondary: peak velocity, SPARC, trunk tilt |
| Trial structure | 5 repetitions per assessment (not 3: enables within-session slopes, Q5, and halves the repetition SE) |
| Schedule | 12 weekly assessments (E8: power 1.0 vs 0.81 at 8 × 3), a **4-week break without practice**, 1 designated retention test |
| Practice | home programme with a practice log (minutes); feedback and structure as the study arm specifies |
| Calibration | stand-still every session; six-position accelerometer calibration of the modules once per study |
| Measurements | raw 100 Hz frames kept; practice log; goniometer reference at the first and last session (agreement and drift check) |
| Analysis plan | all 5 candidates; dose = practice minutes; retention delay 21 d; external MDC from the reliability study if available; selection rule as in mathematical-models.md §6 |
| Power check | in the Study Designer, with noise estimated from workspace data |

**Why the break matters.** Without a no-practice interval, forgetting cannot be separated from saturation (E5: 0 % vs 100 %).

## 3. Template B — Feedback frequency and retention (controlled study, future)

- Two arms are randomised by participant: 100 % versus faded or reduced feedback (winstein1990 in adults). **In children the expected direction differs:** reduced feedback harmed children's retention (sullivan2008), and children with hemiplegic CP behaved like typically developing children (burtner2014). The hypothesis must be stated without assuming the adult result.
- The primary outcome is **retention-test** ROM error relative to a target, not acquisition performance.
- **Requires** storing practice trials with the target and the feedback given. The live sensor feedback of child mode exists but does not store trials. This is a software change, not hardware; it is a roadmap item.
- Once trials are stored, the trial-level dual-rate model becomes applicable. E6 says ≥ 200 dense trials with error-clamp-like probes are needed.

## 4. Template C — Measurement reliability (prerequisite for any change claim)

- Test–retest: two assessments within 7 days without practice, ≥ 15 participants, for SEM and MDC95 (weir2005, haley2006).
- Agreement against a goniometer through the existing validation module (Bland–Altman, ICC).
- Its MDC is entered as the **external MDC** in later protocols. Between-session changes are then compared with both the internal noise and the MDC.

## 5. Practical rules derived from the simulations

1. Prefer **more sessions** over more repetitions to detect change, but use **≥ 4–5 repetitions** if within-session change matters.
2. Include **at least one designated no-practice delay** longer than the usual interval if retention is a question.
3. **Vary the dose** if dose–response is a question. With constant dose, gain and saturation are confounded.
4. **Log practice** (minutes). Otherwise dose is an assumption and the dose model can only describe, not test.
5. Freeze the protocol **before** the first session; change it only by creating a new version.
