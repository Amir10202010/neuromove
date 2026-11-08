# NeuroMove pilot evaluation framework

Status: a framework for planning a **supervised feasibility study**. It is not a protocol, and it does not replace one. Date: 8 November 2026.

> Before any data is collected from children, the study needs:
> - approval from an institutional ethics committee,
> - written permission from a parent or guardian,
> - the child's assent where applicable,
> - a data-management plan.
>
> NeuroMove records these. It does not grant them, and it blocks enrolment until they are on record (Studies page).
> This framework assumes no efficacy. Negative, neutral and positive findings are all reported.

Related documents: [Architecture](NEUROMOVE_PEDIATRIC_REHABILITATION_ARCHITECTURE.md) · [Evidence map](NEUROMOVE_PEDIATRIC_REHABILITATION_EVIDENCE_MAP.md) · [Statistics of the validation module](research/STATISTICS.md)

## 1. Questions a first pilot can answer

1. Can a clinic team and families use the Functional Progression workflow for one program block (for example 8 weeks) as intended? This covers goals, program, home logging, review and a new version.
2. Is the three-IMU upper-limb measurement reliable enough, in this setting and age group, to describe within-child change? What are its agreement with goniometry and its test–retest error?
3. What gets in the way: technical failures, burden, unclear instructions, fatigue?

A pilot of this kind **cannot** show that NeuroMove improves function. Efficacy would need a controlled trial designed for it.

## 2. Suggested design (to be adapted by the study team)

| Element | Suggestion |
|---|---|
| Design | Single-arm, prospective, mixed-methods feasibility study |
| Setting | One rehabilitation centre plus participants' homes |
| Participants | Children who already receive upper-limb rehabilitation, selected by the treating professionals with inclusion and exclusion criteria set in the protocol. NeuroMove does not determine eligibility. |
| Sample | Justified for feasibility (precision of completion and retention proportions), not for effect size |
| Duration | One program block as the professionals plan it, plus a follow-up assessment |
| Intervention | Usual care, documented in NeuroMove. Content, dose and progression are decided by the professionals. |
| Comparators | None. Within-child description only. |

## 3. Evaluation domains, measures and NeuroMove data sources

The **NeuroMove export** column refers to the pseudonymised study dataset (Studies page → Dataset), with tables `participants`, `goals`, `programs`, `practice`, `movement`, `assessments`, `incidents` and `reviews`. Columns are defined in its dictionary.

### 3.1 Feasibility

| Measure | Definition | NeuroMove export |
|---|---|---|
| Recruitment | Approached, eligible, enrolled; reasons for non-enrolment | `participants` (enrolled only); screening log kept outside the app |
| Retention | Completed follow-up / enrolled; withdrawals with study day | `participants.consent_status`, `withdrawn_day` |
| Clinic session completion | Sensor sessions with all steps done / planned | `movement` (`issues` contains `skipped`); planned from `programs` |
| Technical failure frequency | Technical incidents per sensor session; sessions with blocking quality issues | `incidents` (category `technical`), `movement.issues` |
| Data completeness | Steps passing quality checks / steps recorded; baseline and follow-up assessments present | `movement.eligible`; `assessments.timepoint` |

### 3.2 Usability

| Measure | How |
|---|---|
| Professional experience | A standard usability questionnaire chosen in the protocol, plus a structured interview after the block |
| Caregiver experience | A questionnaire in Russian or Kazakh, plus an interview. Ask specifically whether logging was burdensome and whether "not done" felt neutral. |
| Child-facing usability | Age-appropriate observation of child mode (task completion, help needed, signs of frustration), with assent |
| Time burden | Professional minutes per participant per week (self-report) |

The app does not collect questionnaires. Record them in the study's data system and link them by pseudonym.

### 3.3 Engagement

| Measure | Definition | NeuroMove export |
|---|---|---|
| Assigned vs reported practice | Reports done or partly done ÷ planned occasions (Σ frequency × weeks, as the professional set it) | `practice`, `programs` |
| Participation over time | Reports per study week | report section "Engagement" |
| Barriers | Frequency of each reported barrier | `practice.barriers` |
| Child-mode use | Reports with `source = child_mode` | `practice.source` |

