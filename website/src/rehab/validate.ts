// Structural validation and allowed transitions of rehab records. Shared by the browser (records loaded
// from disk or pulled from the server) and the server (records pushed by clients). Nothing is trusted
// that did not pass here.

import { EXERCISE_IDS } from '../core/exercises';
import { ICF_CODES } from './icf';
import {
  ACTIVITY_MEASUREMENTS,
  ACTIVITY_STATUSES,
  AGE_BANDS,
  AUTHOR_ROLES,
  BARRIERS,
  CHILD_THEMES,
  CLASSIFICATION_SYSTEMS,
  COMPLETIONS,
  EVALUATION_DOMAINS,
  GOAL_CATEGORIES,
  GOAL_EVENT_TYPES,
  GOAL_MEASUREMENT_KINDS,
  GOAL_STATUSES,
  IMMUTABLE_KINDS,
  INCIDENT_CATEGORIES,
  INCIDENT_TYPES,
  INSTRUMENTS,
  MODULE_TYPES,
  MOVEMENT_DOMAINS,
  OBSERVATION_RESPONSES,
  PRACTICE_SOURCES,
  PROGRAM_STATUSES,
  REHAB_KINDS,
  REVIEW_DECISIONS,
  STEP_ICONS,
  STUDY_STATUSES,
  TIMEPOINTS,
  type RehabRecord,
} from './model';

type Obj = Record<string, unknown>;
const obj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x: unknown, max = 300): x is string => typeof x === 'string' && x.length <= max;
const nonEmpty = (x: unknown, max = 300) => str(x, max) && (x as string).trim().length > 0;
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const date = (x: unknown) => str(x, 40) && Number.isFinite(Date.parse(x as string));
const nDate = (x: unknown) => x === null || date(x);
const nNum = (x: unknown, lo = -1e9, hi = 1e9) => x === null || (num(x) && x >= lo && x <= hi);
const oneOf = (x: unknown, xs: readonly unknown[]) => xs.includes(x);
const intIn = (x: unknown, lo: number, hi: number) => Number.isInteger(x) && (x as number) >= lo && (x as number) <= hi;
const arr = (x: unknown, max: number, f: (v: unknown) => boolean): x is unknown[] => Array.isArray(x) && x.length <= max && x.every(f);
const bool = (x: unknown): x is boolean => typeof x === 'boolean';
const id = (x: unknown) => nonEmpty(x, 120) && /^[\w@.:-]+$/.test(x as string);
const nId = (x: unknown) => x === null || id(x);

const SHORT = 300;
const TEXT = 4000;
const LONG = 20_000;

function base(x: Obj): boolean {
  return id(x.id) && oneOf(x.kind, REHAB_KINDS) && oneOf(x.workspace, ['clinic', 'demo']) && nId(x.participantId) && date(x.createdAt) && str(x.createdBy, 200) && oneOf(x.createdByRole, AUTHOR_ROLES);
}

const child = (c: unknown) =>
  obj(c) && oneOf(c.ageBand, AGE_BANDS) && oneOf(c.theme, CHILD_THEMES) && bool(c.story) && oneOf(c.textSize, ['normal', 'large', 'xlarge']) && bool(c.reduceMotion) && bool(c.sound) && bool(c.showMeasurements);

const goalEvent = (e: unknown) =>
  obj(e) &&
  date(e.at) &&
  str(e.by, 200) &&
  oneOf(e.byRole, AUTHOR_ROLES) &&
  oneOf(e.type, GOAL_EVENT_TYPES) &&
  str(e.note, TEXT) &&
  (e.status === undefined || oneOf(e.status, GOAL_STATUSES)) &&
  (e.gas === undefined || oneOf(e.gas, [-2, -1, 0, 1, 2])) &&
  (e.fields === undefined || arr(e.fields, 30, (f) => str(f, 60)));

const evidence = (e: unknown) => obj(e) && oneOf(e.ref, ['session', ...REHAB_KINDS]) && id(e.id) && str(e.label, SHORT) && (e.value === undefined || num(e.value) || str(e.value, SHORT)) && (e.unit === undefined || str(e.unit, 20));

const observation = (o: unknown) =>
  obj(o) &&
  nonEmpty(o.id, 200) &&
  nonEmpty(o.ruleId, 80) &&
  intIn(o.ruleVersion, 1, 1000) &&
  oneOf(o.category, ['safety', 'data_quality', 'adherence', 'reported', 'measurement', 'goal', 'schedule']) &&
  oneOf(o.severity, ['info', 'review']) &&
  obj(o.params) &&
  Object.values(o.params).every((v) => num(v) || str(v, SHORT)) &&
  arr(o.evidence, 200, evidence);

