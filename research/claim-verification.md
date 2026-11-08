# Claim verification against the sources (8 November 2026)

Every claim the review attributes to a source was checked against that source's own text.

**Sources of text:**
- abstracts from Semantic Scholar, OpenAlex and PubMed (82 of 85 entries);
- full texts from Europe PMC / PMC BioC where the abstract could not settle the claim: `melendez2021`, `balasubramanian2015`.

**Not checked:**
- `bland1986` and `salmoni1984`: no abstract in PubMed, OpenAlex or Semantic Scholar.
- `kwakkel2019`: no open full text; only the abstract was read.

**Verdict key:**
- ✅ supported;
- ✏️ corrected in the documents (what was wrong is stated);
- ◻ abstract consistent but too general to confirm the exact wording;
- — not checked.

| Key | Read | Verdict | Note |
|---|---|---|---|
| smith2006 | abstract | ✅ | Two processes (fast learns and forgets quickly, slow retains), spontaneous recovery, savings |
| thoroughman2000 | abstract | ✅ | Trial-by-trial error time-series analysis of learning dynamics |
| albert2018 | abstract | ✏️ | The paper is about **estimation**: least-squares fits of deterministic models give unrealistic hidden states; a stochastic model fitted by EM is better. The earlier text attributed "only probing paradigms identify the rates" to it. **NeuroMove's dual-rate fit is the least-squares kind**, and this is now stated as a limitation. |
| kantak2012 | abstract | ✅ | Delayed retention or transfer indicates learning better than end-of-practice performance |
| soderstrom2015 | abstract | ✅ | Learning vs performance; manipulations can affect them oppositely |
| heathcote2000 | abstract | ✅ | Exponential fits better in all unaveraged data; averaging biases toward a power law |
| krakauer2019 | abstract | ✅ | Review of adaptation vs skill acquisition |
| shea1979 | abstract | ✅ | Random practice → better retention (changed context) and transfer |
| winstein1990 | title + abstract | ✅ | Title states reduced KR frequency enhances learning (adults) |
| salmoni1984 | — | — | No abstract available |
| schmidt1975 | abstract | ✅ | Schema theory |
| huang2011 | abstract | ✅ | Use-dependent and operant reinforcement components besides adaptation |
| diedrichsen2010 | abstract | ✅ | Use-dependent learning alongside error-based learning |
| wu2014 | abstract | ✅ | Task-relevant variability predicts faster learning |
| herzfeld2014 | commentary (no abstract) | ◻ | Commentary on wu2014 |
| kitago2013 | abstract | ✅ | Adaptation vs skill; recovery vs compensation |
| brashers1996 | abstract | ✅ | Consolidation; interference within 4 h |
| kording2007 | abstract | ✅ | Bayesian multi-timescale adaptation |
| shmuelof2012 | abstract | ✅ | Skill = shift of speed–accuracy trade-off; less variability, more smoothness |
| reis2009 | abstract | ✅ | Online (within-day) vs offline (between-day) skill components |
| bonstrup2019 | abstract | ✅ | Offline gains during short rests |
| reinkensmeyer2016 | abstract | ✅ | Computational neurorehabilitation agenda |
| hidaka2012 | abstract | ✅ | Dynamical model of arm function and use; model comparison |
| schweighofer2018 | abstract | ✅ | Fast (device learning) and slow (recovery) processes, mixed-effect exponential models |
| casadio2012 | abstract + title | ◻ | Linear dynamical model of recovery (learning, retention, slacking in the title). NeuroMove's **dose term is our adaptation**, already worded as "adapted from" |
| lang2009 | abstract | ✅ | Low practice amounts in therapy sessions |
| kleim2008 | abstract | ✅ | Experience-dependent plasticity principles |
| lohse2014 | abstract | ✏️ | Found a **positive** dose–response (more scheduled time → more improvement, g = 0.35) in adult stroke. Earlier text said "open question". |
| lohse2020 | abstract | ✅ | Mixed-effects vs repeated-measures ANOVA |
| balasubramanian2015 | **full text** | ✏️ | Recommends **SPARC over LDLJ** ("serious problems with the LDLJ"). Earlier text said it recommends both. |
| balasubramanian2012 | abstract | ✅ | SPARC valid, consistent, sensitive, robust |
| melendez2021 | **full text** | ✏️ | SPARC/LDLJ inappropriate for translational IMU data; both good candidates for rotational kinematics; LDLJ-A depends on orientation accuracy. Earlier wording ("gravity contaminates jerk") simplified it. The gyroscope-SPARC choice is supported. |
| rohrer2002 | abstract | ✅ | Smoothness changes with recovery; submovement blending |
| schwarz2019 | abstract | ✅ | Heterogeneous kinematic metrics, clinimetrics often unknown |
| kwakkel2019 | abstract only | ✏️ | Abstract lists assays (2D reaching, finger individuation, grip, precision grip, 3D drinking task), not a metric list. The text was reworded, and the metric choice is now grounded on jaspers2009 (children). |
| levin2009 | abstract | ✅ | Definitions of recovery vs compensation |
| cirstea2000 | abstract | ◻ | Compensation in reaching after stroke (trunk details beyond the visible abstract) |
| stergiou2011 | abstract | ✅ | Optimal variability |
| kok2017 | abstract (truncated) | ◻ | Tutorial scope; specific statements are standard IMU facts, not confirmed from this text |
| picerno2017 | abstract | ✅ | Methodological review of lower-limb IMU kinematics |
| poitras2019 | abstract | ✏️ | Valid for whole-body ROM; better for simple tasks and lower limbs; **reliability evidence too limited**. Earlier text said "good validity and reliability". |
| wang2017 | abstract | ✅ | Interactive wearable rehabilitation systems |
| madgwick2011 | abstract | ✅ | Orientation filter |
| rast2020 | abstract | ✅ | Everyday-life wearable algorithms |
| bland1986 | — | — | No abstract available |
| weir2005, koo2016, haley2006 | abstract | ✅ | ICC forms and SEM; ICC reporting; interpreting change. (Koo & Li's "≥ 30 samples" advice is in the full text, not the abstract.) |
| kalman1960, durbin2012, shumway1982 | abstract | ✅ | Filtering; state-space text; EM for state-space ML |
| stoffer1991 | abstract | ✏️ | Bootstraps the **innovations**; NeuroMove's variant is parametric. Wording corrected. |
| raue2009 | abstract | ✅ | Profile likelihood detects structural and practical non-identifiability |
| burkner2020 | abstract | ✅ | Leave-future-out CV; LOO is over-optimistic for forecasting |
| hurvich1989, burnham2004, gabry2019, wilson2019, lagarias1998, bates2015, roberts2017 | abstract | ✅ | — |
| saeb2017 | abstract | ✅ | Record-wise CV often massively overestimates accuracy |
| kaufman2012, riley2020, varoquaux2018 | abstract | ✅ | Leakage; sample-size calculation; large CV error bars at small n |
| yuan2024 | abstract | ✅ | 700,000 person-days of **UK Biobank** accelerometry; generalises across external datasets |
| haresamudram2022, zerveas2021, yue2022, saeed2019, wang2019, wilson2020 | abstract | ✅ | — |
| wilkinson2016, gebru2021 | abstract | ✅ | FAIR; datasheets |
| novak2020, jackman2022, sudati2024 | abstract | ✅ | sudati2024: minimum effective dose of intensive mobility training in CP |
| eliasson2006, palisano1997, rosenbaum2007 | abstract | ✅ | MACS; GMFCS (κ 0.55 under 2 years, 0.75 at 2–12 years); CP definition |
| jaspers2009 | abstract | ✅ | Hemiplegic CP: longer duration, slower, less straight; trunk flexion compensation. Now cited as the paediatric basis for duration, speed and trunk metrics. |
| sullivan2008 | abstract | ✏️ | Reduced feedback **harmed** children's retention (helped adults). Made explicit. |
| burtner2014 | abstract | ✏️ | Children with hemiplegic CP used feedback **similarly** to typically developing children. The earlier text said they "differ again", which is **not supported**. |
| robert2017 | abstract | ✅ | No consistent guidance for children |
| diekema2006 | abstract | ◻ | Overview of paediatric research regulations; permission and assent are part of them, not named in the abstract |

**Summary:**
- 85 entries; 82 had text available.
- No claim was found to be fabricated, but **9 claims were corrected**:
  - one that a source does not support (burtner2014);
  - one about a method that NeuroMove itself uses (albert2018);
  - seven overstatements or imprecise wordings.
- Corrections are applied in literature-review.md, evidence-matrix.md, mathematical-models.md, measurement-model.md, experimental-protocols.md and research-gaps.md.
