# NeuroMove research platform: engineering report, 8 November 2026

Scope: software only. Hardware is frozen (one ESP32 and three MPU-6050 modules). Firmware was read, not changed.

**Status labels used below**

| Label | Meaning |
|---|---|
| ✅ **tested** | Implemented, with automated tests run |
| 🟡 **not on hardware** | Implemented and tested in software, never run against the physical device |
| 🧪 **experimental** | Works, with stated limitations |
| ⛔ **not implemented** | Not built yet |

## 1. Original architecture

- **Client only.** A Vite 7, React 19, TypeScript and Zustand app with no server and no database.
- **Storage.** All data lived in the IndexedDB of each browser (`neuromove` database, schema v1). The crash-recovery copy of a running test was kept in `localStorage`.
- **Network.** The CSP `connect-src 'none'` blocked all network requests.
- **Device input.** Web Serial or Web Bluetooth with the `imu-csv v1` text protocol, plus a simulator and file replay.
- **Two workspaces.** `demo` holds simulated children; `clinic` holds real records.
- **Deployment.** Vercel, static `dist/`.

## 2. Root cause of the lost data (confirmed)

**The symptom.** The clinic backup from 27 Oct 2026 listed three alerts that pointed to sessions `s_fcf24f…` and `s_8529…`, but its `sessions` array was empty.

**The cause.** `ProtocolId` includes `'single'`, the single-sensor test. The validator that runs every time the app loads (`data/backup.ts`) kept its own protocol list, and that list did not contain `'single'`.

- Single-sensor sessions were therefore written to IndexedDB, then hidden as "corrupted" on every reload. Both orphaned alerts are `forearm_rotation`, which is the single-sensor forearm test.
- Exported backups are built from the in-memory list, so they also left these sessions out.

I reproduced this with a test that fails before the fix and passes after it (`src/data/persistence.test.ts`).

**Hazards found while tracing it:**

1. **Hidden records were deleted for good by import and clear.** `replaceWorkspace`, which runs on backup import and on "Clear clinic", deleted every record in the workspace, including the hidden ones. Importing the backup above would have erased those sessions from the browser permanently.
2. **The crash-recovery copy was cleared too early.** `SessionController.finalize()` cleared it before the session write was confirmed. A failed write therefore lost the session.
3. **"Saved" meant "displayed".** All writes were fire-and-forget, so nothing could tell the user what was actually on disk.
4. **Data was per browser and per origin.** Every Vercel preview URL is a separate, empty database. A new deployment URL looked like data loss even though the data was still in the old URL's storage.
5. **A schema upgrade could silently switch to memory.** If another tab held an older database version open, the app gave up after 5 s and kept data in memory only, without making that clear.

**Fixes.**

- A single `PROTOCOL_IDS` constant now drives both the type and the validator.
- Records that fail validation are quarantined: they are hidden but never deleted, `replaceWorkspace(…, preserve)` skips them, and they can be downloaded from Settings.
- The crash-recovery copy is cleared only after `flush()` confirms the write.
- `pendingWrites` and `flush()` track every local write.
- A blocked database upgrade now waits and shows `dbBlocked` instead of falling back to memory.

**What you need to do.** Open the app at the same address as before. With this fix the hidden sessions should reappear, because they were never deleted. **Do not import the 27 Oct backup over them** until they are visible again. The current code preserves them during an import anyway.

## 3. Architecture changes

```
Browser (offline-first)                               Vercel Function api/index.js
  React UI ── stores ── IndexedDB v2                     server/http.ts  (auth, CSRF, limits)
              │          ├ records + outbox (1 tx)        server/sync.ts  (push/pull, audit)
              │          └ syncstate                       server/storage.ts (raw chunks)
              └ sync engine ── fetch same-origin /api ──►  PostgreSQL (authoritative) + Upstash (optional)
```

| Module | Location | Responsibility |
|---|---|---|
| Research | `src/research` | Model, workflow state machine, capture, statistics, validation, export, protocols, capabilities |
| Sync | `src/sync` | Types, outbox op builder, engine, raw-chunk uploader |
| Server | `server/` | HTTP, auth, sync, storage, Redis, migrations |
| UI | `src/features/research` | Validation desk, report, Protocol Studio, datasets, cloud sync settings panel |

