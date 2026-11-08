// NeuroMove Functional Progression System — data model.
//
// CHILD & FAMILY GOALS → PROFESSIONAL ASSESSMENT → PERSONALIZED PROGRAM → STRUCTURED PRACTICE →
// MOVEMENT MEASUREMENT → PROGRESS ANALYSIS → PROFESSIONAL REVIEW → UPDATED PROGRAM
//
// Design rules (docs/NEUROMOVE_PEDIATRIC_REHABILITATION_ARCHITECTURE.md):
//  - Ten record kinds in ONE local store ('rehab') and ONE server table (nm_rehab_records), all going
//    through the existing outbox → /api/sync path. No second persistence architecture.
//  - Participants are the existing pseudonymous Patient records; sensor sessions are the existing
//    Session records; professional notes and approved family summaries are the existing Note records.
//  - Immutable kinds (activity, program, review, assessment, practice) are never edited: a change is a
//    new record (new version, or a record that `supersedes` the old one). PostgreSQL enforces it.
//  - Mutable kinds only move forward through allowed transitions (validate.ts → checkTransition):
//    goal history is append-only; an incident gains a review once; consent can only be withdrawn.
//  - Three kinds of information are never merged into one score: instrument-based assessments,
//    IMU-derived measurements and child/caregiver-reported experience (InformationSource).
//  - Nothing here prescribes treatment. Frequencies and durations are what a professional entered.

import type { ExerciseId } from '../core/exercises';
import type { Workspace } from '../data/models';
import type { Side } from '../devices/types';

/** Every record kind, single source for types, validators, SQL check and policy. */
export const REHAB_KINDS = ['profile', 'goal', 'activity', 'program', 'practice', 'review', 'assessment', 'study', 'consent', 'incident'] as const;
export type RehabKind = (typeof REHAB_KINDS)[number];

/** Kinds whose payload never changes after the first write (enforced client side AND by a PostgreSQL trigger). */
export const IMMUTABLE_KINDS: readonly RehabKind[] = ['activity', 'program', 'review', 'assessment', 'practice'];

/** Who wrote a record, as a category (the person is in createdBy; the server also audits the account). */
export const AUTHOR_ROLES = ['professional', 'caregiver', 'researcher'] as const;
export type AuthorRole = (typeof AUTHOR_ROLES)[number];

/** Three kinds of information that are shown and exported separately and never combined into a score. */
export type InformationSource = 'instrument' | 'imu' | 'reported' | 'professional';

interface RecordBase {
  id: string;
  kind: RehabKind;
  workspace: Workspace;
  /** Existing Patient id (pseudonymous). null for library items, templates and studies. */
  participantId: string | null;
  createdAt: string;
  createdBy: string;
  createdByRole: AuthorRole;
}

// ── Profile ─────────────────────────────────────────────────────────────────────────────────────

export const GOAL_CATEGORIES = ['reaching', 'object_manipulation', 'bilateral_hand_use', 'maintaining_position', 'movement_coordination', 'functional_mobility', 'balance', 'daily_activity', 'other'] as const;
export type GoalCategory = (typeof GOAL_CATEGORIES)[number];

export const AGE_BANDS = ['early', 'middle', 'teen'] as const;
/** Presentation band for the child interface — chosen by the professional, not derived automatically. */
export type AgeBand = (typeof AGE_BANDS)[number];

export const CHILD_THEMES = ['garden', 'space', 'ocean', 'plain'] as const;
export type ChildTheme = (typeof CHILD_THEMES)[number];

export interface ChildPresentation {
  ageBand: AgeBand;
  theme: ChildTheme;
  /** Optional story progression (a path that grows with participation, never with performance). */
  story: boolean;
  textSize: 'normal' | 'large' | 'xlarge';
  reduceMotion: boolean;
  sound: boolean;
  /** Show the measured movement next to the child's own target, when a real measurement exists. */
  showMeasurements: boolean;
}

export const CLASSIFICATION_SYSTEMS = ['GMFCS', 'MACS', 'CFCS', 'other'] as const;

/** A classification entered by a qualified professional. NeuroMove never classifies a child itself. */
export interface ClinicalClassification {
  system: (typeof CLASSIFICATION_SYSTEMS)[number];
  label: string;
  level: string;
  enteredBy: string;
  at: string;
}

