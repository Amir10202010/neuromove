# NeuroMove Functional Progression System: architecture and delivery report

Date: 8 November 2026. Scope: software only. Hardware is frozen (ESP32 and 3 × MPU-6050). Firmware was not touched.

NeuroMove is an experimental rehabilitation-support and movement-analysis platform. It does not diagnose, prescribe, set intensity or change a professional's plan. Every number in a program is typed by a professional. The analytics engine produces observations for professional review and nothing else.

Companion documents:
- [Evidence map](NEUROMOVE_PEDIATRIC_REHABILITATION_EVIDENCE_MAP.md): approaches, evidence, what NeuroMove may and may not claim.
- [Pilot evaluation framework](NEUROMOVE_PILOT_EVALUATION_FRAMEWORK.md): how to study it.
- [Research data model](research/DATA_MODEL.md) and [engineering report](research/ENGINEERING_REPORT.md): the validation platform this builds on.

**Status labels**

| Label | Meaning |
|---|---|
| ✅ **implemented and tested** | Built, with automated tests that ran and passed |
| 🧪 **experimental** | Works, with stated limits; not validated |
| 👩‍⚕️ **needs professional validation** | Built, but clinicians must confirm the content or the rule before clinical use |
| 🔬 **needs future research** | Must be studied before any claim |
| ⛔ **not implemented** | Not built |

---

## 1. Evidence review summary

The full map, with 53 references, is in [the evidence map](NEUROMOVE_PEDIATRIC_REHABILITATION_EVIDENCE_MAP.md). Three of the four starting references turned out to be something other than what the brief described, and the map cites the correct papers:
- **Sudati 2024** (threshold dose) is doi 10.1111/dmcn.16040. The doi given in the brief, 10.1111/dmcn.16149, points to an indexed item without an abstract.
- **Amponsah 2026** in BMJ Open is a completed scoping review, not a study protocol.
- **Burchfield 2025** is a scoping review in *Frontiers in Neurology*.

Five findings shaped the design:

1. **Goals before metrics.** Goal-directed, task-specific training is the established approach (Jackman 2022 guideline; Novak 2020). Outcomes are the child's and family's goals (GAS, COPM). An IMU angle is body-function context only, and the software never presents it as a goal outcome.
2. **Dose is recorded, not prescribed.** No threshold dose has been established (Sudati 2024). NeuroMove stores what the professional planned and what families report. It never proposes or raises intensity.
3. **Three kinds of information are kept apart:** instrument results, IMU measurements and reports from the family or child. There is no composite score.
4. **Change is shown neutrally.** NeuroMove has no paediatric SEM or MDC yet, so differences are worded as "higher / lower than baseline", never "improved".
5. **Participation, not performance.** The child mode has no leaderboards and no punishing streaks, and "not done" is a neutral answer. Discomfort goes to a professional, and nothing changes automatically.

## 2. Product architecture

```
CHILD & FAMILY GOALS → PROFESSIONAL ASSESSMENT → PERSONALIZED PROGRAM → STRUCTURED PRACTICE
        → MOVEMENT MEASUREMENT → PROGRESS ANALYSIS → PROFESSIONAL REVIEW → UPDATED PROGRAM
```

```
Browser (offline-first)                                     Server (Vercel function, optional)
 Professional workspace ─┐                                   /api/sync  push ─► rehab_record handler
 Family workspace ───────┼─ rehab store ─ IndexedDB v3 ──┐      validate → authorise (policy.ts)
 Child mode ─────────────┘  (validate, authorise,        │      → integrity (checkTransition)
                             integrity, ONE transaction) │      → nm_rehab_records (+ trigger)
 Existing: patients, sessions, notes, research ──────────┘   /api/sync  pull ─► caregiver filter
                                     outbox ─► sync engine ─► PostgreSQL (authoritative when on)
```

| Layer | Location | Responsibility |
|---|---|---|
| Domain (pure, shared with the server) | `src/rehab/` | `model.ts` types; `validate.ts` validators and allowed transitions; `policy.ts` roles; `goals.ts`; `programs.ts`; `movement.ts`; `progress.ts`; `timeline.ts`; `study.ts`; `workflows.ts`; `demoSeed.ts` |
| State | `src/rehab/store.ts` | The single write path: validate, authorise, check integrity, then commit to IndexedDB and the outbox in one transaction. Only after that does the screen change. |
| UI | `src/features/rehab/` | Professional dashboard and participant page (8 tabs), activity library, studies, family workspace, child mode, translations |
| Server | `server/sync.ts`, `server/auth.ts`, `server/http.ts`, `server/migrations.ts` (`0002_rehab`) | Handler for `rehab_record`, caregiver accounts and links, pull filter, immutability trigger |

