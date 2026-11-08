# NeuroMove: pediatric rehabilitation evidence map

Status: working research document, single reviewer. Date of searches: 2026-11-08.
Audience: the NeuroMove software and research team, and the clinicians we ask to review our work.

NeuroMove is an experimental measurement and documentation platform. It is not a therapy and it does not
diagnose, prescribe, or set intensity. This document asks a narrower question: given what the pediatric
rehabilitation literature supports, which parts of a clinician's workflow can software and a three-IMU
arm sensor *document* or *measure*, and which claims must the product never make?

Reference numbers in square brackets point to section 6. Each reference carries a verification marker.

---

## 1. Purpose, scope and method

### 1.1 Purpose

1. Map the main evidence-supported approaches in pediatric upper-limb rehabilitation, mainly for
   children with cerebral palsy (CP), the best-studied population.
2. For each approach, state what it needs from technology and from measurement.
3. State honestly where NeuroMove can help (documentation, structured data, an experimental kinematic
   adjunct) and where it cannot.
4. Turn that into concrete design rules for the software being built now.

### 1.2 What NeuroMove can and cannot measure (fixed for this document)

- **Hardware (frozen).** One ESP32 and three MPU-6050 IMUs (accelerometer and gyroscope, no magnetometer)
  at 100 Hz. They are worn on the trunk, upper arm and forearm of one arm, or a single module is used alone.
- **Operational measures.** Upper-arm elevation from a calibrated hanging pose. This is labelled shoulder
  flexion or abduction, but the plane is set by the protocol and the sensor does not verify it. Elbow
  flexion and extension are also operational.
- **Experimental measures.** Forearm rotation, valid only with the forearm horizontal, and trunk
  inclination, used as a compensation indicator.
- **Per-repetition outputs.** Range of motion (ROM), peak angular velocity, repetition duration, SPARC
  smoothness, trunk tilt, and the coefficient of variation (CV) of ROM across repetitions.
- **Not measured.** Hand and finger function, grip, object manipulation, the quality of bimanual use,
  real-world arm use over a day, and gait. Heading (yaw) drifts because there is no magnetometer.
- **Validation status.** A goniometer-agreement module exists (Bland–Altman, ICC, SEM/MDC). **No
  clinical validation study in children has been done.** Every NeuroMove number is therefore a research
  measurement, not a clinical one.

### 1.3 Method

- **Sources searched.** Europe PMC REST API (MEDLINE-indexed records with abstracts), general web search,
  and direct DOI or PubMed lookups. Several publisher sites (Wiley, BMJ) blocked automated access, so
  most abstracts were read through Europe PMC records.
- **Starting points.** The four required references, then the topics listed in section 3, with
  preference for guidelines, Cochrane and other systematic reviews, landmark RCTs, and the original
  papers for each measurement framework.
- **Verification rule.** A reference is marked **[verified]** only when its DOI resolved to a record
  whose title, authors, year and journal matched, and whose abstract (or, for frameworks, an official
  source) was read. **[metadata only]** means the bibliographic record was confirmed but no abstract was
  available. Anything not confirmed is listed under "Unverified / to check" and is not cited as fact.
- **Certainty wording.** Effect sizes and GRADE certainty are reported only when the abstract stated them.

### 1.4 Limitations of this review

- **Not systematic.** One reviewer, no protocol, no duplicate screening, no risk-of-bias assessment by us.
  Selection bias is likely.
- **Abstract-level reading.** Most sources were read at abstract level. Full-text details such as
  per-recommendation GRADE strength in the 2022 guideline [1] were not verified.
- **English only, CP-centric.** Evidence for other pediatric neuromotor conditions is thinner and is
  generalised only with caution.
- **Fast-moving field.** Several 2025–2026 papers were included, and the newest ones have not yet been
  scrutinised by the field.

### 1.5 Corrections to the starting references

| Starting reference | What it actually is |
|---|---|
| doi 10.1111/dmcn.15055 | As expected: Jackman et al., international clinical practice guideline, DMCN 2022;64(5):536–549 [1]. |
| doi 10.1111/dmcn.16149 | An indexed DMCN item (2024;66(12):e250) with the same title as the Sudati et al. review but **no authors and no abstract** in PubMed or Europe PMC. It is probably a companion e-page such as a translated abstract; we could not confirm which. The substantive review is **Sudati et al., DMCN 2024;66(12):1542–1557, doi 10.1111/dmcn.16040** [2], and that is what we cite. |
| doi 10.1136/bmjopen-2025-115511 | A **completed scoping review**, not a protocol: Amponsah et al., BMJ Open 2026;16(8):e115511 [3]. |
| PMID 41281567 | A scoping review in **Frontiers in Neurology** 2025 (Burchfield et al.), doi 10.3389/fneur.2025.1663596 [4], not a DMCN paper. |

---

## 2. Summary table

Evidence categories: **Established** means a guideline or several systematic reviews of RCTs support it,
though the certainty can still be low. **Supported, low certainty** means RCT or review evidence exists
but is rated low or very low. **Framework** means a measurement or practice framework rather than an
intervention. **Emerging** means mostly feasibility work or heterogeneous small trials.

NeuroMove support levels:
- **D:** documentation and workflow only.
- **D+K:** documentation plus an experimental kinematic adjunct.
- **K-limited:** the kinematic adjunct covers only a narrow part of what the approach needs.
- **None:** NeuroMove offers nothing meaningful.

| # | Approach | Evidence category | Target population | Intended outcome | NeuroMove support |
|---|---|---|---|---|---|
| 3.1 | Goal-directed rehabilitation | Established (guideline principle) [1]; the effect of goal setting itself is unclear [11] | Children with CP, all ages and levels | Attainment of child- and family-chosen activity goals | **D**: goal records, GAS entry |
| 3.2 | Task-specific / whole-task motor training | Established [1][5][6] | CP; hand, mobility and self-care goals | Better performance of the practised real-life task | **D**; K-limited for arm-movement components |
| 3.3 | Pediatric motor learning principles | Framework / mechanistic [29][30] | All pediatric neuromotor conditions | Retention and transfer of skills | **D** (practice structure); K-limited |
| 3.4 | CP rehabilitation overall (guideline) | Established [1][5][6] | CP | Physical function and participation | **D** |
| 3.5 | Upper-limb rehabilitation (unilateral CP) | Established, modest effects [7][8] | Unilateral CP | Hand and arm use in daily life | **D**; K-limited (proximal arm only) |
| 3.6 | Bimanual training (HABIT, HABIT-ILE) vs CIMT | Both established; similar at matched dose, low to very low certainty [7][8][9] | Unilateral CP (CIMT, HABIT); bilateral CP (HABIT-ILE) | Bimanual performance, goals | **D**; cannot measure bimanual quality |
| 3.7 | Home-based rehabilitation / home programs | Supported (RCT [20]; reviews [7]) | CP, school age | Goal attainment, added practice dose | **D**: logging; K-limited |
| 3.8 | Family-centred rehabilitation | Framework, observational evidence [19][23][24] | Children with disabilities and their families | Family satisfaction, engagement, partnership | **D**: design principle |
| 3.9 | Digital rehabilitation (telerehab, web programs) | Emerging, low certainty [3][26][27][28] | CP, mostly unilateral | Upper-limb and gross motor function | **D**; the platform itself belongs here |
| 3.10 | Wearable motion tracking | Emerging (measurement) [4][39][40][41][42] | CP and other conditions | Objective measurement of movement or use | **K**: core of NeuroMove, unvalidated in children |
| 3.11 | Movement-quality assessment (smoothness, variability, compensation) | Emerging (measurement) [36][37][38][43][44] | Hemiplegic CP, other neuromotor conditions | Describing *how* a movement is done | **K**: SPARC, CV, trunk tilt (experimental) |
| 3.12 | Rehabilitation adherence | Observational; one small RCT on a digital tool [24][25] | Parents and children with CP | Programme completion | **D**: neutral logging |
| 3.13 | Longitudinal outcome measurement (GAS, COPM, GMFM, ICF) | Framework, established instruments [12]–[18][48][49] | Pediatric rehabilitation | Valid, interpretable change over time | **D**: clinician-entered scores |
| 3.14 | Gamified rehabilitation / VR | Supported, low to very low certainty [31][32][33][34] | CP, mostly school age | Motor function, motivation | **D**: participation-based child mode only |
| 3.15 | Clinician-supervised adaptive rehabilitation | Emerging; little direct evidence | CP | Individualised progression | **D**: rule-based flags for review only |