- Computation is pure and has no React dependency. The server imports the same `stats.ts`, `workflow.ts` and validators as the browser.
- The server is a single function bundled by esbuild (`npm run build:api`). Vercel's builder cannot run this ESM package's extension-less imports. A test fails if the committed bundle drifts from the source.

## 4. Database changes

| Store | Changes | Migration safety |
|---|---|---|
| **IndexedDB v1 → v2** | Adds `protocols`, `vsessions`, `trials`, `outbox` and `syncstate`. v1 stores are untouched. | Tested on a database built exactly the way the old code built it. |
| **PostgreSQL, migration `0001_core`** | 23 tables, documented in [DATA_MODEL.md](DATA_MODEL.md) | Additive and idempotent, with no DROP or TRUNCATE (enforced by a test). Each migration runs in one transaction under an advisory lock. Apply with `DATABASE_URL=… npm run db:migrate`. |

Integrity guarantees in PostgreSQL:

- Foreign keys everywhere.
- Protocol definitions are immutable, enforced by a trigger.
- Sensor configurations are content-addressed.
- Generated error columns.
- Write-once raw chunks.
- An idempotency ledger in the same transaction as each write.
- An append-only audit log.

## 5. Upstash Redis: what it actually does

All Redis use is optional. Redis is never the record of anything.

- **Rate limits** on login (10 per 5 min per IP and email), bootstrap (5 per hour) and push (240 per min per user).
- **Cursor cache.** Idle clients poll `/sync/pull` without hitting PostgreSQL. Entries live 30 s, so the worst case is a 30 s delay.
- **Notifications.** A `PUBLISH nm:team:<id>` happens after each commit.

Redis is written only after the PostgreSQL commit, and every Redis failure is swallowed.

- **Not used for idempotency or locks.** PostgreSQL handles both inside the transaction.
- **No browser Pub/Sub subscription.** Serverless functions cannot hold a subscription, so clients poll every 15 s instead.
- **Without credentials** there is an in-memory fallback, and rate limits then apply per instance only.
- **Not verified against a live Upstash instance.** No credentials were available.

## 6. Offline synchronisation

1. A write goes to IndexedDB together with its outbox op in **one transaction**.
2. The engine pushes batches of up to 50 ops, oldest first, so parents go before children.
3. The server applies each op in its own transaction and answers `applied`, `duplicate`, `conflict`, `rejected` or `retry`.
4. Only `applied` or `duplicate` removes the op and records the server revision. That is the only point at which the UI shows "Synced".

Other behaviour:

- **Idempotency.** Each op carries an `opId`. If a newer edit of the same entity is coalesced into a queued op, it gets a new `opId`.
- **Backoff.** Retries wait 2 s, 4 s and so on up to 5 min, with jitter. "Sync now" retries immediately, and so does coming back online.
- **Conflicts.** If an edit's base revision is not the server's current revision, the op is parked together with the server's copy. The operator chooses "Use server version" or "Keep mine (overwrite)", and the choice is audited.
- **Pull.** An ordered change feed with a cursor. Local unsent edits are not overwritten by pulled data.
- **Off by default.** Nothing leaves the browser until a team member signs in and enables sync. Demo data never syncs, and the server also refuses demo and simulated data.
- **CSP.** `connect-src 'self'` for the site: only its own `/api`, no third parties. The single-file demo stays at `'none'`.
- **Closed browser.** Pending ops stay in IndexedDB and resume on the next start. The status pill shows how many are waiting.

## 7. Testing workflow: Research → Validation session

1. Choose a protocol version and a participant (pseudonymous code).
2. Connect sensors.
3. Run the stand-still calibration.
4. Capture. In **hold** mode, the Space key or a button captures the median joint angle over the protocol window (1 s by default) and records the window's SD as a stability check. **Repetition-peak** mode captures automatically when a repetition ends (🧪).
5. The session **pauses**. The goniometer field takes focus, and Enter saves and continues.
6. The other actions are Repeat measurement, Mark invalid (reason required), Skip (reason required) and Review/correct an earlier repetition.
7. The live report updates from stored data.
8. Complete the session to get the report.