**Reused, not duplicated.** The patients, sensor sessions and notes stores; IndexedDB with its atomic outbox; the sync engine with idempotency, backoff and conflict parking; team authentication and isolation; the audit log; the CSP; the API bundle. There is no second persistence architecture.

## 3. Implemented modules

| Module | Where | Status |
|---|---|---|
| Participant rehabilitation profile: assigned professional, domains, caregiver participation, clinician-entered classifications, assessment summary, child-mode presentation, baseline sessions | Participant → Profile | ✅ |
| Goal management: category, why it matters, baseline, target in words, measurement method, responsible, review date, 5 states, append-only history, GAS levels, family input | Participant → Goals; Family → Our goals | ✅ |
| Activity library with immutable versions, statuses draft / experimental / clinician-approved, visual steps, caregiver instructions, safety notes, evidence references | Rehabilitation → Activity library | ✅ |
| Program Studio: modular pathway A–E, assignments pinned to an activity version, professional-entered frequency, duration, dosage, family note and child feedback target, checkpoints, immutable versions with a required reason and a diff, templates | Participant → Program | ✅ |
| Home-to-clinic workflow: family reports (done / partly / not done / stopped, barriers, difficulty, break, fatigue, discomfort, minutes, note), free messages, clinic entries linked to real sensor sessions, acknowledgement | Family workspace; Participant → Family | ✅ |
| Safety: pain opens a safety incident in the same save; stopped sessions are recorded; an incident is reviewed once; safety items come first on the dashboard; the stop/pause workflow is always visible in child mode | Everywhere | ✅ |
| Movement intelligence: 12 documented metrics, quality gating, individual baseline, trend, unusual repetitions | Participant → Movement | ✅ (metrics 🧪, see §7) |
| Adaptive Progress Engine: 13 transparent rules, each with a version, thresholds, evidence links and what it does not mean | Participant → Review; dashboard | ✅ (rules 👩‍⚕️) |
| Clinician-controlled progression: observation → professional response → decision and reasoning → optional new program version citing the review | Participant → Review → Program | ✅ |
| Outcome assessments: GAS (Kiresuk–Sherman T-score), COPM means, GMFM-66/88 totals as entered, other instruments; corrections supersede, never overwrite | Participant → Assessments | ✅ |
| Participant timeline across clinic and home with information-source badges | Participant → Timeline | ✅ |
| Approved family summaries (existing notes of kind `summary`) | Participant → Family; Family workspace | ✅ |
| Child mode: themes, text size, reduced motion, age bands, visual steps, break and stop, an adult closes the activity, participation counter and story path, last REAL measurement against the professional's target | `#/play/:id` | ✅ (usability 🔬) |
| **Live sensor feedback in child mode**: an adult connects the sensors (USB or Bluetooth; simulator only in the demo, labelled); calibration; live angle from the existing pipeline next to the professional's target line, highest-this-time marker, movements counted, "sensors OK" indicator. Display only: purpose `practice`, no crash-recovery copy, never stored as a session or shown as a measurement afterwards | Child mode → activity → "Sensors (grown-up)" | ✅ (🧪 not on hardware; usability 🔬) |
| Research readiness: studies with an ethics record, enrolment gating, consent and assent, withdrawal (stop collection or remove data), pseudonymised dataset (8 tables plus a dictionary), feasibility report in Markdown | Rehabilitation → Studies | ✅ |
| Caregiver accounts linked to specific children; server-side read and write scoping; **family-access screen** for admins (create account with a one-time password, link more children, revoke; revoked links kept) | Settings → Family access; participant Profile | ✅ |
| **ICF-CY tags**: goals carry professional-confirmed categories (suggested from the goal category until confirmed); every IMU metric tagged as body function (b710/b760); instruments by component (GAS per goal, COPM/GMFM activity and participation); codes in the research export | Goals, Movement, Assessments, Studies export | ✅ (code choice 👩‍⚕️) |
| Russian, Kazakh and English | All new screens | ✅ RU complete; KK complete for family, child and demo; professional KK falls back to RU |
| Demo workspace history (two invented children, program v1 → review → v2, reports, a reviewed pain incident, GAS) | Demo only, never synced | ✅ |
| **Summary for review**: built-in, no AI — numbered facts from the records, grouped, each with its information source and record links; copy into an editable clinical note | Participant → Review | ✅ |
| **Optional AI draft** (team server, staff only, operator opt-in): the same pseudonymous facts → Google Gemini (`GEMINI_MODEL`, default `gemini-2.5-flash`, JSON output; several keys used in turn) → every sentence cites fact ids; uncited, unknown-fact and diagnosing/prescribing/"improved" sentences are flagged and excluded from copying; nothing stored except an audit count | Participant → Review → "Draft with AI" | ✅ tested with a fake client; 🧪 not run against the live API here |

