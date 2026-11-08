# MCSE feasibility: what the NeuroMove sensors can and cannot observe

Audit date 2026-11-08. Scope: the Motor Coordination & Strategy Discovery Engine (MCSE, `website/src/lab/coord`).
Every statement below cites the code or document that establishes it.

## 1. Measurement configuration (frozen hardware)

| Item | Fact | Source |
|---|---|---|
| Sensors | 3 × MPU-6050 (6-axis: 3-axis accelerometer + 3-axis gyroscope). **No magnetometer.** | `железо.md`, `firmware/NeuroMoveStand/mpu6050.h` |
| Placement | `trunk` (sternum), `upper_<side>` (mid upper arm, lateral), `fore_<side>` (dorsal distal forearm). One arm per recording (`arm=right|left` in the passport). The data model allows 5 places; the stand has 3. | `COORDINATES.md` §2, `firmware/.../config.h`, passport line `sensors=` |
| Mount convention | Calibration pose (arms hanging, thumb forward): sensor X along the bone towards the hand (trunk: X down); Z out of the skin (trunk: Z forward). Checked three ways by `verification/conventions.test.ts`. | `COORDINATES.md` §2 |
| Ranges | ±4 g (8192 LSB/g), ±1000 °/s (32.8 LSB/(°/s)), DLPF 44 Hz | `core/imu.ts`, firmware `configure` |
| Rate / time | 100 Hz from a firmware scheduler; `t = seq / rate`. No per-sample hardware timestamps. | `scheduler.h`, `devices/types.ts` (`RawFrame.t`) |
| Synchronisation | All sensors are read in **one** scheduler tick, sequentially (three I²C buses at 100 kHz); a frame with any failed read is **dropped**, so every stored frame carries simultaneous samples. Intra-frame skew between first and last sensor ≈ 2–4 ms (estimated from bus timing, **not measured**). BLE devices deliver per-sensor packets aligned by `seq`. | `stand.h` `tick()`, `BleDevice.ts` |
| Calibration | (a) 6-position accelerometer offset/scale per module, printed in the passport (`cal_<place>`), stored as `session.device.accCal`; (b) 3 s still pose at the start of every session: gyroscope bias = mean, gravity direction = the zero of every angle. | `core/pipeline.ts` `Calibrator`, `SessionEngine.stepCalibration` |
| Orientation | Gravity-direction complementary filter (α = 0.98 at 100 Hz, τ ≈ 0.5 s). Tracks the 2-DOF "up" vector only; **no heading**. | `core/orientation.ts` |

## 2. Observability map (what MCSE may compute)