---

## 3. Approach-by-approach evidence

Each subsection uses the same eight headings.

### 3.1 Goal-directed rehabilitation

- **Principle.** Therapy is organised around specific goals in everyday activities, chosen by the child
  and family. Practice targets those goals directly.
- **Population.** Children with CP across ages and GMFCS/MACS levels [1][50].
- **Intended outcome.** Attainment of the chosen goals, usually measured with GAS or COPM, plus transfer
  to daily life.
- **Evidence.**
  - The 2022 international guideline (GRADE methods, 13 recommendations) says interventions to improve
    function should include client-chosen goals and whole-task practice in real-life settings [1].
    Per-recommendation strength and certainty were not verified at abstract level.
  - In a 12-week study of 44 preschool children, goal-directed therapy beat activity-focused therapy on
    PEDI and GMFM-66 (except social function) [10]. Children were randomised into the two groups;
    design limitations apply.
  - A 2013 systematic review (13 articles, 6 RCTs) found no support for an effect of goal setting *per se*
    and called for trials that isolate it [11].
  - Reading: goal-directed, activity-based therapy is well supported as a package. Whether the goal-setting
    step alone drives benefit is unresolved.
- **Technology requirements.** Structured, versioned goal records, linked to the practice plan and to
  repeated attainment ratings.
- **Measurement requirements.** Goal-referenced, individualised outcomes (GAS [12][15], COPM [16]),
  rated by people. Kinematics cannot judge whether an everyday task goal was met.
- **Limitations.** GAS scaling quality depends on the person writing the scale [13][14]. Goals vary widely,
  which makes pooling hard.
- **How NeuroMove could support it.**
  - Clinician-owned goals with GAS levels written before intervention (Krasny-Pacini suggests baseline at
    −2 and describing all five levels [14]).
  - Link each activity in a program to the goal it serves.
  - Store ratings with rater identity and date.
  - Optional: tag an IMU measure as *descriptive context* for a goal involving reaching or elevation.
- **What NeuroMove cannot do.** Judge goal attainment from sensor data. Propose or rank goals.

### 3.2 Task-specific / whole-task motor training

- **Principle.** Practise the actual functional task, or meaningful parts of it, in context, with enough
  repetitions, rather than training underlying impairments in isolation.
- **Population.** CP, for hand-use, mobility, self-care and leisure goals [1].
- **Intended outcome.** Better performance of the trained task. Transfer to untrained tasks is less certain.
- **Evidence.**
  - The guideline names whole-task practice as a core component across goal types [1].
  - Novak's 2013 overview of systematic reviews rated outcomes across 64 interventions: 16% green
    ("do it"), 58% yellow-probably-do, 20% yellow-probably-don't, 6% red [5]. The 2019 update lists
    task-specific and bimanual training, CIMT and others as effective allied-health interventions [6].
  - For mobility, Sudati et al. (46 RCTs, 1,449 children) found that intensive task-oriented training
    improved walking speed, cadence, gross motor function and functional mobility. **The threshold dose
    could not be determined** because the studies were too heterogeneous [2].
- **Technology requirements.** Defining activities, recording what was practised and how much (dose),
  and supporting progression decisions made by the therapist.
- **Measurement requirements.** Task performance measures: timed tasks, standardised activity measures,
  GAS or COPM.
- **Limitations.** Dose–response is unresolved [2]. "More practice" is not an established universal rule.
- **How NeuroMove could support it.**
  - Activity libraries and versioned programs.
  - Dose recorded as *delivered*: sessions, minutes, and repetitions where the IMU counts them.
  - For tasks with a reaching or elevation component, per-repetition kinematics as descriptive data.
- **What NeuroMove cannot do.** Measure task success, object handling or hand use. Set or escalate dose.

### 3.3 Pediatric motor learning principles

- **Principle.** Skill acquisition depends on practice structure (amount, variability, distribution),
  instruction, and feedback (type, frequency, timing). Experience-dependent plasticity principles such as
  specificity, repetition, intensity and salience give a mechanistic rationale [30].
- **Population.** Children with neuromotor conditions, including CP and acquired brain injury.
- **Intended outcome.** Retention and transfer, not just performance within a session.
- **Evidence.**
  - Kleim & Jones review ten plasticity principles. Their evidence comes mostly from animal and
    adult-learning research, and they note gaps before clinical translation [30]. This is mechanistic
    support, not clinical-effect evidence.
  - A scoping review found that instruction, practice and feedback strategies are applied within several
    functional pediatric approaches, but are often poorly reported [29].
- **Technology requirements.** Ways to vary and record practice structure. Any feedback timing has to be
  configurable by the clinician.
- **Measurement requirements.** Retention and transfer tests separated from practice sessions.
- **Limitations.** Strategies have mostly been extrapolated from adult or typically developing samples.
  The optimal feedback schedule for children with CP is not established.
- **How NeuroMove could support it.**
  - Record practice structure (which activities, in what order, how many) so it can be reported.
  - Separate *assessment sessions* from *practice sessions* in the data model, so practice-session numbers
    are never read as learning.
  - Make any kinematic feedback to the child optional and clinician-configured, with "off" as the default.
- **What NeuroMove cannot do.** Claim that its feedback improves learning. That has not been studied.

### 3.4 CP rehabilitation overall (clinical practice guideline)

- **Principle.** Function-focused, goal-directed, whole-task practice in real-life settings, with family
  empowerment and a team approach. Specific methods are chosen by goal type, age, ability and preference [1].
- **Population.** Children and young people with CP.
- **Intended outcome.** Improved physical function in walking, hand use, self-care and leisure [1].
- **Evidence by goal type** [1]:
  - Walking: overground walking, which can be supplemented with treadmill training.
  - Hand use: bimanual therapy, CIMT, goal-directed training, or cognitive approaches.
  - Self-care: whole-task practice plus assistive devices.
  - Leisure: whole-task practice plus addressing environmental, personal and social barriers.
  - The broader state-of-evidence reviews [5][6] place many allied-health interventions at moderate or
    low certainty and advise pairing yellow-light interventions with a sensitive outcome measure to
    monitor progress [5].
- **Technology requirements.** Support for an individualised, team-delivered, family-involved process.
- **Measurement requirements.** Goal-referenced plus standardised activity and participation measures.
- **Limitations.** At abstract level, the guideline does not give per-recommendation strength. Most
  primary trials are small.
- **How NeuroMove could support it.** Help the team document the process the guideline describes: goals,
  programs, home practice, and standardised results. NeuroMove's sensor covers only one component, the
  proximal arm kinematics.
- **What NeuroMove cannot do.** Choose between guideline options for a child.

### 3.5 Upper-limb rehabilitation (mainly unilateral CP)

