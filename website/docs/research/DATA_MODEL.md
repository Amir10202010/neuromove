# Research data model

This file describes two layers: IndexedDB, which is the local, offline-first copy, and PostgreSQL, which is authoritative when team sync is enabled. The schema source is [`server/migrations.ts`](../../server/migrations.ts). The client types are in [`src/research/model.ts`](../../src/research/model.ts) and [`src/data/models.ts`](../../src/data/models.ts).

## Principles

- **Observed vs. derived.** A trial stores two observed values: the IMU angle produced by the pipeline and the goniometer angle typed by the operator. Errors are derived from them. In PostgreSQL they are `GENERATED ALWAYS` columns (`signed_error_deg`, `abs_error_deg`), so a stored error can never disagree with its own inputs. No value is rounded before storage.
- **Immutability.**
  - A protocol version's definition cannot change. A trigger rejects any update, including direct SQL.
  - Sensor configurations are content-addressed (`sha256` of the canonical JSON) and insert-only.
  - Calibration records are insert-only.
  - Each validation session carries a frozen copy of its protocol version, and the server checks that the copy matches the stored version.
- **Nothing is hard-deleted.**
  - Workflow corrections create a new trial attempt and mark the old one `superseded`.
  - Deleting a participant or note locally becomes a server-side soft delete (`deleted_at`).
  - Records that fail validation in the browser are quarantined and never deleted.
- **Traceability.** Every trial links to its participant, session, set, repetition and point, protocol version (`protocol_key`), sensor configuration, algorithm version and app version, and operator. Every write also produces a row in `nm_audit_events` with user, device, revision and opId.
- **Pseudonymity.** Participants are stored as `code`, birth year and status only. There are no names, national IDs or contacts.

## PostgreSQL tables

| Table | Purpose | Key constraints |
|---|---|---|
| `nm_teams`, `nm_users`, `nm_memberships` | Teams, people, roles (`admin`, `session_operator`, `measurement_operator`, `observer`) | Email unique and lower-case; one role per team |
| `nm_auth_sessions` | Login sessions | Only the SHA-256 of the token is stored |
| `nm_participants` | Pseudonymous participants | `team_id` FK; soft delete |
| `nm_rehab_sessions`, `nm_notes`, `nm_alerts` | The existing rehab workflow, synced | FK to participant |
| `nm_protocols`, `nm_protocol_versions` | Protocol Studio versions | `unique(protocol_id, version)`; immutability trigger |
| `nm_devices`, `nm_sensors`, `nm_sensor_configurations` | Device registry, MPU-6050 module IDs, immutable configurations | Content hash unique per team |
| `nm_validation_sessions` | Goniometer validation sessions | FKs to participant, protocol version and sensor configuration |
| `nm_trials` | One IMU capture plus one reference value per attempt | `unique(session, set, repetition, point, attempt)`; generated error columns |
| `nm_calibration_records` | Stand-still pose and six-position accelerometer calibration per session | Insert-only (`unique(session, kind, params_hash)`) |
| `nm_derived_metrics` | Bias, SD, MAE, RMSE, median and max error, LoA per completed session | `unique(entity, entity_id, metric, algorithm_version)` |
| `nm_raw_chunks` | Raw sensor data, separate from derived data | Primary key `(team, recording, chunk)`; SHA-256 verified; never overwritten |
| `nm_reports`, `nm_datasets` | Report and export manifests | Dataset IDs are write-once |
| `nm_changes` | Ordered change feed used by `/api/sync/pull` | `bigserial` sequence per team |
| `nm_idempotency` | opId ledger, written in the same transaction as the record | Primary key `(team, op_id)` |
| `nm_audit_events` | Who did what, when, from which device | Append-only |

Every synced table keeps the exact client payload (`payload jsonb`) next to its typed, indexed columns. Analysis can use SQL, and nothing the client sent is lost.

## IndexedDB (browser), version 2

| Store | Key | Notes |
|---|---|---|
| `patients`, `sessions`, `notes`, `alerts`, `meta`, `raw` | Version 1, unchanged | |
| `protocols` | `key` (`prot_x@N`) | New in version 2 |
| `vsessions` | `id` | New in version 2 |
| `trials` | `id`, indexed by `sessionId` | New in version 2 |
| `outbox` | auto-increment `seq`, unique `opId`, indexed by `entityKey` | Sync queue; written in the same transaction as the record |
| `syncstate` | `entity:id` | Last server revision acknowledged |

The upgrade from version 1 to version 2 is additive, and a test covers it (`src/data/storage.test.ts`). If another tab still holds version 1, the app waits and says so (`dbBlocked`) instead of silently falling back to memory-only storage.

## CSV dataset

There is one row per trial attempt. The columns, units and descriptions are in [`src/research/export.ts`](../../src/research/export.ts) (`COLUMNS`), and the app downloads them as the data dictionary.

```python
import pandas as pd
df = pd.read_csv("neuromove-dataset-….csv", comment="#")
pairs = df[(df.status == "valid") & (df.is_current == 1)]
bias = pairs.signed_error_deg.mean()
```

## Functional Progression System (8 November 2026)

Rehabilitation records (profile, goal, activity, program, practice, review, assessment, study, consent, incident) share one IndexedDB store, `rehab` (schema v3, additive), and one PostgreSQL table, `nm_rehab_records` (migration `0002_rehab`). They sync as the entity `rehab_record`.

- **Immutable kinds.** Activity and program versions, reviews, assessments and practice reports are protected by the trigger `nm_rehab_immutable`.
- **Mutable kinds.** These move forward only through `checkTransition` in `src/rehab/validate.ts`:
  - goal history is append-only;
  - an incident gets one review;
  - consent can only be withdrawn.
- **Caregiver accounts.** These use the role `caregiver` and see only the children in `nm_caregiver_links`.

Details: [../NEUROMOVE_PEDIATRIC_REHABILITATION_ARCHITECTURE.md](../NEUROMOVE_PEDIATRIC_REHABILITATION_ARCHITECTURE.md).