## 4. New database entities

One local store and one server table hold ten record kinds. A kind gets its own table only when it needs integrity rules that a JSON payload with typed columns cannot express, and none did.

| Kind | Mutable? | Rule |
|---|---|---|
| `profile` | yes | One per participant. Identity fields are fixed. |
| `goal` | yes | **History is append-only.** Caregivers may add only `family_input` entries. |
| `activity` | **no** | `act_x@N`. A change creates a new version. Drafts cannot be assigned. |
| `program` | **no** | `prg_x@N`, with `previousKey`, a `changeReason` (required from v2) and `basedOnReviewId`. Templates have no participant. |
| `practice` | **no** | A home or clinic occasion, or a free observation (`completion: null`). Only a professional entry may link a `sensorSessionId`. |
| `review` | **no** | Snapshot of the observations shown, the professional's responses, decision, reasoning, goal updates and acknowledged ids. Records the algorithm version. |
| `assessment` | **no** | Instrument, version, scoring method, examiner, date and timepoint. Corrections use `supersedes`. |
| `study` | yes | Cannot be `recruiting` or `active` without `ethics.approvedOn`. |
| `consent` | yes | Pseudonym, guardian permission with date and form version, child assent, export permission. **Can only move active → withdrawn.** |
| `incident` | yes | Category safety, deviation or technical. **`review` can be added once.** |

Existing records are reused: `Patient` is the participant, `Session` is the sensor measurement, `Note` covers clinical notes and approved family summaries (`kind: 'summary'`), and audit uses `nm_audit_events`.

Program modules, assignments and checkpoints live inside the immutable program version, which keeps them historically exact. Review suggestions are computed and then snapshotted into the review that read them. Consent records double as enrolment. Professional assignments are `profile.assignedProfessional` plus `program.responsible`.

## 5. Changes to the existing database

| Store | Change | Safety |
|---|---|---|
| IndexedDB v2 → **v3** | Adds the `rehab` store (indexes `workspace`, `kind`, `participantId`). `upgradeSchema` takes a target version. | Additive. Tested by building a real v2 database and upgrading it (`src/data/storage.test.ts`): trials and the outbox survive. |
| DataStorage API | `getMeta`; `removeResearch`, used only for re-seeding demo data | — |
| Sync contract | New entity `rehab_record`; the kind travels inside the payload | Existing entities unchanged |
| PostgreSQL **`0002_rehab`** | The role check gains `caregiver` (constraint replaced by a wider one); `nm_caregiver_links`; `nm_rehab_records` with a `kind` check, `participant_id` FK, unique `(series_id, version)`; trigger `nm_rehab_immutable` | No DROP TABLE/COLUMN/INDEX/TRIGGER and no TRUNCATE (test-enforced). Idempotent. |
| Roles | `admin`, `session_operator` = professional; `measurement_operator` = measurement entries and technical incidents; `observer` = read-only; **`caregiver`** = linked children only | `canWrite` and the per-record `canWriteRehab` |

## 6. Actual user workflows