- **Principle.** Intensive, activity-based, goal-directed practice of upper-limb tasks.
- **Population.** Mainly unilateral (hemiplegic) CP. MACS describes typical manual ability [50].
- **Intended outcome.** Hand and arm use in daily activities, bimanual performance, and goal attainment.
- **Evidence.**
  - A meta-analysis of 42 studies (1,454 children) found intensive activity-based, goal-directed
    approaches (CIMT, bimanual training) modestly more effective than standard care. It found little
    evidence for block therapy alone, and strong evidence that goal-directed occupational therapy home
    programs are effective and can add dose [7].
  - Children with hemiplegic CP move more slowly, with less direct hand paths, more trunk movement, and
    less elbow extension and supination than typically developing peers [44][46].
- **Technology requirements.** Program documentation and dose recording. Measuring the hand itself is
  outside NeuroMove's hardware.
- **Measurement requirements.**
  - Standardised hand-function and bimanual instruments, which are administered by trained raters; we do
    not reproduce their forms.
  - GAS and COPM.
  - Optionally, 3D kinematics, which are reliable for duration and most endpoint angles but less so for
    wrist, trunk and transverse-plane angles [45].
- **Limitations.** Effects are modest [7]. Evidence centres on unilateral CP.
- **How NeuroMove could support it.**
  - Shoulder-elevation and elbow ROM, speed, duration, SPARC and trunk tilt during reaching-type
    movements, as research descriptors.
  - Elbow-extension range and trunk tilt are kinematic features reported to differ in hemiplegic CP
    [44][46], so they are reasonable *exploratory* variables.
- **What NeuroMove cannot do.** Measure hand function, grasp, supination accuracy across postures, or
  bimanual performance.

### 3.6 Bimanual training (HABIT / HABIT-ILE) vs constraint-induced movement therapy (CIMT)

- **Principle.**
  - CIMT restrains the less-affected hand to force use of the more-affected one.
  - HABIT trains structured bimanual tasks.
  - HABIT-ILE adds lower-extremity and postural involvement, typically in intensive camp formats.
- **Population.** CIMT and HABIT: unilateral CP. HABIT-ILE: unilateral and bilateral CP, including
  infants and preschoolers in recent trials.
- **Intended outcome.** Bimanual performance, unimanual capacity, and goal attainment.
- **Evidence.**
  - **Cochrane review (Hoare 2019)** [8]:
    - CIMT showed some benefit over low-dose comparisons, but no difference from high-dose or
      dose-matched comparisons for bimanual performance.
    - Bimanual performance mean differences were −0.39 AHA units (95% CI −3.14 to 2.36) vs high dose
      and 0.80 (−0.78 to 2.38) vs dose-matched.
    - The authors judged the quality of evidence for all conclusions low to very low. CIMT appeared safe;
      some children found it frustrating.
  - **Equal-dose comparison (meta-analysis)** [7]: CIMT and bimanual therapy produced similar gains.
  - **RCT, 42 children, 90 hours each** [9]: CIMT and HABIT gave similar gains in hand function. The
    HABIT group made greater progress on self-set goals measured by GAS.
  - **Recent HABIT-ILE RCTs (2025–2026), all small:**
    - Massed and distributed 90-hour schedules performed similarly [51].
    - Integrating an interactive virtual device for half the time did not show noninferiority on most
      outcomes [53].
    - A home-delivered pilot (n = 7) was feasible, though children found sessions long and tiring [52].
- **Technology requirements.** Recording dose, schedule, setting (camp, clinic, home) and goals. A
  restraint log for CIMT, as documentation only.
- **Measurement requirements.** Bimanual performance instruments plus GAS/COPM. These are human-rated.
- **Limitations.** Low to very low certainty [8]. Dose matching complicates comparisons. Most trials are
  small.
- **How NeuroMove could support it.**
  - Document the approach chosen by the clinician, the schedule and the dose.
  - Capture single-arm proximal kinematics in assessment sessions before and after a block, as
    exploratory data.
- **What NeuroMove cannot do.**
  - It has no sensor on the second arm or the hands, so it cannot measure bimanual coordination or use.
  - It must not suggest CIMT vs HABIT, or infer which one "works better" for a child.

### 3.7 Home-based rehabilitation and home programs

- **Principle.** Goal-directed practice embedded in family routines, set up in partnership with the
  therapist and reviewed regularly. This adds practice dose outside sessions.
- **Population.** CP, especially school age [20]. Home delivery of intensive models is under study [52].
- **Intended outcome.** Goal attainment and function. Parent satisfaction with performance.
- **Evidence.**
  - **Double-blind RCT, 36 children** [20]:
    - An 8-week occupational therapy home program improved function and parent satisfaction vs no program.
    - The 4-week and 8-week groups did not differ, partly because 4-week families continued against
      instructions.
    - The reported average was about 17.5 sessions a month of about 16.5 minutes.
  - **Qualitative work** [21]: parents valued support, realistic goals, flexibility and clear roles, and
    asked for support without pressure to comply.
  - **Meta-analysis** [7]: describes strong evidence that goal-directed home programs work and can
    supplement hands-on therapy.
- **Technology requirements.** Clear home instructions, low-burden caregiver logging, and the therapist's
  view of what actually happened.
- **Measurement requirements.** Goal-referenced outcomes. Delivered dose as reported by caregivers.
- **Limitations.** Caregiver logs are self-report. Small trials. Adherence varies (section 3.12).
- **How NeuroMove could support it.**
  - Caregiver logging: completed, partial or not done, plus difficulty, breaks, fatigue and discomfort.
    These are recorded neutrally and never scored against the family.
  - Home sessions with the IMU, where families choose to use it, to count repetitions as an objective
    dose record.
- **What NeuroMove cannot do.**
  - Treat home IMU sessions as assessments. They are unsupervised, and donning and calibration quality
    is unknown.
  - Tell families to do more than the clinician planned.

### 3.8 Family-centred rehabilitation

- **Principle.**
  - Parents are experts on their child, and services are delivered in partnership.
  - Information sharing and respect for family priorities are central.
  - The "F-words" (function, family, fitness, fun, friends, future) restate ICF ideas for childhood
    disability [19].
- **Population.** Children with disabilities and their families.
- **Intended outcome.** Family satisfaction, engagement, and goals that reflect family priorities.
- **Evidence.**
  - In a structural-equation study (494 parents, 324 providers, 16 organisations), parent satisfaction
    was driven mainly by the organisation's family-centred culture and by parents' perceptions of care
    [23].
  - Adherence evidence points to the therapist–parent relationship as influential [24].
  - This is largely observational and framework-level evidence, not RCT evidence on child outcomes.
- **Technology requirements.**
  - Transparent data the family can see and understand.
  - Families can decline features.
  - No surveillance framing.
- **Measurement requirements.** Family-reported priorities (COPM [16]), family experience measures where
  used.
- **Limitations.** The link to motor outcomes is indirect.
- **How NeuroMove could support it.**
  - Caregiver-facing views in plain language.
  - Goals phrased in the family's words.
  - Logs that never shame non-completion.
  - Consent and data-sharing controls.
- **What NeuroMove cannot do.** Measure family-centredness.

### 3.9 Digital rehabilitation technologies (telerehabilitation, web-based programs)

- **Principle.** Deliver, monitor or support therapy remotely, often at home.
- **Population.** CP, mostly unilateral, school-age.
- **Intended outcome.** Upper-limb and gross motor function, occupational performance, access.
- **Evidence.**
  - **Scoping review of home digital technologies, 52 studies** [3]:
    - Telerehabilitation and VR/exergaming dominated, and upper-limb motor function was the most common
      outcome.
    - Facilitators: gamification, cost-effectiveness, caregiver capacity building.
    - Barriers: access, equipment and connectivity.
    - Gaps: small samples, short follow-up, inconsistent outcomes, lack of real-world validation.
    - It did not compare effectiveness.
  - **Meta-analysis, 8 RCTs, n = 419** [28]: home telerehabilitation gave an SMD of 1.29 for gross motor
    function (95% CI 0.11–2.47, I² 96%). Fine motor was not significant (SMD 0.62, −0.25 to 1.49). The
    authors call the evidence **low certainty**.
  - **Systematic review of telerehab-monitored home therapy in unilateral CP** [27]: positive changes;
    no pooled certainty reported.
  - **Mitii web-based RCT, n = 102** [26]: statistically significant gains in occupational performance and
    some function measures, but **between-group differences were not clinically significant**. Achieved
    dose varied widely (mean 32.4 h, range 3.7–74.7 h).
  - **RCT of an online exercise-prescription app vs paper, n = 53** [25]: no difference in adherence.
