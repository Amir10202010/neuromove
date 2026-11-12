# Motor strategy intelligence

How a movement was organised — not only how far it went. The same task outcome can be reached with different contributions of trunk and arm and different timing; an outcome value does not show this. (For context: a systematic review of instrumented upper-limb assessment in cerebral palsy found 140 different parameters across 76 studies, with task duration the most frequent and reach tasks in 51 of them — `rozaire2024`, abstract.) This layer describes the organisation of each recording, compares recordings, and separates the explanations for a difference.

Code: `website/src/lab/coord/{profile,flexibility,signature}.ts`, `website/src/lab/tasks/library.ts`, `website/src/lab/frontierJobs.ts` · interface: `#/research/frontier/strategy` · benchmarks: S1–S6, G03–G07, G12 in [SCIENTIFIC_VALIDATION.md](SCIENTIFIC_VALIDATION.md).

It builds on the existing coordination engine (`lab/coord`, [mcse-report.md](mcse-report.md)): channels, segmentation, registration, components, strategy discovery and dissociation tests are unchanged.

**Everything here is kinematic and exploratory.** No muscle or neural synergy is measured. No quantity is graded: more trunk movement is not called worse and less is not called better — the same trunk contribution can make a task possible or mask limited arm capacity, and inertial sensors cannot tell which.

## 1. Tasks are studied in context

`tasks/library.ts`. A task is a movement plus the constraints under which it was performed: target, direction, distance, speed instruction, object, start position, support, feedback. A dimension that was not recorded is `null` ("not recorded"), never assumed equal.

`comparability(a, b, varied)` allows two measurements to be compared only when exercise, side and setting agree and no constraint differs except those deliberately varied; a dimension unknown in either is reported as unknown. What recorded data carry today: an assessment step (movement × side, self-paced, no target) and a practice sitting (movement × side with a professional-set target angle and live feedback).

The research task library names what the three sensors can record (arm raise forward and sideways, elbow flexion–extension, forearm rotation), what they record only partly (hand to shoulder) and what they cannot (reach forward, reach to grasp, object placement: no hand position, no contact). It never claims equivalence to a standardised assessment.

## 2. Motor Strategy Profile

`buildStrategyProfile(recording, { task, reference, uncertainty })` returns one inspectable record per recording:

- the task context and the number of repetitions used and excluded (with reasons);
- every repetition feature ([MEASUREMENT_AND_OBSERVABILITY.md](MEASUREMENT_AND_OBSERVABILITY.md) §2) as mean, SD, 95 % interval, its registry entry and status, its sensor uncertainty when propagated, and a within-recording trend;
- coordination (trunk contribution, onset lags, time to peak) and trunk involvement (pitch and roll excursion);
- quality: signal confidence, calibration source, raw-stream manifest check, heading drift, filter restarts, share of samples where the elbow angle is unobservable, unavailable channels, flags;
- sensor mount diagnostics and the placement comparison with a reference recording;
- provenance: label, source, component versions and a hash of the feature values.

It is a description, not a score.

## 3. Comparing two recordings

`compareProfiles(a, b)` gives, per feature, the difference with its standard error, a 90 % interval, the combined sensor uncertainty, the placement bound and one of four verdicts:

| Verdict | Rule |
|---|---|
| `beyond_noise` | \|Δ\| exceeds t(0.975; Welch df) × √(SE² + u²) **and**, for an angle compared across recordings, the placement attribution bound |
| `within_placement` | exceeds repetition and sensor noise, but a different sensor placement or calibration posture could produce it — or no placement comparison exists |
| `within_noise` | not distinguishable from repetition variability and sensor error |
| `not_assessable` | fewer than two repetitions on a side |

Two additional rules:

- **Trunk pitch and roll.** A rotation of the trunk sensor about the vertical leaks pitch into roll and cannot be observed. A roll (or pitch) difference no larger than sin 20° times the other's excursion is therefore `within_placement`, even inside one recording. The 20° is an assumption about how accurately a strap is placed by eye.
- **Equivalence is tested separately.** `equivalent(d, margin)` is two one-sided tests (`schuirmann1987`, `lakens2017`): equivalent only if the whole 90 % interval lies within ±margin. "Not significantly different" is never reported as "the same". With 12 repetitions per recording an outcome difference of zero is shown to be equivalent within ±5° in only 35 % of simulated comparisons (S1a) — usually the honest answer is "neither different nor shown equal".

The multiplier was the normal 1.96 until scenario 3 was built; with a dozen repetitions that is anti-conservative, and it is now the Welch t quantile (strategy 1.0.1).

## 4. Kinds of variation

"The movement varied" is not one finding. `partitionVariation` separates, for one feature across a participant's recordings of the same movement:

| Component | How it is obtained |
|---|---|
| within a recording, repetition to repetition | residual SD after removing a linear trend per recording |
| within a recording, trend | SD explained by the trend (practice, fatigue, attention — indistinguishable here) |
| between recordings | SD of recording means in excess of what repetitions contribute |
| expected between recordings | from repetition variance and the systematic sensor uncertainty |

and returns verdicts: `insufficient_sessions` (fewer than three), `within_repetition_and_sensor_error` (χ² test of the excess, p ≥ 0.05), `task_conditions_differ`, `placement_not_excluded` (the largest deviation is inside the placement bound, or no bound exists), and `exceeds_measurement_explanations` only when one task condition, a placement bound, and a deviation beyond it are all present.