export interface RehabProfile extends RecordBase {
  kind: 'profile';
  participantId: string;
  assignedProfessional: string;
  domains: GoalCategory[];
  caregiverParticipation: 'not_set' | 'none' | 'occasional' | 'regular';
  classifications: ClinicalClassification[];
  /** Relevant assessment information, entered by an authorised professional. */
  assessmentSummary: string;
  /** Sensor sessions the professional designated as the individual baseline (empty = none designated). */
  baselineSessionIds: string[];
  child: ChildPresentation;
  updatedAt: string;
  updatedBy: string;
}

// ── Functional goals ───────────────────────────────────────────────────────────────────────────

export const GOAL_STATUSES = ['not_started', 'in_progress', 'needs_review', 'achieved', 'paused'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const GOAL_MEASUREMENT_KINDS = ['gas', 'copm', 'observation', 'caregiver_report', 'imu', 'other'] as const;
export type GoalMeasurementKind = (typeof GOAL_MEASUREMENT_KINDS)[number];

export interface GoalMeasurement {
  kind: GoalMeasurementKind;
  detail: string;
  /** Only for kind 'imu': which existing angle definition is shown next to the goal (context, not a success threshold). */
  exercise: ExerciseId | null;
  side: Side | null;
}

export const GOAL_EVENT_TYPES = ['created', 'edited', 'status', 'progress_note', 'gas_rating', 'family_input'] as const;
export type GoalEventType = (typeof GOAL_EVENT_TYPES)[number];

/** One entry of a goal's append-only history. */
export interface GoalEvent {
  at: string;
  by: string;
  byRole: AuthorRole;
  type: GoalEventType;
  note: string;
  status?: GoalStatus;
  /** GAS level −2…+2 recorded by the professional. */
  gas?: -2 | -1 | 0 | 1 | 2;
  /** Names of the fields changed by an 'edited' event. */
  fields?: string[];
}

export interface FunctionalGoal extends RecordBase {
  kind: 'goal';
  participantId: string;
  category: GoalCategory;
  description: string;
  whyItMatters: string;
  baseline: string;
  /** Target outcome in words. No numeric success threshold is invented by the software. */
  target: string;
  measurement: GoalMeasurement;
  responsible: string;
  reviewDate: string | null;
  status: GoalStatus;
  contributors: ('professional' | 'family' | 'child')[];
  /** ICF-CY categories confirmed by the professional (rehab/icf.ts). Absent = only the category suggestion. */
  icf?: string[];
  history: GoalEvent[];
  updatedAt: string;
}

// ── Activity library (immutable versions) ──────────────────────────────────────────────────────

export const ACTIVITY_STATUSES = ['draft', 'experimental', 'clinician_approved'] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export const MOVEMENT_DOMAINS = ['upper_limb_range', 'reaching', 'grasp_release', 'bimanual', 'posture_trunk', 'mobility', 'balance', 'coordination', 'other'] as const;
export type MovementDomain = (typeof MOVEMENT_DOMAINS)[number];

export const ACTIVITY_MEASUREMENTS = ['imu_session', 'completion_only', 'observation', 'count', 'timed'] as const;
export type ActivityMeasurementKind = (typeof ACTIVITY_MEASUREMENTS)[number];

export const STEP_ICONS = ['sit', 'stand', 'reach', 'grasp', 'two_hands', 'lift', 'turn', 'hold', 'rest', 'breathe', 'cup', 'ball', 'blocks', 'star'] as const;
export type StepIcon = (typeof STEP_ICONS)[number];

export interface ActivityDef {
  name: string;
  description: string;
  goalCategories: GoalCategory[];
  domain: MovementDomain;
  setup: string;
  professionalInstructions: string;
  caregiverInstructions: string;
  /** Visual steps shown in the child and family interfaces. */
  steps: { icon: StepIcon; text: string }[];
  homeSuitable: boolean;
  measurement: { kind: ActivityMeasurementKind; exercise: ExerciseId | null; detail: string };
  completionCriteria: string;
  /** Entered by the professional. */
  safetyNotes: string;
  evidenceRefs: string[];
  language: 'ru' | 'kk' | 'en';
}

/** One immutable version. id = `${seriesId}@${version}`. */
export interface ActivityVersion extends RecordBase {
  kind: 'activity';
  participantId: null;
  seriesId: string;
  version: number;
  status: ActivityStatus;
  def: ActivityDef;
  changeNote: string;
}

// ── Programs (immutable versions) ──────────────────────────────────────────────────────────────

export const MODULE_TYPES = ['assessment', 'supervised', 'home', 'review', 'reassessment'] as const;
export type ModuleType = (typeof MODULE_TYPES)[number];

/** An activity assigned by a professional. Every number here was typed by a professional; nothing is computed. */
export interface Assignment {
  id: string;
  /** Pinned activity version (`act_x@3`). A newer library version does not change this program. */
  activityKey: string;
  setting: 'clinic' | 'home';
  frequencyPerWeek: number | null;
  durationMin: number | null;
  dosageNote: string;
  caregiverNote: string;
  goalIds: string[];
  /**
   * Optional individual target angle, degrees, set by the professional for the child's visual feedback
   * (shown next to the last REAL measurement of this activity's movement). Not a success threshold.
   */
  feedbackTargetDeg: number | null;
}

export interface ProgramModule {
  id: string;
  type: ModuleType;
  title: string;
  notes: string;
  assignments: Assignment[];
}

export const PROGRAM_STATUSES = ['active', 'paused', 'completed'] as const;
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];