- **Technology requirements.** Reliability, offline tolerance, privacy, and low burden.
- **Measurement requirements.** Clinically meaningful outcomes, not engagement metrics alone.
- **Limitations.** Low certainty, heterogeneity, and widely variable dose [26][28].
- **How NeuroMove could support it.** NeuroMove *is* a digital rehabilitation support tool, so this
  evidence applies to the platform itself. The honest claim is better documentation and data, not better
  outcomes.
- **What NeuroMove cannot do.** Claim that digital delivery or app reminders raise adherence [25] or
  outcomes.

### 3.10 Wearable motion tracking

- **Principle.** Body-worn inertial sensors quantify movement in the lab, the clinic or daily life.
- **Population.** CP and other neurodevelopmental conditions.
- **Intended outcome.** Objective, repeatable measurement of movement kinematics or real-world limb use.
- **Evidence.**
  - **Systematic review, 21 studies** [39]: sensors detected differences between the two hands' use. The
    authors supported accelerometers as an objective outcome measure, but said responsiveness and
    real-world consistency need more research.
  - **Children with hemiparesis, n = 30** [40]: arm and trunk sensors distinguished paretic from
    non-paretic limbs on duration, angular velocity, elevation and smoothness (including SPARC). These
    measures correlated with Melbourne Assessment components.
  - **Dyskinetic CP** [41]: most IMU parameters showed ICCs of 0.40–0.98, depending on task. Jerk and
    sample entropy were excluded from those reliability ranges.
  - **Wrist accelerometers in unilateral CP** [42]: daily-life asymmetry related to AHA scores.
  - **Wearable neurotechnology scoping review, 21 studies** [4]:
    - Most devices were early-stage, and only five had regulatory approval.
    - Feasibility and adherence were generally positive.
    - Translation is limited by heterogeneity and little high-quality evidence.
    - Most systems were stimulation, VR or robotic, not measurement-only IMUs.
- **Technology requirements.**
  - Robust donning and calibration.
  - Known accuracy against a reference.
  - Handling of drift; no magnetometer means yaw is unobservable.
  - Child-tolerable mounting.
- **Measurement requirements.**
  - Criterion validity vs a goniometer or optical capture, test–retest reliability, and SEM/MDC in the
    target population.
  - Responsiveness to change.
  - Then, separately, association with functional outcomes.
- **Limitations.**
  - Most evidence uses research-grade sensors and is cross-sectional.
  - NeuroMove's sensors are low-cost and its algorithms are validated only in simulation.
- **How NeuroMove could support it.**
  - Structured capture of proximal arm kinematics with device passports and calibration records.
  - A built-in goniometer-agreement workflow that produces the validity and MDC data a pilot needs.
- **What NeuroMove cannot do.**
  - Measure daily-life arm use; there is no long-wear protocol, and the sensors are on one arm only.
  - Measure hand function.
  - Claim validated accuracy in children.

### 3.11 Movement-quality assessment (smoothness, variability, compensation)

- **Principle.** Beyond *how far* a joint moves, kinematics describe *how* it moves: smoothness, speed,
  consistency across repetitions, and use of trunk compensation.
- **Population.** Hemiplegic CP and other neurological conditions.
- **Intended outcome.** A richer description of motor control that ordinal clinical scales may miss.
- **Evidence.**
  - **Smoothness.**
    - SPARC was introduced as a valid, consistent, sensitive and noise-robust metric, tested in adults
      after stroke and in healthy adults [36]. It is framed within a broader analysis of smoothness [37].
    - For IMUs, SPARC can be applied to gyroscope angular velocity. Velocity integrated from
      accelerometers drifts and is unreliable [38]. This supports NeuroMove computing SPARC on gyroscope
      data.
    - In children, IMU SPARC separated paretic from non-paretic limbs [40].
    - A 2026 markerless-camera study (n = 38 children) found smoothness metrics tracked therapist ratings,
      with log dimensionless jerk aligning more closely than SPARC [43]. Exact coefficients were not
      available to us.
  - **Compensation.**
    - Children with hemiplegic CP use more trunk movement when reaching [44][46].
    - Definitions of compensation vs recovery come from stroke [47] and transfer to developing children
      only by analogy.
  - **Variability.**
    - Repetition-to-repetition variability is part of normal motor learning [29].
    - Variability is not by itself a marker of impairment or improvement. No pediatric clinical threshold
      for ROM CV was found.
  - **Reliability.** 3D kinematic reliability in hemiplegic CP is good for duration and most endpoint
    angles, but lower for trunk and transverse-plane angles [45].
- **Technology requirements.** Clean segmentation of repetitions, a sufficient sampling rate, and
  appropriate signals (gyroscope rate for SPARC [38]).
- **Measurement requirements.** Reliability, MDC and responsiveness in children *for each metric and
  protocol*. Establish meaning against clinical ratings before interpreting change.
- **Limitations.** No validated clinical cut-offs. Smoothness depends on movement duration and speed
  [43]. Trunk tilt from one trunk sensor is a single-plane proxy.
- **How NeuroMove could support it.**
  - Report SPARC, CV and trunk tilt per repetition and per session, labelled **experimental descriptors**,
    with the protocol and calibration attached.
  - Allow research export for validation studies.
- **What NeuroMove cannot do.**
  - Interpret a change in SPARC, CV or trunk tilt as improvement or deterioration for an individual child.
  - Combine these metrics into a "quality score".

### 3.12 Rehabilitation adherence

- **Principle.** Outcomes depend on the practice that actually happens. Adherence is shaped by child,
  family and therapist factors.
- **Population.** Families of children with CP doing home programs.
- **Intended outcome.** Sustainable engagement. Adherence is a process measure, not a clinical outcome.
- **Evidence.**
  - **Systematic review of psychosocial determinants** [24]:
    - Reported non-adherence to home programs ranged from 34% to 79.2%.
    - Linked factors: child (age, gross motor function), caregiver (self-efficacy, knowledge, support,
      stress), and therapist.
    - A supportive, collaborative therapist relationship was among the most influential.
  - **Digital prescription RCT** [25]: an online tool did not improve completion over paper (62.8% vs
    55.8%, not significant).
  - **Parents' preferences** [21]: flexibility, and no pressure to comply.
- **Technology requirements.** Low-burden, honest logging that can record "not done" without penalty.
- **Measurement requirements.**
  - Delivered dose, defined clearly: planned vs logged vs sensor-counted.
  - Reasons for non-completion: fatigue, discomfort, illness, schedule.
- **Limitations.** Self-report bias. Adherence definitions vary across studies.
- **How NeuroMove could support it.**
  - Feasibility metrics for pilots, such as the proportion of planned sessions logged.
  - Structured reasons that a clinician can discuss with the family.
  - Discomfort and fatigue flags routed to clinician review.
- **What NeuroMove cannot do.**
  - Assume reminders, streaks or rewards improve adherence; this is not shown [25].
  - Use adherence data to judge families.

### 3.13 Longitudinal functional outcome measurement (GAS, COPM, GMFM, ICF)