## 5. Motor Flexibility Index (exploratory)

Does the organisation of the movement change when the task condition changes, relative to how consistently it is organised within a condition?

    s²   pooled within-condition variance per curve sample
    D²   mean squared difference between two condition mean curves
    δ²   = max(0, D² − s²(1/nₐ + 1/n_b))
    MFI  = δ / s

computed on **share curves** (each repetition's curves divided by its own task outcome), so that reaching further with the same organisation is not "flexibility". Inference: permutation of condition labels within sessions, bootstrap interval, split-half reproducibility of the difference pattern.

Rules (`FLEXIBILITY_RULE`): at least 8 repetitions per condition; repetitions with an outcome below 20° are excluded; `condition_dependent_organisation` needs p < 0.05 and an interval above zero; conditions that never share a session are `confounded_by_session`, because they cannot be told apart from sensor re-attachment.

Only trunk pitch, trunk roll and upper-arm inclination are used. With the forearm or elbow channels, the same organisation at two amplitudes was called condition-dependent in 3 of 8 development sessions: the forearm sensor's centripetal acceleration disturbs the gravity estimate in proportion to the square of the speed, so its error does not scale with the movement.

The index is not "less variability is better": high within-condition variability lowers it, and so does an organisation that does not respond to the task. Which of these is desirable is not for the number to say. Its reproducibility across sessions in real children is unknown.

## 6. Trunk–outcome trade-off (exploratory)

When the trunk contributes more on one repetition than on another, what happens to the task outcome? Across the repetitions of one condition the outcome is regressed on the signed trunk excursion in the task plane:

    pass-through = −slope      ≈ 0  the arm absorbs trunk variation (the outcome is preserved)
                               ≈ 1  trunk variation passes into the outcome

In the planar chain model (outcome = arm relative to trunk − trunk pitch), pass-through 1 is what independent trunk and arm variation gives, so a value below 1 is covariation that stabilises the outcome — the smallest valid case of the motor-abundance idea (`scholz1999`, `latash2002`): two measured elements, one task variable.

Rules (`TRADEOFF_RULE`): sagittal arm raising only; at least 12 repetitions; trunk excursion SD of at least 1°; the slope is corrected for errors-in-variables attenuation when the trunk measurement noise is known and refused when reliability is below 0.8; the verdict comes from the bootstrap interval (`outcome_preserved…` when its upper end is below 0.5, `trunk_variation_passes_into_outcome` when its lower end is above 0.5, `reinforcing` when above 1, otherwise `between`). Kendall correlations of the trunk share with duration, peak rate and smoothness are Holm-adjusted.

It describes covariation within one recording, not cause.

## 7. Reproducibility across sessions (exploratory)

`signature.ts`:

- **Movement signature.** Is a participant's multivariate description closer to their own other session than to other participants' sessions? Nearest-neighbour identification with a permutation test, a distance contrast, and a per-feature ICC(1,1). Needs at least five participants with two sessions each. It is a statement about reproducibility of a description, not an identity and not a diagnosis.
- **Strategy shift.** Did the share of one strategy among confidently assigned repetitions change between earlier and later sessions? Likelihood-ratio statistic of the best split of the ordered sessions, p by permuting repetitions across sessions, which accounts for searching over the split. Needs at least two sessions and twelve repetitions.

## 8. Strategy atlas

`buildAtlas` (run in a worker) profiles a participant's raw recordings of one movement in time order, takes the first as the placement reference, compares each later one with it, partitions the variation of outcome, trunk pitch, trunk share and trunk onset lag, and computes the trade-off per recording. `syntheticAtlas` generates three recordings with a known answer (same movement; same movement with sensors re-attached and the calibration posture off by 6°; a trunk-assisted organisation) so that the page can be read against the truth.

Demo sessions have no raw frames, so the atlas of a demo participant can only be shown on the synthetic recordings. Real recordings need the raw 100 Hz frames of all three sensors.

## 9. What simulation showed (all synthetic)

| Question | Result | Benchmark |
|---|---|---|
| Different organisation at equal outcome is detected | 40 of 40 | S1a |
| The same organisation is called different | 5 % | S1b |
| Re-attached sensors are called a change of the movement | 0 of 80 (run 1, before the strap allowance: 12.5 %) | S2 |
| Pure scaling is called flexibility | 2.5 % | S3a |
| An 18° change of trunk involvement between targets is detected | 40 of 40; conditions in separate sessions are always called confounded | S3b |
| Pass-through recovered | 0.03 when compensated, 1.00 when independent; interval coverage 0.94 | S4 |
| Signature identification | 0.96 against chance 0.125; no signature when participants do not differ | S5 |
| Strategy shift | false alarms 3.8 %; power 0.96 for a switch, 0.76 for a gradual change | S6 |

## 10. Limits

- No real multi-sensor recording of a child has been analysed. Synthetic participants are far simpler and more homogeneous than children with cerebral palsy.
- Assessment sessions hold three repetitions per movement; most of this layer needs a practice sitting with raw frames kept (which requires recorded consent).
- The elbow angle is unstable under sensor rotation and has no validated uncertainty budget; it is excluded from flexibility and reported with its flag.
- Scapular and glenohumeral contributions, hand path and grasp are not observable.