**Recovery.** Progress is derived only from stored trials, so a reload, a closed browser or another device after sync all resume at the same slot. A pending capture is restored too.

Status: ✅ tested (unit, IndexedDB recovery, and an end-to-end browser test with the simulator) · 🟡 not on hardware.

## 8. Goniometer pairing

- Each goniometer value belongs to exactly one captured IMU measurement, stored on the same trial record. The record includes the capture window times, sample count, SD, min, max and capture method.
- A value is never paired with "the current reading".
- Supported measurement points per repetition: max flexion, max extension, neutral, custom, and several points per repetition.
- Stored values are never rounded.

Status: ✅ tested.

## 9. Statistics

See [STATISTICS.md](STATISTICS.md).

- **Error metrics:** bias with its CI, SD, MAE, RMSE, median |error|, min/max, and counts (valid, invalid, skipped, missing).
- **Bland–Altman:** standard limits with CIs and a proportional-bias slope; the repeated-measures method (2007) is used automatically when the data have that structure.
- **ICC and related:** ICC(A,1) and ICC(C,1) with CIs, SEM, and MDC95.
- **Other analyses:** range bins, drift, and outlier flags that never remove data.
- **Sufficiency labels:** each analysis says whether there is enough data for it.

Tested against NumPy and published values.

Status: ✅ tested. Test–retest, inter-rater and intra-rater reliability screens are ⛔ not implemented (the function exists, the study design UI does not).

## 10. Sensor processing

- **Verified in firmware:** 100 Hz, DLPF_CFG = 3 (about 44 Hz accelerometer / 42 Hz gyroscope), ±4 g (8192 LSB/g), ±1000 °/s (32.8 LSB/°/s), 460 800 baud.
- **Joint angles:** the existing pipeline (`core/pipeline.ts`) was reused unchanged. It is gravity- and gyro-based with no magnetometer, so yaw is not observable.
- **Capability map:** `research/capabilities.ts` states what three MPU-6050 modules can measure today.
  - Operational: shoulder flexion and abduction, elbow flexion.
  - Experimental: forearm rotation, trunk inclination.
  - Future and disabled: knee, hip, ankle.
- **Live signal checks** in the validation desk: missing-sensor detection, window stability, and saturation and loss counts from the existing engine. They are stored with the session.
- **Not done:** no new filtering or orientation algorithms. Packet loss is reported only where `seq` gaps make it detectable (existing engine).

## 11. New research modules

| Module | Status |
|---|---|
| Validation sessions | ✅ |
| Protocol Studio (versioned, templates, custom fields, archive) | ✅ |
| Datasets (filters, CSV, data dictionary, JSON) | ✅ |
| Capability map | ✅ |
| Team cloud sync (settings, conflicts, rejected ops, quarantine download) | ✅ |
| Raw-chunk upload (gzip, SHA-256, resumable) | ✅ (server and engine tests) |
| Longitudinal and cohort analytics, session comparison for validation sessions | ⛔ (the existing rehab analytics pages are unchanged) |
| 3D replay | ⛔ |
| AI assistant | ⛔ |
| Realtime collaboration beyond polling and audit | ⛔ |
| Calibration *correction models* | ⛔. Calibration records are stored; no correction is applied. |

## 12. Reports and exports

- **Session validation report:** session information, sensor configuration, calibration, data-quality warnings, statistics, six charts, the agreement table, and the repetition table including superseded attempts.
- **Print and PDF** through the browser's print dialog, with dedicated print styles.
- **Per-session CSV and JSON.**
- **Dataset CSV:** one row per attempt, full precision, units in the data dictionary, a unique dataset ID per export (never replaced).
- **Parquet:** ⛔ not implemented. The CSV loads directly into pandas.
- **Reviewer warning:** `PDF` uses `window.print`. It has not been checked against a real printer or PDF engine beyond the print CSS.

## 13. Tests run on 8 Nov 2026

| Check | Result |
|---|---|
| `tsc -b` (app, node and server projects) | pass |
| `eslint .` | pass |
| `vitest run` (unit and integration, including PGlite server tests) | **319 passed** in 24 files (baseline before this work: 256 in 19 files) |
| `vite build` | pass |
| `npm run check:api` | bundle is up to date |
| Playwright e2e (installed Chrome, desktop and Pixel 7) | **39 passed**, including the new `e2e/validation.spec.ts` and the layout check extended to the research pages. The first run found 2 overflows at 320–430 px in the new Settings sync panel; both were fixed and re-run. |

