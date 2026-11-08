# Dataset specification — NeuroMove movement research data

This describes what the software **already records** and what a research dataset release must contain. It follows FAIR principles (wilkinson2016), and a datasheet (gebru2021) must accompany every release.

## 1. Units of data

| Entity | Content | Store | Identifier |
|---|---|---|---|
| Participant | pseudonymous code, birth year, sex (optional), CP form, GMFCS, MACS, affected side | IndexedDB `patients`, PostgreSQL `nm_participants` | record id; the code is a **name** in current clinic use, so exports never contain it |
| Sensor session | protocol, steps, per-repetition metrics, quality, calibration pose, device (kind, firmware, rate, accelerometer calibration, module ids), algorithm and app versions | `sessions` / `nm_rehab_sessions` | session id |
| Raw recording | seq, t, int16 × 6 per module, presence mask, 10 s chunks | `raw` / `nm_raw_chunks` (SHA-256) | sessionId:chunk |
| Practice record | date, minutes, completion, source (caregiver, professional, child mode), discomfort, barriers | `rehab` (kind practice) / `nm_rehab_records` | record id |
| Consent | study, guardian permission, child assent, status | `rehab` (kind consent) | record id |
| Learning protocol version | definition + SHA-256 | `lab` (IndexedDB v4) | lp_… id, protocolId, version |
| Frozen analysis run | snapshot, configuration, versions, results, hashes | `lab` (IndexedDB v4) | run_… id |

## 2. Release formats (implemented)

**Motor-learning run export** (`lab/export.ts`), schema `neuromove-motor-learning-run` v1:
- JSON: manifest, configuration, inputs, snapshot and results.
- `observations.csv`: one row per repetition, full precision.
- `models.csv`: one row per series × candidate model.
- A data dictionary (`dictionary.csv`) with units.

**Raw data** use the existing imu-csv v1 export per session. **Validation (goniometer) datasets** are the existing `neuromove-validation-dataset`.

**De-identification by default:**
- run-local participant pseudonym `P-xxxxxxxx`;
- run-local session pseudonyms `S-xxxxxxxxxx`;
- dates replaced by study days;
- no names, birth years or free text.

Dates can be included only by an explicit export option. **Pseudonymised is not anonymous.** Small datasets can be re-identifiable, and the manifest says so.

## 3. Required metadata for a research release

- The study protocol version and its definition hash, plus the ethics reference (rehab Study record).
- Device: firmware version, sampling rate, ranges, module calibration presence, module ids.
- Processing: core algorithm version per session; lab component versions per run.
- Quality: per-session quality and exclusions with reasons.
- Population descriptors as **bands** (age band, GMFCS, MACS), never exact birth dates.

## 4. Annotation strategy

| Annotation | Source | Reliability |
|---|---|---|
| Task (exercise, side) and step boundaries | protocol steps recorded by the engine | exact (software) |
| Repetition windows | angle-threshold detector (existing) | algorithmic; compared with velocity events in the Analysis Lab |
| Movement onset, offset and direction | velocity method (lab) | algorithmic |
| Reference joint angle | goniometer, through the validation module | measured with its own error; inter-rater reliability to be studied |
| Movement quality judgements (clinician) | not collected | future: would need an inter-rater reliability study before use as labels |

## 5. Data-quality requirements for inclusion

- Session quality ≥ 90 % completeness, and no blocking flags (saturation, data gap, sensor lost, flipped mount, calibration moved). Excluded sessions are released with their reasons, not deleted.
- Raw recordings: per-sensor QC confidence of high or medium. "Low" and "unusable" are released only with their QC report.
- Simulated or demo data are **never** mixed into a real dataset. The server refuses them; exports label them.

## 6. Imbalance and representativeness

Report the participant contribution share of raw hours (the readiness page computes the largest share), the distribution of age bands, GMFCS and MACS, and tasks per participant. A single participant dominating the data biases any pooled model and must be reported.