export interface ProgramDef {
  name: string;
  description: string;
  responsible: string;
  goalIds: string[];
  domain: MovementDomain;
  startDate: string | null;
  reviewDate: string | null;
  plannedWeeks: number | null;
  plannedSessions: number | null;
  sessionStructure: string;
  measurementRequirements: string;
  modules: ProgramModule[];
  checkpoints: { id: string; date: string; label: string }[];
  notes: string;
  status: ProgramStatus;
}

/** One immutable program version. id = `${seriesId}@${version}`. Templates have no participant. */
export interface ProgramVersion extends RecordBase {
  kind: 'program';
  seriesId: string;
  version: number;
  template: boolean;
  def: ProgramDef;
  /** Why this version exists (required from version 2 on). */
  changeReason: string;
  /** The professional review that led to this version, when there was one. */
  basedOnReviewId: string | null;
  previousKey: string | null;
}

// ── Practice (home and clinic), caregiver reports ──────────────────────────────────────────────

export const COMPLETIONS = ['completed', 'partial', 'not_completed', 'stopped'] as const;
export type Completion = (typeof COMPLETIONS)[number];

export const BARRIERS = ['time', 'child_tired', 'child_unwell', 'child_declined', 'unclear_instructions', 'equipment', 'other'] as const;
export type Barrier = (typeof BARRIERS)[number];

export const PRACTICE_SOURCES = ['caregiver_report', 'professional_entry', 'child_mode'] as const;
export type PracticeSource = (typeof PRACTICE_SOURCES)[number];

/**
 * One practice occasion (or a free observation when `completion` is null). Reported information,
 * not a measurement: `sensorSessionId` is the only link to measured data, and only a professional sets it.
 */
export interface PracticeRecord extends RecordBase {
  kind: 'practice';
  participantId: string;
  programKey: string | null;
  assignmentId: string | null;
  activityKey: string | null;
  setting: 'home' | 'clinic';
  date: string;
  source: PracticeSource;
  completion: Completion | null;
  difficulty: boolean;
  breakRequested: boolean;
  /** Reported fatigue: 0 none, 1 a little, 2 moderate, 3 a lot. Subjective. */
  fatigue: 0 | 1 | 2 | 3 | null;
  /** Reported discomfort. 'pain' always opens a safety incident for professional review. */
  discomfort: 'none' | 'some' | 'pain' | null;
  barriers: Barrier[];
  durationMin: number | null;
  observation: string;
  sensorSessionId: string | null;
  supersedes: string | null;
}

// ── Professional reviews ───────────────────────────────────────────────────────────────────────