1. **Professional sets up a child.** Rehabilitation → participant → Profile (domains, classifications as entered, child presentation) → Goals with the family (words, why it matters, baseline, target, measurement method) → Program from the A–E pathway or a template, assigning approved or experimental activities with the frequencies and minutes the professional chooses → Save v1.
2. **Family at home.** Family page (on the clinic tablet, or with a caregiver account on their own device) → activities with steps, the therapist's note and safety note → "Tell us how it went" (done, partly, not done or stopped, with optional barriers, fatigue, discomfort and minutes) → saved on the device → synced when a team account is on. Pain shows a stop message and opens a safety incident.
3. **Child practice.** Child mode → large activity cards → step by step, with Break and Stop always present → an adult answers "How did it go?" and "Did it hurt?" → the participation counter and story path grow. If a real measurement exists, it is shown next to the professional's target, with its date.
4. **Next clinic visit.** The dashboard puts safety first, then items for review, unreviewed reports and data-quality warnings. The participant's Family tab handles incident reviews, acknowledgements and family summaries. Movement shows metrics, quality, baseline and trend. The Review tab lists observations with their underlying data, the professional's response to each, a decision and the reasoning. If the decision is "modify", the program editor opens and the new version cites the review, while the old versions stay unchanged.
5. **Research pilot.** Studies: create a study, record the ethics approval, then set the status to recruiting. Enrol a participant with guardian permission, date, form version, assent and export permission; withdrawal is available. Export the pseudonymised dataset (JSON and CSV tables) and the study report.

## 7. Statistical and movement-analysis capabilities

Source: `src/rehab/movement.ts` (definitions, units, input, processing, limitations and validation status per metric, also shown in the app).

| Group | Metric | Status |
|---|---|---|
| Range | Max angle per repetition (ROM, median), min angle, excursion | ROM ✅ software-verified; min and excursion 🧪 (20 Hz trace) |
| Dynamics | Peak angular velocity, repetition duration, time to peak | velocity and duration ✅ software-verified; time to peak 🧪 |
| Quality | SPARC smoothness, CV of ROM (consistency), SD of ROM (variability), inter-repetition timing CV | CV and SD ✅; SPARC 🧪; timing 🧪 |
| Compensation | Trunk tilt | ✅ software-verified (tilt only) |
| Volume | Repetitions detected | ✅ (never a target) |
| Not computed | Angular acceleration | ⛔ The 20 Hz trace is too coarse; raw 100 Hz data is kept |

- **Quality gating.** A step is comparable only with signal ≥ 90 %, ≥ 3 repetitions, and no saturation, data gap, lost sensor, flipped mount or calibration movement. Simulated data is never eligible in the clinic.
- **Baseline.** Sessions designated by the professional. Without them, the first usable session is used and labelled provisional.
- **Noise check.** 2 × SE of the difference of repetition means. This is a heuristic, **not an MDC** 👩‍⚕️🔬.
- **Trend.** Least-squares slope per week over the last ≤ 6 usable sessions. Descriptive only.
- **Unusual repetitions.** Further than 3 × scaled MAD from the median.
- **GAS T-score.** Kiresuk–Sherman with ρ = 0.3.
- **COPM.** Means only, with no change threshold applied.

**Progress rules** (`src/rehab/progress.ts`, `RULES`, version `nm-progress 1.0`):
- `safety_unreviewed`, `data_quality_latest`, `assigned_not_completed`, `reported_fatigue_discomfort`, `repeated_barrier`
- `consistency_trend`, `range_vs_baseline`, `unusual_repetitions`, `baseline_not_designated`
- `goal_reassessment`, `imu_goal_without_measurement`, `review_due`, `assessment_interval`

Every threshold is documented in the app under Review → "All rules and thresholds". Every threshold is a design choice 👩‍⚕️ and still needs clinical review.

## 8. Security and privacy safeguards

- **Pseudonymity.** Participants are codes plus birth year. The rehab profile holds no names, contacts or national IDs.
- **Single validated write path.** The device and the server use the same validator, the same `canWriteRehab` policy and the same `checkTransition` integrity rules. The server never trusts the device.
- **Immutability in the database.** A trigger blocks any update to the payload of an activity, program, review, assessment or practice record, and any soft delete of them, including by direct SQL (tested).
- **Caregiver accounts.**
  - Only an admin creates them, and only with links to specific participants of the team. A staff account cannot be converted.
  - On push they may write only their linked child's reports, safety reports and family goal input.
  - On pull they receive only their child's participant record, goals, programs, profile, their own reports and incidents, non-draft activities and approved summaries. Everything else is withheld.
  - They are blocked from team, audit, raw and dataset endpoints. All of this is tested in `server/rehab.test.ts`.
