# Ethics and data governance of the research engines

What the research-frontier engines may and may not do, how they handle data, and what must exist outside the software before any of them is used with children.

This is an engineering statement about the code. It is not legal advice and not an ethics approval. Where it refers to law or guidance it says exactly what was read.

## 1. What the software never does

These are properties of the code, checked in tests or visible in the interface:

| Never | How it is enforced |
|---|---|
| Diagnose, grade severity, or name a cause | verdict vocabularies are fixed lists of neutral terms (`beyond_noise`, `change_signalled`, `practice_like` …); a genuine change is "what remains", cause unidentified; report tests reject the words "recovery has occurred" and "diagnos…" |
| Select, recommend or change treatment | no engine writes to a programme, goal or activity; the planning module answers only "which measurement would reduce an uncertainty"; hypothetical scenarios are labelled hypothetical and are "never recommendations" |
| Claim neural recovery or anything about the nervous system | brain activity, corticospinal integrity, neural activation and muscle activity are registry entries with status `not_observable`; no estimate is produced |
| Clear a child for activity or encourage continuing through pain | no engine produces a safety statement; the existing stop, discomfort and incident mechanisms are untouched |
| Call trunk movement or variability good or bad | profile, trade-off and flexibility texts state it; "performance-up" orders an axis only |
| Present a prediction as a prognosis | every prediction record carries its limitations and can be refused; maturity level 4 is never met by software evidence |
| Present synthetic data as evidence about people | synthetic participants are named `SYN-…`; every synthetic result is labelled; simulated content is refused in the clinic workspace (`evidenceAllowed`, `mixed_provenance`); the hypothesis registry counts only non-simulated sessions |
| Invent approval, consent or supervision | see §3 |

Every research-frontier page opens with: *research tool — not clinical decision support*.

## 2. Data

**Local first.** All new analyses run in the browser, on the device. No new network call was added; the site's content security policy (`connect-src 'self'`) is unchanged. The new engines send nothing to any external service — in particular no participant data to any AI service. (The optional staff-only AI summary that existed before is off unless the operator opts in and was not touched.)

**No new identifiers.** The engines read existing sessions, practice sittings and frozen runs. They store only evidence records (twin snapshot, report, strategy atlas), which are sealed, insert-only, kept in the device's own database, and **never synced or uploaded**.

**Pseudonymised exports.** The report download replaces the participant identifier and every session identifier by run-local pseudonyms, also inside evidence references, and replaces session dates by study days. A test checks that neither identifiers nor dates remain, and an end-to-end test checks the downloaded file. Small samples can still be re-identifiable; the export says so.

**Minimal data.** Nothing new is collected from a child. Raw frames of practice sittings are kept only under a recorded consent, as before.

**No rewriting of history.** Raw measurements, sessions and frozen runs are never modified. Derived records name the engine version that produced them; a later engine version does not overwrite them.

**Demonstration data.** Generated datasets contain no real names, identifiers or medical data. (The demo workspace that existed before uses fictional first names for its simulated children.)

**Telemetry.** The research engines produce none.

## 3. What must exist outside the software

The application has records for a study's ethics reference, for consent and for incidents (`rehab/model.ts`): the committee, reference and approval date of a study are typed in by a person; a consent record holds the legal representative's permission, the child's assent (`obtained`, `not_applicable`, `declined`, `not_yet`), whether export is allowed, and withdrawal with its scope (`stop_collection`, `remove_data`); an incident record holds pain, discomfort, fatigue, a stopped session and other events, and is reviewed once by a professional.

The software stores what it is told. It does not verify that an approval exists, does not generate one, and does not infer consent. An empty field stays empty. The hypothesis registry states in its rules that testing any hypothesis on children requires a documented positive ethics decision, consent and assent; the software has no way of marking this as met, and does not.

Before any protocol of [EXPERIMENTAL_PROTOCOLS.md](EXPERIMENTAL_PROTOCOLS.md) is run with children, a person responsible for the study must have, on paper:

1. a documented **positive decision of a bioethics commission** for that protocol;
2. **written informed consent of the legal representative** and the **child's assent** in a form the child can understand, with the right to stop at any time and to withdraw;
3. **clinical supervision** by a qualified professional during every session;
4. a plan for incidental findings, for pain or distress during a session, and for data access, retention and deletion.

## 4. Kazakhstan: what was read

Articles 227 and 228 of the Code of the Republic of Kazakhstan "On public health and the healthcare system" were read on 10 November 2026 in the Russian text at kodeksy-kz.com, where they were marked as checked on 31.10.2026 (`kz_health_code`). The official database (adilet.zan.kz) refused automated access, so **the wording and paragraph numbers below must be checked against the official text** before they are relied on:

- biomedical research requires a positive conclusion of a bioethics commission (Art. 227);
- for minors, written informed consent of the legal representative is required (Art. 227);
- research with minors is permitted only when it cannot be done on other persons and a direct benefit is expected (Art. 227) — a condition that the purely observational, sensor-only designs here have to be assessed against by the commission, not by this document;
- the research stops at the participant's (or representative's) request (Art. 227);
- local bioethics commissions act under a certificate of the Central commission, and multi-centre research goes to the Central commission (Art. 228).

Nothing here is an interpretation of how the Code applies to a specific study. That is the commission's decision.

## 5. Other guidance: what was and was not read

| Source | What was checked | What was not |
|---|---|---|
| ICH E6(R3) Good Clinical Practice (`ich_e6r3`) | its status and dates only | the text |
| FDA Clinical Decision Support Software guidance, final January 2026 (`fda_cds2026`) | existence and date only | the document and its criteria — **no statement about how NeuroMove would be classified is made anywhere** |
| TRIPOD+AI (`collins2024`) | bibliographic record only | the statement and its checklist; the prediction records report what such guidance asks for in general terms, and no item-by-item audit was made |
| COSMIN view of reliability and measurement error (`mokkink2026`) | bibliographic record | the full text |

NeuroMove is a research prototype. It has not been assessed as a medical device or as clinical decision support software in any jurisdiction, and this work does not change that.

## 6. Risks that remain

- **Over-reading.** A chart of a rising metric invites the conclusion "the child is recovering". The interface counters this with labels, refusals and explicit alternatives, but a label does not stop a determined reader. Training of the people who use the pages is part of any study.
- **Re-identification.** Movement data of a few children in one clinic can be re-identifying even without names. Exports should stay inside the approved study.
- **Burden on the child.** Several analyses need 24 or more repetitions in one sitting. A protocol must weigh this; the software analyses a short sitting as what it is and never asks for more.
- **Synthetic confidence.** Every validation result so far is from simulation. Good numbers on simulated data can make a tool look more ready than it is; the benchmark page and every document state this.
- **Kazakh interface text** of the new pages was written without native-speaker review and must be checked before use with families or in publications.