const assignment = (a: unknown) =>
  obj(a) &&
  id(a.id) &&
  id(a.activityKey) &&
  oneOf(a.setting, ['clinic', 'home']) &&
  nNum(a.frequencyPerWeek, 0, 50) &&
  nNum(a.durationMin, 0, 600) &&
  str(a.dosageNote, TEXT) &&
  str(a.caregiverNote, TEXT) &&
  arr(a.goalIds, 50, id) &&
  nNum(a.feedbackTargetDeg, -180, 360);

const programDef = (d: unknown) =>
  obj(d) &&
  nonEmpty(d.name, 200) &&
  str(d.description, TEXT) &&
  str(d.responsible, 200) &&
  arr(d.goalIds, 50, id) &&
  oneOf(d.domain, MOVEMENT_DOMAINS) &&
  nDate(d.startDate) &&
  nDate(d.reviewDate) &&
  nNum(d.plannedWeeks, 0, 520) &&
  nNum(d.plannedSessions, 0, 5000) &&
  str(d.sessionStructure, TEXT) &&
  str(d.measurementRequirements, TEXT) &&
  arr(d.modules, 30, (m) => obj(m) && id(m.id) && oneOf(m.type, MODULE_TYPES) && str(m.title, 200) && str(m.notes, TEXT) && arr(m.assignments, 50, assignment)) &&
  arr(d.checkpoints, 50, (c) => obj(c) && id(c.id) && date(c.date) && str(c.label, 200)) &&
  str(d.notes, LONG) &&
  oneOf(d.status, PROGRAM_STATUSES);

const activityDef = (d: unknown) =>
  obj(d) &&
  nonEmpty(d.name, 200) &&
  str(d.description, TEXT) &&
  arr(d.goalCategories, 20, (c) => oneOf(c, GOAL_CATEGORIES)) &&
  oneOf(d.domain, MOVEMENT_DOMAINS) &&
  str(d.setup, TEXT) &&
  str(d.professionalInstructions, LONG) &&
  str(d.caregiverInstructions, LONG) &&
  arr(d.steps, 20, (s) => obj(s) && oneOf(s.icon, STEP_ICONS) && str(s.text, SHORT)) &&
  bool(d.homeSuitable) &&
  obj(d.measurement) &&
  oneOf(d.measurement.kind, ACTIVITY_MEASUREMENTS) &&
  (d.measurement.exercise === null || oneOf(d.measurement.exercise, EXERCISE_IDS)) &&
  str(d.measurement.detail, TEXT) &&
  str(d.completionCriteria, TEXT) &&
  str(d.safetyNotes, TEXT) &&
  arr(d.evidenceRefs, 30, (r) => str(r, 500)) &&
  oneOf(d.language, ['ru', 'kk', 'en']);