New tests cover:

- the data-loss regression, quarantine, IndexedDB v1 → v2 migration, and outbox atomicity;
- statistics (NumPy and psych::ICC values, edge cases, floating-point behaviour);
- the workflow state machine and recovery after reload;
- protocol versioning;
- the server: migrations, auth, CSRF, rate limit, team isolation, roles, idempotency, conflicts, demo and simulated data rejection, FK retry, protocol immutability (including direct SQL), generated errors, derived metrics with algorithm version, raw chunks, soft delete;
- the sync engine against the real handler: offline retry, backoff, acknowledgement, two-device pull, conflict resolution, raw upload resume, coalescing.

## 14. Known gaps and incomplete features

Fixed during verification:

- **Sync engine.** "Sync now" during an in-flight cycle returned the older cycle, so a fresh write waited until the next 15 s tick. Found by the sync-engine test; it now runs another pass.
- **Development mode only.** The validation page created its device controller in `useState`. React StrictMode then disposed it and kept using it. Found in the in-app browser; controllers now live in a reference-counted registry.

Still open:

- **Nothing verified against a real database or Redis.** No live PostgreSQL or Upstash was available. The SQL runs on PGlite, which is real PostgreSQL 17 compiled to WASM, but `postgres.js` against a hosted pooler has not been exercised.
- **Remaining research features** from §11 (⛔).
- **Kazakh translations** for the research module fall back to Russian.
- **Team members:** they can be added through the API (`POST /api/team/members`), but there is no admin UI yet.
- **Raw data stays in PostgreSQL** (`bytea`). `RAW_STORAGE=object` returns 501 until an object-store backend is written.
- **Validation sessions do not record raw frames** (only rehab sessions do), so validation captures cannot be reprocessed from raw data later.

## 15. Environment variables

See [`.env.example`](../../.env.example). All are server-only.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` or `POSTGRES_URL` | PostgreSQL connection string |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL` / `KV_REST_API_TOKEN`) | Upstash Redis |
| `NEUROMOVE_SETUP_CODE` | One-time team setup code |
| `RAW_STORAGE` | Raw recording backend (`postgres` by default) |

## 16. Deploying on Vercel

1. In Vercel, set the project root to `website`. `vercel.json` already rewrites `/api/*` to `api/index.js` and sets `Cache-Control: no-store` on the API.
2. Add a PostgreSQL database through Vercel → Storage (Neon or Supabase), or set `DATABASE_URL` to the **pooled** connection string.
3. Optionally add the Upstash integration.
4. Set `NEUROMOVE_SETUP_CODE` to a long random string.
5. Run `DATABASE_URL=… npm run db:migrate` once from your machine.
6. Deploy, then open `/api/health`. Expect `{"ok":true,"database":"ok","pendingMigrations":[]}`.
7. In the app: Settings → Team cloud sync → First setup. Sign in, then enable sync on each device.
8. Use one production domain. Every preview URL has its own browser storage.

Whenever `server/` or shared `src/` code changes, run `npm run build:api` and commit `api/index.js`. The test suite fails if you forget.

## 17. What you need to do

- Provision PostgreSQL and run the migration.
- Set the environment variables.
- Optionally connect Upstash.
- Create the team and remove `NEUROMOVE_SETUP_CODE` afterwards.
- Check that the hidden clinic sessions reappear at the original URL.
- Decide whether participant codes (currently first names, such as "Малика") should be replaced with pseudonymous codes **before** enabling cloud sync.

## 18. What still needs validation with real measurements

- The validation desk with the physical device over USB and BLE: connection, calibration, capture timing, and the hold-window choice.
- Whether the 1 s median window and the 1.5° SD stability limit suit real holds.
- Rep-peak capture (🧪).
- The goniometer agreement itself, meaning the bias and LoA of the device. This is what the module measures and nothing here asserts it.
- Forearm rotation (🧪) and range agreement at extreme angles.
- Raw upload volume and latency over real hospital networks.