Reported practice is **not** measured practice. Missing reports are not evidence that no practice took place. Report both the numerator and the denominator.

### 3.4 Measurement quality

| Measure | How | Tooling |
|---|---|---|
| Agreement with a reference | Paired goniometer readings per protocol: bias, limits of agreement (repeated-measures Bland–Altman), ICC | Research → validation sessions and datasets (existing module) |
| Test–retest reliability | Two sessions within a short interval with no intended change: ICC, SEM, MDC95 per movement | Existing statistics module (SEM/MDC) |
| Missing data | Share of steps failing quality checks, by reason | `movement.issues`, `signal_percent` |
| Sensor reliability | Technical incidents, saturations, lost sensors | `incidents`, `movement.issues` |

Until these exist for this population, the movement analytics stay labelled "not clinically validated", and the baseline noise check stays a heuristic. Once an MDC is available for a protocol, the professional team can decide whether and how it replaces the heuristic. That change is a software version change and is documented.

### 3.5 Longitudinal observation (individual, descriptive)

| Measure | How | NeuroMove export |
|---|---|---|
| Goal attainment | GAS levels at baseline and follow-up; T-score as a descriptive summary | `assessments` (GAS items, `derived:gas_t_score`) |
| Occupational performance | COPM performance and satisfaction, if the professionals choose it | `assessments` |
| Gross motor function | GMFM-66 or GMFM-88 total as produced by the official scoring, if appropriate | `assessments` |
| IMU-derived change | Within-child difference from the designated baseline per movement and metric, with its quality status | `movement` |
| Program adherence | As in 3.3 | `practice` |

Rules:
- Never combine instrument, IMU and reported data into one score.
- Present individual trajectories. Group statistics are descriptive, with confidence intervals for feasibility proportions only.

## 4. Safety monitoring

- **Recording.** Every pain report and every stopped session creates a safety incident for professional review. The dashboard lists unreviewed incidents first.
- **Classification and reporting.** The study protocol defines adverse events and reporting timelines. Record them in the institution's system as well; NeuroMove's incident record does not replace that.
- **Reporting in results.** Report the number of safety incidents, their types, time to professional review, and actions taken (`incidents`, review outcome).
- **Stopping rules.** Set in the protocol by the study team, not by the software.

## 5. Protocol deviations

Record deviations as incidents with category `deviation`, for example a missed assessment window, a wrong protocol version, or an assessment by a different examiner. They appear in the export and the study report.

## 6. Data handling

- Use the clinic workspace with team sync when the study needs central data. Each person needs an individual account: professionals as staff roles, families as caregiver accounts linked to their child only.
- Exports are pseudonymised, not anonymous:
  - Keep the code ↔ pseudonym key at the centre, outside NeuroMove.
  - Store exports according to the data-management plan.
  - With small samples, check for re-identification risk before sharing.
- Withdrawal choices:
  - "Stop collection": data up to the withdrawal date stays in exports.
  - "Remove data": the participant is excluded from every export.
  - The protocol and the consent form must describe these choices in the same terms.
- Retention periods are not automated. Implement the plan's retention manually.

## 7. Analysis and reporting checklist

- [ ] Flow diagram: approached → eligible → enrolled → completed, with reasons
- [ ] Feasibility proportions with 95 % confidence intervals
- [ ] Usability results (scores, plus themes from interviews)
- [ ] Engagement: planned vs reported, per week, barriers
- [ ] Measurement quality: agreement, test–retest SEM and MDC, missing data
- [ ] Individual goal-attainment and instrument trajectories (descriptive)
- [ ] IMU trajectories with quality status, and explicitly no functional interpretation
- [ ] Safety incidents and deviations
- [ ] Software version, algorithm versions (`ALGORITHM_VERSION`, `nm-progress` rule version) and protocol versions used
- [ ] **Negative and neutral findings**, problems and lessons learned
- [ ] What would have to change before a larger or controlled study

The study report generated by NeuroMove (Studies → Study report) fills in the descriptive feasibility, engagement, quality, safety and goal sections and leaves the interpretation to the research team.