- **Shared tablet.** Without a caregiver account, the family view on the professional's device is a UI boundary, not a security boundary. A family report uploaded by a staff account keeps `createdByRole: caregiver`; the audit log names the uploading account and device, and the report cannot be edited.
- **Team isolation, audit, CSRF header, rate limits.** Inherited from the existing server and tested.
- **Demo isolation.** Demo records never sync, and the server refuses them.
- **Research exports.**
  - Only participants with guardian permission and export allowed are included. "Remove data" withdrawals are excluded entirely; "stop collection" withdrawals keep data only up to the withdrawal date.
  - Pseudonyms replace codes. Dates become study days, ages become bands, ids become tokens, and free text is removed. The manifest states that the data is pseudonymised, not anonymous.
- **ICF levels kept apart.** IMU metrics are tagged b (body functions) and never presented as activity or participation outcomes.
- **AI summaries (optional).**
  - Off unless the server operator sets both `GEMINI_API_KEYS` (comma-separated; each request uses the next key, a rate-limited key is skipped) and `NEUROMOVE_AI_SUMMARIES=1`. Only admins and session operators can request a draft. Keys travel in a request header, never in a URL, and are never logged (the audit stores only the key's position).
  - The request holds only the facts built on the device: no participant code, names, record ids or family free text. Goal wording is included only when the professional ticks it.
  - The server checks the facts payload and the draft (citations, wording), rate-limits to 20 per hour per user, stores no content and audits only counts and the model.
  - The draft is never sent to families and never saved unless the professional edits it into a note.
- **Clinical safety in the UI.** Stop and Break on every child screen. "Never continue through pain" on the family page. Pain produces a safety incident that is listed first.

## 9. Tests executed (8 November 2026)

| Suite | Result |
|---|---|
| `npm test` (Vitest: unit, integration, PGlite server) | **374 / 374 passed** (30 files), including `src/rehab/rehab.test.ts` (28), `src/rehab/extensions.test.ts` (11: ICF, family-access helpers, summary grounding and privacy, practice runs never recovered), `src/rehab/rehab-i18n.node.test.ts` (5), `server/rehab.test.ts` (4), `server/rehab-store.test.ts` (1), `server/ai-and-access.test.ts` (8: Gemini route with a fake fetch — key rotation, skipping rate-limited keys, no keys in URLs or logs — and the family-access client against the API) and the v2 → v3 storage test. One earlier run showed a single failure that did not reproduce in two further full runs. |
| `npm run typecheck` (`tsc -b`: app, node, server) | passed |
| `npm run lint` | passed |
| `npm run build` | passed |
| `npm run check:api` | `api/index.js` up to date |
| Playwright, full suite (desktop + mobile, built site with production CSP) | **43 / 43 passed**, including `e2e/rehab.spec.ts` (4: home-to-clinic workflow, child mode, live sensor feedback with the simulator, ICF/family access/summary) and `e2e/layout-a11y.spec.ts`, which now also covers the dashboard, participant tabs, activity library, family page and child mode: no horizontal scroll from 320 to 1440 px in RU/KK/EN, and axe WCAG 2.1 AA / 2.2 AA with no serious or critical issues |

Two problems were found and fixed during testing:
1. The new stylesheet reused generic class names (`goal`, `history`, `report` …) that also exist on other pages, and it broke the session report table. All rehab classes now carry an `rh-` prefix.
2. The evidence disclosure links were below the WCAG 2.2 target size.

Acceptance criteria and where they are tested:

| # | Criterion | Test |
|---|---|---|
| 1 | Creating a participant | `server/rehab-store.test.ts` |
| 2 | Defining goals | `rehab.test.ts` §1–2; e2e |
| 3–4 | Creating a program and saving a new version | `rehab.test.ts` §3–5; store test; e2e |
| 5 | Assigning activities | `rehab.test.ts` (draft refused, approved accepted) |
| 6–7 | Home completion, caregiver observations | `rehab.test.ts` §6–7; store test; e2e |
| 8 | Reopening the application | store test (new IndexedDB connection); e2e reload |
| 9 | Syncing offline changes | store test (outbox → in-process server) |
| 10 | Participant timeline | `rehab.test.ts` §10–11; e2e |
| 11 | Baseline vs follow-up | `rehab.test.ts` |
| 12–13 | Reviewing a suggestion, recording a decision | `rehab.test.ts` §12–13; e2e |
| 14 | Pseudonymised export | `rehab.test.ts` §14 |
| 15 | Permissions | `rehab.test.ts` §15; `server/rehab.test.ts` |
| — | No program changed without authorisation | caregiver and observer refused (unit, store, server) |
| — | No automatic progression | engine output keys fixed; inputs unchanged (unit) |
| — | No fake measurement shown as real | simulated or poor sessions ineligible; caregivers cannot link sessions (validator); child mode labels the source |
| — | No unsupported metric shown as validated | metric registry test; UI labels |
| — | No unauthorised child access | caregiver pull filter (server test) |
| — | History intact | immutability trigger, goal history, consent and incident transitions |

## 10. Incomplete components

- 🧪 **Live sensor feedback** has been tested with the simulator only, never with the physical sensors on a child. It is display only: a practice run is not saved, so a "measured" home session still needs the professional test flow.
- 🧪 **AI drafts** are tested against a fake client; no request was sent to the Gemini API from this environment. Password reset for family accounts is not built (an admin can revoke the account and create a new one).
- ⛔ **Granular per-family sensor opt-out.** Families can already use programs without sensors, but there is no explicit consent field for it.
- ⛔ **Server-side dataset registry for rehab exports.** Validation exports register at `/api/datasets`; rehab study exports stay local.
- ⛔ **Professional screens in Kazakh** (they fall back to Russian); native review of all Kazakh text.
- ⛔ **Reminder notifications.** Deliberately not built; they need a non-punitive design with families.
- 🧪 **Conflict resolution for mutable rehab records** (goal, profile, study, consent, incident) uses the existing park-and-choose UI. Two devices appending goal history at once produce a conflict that the operator resolves; there is no automatic merge.

## 11. Remaining production configuration

- Run migration `0002_rehab`: `DATABASE_URL=… npm run db:migrate`. `/api/health` lists pending migrations.
- Create family accounts in Settings → Family access (admin, clinic workspace, sync on). Give the one-time password to the family in person.
- Optional AI drafts: set `GEMINI_API_KEYS=key1,key2,…` and `NEUROMOVE_AI_SUMMARIES=1` (optionally `GEMINI_MODEL`) on the server. Use a paid Gemini API project under Google's data-processing terms; on the free tier Google may use requests to improve its products. `/api/health` reports `aiSummaries`. The round-robin counter lives in each server instance, so with several instances the order is per instance.
- Agree the data-management plan for exports and the retention period, which is not automated yet.
- Set up institutional incident reporting. NeuroMove records incidents but does not replace the institution's procedure; the UI says so.
- The settings already in place for sync remain unchanged: `NEUROMOVE_SETUP_CODE`, optional Upstash, HTTPS only.

## 12. What rehabilitation professionals must validate

- 👩‍⚕️ **Activity library content.** Every demo activity is an invented example and must be reviewed before clinical use.
- 👩‍⚕️ **Rule thresholds.** 14-day window, 50 % of planned, 2 reports, 3 percentage points of CV, 2 × SE, 3 × MAD, 56 days and 16 weeks are design choices, not clinical standards.
- 👩‍⚕️ **Wording of observations, family texts and child texts in all three languages**, especially Kazakh.
- 👩‍⚕️ **Child-mode presentation** for different ages and abilities, and the reward mechanics.
- 👩‍⚕️ **Choice and entry of instruments.** GAS level definitions; COPM administration; whether GMFM is appropriate for each child.
- 👩‍⚕️ **The safety workflow** against the institution's adverse-event procedure.

## 13. What a supervised pilot study must evaluate

See [the pilot framework](NEUROMOVE_PILOT_EVALUATION_FRAMEWORK.md). In short:
- **Feasibility.** Recruitment, retention, session completion, technical failures, data completeness.
- **Usability.** Professionals, caregivers and children.
- **Engagement.** Assigned vs reported practice, participation over time, barriers.
- **Measurement quality.** Sensor reliability, missing data, agreement with goniometry, test–retest SEM and MDC per protocol.
- **Longitudinal observation.** Individual goal attainment and instrument change.

No efficacy claim is possible from this platform without a properly designed controlled study.