- **Principle.** Measure change with instruments that have known reliability, validity and
  responsiveness. Interpret change against measurement error and against what matters to families.
- **Population.** Pediatric rehabilitation.
- **Instruments and frameworks.**
  - **ICF / ICF-CY** (WHO 2007) [18]: a common language across body functions and structures, activity,
    participation, and environmental factors. NeuroMove kinematics are *body function / structure* level.
    Goals are mostly *activity / participation* level.
  - **GAS** [12]:
    - Originally from mental-health program evaluation.
    - Practical rehabilitation guide [15].
    - In pediatrics it was promising and responsive, but reliability evidence in children was insufficient
      [13].
    - It is ordinal, so medians and rank tests are suggested over parametric T-score analysis [14].
  - **COPM** [16]: a semi-structured interview producing performance and satisfaction ratings for
    client-identified problems.
  - **GMFM** [17]: a criterion measure of gross motor function whose change scores tracked independent
    judgments of change. MCIDs for ambulatory children were derived from non-surgical change scores [48].
    GMFM addresses gross motor, not upper-limb, function.
  - **MDC vs MCID** [49]: change beyond measurement error is a different question from change that matters
    to the family.
- **Technology requirements.**
  - Store scores with the instrument name and version, the administration date, the rater, and the
    rater's training status.
  - Never reproduce proprietary forms or items.
- **Measurement requirements.** The same instrument, protocol and, ideally, rater over time. Change
  interpreted against published MDC or MCID where they exist.
- **Limitations.** GAS reliability in children [13]. Instruments differ in level (ICF component) and
  population.
- **How NeuroMove could support it.**
  - Clinician-entered results (GAS, COPM, GMFM totals) in a timeline next to, but **separate from**, IMU
    measures.
  - For IMU measures, show SEM/MDC from NeuroMove's own validation data once it exists. Until then, show
    no "significant change" label at all.
- **What NeuroMove cannot do.** Administer or score these instruments. Map IMU values onto them.

### 3.14 Gamified rehabilitation and virtual reality

- **Principle.** Game elements or VR increase engagement and allow many repetitions with feedback.
- **Population.** CP, mostly school-age.
- **Intended outcome.** Motor function, motivation and practice volume.
- **Evidence.**
  - **Upper-limb VR meta-analysis, 22 RCTs, 746 participants** [31]: VR added to conventional therapy
    favoured VR for upper-limb activity (SMD 0.65, 95% CI 0.19–1.11). **Certainty was very low to low.**
  - **Overview of 16 VR reviews** [32]:
    - Most reviews were low or very low quality on AMSTAR-2.
    - Of 58 outcomes, 9 were rated moderate, 21 low and 28 very low certainty.
  - **Home-based VR meta-analysis** [33]: VR is presented as a possible adjunct, not a replacement.
  - **Gamification systematic review, 11 trials, 6 in CP** [34]: the most consistent benefits reported
    were motivation and adherence. The authors call for dosage research.
  - **HABIT-ILE with an interactive device** [53]: replacing half of the time with the device did not
    show noninferiority on most outcomes.
  - We found **no Cochrane review of VR specifically for CP**. Older reviews such as [35] were not read
    beyond metadata.
- **Technology requirements.** Age-appropriate design, safety, and clinician control over difficulty.
- **Measurement requirements.** Functional outcomes, not in-game scores.
- **Limitations.** Low certainty. Commercial games and rehabilitation-specific systems are mixed together.
  Engagement does not equal benefit.
- **How NeuroMove could support it.**
  - The child-facing mode rewards participation and effort (showing up, trying, stopping when tired),
    never ROM, speed or comparison with others. There are no leaderboards.
  - Rewards must never push past clinician-set limits or encourage practice through discomfort.
- **What NeuroMove cannot do.** Claim that its game mode improves motor outcomes or adherence.

### 3.15 Clinician-supervised adaptive rehabilitation

- **Principle.** Progression is individualised: the therapist adjusts tasks, difficulty and dose based on
  the child's response, using goals and monitoring data.
- **Population.** CP and other conditions.
- **Intended outcome.** Appropriately challenging practice and earlier detection of problems such as pain,
  fatigue or plateau.
- **Evidence.**
  - Novak's 2013 advice to pair lower-certainty interventions with a sensitive outcome measure supports
    monitoring [5].
  - We found **no direct trial evidence** that software-generated progression rules improve pediatric
    outcomes.
  - Wearable neurotechnology reviews emphasise feedback-driven practice but report heterogeneous, early
    evidence [4].
- **Technology requirements.**
  - Transparent, auditable rules.
  - A human in the loop.
  - Every rule shows its inputs and its threshold.
  - Flags are reversible and dismissable with a reason.
- **Measurement requirements.** Rule inputs must have known error (MDC). Otherwise the rules flag noise.
- **Limitations.** Automated adaptation without validated inputs risks harm. Software that informs
  clinical decisions may fall under medical-device regulation; see this repository's RESEARCH.md
  regulatory notes.
- **How NeuroMove could support it.**
  - The rule-based "progress observations" engine: for example, "three home sessions logged with
    discomfort", or "no assessment session in 8 weeks", or "IMU elevation range outside the clinician's
    recorded expectation".
  - Flags only. Each flag is shown to a professional, with its evidence and its limitation, and never
    changes the program.
- **What NeuroMove cannot do.** Automatically progress, regress, or set intensity.

---

## 4. Classification

### (A) Established clinical approaches

"Established" means supported by a guideline or by multiple RCT-based reviews. It does not mean high
certainty.

- Goal-directed, activity-based practice with client-chosen goals [1][7][10].
- Whole-task / task-specific practice in real-life settings [1][5][6].
- CIMT and bimanual training (HABIT; HABIT-ILE) for hand-use goals in unilateral CP. They are similar at
  matched dose, with low to very low certainty [7][8][9].
- Goal-directed home programs set up in partnership with families [7][20].
- Family-centred service as a practice framework [19][23].
- Standardised and individualised outcome measurement (GAS, COPM, GMFM) interpreted through ICF-CY
  [12]–[18][48].

### (B) Emerging technologies

- Telerehabilitation and web-based home programs. The evidence is low certainty, the dose is variable,
  and in one RCT the between-group differences were not clinically significant [26][27][28].
- VR and gamified rehabilitation, with low to very low certainty [31][32][33][34].
- Wearable inertial sensing as an outcome measure. It shows discriminative validity and promising
  reliability, but responsiveness has not been established [39][40][41][42].
- Wearable neurotechnology (stimulation, robotics, VR). These are early-stage, heterogeneous, and few
  are approved [4].
- Kinematic smoothness metrics (SPARC, LDLJ) in children, with early evidence of association with
  therapist ratings [40][43].

### (C) Experimental ideas NeuroMove might try (each needs a study)

1. **Goniometer-agreement pilot in children.**
   - Elbow and shoulder elevation agreement (Bland–Altman, ICC), SEM and MDC95 per protocol, in children
     with and without CP.
   - This comes before any other use of NeuroMove numbers.
2. **Test–retest reliability.**
   - Within- and between-session reliability of ROM, peak angular velocity, duration, SPARC (gyroscope),
     ROM CV and trunk tilt, following the design used in [41].
3. **Feasibility of home IMU sessions.**
   - Donning success, calibration quality, child tolerance, caregiver burden, and data completeness.
   - These are feasibility outcomes only.
4. **Repetition count as a dose record.**
   - Agreement between IMU-counted repetitions and caregiver logs or video in home practice.
5. **Association study.**
   - Correlation between changes in IMU descriptors and changes in GAS or COPM across a therapy block.
   - The hypothesis is pre-registered, and a null result is treated as informative.
6. **Usability of the progress-observations engine.**
   - Do clinicians find the flags useful and correct?
   - How often do they dismiss them, and why?