const VALIDATORS: { [K in RehabRecord['kind']]: (x: Obj) => boolean } = {
  profile: (x) =>
    id(x.participantId) &&
    str(x.assignedProfessional, 200) &&
    arr(x.domains, 20, (c) => oneOf(c, GOAL_CATEGORIES)) &&
    oneOf(x.caregiverParticipation, ['not_set', 'none', 'occasional', 'regular']) &&
    arr(x.classifications, 20, (c) => obj(c) && oneOf(c.system, CLASSIFICATION_SYSTEMS) && str(c.label, 100) && str(c.level, 40) && str(c.enteredBy, 200) && date(c.at)) &&
    str(x.assessmentSummary, LONG) &&
    arr(x.baselineSessionIds, 20, id) &&
    child(x.child) &&
    date(x.updatedAt) &&
    str(x.updatedBy, 200),
  goal: (x) =>
    id(x.participantId) &&
    oneOf(x.category, GOAL_CATEGORIES) &&
    nonEmpty(x.description, TEXT) &&
    str(x.whyItMatters, TEXT) &&
    str(x.baseline, TEXT) &&
    str(x.target, TEXT) &&
    obj(x.measurement) &&
    oneOf(x.measurement.kind, GOAL_MEASUREMENT_KINDS) &&
    str(x.measurement.detail, TEXT) &&
    (x.measurement.exercise === null || oneOf(x.measurement.exercise, EXERCISE_IDS)) &&
    (x.measurement.side === null || oneOf(x.measurement.side, ['left', 'right'])) &&
    str(x.responsible, 200) &&
    nDate(x.reviewDate) &&
    oneOf(x.status, GOAL_STATUSES) &&
    arr(x.contributors, 3, (c) => oneOf(c, ['professional', 'family', 'child'])) &&
    (x.icf === undefined || arr(x.icf, 12, (c) => oneOf(c, ICF_CODES))) &&
    arr(x.history, 2000, goalEvent) &&
    (x.history as unknown[]).length > 0 &&
    date(x.updatedAt),
  activity: (x) =>
    x.participantId === null &&
    id(x.seriesId) &&
    intIn(x.version, 1, 100000) &&
    x.id === `${x.seriesId}@${x.version}` &&
    oneOf(x.status, ACTIVITY_STATUSES) &&
    activityDef(x.def) &&
    str(x.changeNote, TEXT),
  program: (x) =>
    id(x.seriesId) &&
    intIn(x.version, 1, 100000) &&
    x.id === `${x.seriesId}@${x.version}` &&
    bool(x.template) &&
    // A template belongs to nobody; an individual program belongs to exactly one participant
    (x.template ? x.participantId === null : id(x.participantId)) &&
    programDef(x.def) &&
    str(x.changeReason, TEXT) &&
    (x.version === 1 || nonEmpty(x.changeReason, TEXT)) &&
    nId(x.basedOnReviewId) &&
    nId(x.previousKey),
  practice: (x) =>
    id(x.participantId) &&
    nId(x.programKey) &&
    nId(x.assignmentId) &&
    nId(x.activityKey) &&
    oneOf(x.setting, ['home', 'clinic']) &&
    date(x.date) &&
    oneOf(x.source, PRACTICE_SOURCES) &&
    (x.completion === null || oneOf(x.completion, COMPLETIONS)) &&
    bool(x.difficulty) &&
    bool(x.breakRequested) &&
    (x.fatigue === null || oneOf(x.fatigue, [0, 1, 2, 3])) &&
    (x.discomfort === null || oneOf(x.discomfort, ['none', 'some', 'pain'])) &&
    arr(x.barriers, BARRIERS.length, (b) => oneOf(b, BARRIERS)) &&
    nNum(x.durationMin, 0, 600) &&
    str(x.observation, TEXT) &&
    nId(x.sensorSessionId) &&
    // Only a professional links a sensor session: a caregiver report is never presented as a measurement
    (x.sensorSessionId === null || x.source === 'professional_entry') &&
    nId(x.supersedes),
  review: (x) =>
    id(x.participantId) &&
    oneOf(x.type, ['progress_review', 'acknowledgement']) &&
    nId(x.programKey) &&
    nDate(x.periodFrom) &&
    date(x.periodTo) &&
    arr(x.observations, 100, observation) &&
    arr(x.responses, 100, (r) => obj(r) && nonEmpty(r.observationId, 200) && oneOf(r.response, OBSERVATION_RESPONSES) && str(r.note, TEXT)) &&
    oneOf(x.decision, REVIEW_DECISIONS) &&
    str(x.reasoning, LONG) &&
    // A progress review records the professional's reasoning; an acknowledgement may be a click
    (x.type === 'acknowledgement' || nonEmpty(x.reasoning, LONG)) &&
    arr(x.goalUpdates, 50, (g) => obj(g) && id(g.goalId) && oneOf(g.status, GOAL_STATUSES)) &&
    arr(x.acknowledged, 1000, id) &&
    str(x.algorithmVersion, 100),
  assessment: (x) =>
    id(x.participantId) &&
    oneOf(x.instrument, INSTRUMENTS) &&
    nonEmpty(x.instrumentName, 200) &&
    str(x.instrumentVersion, 100) &&
    str(x.scoringMethod, TEXT) &&
    nonEmpty(x.examiner, 200) &&
    date(x.date) &&
    oneOf(x.timepoint, TIMEPOINTS) &&
    nId(x.studyId) &&
    arr(x.items, 200, (i) => obj(i) && nonEmpty(i.key, 120) && str(i.label, SHORT) && nNum(i.value) && nNum(i.value2) && nNum(i.weight, 0, 100)) &&
    arr(x.totals, 50, (t) => obj(t) && nonEmpty(t.key, 80) && num(t.value)) &&
    (x.instrument !== 'gas' || (x.items as Obj[]).every((i) => i.value === null || oneOf(i.value, [-2, -1, 0, 1, 2]))) &&
    (x.instrument !== 'copm' || (x.items as Obj[]).every((i) => nNum(i.value, 1, 10) && nNum(i.value2, 1, 10))) &&
    str(x.notes, LONG) &&
    nId(x.supersedes),
  study: (x) =>
    x.participantId === null &&
    nonEmpty(x.title, 300) &&
    nonEmpty(x.shortCode, 20) &&
    /^[A-Za-z0-9-]+$/.test(x.shortCode as string) &&
    obj(x.ethics) &&
    str(x.ethics.committee, SHORT) &&
    str(x.ethics.reference, SHORT) &&
    nDate(x.ethics.approvedOn) &&
    oneOf(x.status, STUDY_STATUSES) &&
    // A study cannot be recruiting or active without a recorded ethics approval
    (!['recruiting', 'active'].includes(x.status as string) || x.ethics.approvedOn !== null) &&
    str(x.protocolSummary, LONG) &&
    arr(x.domains, EVALUATION_DOMAINS.length, (d) => oneOf(d, EVALUATION_DOMAINS)) &&
    nDate(x.startDate) &&
    nDate(x.endDate) &&
    arr(x.programTemplateKeys, 50, id) &&
    date(x.updatedAt),
  consent: (x) =>
    id(x.participantId) &&
    id(x.studyId) &&
    nonEmpty(x.pseudonym, 40) &&
    /^[A-Za-z0-9-]+$/.test(x.pseudonym as string) &&
    obj(x.guardianPermission) &&
    bool(x.guardianPermission.obtained) &&
    nDate(x.guardianPermission.date) &&
    str(x.guardianPermission.formVersion, 100) &&
    oneOf(x.childAssent, ['obtained', 'not_applicable', 'declined', 'not_yet']) &&
    bool(x.exportAllowed) &&
    oneOf(x.status, ['active', 'withdrawn']) &&
    nDate(x.withdrawnAt) &&
    (x.withdrawalScope === null || oneOf(x.withdrawalScope, ['stop_collection', 'remove_data'])) &&
    (x.status === 'active' ? x.withdrawnAt === null : x.withdrawnAt !== null),
  incident: (x) =>
    id(x.participantId) &&
    oneOf(x.category, INCIDENT_CATEGORIES) &&
    oneOf(x.type, INCIDENT_TYPES) &&
    date(x.occurredAt) &&
    str(x.description, TEXT) &&
    str(x.actionTaken, TEXT) &&
    nId(x.relatedPracticeId) &&
    nId(x.relatedSessionId) &&
    nId(x.studyId) &&
    (x.review === null || (obj(x.review) && date(x.review.at) && nonEmpty(x.review.by, 200) && nonEmpty(x.review.outcome, TEXT) && str(x.review.followUp, TEXT))),
};