| Quantity | Status | Reason |
|---|---|---|
| Segment inclination (angle of a segment's long axis from its calibration-pose direction) — trunk, upper arm, forearm | **observable** | gravity reference; drift-free; exact for any strap rotation about the bone (`COORDINATES.md` §4) |
| Trunk sagittal / frontal tilt (signed) | **observable** | gravity in the trunk frame, axes from the calibration pose and the mount rule (Z forward); accurate to the strap misalignment (2–5°) |
| Angular velocity of each segment, 3 components in the sensor frame | **measured** | gyroscope |
| Axial (about the bone) vs swing angular rate of upper arm / forearm | **observable** | bone axis in the sensor frame = gravity in the calibration pose |
| Elbow flexion (hinge model) | **observable under the hinge assumption** | existing `elbowFlexion` (hinge axis = upper-arm Z); limitations F3/F4 in `FINDINGS.md` |
| Forearm pronation/supination | **observable only with the forearm near horizontal** | gravity roll about the bone; existing `rotation` exercise |
| Relative 3-D orientation trunk ↔ upper arm (e.g. humerothoracic elevation, plane of elevation) | **estimated, drift-bounded, within a repetition only** | requires relative heading; with 6-axis IMUs heading comes only from gyroscope integration (drift grows with time). MCSE propagates it from the rest position at each repetition onset and reports the drift diagnostic; it is **never** used across a session. |
| Absolute heading / yaw, direction the child faces | **unavailable** | no magnetometer |
| Segment position, hand path, reach distance | **unavailable** | double integration of acceleration drifts quadratically (Kok, Hol & Schön 2017) |
| Shoulder (glenohumeral) joint angles in ISB convention | **unavailable** | needs relative heading and anatomical calibration not available (Wu et al. 2005) |
| Wrist, scapula, contralateral arm | **unavailable** | not instrumented |
| Muscle activity, muscle/neural synergies | **unavailable — never claimed** | no EMG; MCSE extracts *kinematic* coordination components only |

## 3. Raw-data availability

| Recording type | Raw streams preserved? | Source |
|---|---|---|
| Live clinic/demo sessions recorded with a device (`SessionController`, `recordRaw: true`) | **Yes** — every frame of the active phases (calibration, positioning, recording), int16, `seq` and `t`, in IndexedDB store `raw` (10 s chunks, packed typed arrays). Uploaded to the server when sync is on (`sync/raw.ts`). | `SessionEngine.recordRaw`, `data/db.ts` `putRaw` |
| Sessions saved when storage was full | **No** (`hasRaw = false`, warned) | `appStore.saveSession` |
| Seeded demo history | **No** (`hasRaw: false`) — aggregate repetition metrics only | `data/seed/demo.ts` |
| Validation (goniometer) sessions | **No** | `research/system-audit.md` |
| Child-mode practice sittings (before this change) | **No** — only the peak angle per repetition (`practice_trials`) | `lab/practice.ts` |
| Imported imu-csv files in the Movement Lab | in memory only (not saved) | `MovementLabPage.tsx` |

What was **missing** for coordination analysis even when raw frames exist:
1. no record of which processing ran, no content hash (immutability not verifiable);
2. calibration window boundaries, gyroscope bias and mount convention not stored (recomputable from the frames, but the recomputation was not documented or versioned);
3. the event times (`session.events[].t`) are relative to the first processed frame; that mapping was implicit.

**Historical reconstruction.** Sessions with `hasRaw = true` can be fully re-analysed by MCSE (the calibration frames are inside the raw stream). Sessions with `hasRaw = false` carry only per-repetition ROM / SPARC / trunk values and a 20 Hz trace of ONE angle; multi-segment trajectories **cannot** be reconstructed from them, and MCSE marks them `aggregate_only` rather than synthesising signals.

## 4. Changes made for future recordings

- `Session.rawManifest` (optional, backward compatible): frame count, `seq`/`t` range, placements, SHA-256 of the packed int16 stream, mount convention id, synchronisation model, calibration source, processing versions. Written once, at save time, from the frames actually stored; MCSE verifies it before analysis and refuses a mismatch (`coord/provenance.ts`).
- Practice sittings: raw frames are kept **only** when the existing consent gate allows trial recording (`trialRecordingStatus`), stored in the same `raw` store under the trial-set id with the same manifest; they are local-only (the server accepts raw chunks for sessions only).
- Storage cost: 3 sensors × 6 × int16 = 36 B/frame + 12 B seq/t ≈ 4.8 kB/s ≈ 17 MB/hour, unchanged packed representation (`packChunk`).

## 5. Consequences for the research question

- Coordination is analysed in a **gravity-referenced inclination + angular-rate** representation of three segments of one arm and the trunk; this is the strongest representation the sensors support without inventing heading.
- "Trunk contribution" is defined explicitly: trunk sagittal tilt excursion during the outbound phase divided by the upper-arm inclination excursion (both from the calibration pose). It is an observed kinematic quantity, not a diagnosis of compensation.
- Typical assessment sessions contain ≈ 3 repetitions per movement; strategy discovery within one session is usually **inconclusive by design**. Practice sittings with raw retention are the realistic source of enough repetitions.