### (D) Unsupported hypotheses: claims NeuroMove must NOT make

| Claim NeuroMove must not make | Why |
|---|---|
| "An increase in IMU-measured ROM means functional improvement." | ROM is body-function level, while goals are activity or participation level [18]. No association study exists for NeuroMove. Change may be measurement error, since MDC is not established. |
| "Gamification / the child mode improves outcomes in CP." | VR and gamification evidence is low to very low certainty [31][32]. Reported benefits are mainly motivation [34]. NeuroMove's mode has not been studied. |
| "More repetitions are always better." | The threshold dose was undeterminable [2]. Equal-dose comparisons show no single approach is superior [7][8]. Children reported fatigue in intensive formats [52]. |
| "IMU smoothness (SPARC) is a validated clinical metric in children with CP." | SPARC was validated in adult stroke and healthy samples [36]. Pediatric evidence is discriminative or correlational [40][43], and no clinical cut-off or MDC exists. |
| "NeuroMove measures hand function, bimanual use, or daily-life arm use." | No hand sensors, one arm only, and no long-wear protocol. |
| "Shoulder flexion and abduction are measured as separate planes." | Elevation is from the hanging pose; the plane is not verified by the sensor. |
| "Higher logged adherence leads to better outcomes for this child." | Adherence is a process measure. A digital tool did not improve adherence in an RCT [25]. |
| "NeuroMove's progress observations recommend treatment." | It has no validated inputs and no decision-support evidence. It only flags things for review. |
| "Trunk tilt reduction means recovery rather than compensation." | The definitions come from stroke [47]. A single trunk sensor cannot separate the mechanisms. |
| "A composite NeuroMove score summarises a child's arm function." | No validated weighting exists. A composite would hide the different validity of each component. |

---

## 5. Implications for NeuroMove software design

- **Goals before metrics.** A program starts from clinician-owned, family-informed goals [1][10]. IMU
  sessions can be linked to a goal as context, never shown as the goal's outcome.
- **Three separate data classes, never mixed in one chart axis or score.**
  1. Clinician-administered instrument results (GAS, COPM, GMFM), with instrument, version, rater and date.
  2. IMU kinematic descriptors, with protocol, calibration, device passport and validation status.
  3. Caregiver- or child-reported data (logs, difficulty, fatigue, discomfort).
- **No composite score.** Report each metric on its own with its label and limitation. In particular,
  no "arm quality" or "progress" index.
- **Dose is recorded, not prescribed.**
  - Store planned dose as the clinician wrote it, and delivered dose as logged or counted.
  - The software never proposes or escalates intensity, because a threshold dose is unknown [2].
- **Assessment sessions are distinct from practice sessions.** Only supervised, protocol-following
  assessment sessions feed longitudinal IMU timelines. Home and practice data are dose records [29].
- **Change is shown against measurement error, or not at all.**
  - Until NeuroMove has its own pediatric SEM/MDC for a protocol, IMU timelines show raw values with no
    "improved / declined" wording [49].
  - Instrument MCIDs are shown only where published and verified [48].
- **The validation status is visible on every number.** Labels distinguish operational-unvalidated from
  experimental, and repeat the frozen-hardware limitations (no magnetometer, plane not verified).
- **SPARC is computed on gyroscope angular velocity**, not on integrated accelerometer velocity [38], and
  is labelled experimental [36][43].
- **Participation-based rewards only.** The child mode rewards attendance, effort and stopping when
  tired. There are no ROM or speed targets, no leaderboards, and no streaks that punish missed days
  [21][24].
- **Logging never punishes.** "Not done" is a first-class, neutral answer with optional reasons.
  Discomfort and fatigue go to clinician review, not to automated program changes [21][24].
- **Rules are transparent and advisory.** Every progress observation shows its rule, its inputs, its
  threshold, its data quality and its limitation. It requires a professional to acknowledge it, and it
  never edits a program.
- **Scope honesty in the UI.** Capabilities the hardware cannot provide (hand, bimanual, daily-life use,
  gait) appear as "not measured", never as empty charts that imply measurement.
- **Use ICF-CY tagging.** Goals, instruments and IMU metrics carry an ICF component tag, so the
  body-function vs activity distinction is visible [18].
- **Family-centred data access.** Caregiver views use plain language, and consent is granular, so
  families can decline the sensor and still use the program [19][23].
- **Research infrastructure comes first.** Consent records, pseudonymised export, and feasibility metrics
  (donning success, data completeness, logging rates) support the section 4(C) studies. Those studies
  must happen before any clinical claim.
- **No proprietary instrument content.** Store totals and goal text only. Do not reproduce forms, item
  wording or scoring manuals.

---

## 6. References

Markers:
- **[verified]**: the DOI or identifier resolved to a matching record, and the abstract was read (via
  Europe PMC or PubMed unless noted).
- **[metadata only]**: the record was confirmed, but no abstract was available or read.

1. Jackman M, Sakzewski L, Morgan C, Boyd RN, Brennan SE, Langdon K, Toovey RAM, Greaves S, Thorley M,
   Novak I. Interventions to improve physical function for children and young people with cerebral palsy:
   international clinical practice guideline. *Dev Med Child Neurol*. 2022;64(5):536–549.
   https://doi.org/10.1111/dmcn.15055 **[verified]**. Per-recommendation GRADE strength not read.
2. Sudati IP, Sakzewski L, Fioroni Ribeiro da Silva C, Jackman M, Haddon M, Pool D, Patel M, Boyd RN,
   de Campos AC. Efficacy and threshold dose of intensive training targeting mobility for children with
   cerebral palsy: a systematic review and meta-analysis. *Dev Med Child Neurol*. 2024;66(12):1542–1557.
   https://doi.org/10.1111/dmcn.16040 **[verified]**. The companion item
   https://doi.org/10.1111/dmcn.16149 (same title, *DMCN* 66(12):e250, no authors or abstract indexed) is
   **[metadata only]**.
3. Amponsah SK, Ansu-Mensah M, Osei E, Danquah FI, Kuupiel D. Digital health technologies for supporting
   home-based rehabilitation and management of children with cerebral palsy: a scoping review. *BMJ Open*.
   2026;16(8):e115511. https://doi.org/10.1136/bmjopen-2025-115511 **[verified]**
4. Burchfield SJ, Shierk A, Truong C, Blankenship R. Wearable neurotechnology systems for upper extremity
   rehabilitation in children with cerebral palsy: a scoping review. *Front Neurol*. 2025;16.
   https://doi.org/10.3389/fneur.2025.1663596 (PMID 41281567) **[verified]**
5. Novak I, McIntyre S, Morgan C, et al. A systematic review of interventions for children with cerebral
   palsy: state of the evidence. *Dev Med Child Neurol*. 2013;55(10):885–910.
   https://doi.org/10.1111/dmcn.12246 **[verified]**
6. Novak I, Morgan C, Fahey M, et al. State of the evidence traffic lights 2019: systematic review of
   interventions for preventing and treating children with cerebral palsy. *Curr Neurol Neurosci Rep*.
   2020;20(2):3. https://doi.org/10.1007/s11910-020-1022-z **[verified]**
7. Sakzewski L, Ziviani J, Boyd RN. Efficacy of upper limb therapies for unilateral cerebral palsy: a
   meta-analysis. *Pediatrics*. 2014;133(1):e175–204. https://doi.org/10.1542/peds.2013-0675
   **[verified]**
8. Hoare BJ, Wallen MA, Thorley MN, Jackman ML, Carey LM, Imms C. Constraint-induced movement therapy in
   children with unilateral cerebral palsy. *Cochrane Database Syst Rev*. 2019;4:CD004149.
   https://doi.org/10.1002/14651858.CD004149.pub3 **[verified]**