export function validRehabRecord(x: unknown): x is RehabRecord {
  if (!obj(x) || !base(x)) return false;
  const v = VALIDATORS[x.kind as RehabRecord['kind']];
  try {
    return !!v && v(x);
  } catch {
    return false;
  }
}

/** Canonical JSON (sorted keys, undefined dropped) — "is this the same record?" */
export function canonicalJson(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonicalJson).join(',')}]`;
  if (x && typeof x === 'object')
    return `{${Object.keys(x as object)
      .sort()
      .filter((k) => (x as Obj)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((x as Obj)[k])}`)
      .join(',')}}`;
  return JSON.stringify(x);
}

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const without = (x: Obj, keys: string[]) => Object.fromEntries(Object.entries(x).filter(([k]) => !keys.includes(k)));

export type TransitionProblem = 'immutable' | 'kind_changed' | 'identity_changed' | 'history_rewritten' | 'incident_changed' | 'consent_changed' | null;

/**
 * Can `next` replace `prev` (same id)? Historical integrity rules, enforced on the device AND on the server:
 *  - immutable kinds: never (a change is a new version or a superseding record)
 *  - identity (kind, workspace, participant, creation) never changes
 *  - goal: history only grows; existing entries are never edited or removed
 *  - incident: only `review` may be added, once
 *  - consent: only withdrawal (active → withdrawn), with its date and scope
 */
export function checkTransition(prev: RehabRecord, next: RehabRecord): TransitionProblem {
  if (same(prev, next)) return null;
  if (prev.kind !== next.kind) return 'kind_changed';
  if ((IMMUTABLE_KINDS as readonly string[]).includes(prev.kind)) return 'immutable';
  if (prev.workspace !== next.workspace || prev.participantId !== next.participantId || prev.createdAt !== next.createdAt || prev.createdBy !== next.createdBy || prev.createdByRole !== next.createdByRole) return 'identity_changed';
  if (prev.kind === 'goal' && next.kind === 'goal') {
    if (next.history.length < prev.history.length || !same(prev.history, next.history.slice(0, prev.history.length))) return 'history_rewritten';
  }
  if (prev.kind === 'incident' && next.kind === 'incident') {
    if (prev.review !== null || !same(without(prev as unknown as Obj, ['review']), without(next as unknown as Obj, ['review']))) return 'incident_changed';
  }
  if (prev.kind === 'consent' && next.kind === 'consent') {
    const fixed = ['status', 'withdrawnAt', 'withdrawalScope', 'exportAllowed'];
    if (prev.status !== 'active' || next.status !== 'withdrawn' || !same(without(prev as unknown as Obj, fixed), without(next as unknown as Obj, fixed))) return 'consent_changed';
  }
  return null;
}