export const REVIEW_DECISIONS = ['continue', 'modify_program', 'pause_program', 'reassess', 'refer', 'noted'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const OBSERVATION_RESPONSES = ['agree', 'disagree', 'not_relevant', 'needs_more_data'] as const;
export type ObservationResponse = (typeof OBSERVATION_RESPONSES)[number];

/** Snapshot of an analytical observation as it was shown to the professional (progress.ts). */
export interface ObservationSnapshot {
  id: string;
  ruleId: string;
  ruleVersion: number;
  category: ObservationCategory;
  severity: 'info' | 'review';
  params: Record<string, string | number>;
  evidence: Evidence[];
}

export interface ProgramReview extends RecordBase {
  kind: 'review';
  participantId: string;
  type: 'progress_review' | 'acknowledgement';
  programKey: string | null;
  periodFrom: string | null;
  periodTo: string;
  observations: ObservationSnapshot[];
  responses: { observationId: string; response: ObservationResponse; note: string }[];
  decision: ReviewDecision;
  reasoning: string;
  goalUpdates: { goalId: string; status: GoalStatus }[];
  /** Practice records and incidents this review read (they leave the "unreviewed" lists). */
  acknowledged: string[];
  algorithmVersion: string;
}

// ── Outcome assessments (instrument-based, clinician-entered) ──────────────────────────────────

export const INSTRUMENTS = ['gas', 'copm', 'gmfm66', 'gmfm88', 'other'] as const;
export type InstrumentId = (typeof INSTRUMENTS)[number];

export const TIMEPOINTS = ['baseline', 'interim', 'follow_up', 'discharge'] as const;
export type Timepoint = (typeof TIMEPOINTS)[number];

/**
 * Results only. NeuroMove does not reproduce proprietary forms, items or scoring manuals: the examiner
 * enters the scores produced with the licensed instrument (or, for GAS, the levels of the goals defined here).
 */
export interface OutcomeAssessment extends RecordBase {
  kind: 'assessment';
  participantId: string;
  instrument: InstrumentId;
  instrumentName: string;
  instrumentVersion: string;
  scoringMethod: string;
  examiner: string;
  date: string;
  timepoint: Timepoint;
  studyId: string | null;
  /** Item level results (GAS: one per goal, key = goalId; COPM: one per problem). */
  items: { key: string; label: string; value: number | null; value2: number | null; weight: number | null }[];
  /** Totals as entered (e.g. GMFM-66 score from the official scoring software). */
  totals: { key: string; value: number }[];
  notes: string;
  supersedes: string | null;
}

// ── Research: studies and consent ──────────────────────────────────────────────────────────────

export const STUDY_STATUSES = ['planning', 'approved', 'recruiting', 'active', 'closed'] as const;
export type StudyStatus = (typeof STUDY_STATUSES)[number];

export const EVALUATION_DOMAINS = ['feasibility', 'usability', 'engagement', 'measurement_quality', 'longitudinal'] as const;
export type EvaluationDomain = (typeof EVALUATION_DOMAINS)[number];

export interface Study extends RecordBase {
  kind: 'study';
  participantId: null;
  title: string;
  shortCode: string;
  ethics: { committee: string; reference: string; approvedOn: string | null };
  status: StudyStatus;
  protocolSummary: string;
  domains: EvaluationDomain[];
  startDate: string | null;
  endDate: string | null;
  programTemplateKeys: string[];
  updatedAt: string;
}

export interface ConsentRecord extends RecordBase {
  kind: 'consent';
  participantId: string;
  studyId: string;
  /** Study pseudonym used in exports instead of the participant code (e.g. NM1-007). */
  pseudonym: string;
  guardianPermission: { obtained: boolean; date: string | null; formVersion: string };
  childAssent: 'obtained' | 'not_applicable' | 'declined' | 'not_yet';
  exportAllowed: boolean;
  status: 'active' | 'withdrawn';
  withdrawnAt: string | null;
  withdrawalScope: 'stop_collection' | 'remove_data' | null;
}

// ── Incidents: safety events, protocol deviations, technical failures ──────────────────────────

export const INCIDENT_CATEGORIES = ['safety', 'deviation', 'technical'] as const;
export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];

export const INCIDENT_TYPES = ['pain', 'discomfort', 'fatigue', 'unusual_response', 'fall_or_injury', 'session_stopped', 'protocol_deviation', 'sensor_failure', 'software_failure', 'other'] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

export interface IncidentRecord extends RecordBase {
  kind: 'incident';
  participantId: string;
  category: IncidentCategory;
  type: IncidentType;
  occurredAt: string;
  description: string;
  actionTaken: string;
  relatedPracticeId: string | null;
  relatedSessionId: string | null;
  studyId: string | null;
  /** Added once by a professional; afterwards the incident never changes. */
  review: { at: string; by: string; outcome: string; followUp: string } | null;
}

export type RehabRecord = RehabProfile | FunctionalGoal | ActivityVersion | ProgramVersion | PracticeRecord | ProgramReview | OutcomeAssessment | Study | ConsentRecord | IncidentRecord;

export type RecordOf<K extends RehabKind> = Extract<RehabRecord, { kind: K }>;

// ── Analytics output (progress.ts) ─────────────────────────────────────────────────────────────

export type ObservationCategory = 'safety' | 'data_quality' | 'adherence' | 'reported' | 'measurement' | 'goal' | 'schedule';

/** A pointer to the data an observation was derived from — every observation is traceable. */
export interface Evidence {
  /** 'session' = existing sensor Session; others are rehab record kinds. */
  ref: 'session' | RehabKind;
  id: string;
  label: string;
  value?: number | string;
  unit?: string;
}