9. Gordon AM, Hung YC, Brandao M, et al. Bimanual training and constraint-induced movement therapy in
   children with hemiplegic cerebral palsy: a randomized trial. *Neurorehabil Neural Repair*.
   2011;25(8):692–702. https://doi.org/10.1177/1545968311402508 **[verified]**
10. Löwing K, Bexelius A, Brogren Carlberg E. Activity focused and goal directed therapy for children with
    cerebral palsy: do goals make a difference? *Disabil Rehabil*. 2009;31(22):1808–1816.
    https://doi.org/10.1080/09638280902822278 **[verified]**
11. Brogren Carlberg E, Löwing K. Does goal setting in activity-focused interventions for children with
    cerebral palsy influence treatment outcome? *Dev Med Child Neurol*. 2013;55(Suppl 4):47–54.
    https://doi.org/10.1111/dmcn.12307 **[verified]**
12. Kiresuk TJ, Sherman RE. Goal attainment scaling: a general method for evaluating comprehensive
    community mental health programs. *Community Ment Health J*. 1968;4(6):443–453.
    https://doi.org/10.1007/BF01530764 **[verified]**
13. Steenbeek D, Ketelaar M, Galama K, Gorter JW. Goal attainment scaling in paediatric rehabilitation: a
    critical review of the literature. *Dev Med Child Neurol*. 2007;49(7):550–556.
    https://doi.org/10.1111/j.1469-8749.2007.00550.x **[verified]**
14. Krasny-Pacini A, Hiebel J, Pauly F, Godon S, Chevignard M. Goal attainment scaling in rehabilitation:
    a literature-based update. *Ann Phys Rehabil Med*. 2013;56(3):212–230.
    https://doi.org/10.1016/j.rehab.2013.02.002 **[verified]**
15. Turner-Stokes L. Goal attainment scaling (GAS) in rehabilitation: a practical guide. *Clin Rehabil*.
    2009;23(4):362–370. https://doi.org/10.1177/0269215508101742 **[verified]**
16. Law M, Baptiste S, McColl M, Opzoomer A, Polatajko H, Pollock N. The Canadian occupational performance
    measure: an outcome measure for occupational therapy. *Can J Occup Ther*. 1990;57(2):82–87.
    https://doi.org/10.1177/000841749005700207 **[verified]**
17. Russell DJ, Rosenbaum PL, Cadman DT, Gowland C, Hardy S, Jarvis S. The gross motor function measure: a
    means to evaluate the effects of physical therapy. *Dev Med Child Neurol*. 1989;31(3):341–352.
    https://doi.org/10.1111/j.1469-8749.1989.tb04003.x **[verified]**
18. World Health Organization. *International Classification of Functioning, Disability and Health:
    Children & Youth Version (ICF-CY)*. Geneva: WHO; 2007. ISBN 9789241547321.
    https://www.who.int/news/item/23-10-2007-who-publishes-new-standard-for-documenting-the-health-of-children-and-youth
    **[verified: WHO release and library records; the classification text itself not read]**
19. Rosenbaum P, Gorter JW. The 'F-words' in childhood disability: I swear this is how we should think!
    *Child Care Health Dev*. 2012;38(4):457–463. https://doi.org/10.1111/j.1365-2214.2011.01338.x
    **[verified]**
20. Novak I, Cusick A, Lannin N. Occupational therapy home programs for cerebral palsy: double-blind,
    randomized, controlled trial. *Pediatrics*. 2009;124(4):e606–614.
    https://doi.org/10.1542/peds.2009-0288 **[verified]**
21. Novak I. Parent experience of implementing effective home programs. *Phys Occup Ther Pediatr*.
    2011;31(2):198–213. https://doi.org/10.3109/01942638.2010.533746 **[verified]**
22. Novak I, Berry J. Home program intervention effectiveness evidence. *Phys Occup Ther Pediatr*.
    2014;34(4):384–389. https://doi.org/10.3109/01942638.2014.964020 **[metadata only]**. Not cited in
    the text for any finding.
23. Law M, Hanna S, King G, Hurley P, King S, Kertoy M, Rosenbaum P. Factors affecting family-centred
    service delivery for children with disabilities. *Child Care Health Dev*. 2003;29(5):357–366.
    https://doi.org/10.1046/j.1365-2214.2003.00351.x **[verified]**
24. Niyonsenga J, Uwingeneye L, Musabyemariya I, et al. The psychosocial determinants of adherence to
    home-based rehabilitation strategies in parents of children with cerebral palsy: a systematic review.
    *PLoS One*. 2024;19(6):e0305432. https://doi.org/10.1371/journal.pone.0305432 **[verified]**
25. Johnson RW, Williams SA, Gucciardi DF, Bear N, Gibson N. Can an online exercise prescription tool
    improve adherence to home exercise programmes in children with cerebral palsy and other
    neurodevelopmental disabilities? A randomised controlled trial. *BMJ Open*. 2020;10(12):e040108.
    https://doi.org/10.1136/bmjopen-2020-040108 **[verified]**
26. James S, Ziviani J, Ware RS, Boyd RN. Randomized controlled trial of web-based multimodal therapy for
    unilateral cerebral palsy to improve occupational performance. *Dev Med Child Neurol*.
    2015;57(6):530–538. https://doi.org/10.1111/dmcn.12705 **[verified]**
27. Usman JS, Wong TW, Mei Ng SS. Effects of telerehabilitation monitored home-based therapies on upper
    extremity function-related outcomes in children and adolescents with unilateral cerebral palsy: a
    systematic review. *J Telemed Telecare*. 2026;32(8):654–668. https://doi.org/10.1177/1357633x261420104
    **[verified]**
28. Domínguez-López P, Lirio-Romero C, Coello-Villalón M, López-Muñoz P, Martínez-Olagüe Jácome M,
    Palomo-Carrión R. Home-based telerehabilitation on motor function in youth with cerebral palsy:
    systematic review and meta-analysis. *Pediatr Res*. 2026. https://doi.org/10.1038/s41390-026-05382-w
    **[verified]**
29. Levac D, Wishart L, Missiuna C, Wright V. The application of motor learning strategies within
    functionally based interventions for children with neuromotor conditions. *Pediatr Phys Ther*.
    2009;21(4):345–355. https://doi.org/10.1097/PEP.0b013e3181beb09d **[verified]**
30. Kleim JA, Jones TA. Principles of experience-dependent neural plasticity: implications for
    rehabilitation after brain damage. *J Speech Lang Hear Res*. 2008;51(1):S225–239.
    https://doi.org/10.1044/1092-4388(2008/018) **[verified]**
31. Burin-Chu S, Baillet H, Leconte P, Lejeune L, Thouvarecq R, Benguigui N. Effectiveness of virtual
    reality interventions of the upper limb in children and young adults with cerebral palsy: a
    systematic review with meta-analysis. *Clin Rehabil*. 2024;38(1):15–33.
    https://doi.org/10.1177/02692155231187858 **[verified]**
32. Fang E, Guan H, Du B, Ma X, Ma L. Effectiveness of virtual reality for functional disorders in
    cerebral palsy: an overview of systematic reviews and meta-analyses. *Front Neurol*. 2025;16:1582110.
    https://doi.org/10.3389/fneur.2025.1582110 **[verified]**
33. Hao J, Huang B, Remis A, He Z. The application of virtual reality to home-based rehabilitation for
    children and adolescents with cerebral palsy: a systematic review and meta-analysis. *Physiother
    Theory Pract*. 2024;40(7):1588–1608. https://doi.org/10.1080/09593985.2023.2184220 **[verified]**
34. Pimentel-Ponce M, Romero-Galisteo RP, Palomo-Carrión R, et al. Gamification and neurological motor
    rehabilitation in children and adolescents: a systematic review. *Neurologia (Engl Ed)*.
    2024;39(1):63–83. https://doi.org/10.1016/j.nrleng.2023.12.006 **[verified]**
35. Chen Y, Fanchiang HD, Howard A. Effectiveness of virtual reality in children with cerebral palsy: a
    systematic review and meta-analysis of randomized controlled trials. *Phys Ther*. 2018;98(1):63–77.
    https://doi.org/10.1093/ptj/pzx107 **[metadata only]**. No findings cited.
36. Balasubramanian S, Melendez-Calderon A, Burdet E. A robust and sensitive metric for quantifying
    movement smoothness. *IEEE Trans Biomed Eng*. 2012;59(8):2126–2136.
    https://doi.org/10.1109/TBME.2011.2179545 **[verified]**
37. Balasubramanian S, Melendez-Calderon A, Roby-Brami A, Burdet E. On the analysis of movement
    smoothness. *J Neuroeng Rehabil*. 2015;12:112. https://doi.org/10.1186/s12984-015-0090-9
    **[verified]**
38. Melendez-Calderon A, Shirota C, Balasubramanian S. Estimating movement smoothness from inertial
    measurement units. *Front Bioeng Biotechnol*. 2021;8:558771. https://doi.org/10.3389/fbioe.2020.558771
    **[verified]**
39. Braito I, Maselli M, Sgandurra G, et al. Assessment of upper limb use in children with typical
    development and neurodevelopmental disorders by inertial sensors: a systematic review. *J Neuroeng
    Rehabil*. 2018;15:94. https://doi.org/10.1186/s12984-018-0447-y **[verified]**
40. Newman CJ, Bruchez R, Roches S, et al. Measuring upper limb function in children with hemiparesis with
    3D inertial sensors. *Childs Nerv Syst*. 2017;33(12):2159–2168.
    https://doi.org/10.1007/s00381-017-3580-1 **[verified]**
41. Vanmechelen I, Bekteshi S, Haberfehlner H, Feys H, Desloovere K, Aerts JM, Monbaliu E. Reliability
    and discriminative validity of wearable sensors for the quantification of upper limb movement
    disorders in individuals with dyskinetic cerebral palsy. *Sensors*. 2023;23(3):1574.
    https://doi.org/10.3390/s23031574 **[verified]**
42. Beani E, de 'Cavalieri MF, Filogna S, et al. Wearable sensors for measuring spontaneous upper limb use
    in children with unilateral cerebral palsy and typical development. *J Neuroeng Rehabil*.
    2025;22(1):71. https://doi.org/10.1186/s12984-025-01601-3 **[verified]**
43. Hesse N, Lieber J, van Hedel HJA. Evaluating upper limb movement smoothness metrics derived from
    markerless 3D motion tracking in children with neurological disorders. *J Neuroeng Rehabil*.
    2026;23(1):256. https://doi.org/10.1186/s12984-026-02020-8 **[verified]**. Correlation values were
    not rendered in the record and are not cited.
44. Jaspers E, Desloovere K, Bruyninckx H, Molenaers G, Klingels K, Feys H. Review of quantitative
    measurements of upper limb movements in hemiplegic cerebral palsy. *Gait Posture*. 2009;30(4):395–404.
    https://doi.org/10.1016/j.gaitpost.2009.07.110 **[verified]**
45. Jaspers E, Feys H, Bruyninckx H, et al. The reliability of upper limb kinematics in children with
    hemiplegic cerebral palsy. *Gait Posture*. 2011;33(4):568–575.
    https://doi.org/10.1016/j.gaitpost.2011.01.011 **[verified]**
46. Jaspers E, Desloovere K, Bruyninckx H, et al. Three-dimensional upper limb movement characteristics in
    children with hemiplegic cerebral palsy and typically developing children. *Res Dev Disabil*.
    2011;32(6):2283–2294. https://doi.org/10.1016/j.ridd.2011.07.038 **[verified]**
47. Levin MF, Kleim JA, Wolf SL. What do motor "recovery" and "compensation" mean in patients following
    stroke? *Neurorehabil Neural Repair*. 2009;23(4):313–319. https://doi.org/10.1177/1545968308328727
    **[verified]**
48. Oeffinger D, Bagley A, Rogers S, et al. Outcome tools used for ambulatory children with cerebral
    palsy: responsiveness and minimum clinically important differences. *Dev Med Child Neurol*. 2008.
    https://doi.org/10.1111/j.1469-8749.2008.03150.x **[verified]**. Volume and pages were not recorded.
49. Haley SM, Fragala-Pinkham MA. Interpreting change scores of tests and measures used in physical
    therapy. *Phys Ther*. 2006;86(5):735–743. https://doi.org/10.1093/ptj/86.5.735 **[verified]**. The
    abstract describes the measurement-error and meaningful-change perspectives. The MDC/MCID labels are
    the conventional terms, not quoted from the abstract.
50. Eliasson AC, Krumlinde-Sundholm L, Rösblad B, et al. The Manual Ability Classification System (MACS)
    for children with cerebral palsy: scale development and evidence of validity and reliability. *Dev
    Med Child Neurol*. 2006;48(7):549–554. https://doi.org/10.1017/S0012162206001162 **[verified]**
51. Sienko SE, et al. (last author Gordon AM). The impact of dosing schedule on HABIT-ILE in children with
    bilateral cerebral palsy. *Neurorehabil Neural Repair*. 2026;40(9):770–783.
    https://doi.org/10.1177/15459683261432091 **[verified: abstract summary; full author list not recorded]**
52. Ducoffre E, et al. (last author Bleyenheuft Y). Feasibility of HABIT-ILE@home in children with
    cerebral palsy and adults with chronic stroke: a pilot study. *PLOS Digit Health*. 2025;4(5):e0000850.
    https://doi.org/10.1371/journal.pdig.0000850 **[verified: abstract summary; full author list not recorded]**
53. Kilcioglu S, et al. (last author Bleyenheuft Y). Integrating the REAtouch interactive virtual device
    into HABIT-ILE for children with bilateral cerebral palsy: a noninferiority RCT. *Neurorehabil Neural
    Repair*. 2026. https://doi.org/10.1177/15459683261469065 **[verified: abstract summary; title
    paraphrased in the index view; check exact title]**

### Unverified / to check (not cited as fact anywhere above)

- **Per-recommendation strength and certainty in [1].** Strong vs conditional, and GRADE certainty for
  each hand-use recommendation. The publisher's full text was not accessible to us.
- **What doi 10.1111/dmcn.16149 actually is.** It may be a translated abstract, a plain-language summary,
  or a correction; the index records give no authors or abstract.
- **The original HABIT-ILE RCT in unilateral CP** (Bleyenheuft et al., c. 2015, *Neurorehabil Neural
  Repair*). It was not located in our searches, so no claim relies on it.
- **Novak & Cusick 2006** home-program model paper (*Aust Occup Ther J*). Not searched.
- **Rosenbaum et al. 1998** definitional paper on family-centred service, and **King et al. 2004** on
  family-centred service. Not located.
- **Any Cochrane review of VR specifically for children with CP.** None found. The Cochrane VR review
  for stroke (Laver et al.) is adult and was not checked.
- **COPM change threshold.** The commonly cited 2-point clinically important change was not verified
  against a primary source.
- **GMFM-66 MCID values** from [48]. Numeric values were not extracted.
- **Chen et al. 2018 [35] findings.** The abstract was not available in the record.
- **Exact correlation coefficients in Hesse et al. 2026 [43].**
- **Schmidt & Lee motor-learning textbook principles** (feedback frequency, contextual interference)
  as applied to children with CP. Not checked; no specific claims are made.
