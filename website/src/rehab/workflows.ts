// Record builders for the home-to-clinic workflow (pure). The store persists what these return,
// atomically. None of these functions changes a program, a goal target or a dose.

import { newId } from '../lib/ids';
import type { Workspace } from '../data/models';
import { addGoalEvent } from './goals';
import type {
  AuthorRole,
  ChildPresentation,
  ConsentRecord,
  FunctionalGoal,
  GoalStatus,
  IncidentRecord,
  ObservationResponse,
  OutcomeAssessment,
  PracticeRecord,
  ProgramReview,
  RehabProfile,
  ReviewDecision,
  Study,
} from './model';
import { PROGRESS_ALGORITHM, type Observation } from './progress';

export const DEFAULT_CHILD: ChildPresentation = { ageBand: 'middle', theme: 'garden', story: true, textSize: 'large', reduceMotion: false, sound: false, showMeasurements: true };

export function newProfile(participantId: string, ws: Workspace, author: string, now = new Date()): RehabProfile {
  const at = now.toISOString();
  return {
    id: `rp_${participantId}`,
    kind: 'profile',
    workspace: ws,
    participantId,
    createdAt: at,
    createdBy: author,
    createdByRole: 'professional',
    assignedProfessional: author,
    domains: [],
    caregiverParticipation: 'not_set',
    classifications: [],
    assessmentSummary: '',
    baselineSessionIds: [],
    child: { ...DEFAULT_CHILD },
    updatedAt: at,
    updatedBy: author,
  };
}

export interface PracticeInput {
  participantId: string;
  programKey: string | null;
  assignmentId: string | null;
  activityKey: string | null;
  setting: PracticeRecord['setting'];
  source: PracticeRecord['source'];
  completion: PracticeRecord['completion'];
  difficulty: boolean;
  breakRequested: boolean;
  fatigue: PracticeRecord['fatigue'];
  discomfort: PracticeRecord['discomfort'];
  barriers: PracticeRecord['barriers'];
  durationMin: number | null;
  observation: string;
  sensorSessionId?: string | null;
  date?: string;
}

/**
 * A practice report. Pain → a SAFETY incident for professional review, in the same atomic save.
 * A stopped session → a 'session_stopped' safety incident. Nothing else happens automatically:
 * no reminder escalation, no score, no penalty for "not completed".
 */
export function reportPractice(input: PracticeInput, ws: Workspace, author: string, role: AuthorRole, now = new Date()): { practice: PracticeRecord; incidents: IncidentRecord[] } {
  const at = now.toISOString();
  const practice: PracticeRecord = {
    id: newId('pr'),
    kind: 'practice',
    workspace: ws,
    participantId: input.participantId,
    createdAt: at,
    createdBy: author,
    createdByRole: role,
    programKey: input.programKey,
    assignmentId: input.assignmentId,
    activityKey: input.activityKey,
    setting: input.setting,
    date: input.date ?? at,
    source: input.source,
    completion: input.completion,
    difficulty: input.difficulty,
    breakRequested: input.breakRequested,
    fatigue: input.fatigue,
    discomfort: input.discomfort,
    barriers: [...new Set(input.barriers)],
    durationMin: input.durationMin,
    observation: input.observation.trim(),
    sensorSessionId: input.sensorSessionId ?? null,
    supersedes: null,
  };
  const incidents: IncidentRecord[] = [];
  const incident = (type: IncidentRecord['type']): IncidentRecord => ({
    id: newId('inc'),
    kind: 'incident',
    workspace: ws,
    participantId: input.participantId,
    createdAt: at,
    createdBy: author,
    createdByRole: role,
    category: 'safety',
    type,
    occurredAt: practice.date,
    description: practice.observation,
    actionTaken: type === 'session_stopped' || input.completion === 'stopped' ? 'stopped' : '',
    relatedPracticeId: practice.id,
    relatedSessionId: null,
    studyId: null,
    review: null,
  });
  if (input.discomfort === 'pain') incidents.push(incident('pain'));
  else if (input.completion === 'stopped') incidents.push(incident('session_stopped'));
  return { practice, incidents };
}

export function newIncident(args: Pick<IncidentRecord, 'participantId' | 'category' | 'type' | 'occurredAt' | 'description' | 'actionTaken' | 'relatedPracticeId' | 'relatedSessionId' | 'studyId'>, ws: Workspace, author: string, role: AuthorRole, now = new Date()): IncidentRecord {
  return { id: newId('inc'), kind: 'incident', workspace: ws, createdAt: now.toISOString(), createdBy: author, createdByRole: role, review: null, ...args };
}

export function reviewIncident(i: IncidentRecord, by: string, outcome: string, followUp: string, now = new Date()): IncidentRecord {
  return { ...i, review: { at: now.toISOString(), by, outcome, followUp } };
}

export interface ReviewInput {
  participantId: string;
  programKey: string | null;
  periodFrom: string | null;
  observations: readonly Observation[];
  responses: { observationId: string; response: ObservationResponse; note: string }[];
  decision: ReviewDecision;
  reasoning: string;
  goalUpdates: { goalId: string; status: GoalStatus }[];
  acknowledged: string[];
}

/**
 * A professional review: an immutable record of what the system showed, how the professional read it,
 * what they decided and why. Goal status changes ride along as goal-history entries (same atomic save).
 * A program change is NOT made here: when the decision is 'modify_program', the professional edits the
 * program and the new version points back at this review (basedOnReviewId).
 */
export function recordReview(input: ReviewInput, goals: readonly FunctionalGoal[], ws: Workspace, author: string, now = new Date()): { review: ProgramReview; goals: FunctionalGoal[] } {
  const at = now.toISOString();
  const review: ProgramReview = {
    id: newId('rev'),
    kind: 'review',
    workspace: ws,
    participantId: input.participantId,
    createdAt: at,
    createdBy: author,
    createdByRole: 'professional',
    type: 'progress_review',
    programKey: input.programKey,
    periodFrom: input.periodFrom,
    periodTo: at,
    observations: input.observations.map((o) => structuredClone(o)),
    responses: input.responses,
    decision: input.decision,
    reasoning: input.reasoning.trim(),
    goalUpdates: input.goalUpdates,
    acknowledged: [...new Set(input.acknowledged)],
    algorithmVersion: PROGRESS_ALGORITHM,
  };
  const updated: FunctionalGoal[] = [];
  for (const u of input.goalUpdates) {
    const g = goals.find((x) => x.id === u.goalId);
    if (!g || g.status === u.status) continue;
    updated.push({ ...addGoalEvent(g, { by: author, byRole: 'professional', type: 'status', status: u.status, note: `review ${review.id}` }, now), status: u.status });
  }
  return { review, goals: updated };
}

/** "Seen" for reports and incidents without a full progress review. */
export function acknowledge(participantId: string, ids: string[], ws: Workspace, author: string, now = new Date()): ProgramReview {
  const at = now.toISOString();
  return {
    id: newId('rev'),
    kind: 'review',
    workspace: ws,
    participantId,
    createdAt: at,
    createdBy: author,
    createdByRole: 'professional',
    type: 'acknowledgement',
    programKey: null,
    periodFrom: null,
    periodTo: at,
    observations: [],
    responses: [],
    decision: 'noted',
    reasoning: '',
    goalUpdates: [],
    acknowledged: [...new Set(ids)],
    algorithmVersion: PROGRESS_ALGORITHM,
  };
}

export function newAssessment(args: Omit<OutcomeAssessment, 'id' | 'kind' | 'workspace' | 'createdAt' | 'createdBy' | 'createdByRole'>, ws: Workspace, author: string, now = new Date()): OutcomeAssessment {
  return { id: newId('oa'), kind: 'assessment', workspace: ws, createdAt: now.toISOString(), createdBy: author, createdByRole: 'professional', ...structuredClone(args) };
}

export function newStudy(args: Pick<Study, 'title' | 'shortCode' | 'ethics' | 'protocolSummary' | 'domains' | 'startDate' | 'endDate' | 'programTemplateKeys'>, ws: Workspace, author: string, now = new Date()): Study {
  const at = now.toISOString();
  return { id: newId('study'), kind: 'study', workspace: ws, participantId: null, createdAt: at, createdBy: author, createdByRole: 'researcher', status: 'planning', updatedAt: at, ...structuredClone(args) };
}

export function newConsent(args: Pick<ConsentRecord, 'participantId' | 'studyId' | 'pseudonym' | 'guardianPermission' | 'childAssent' | 'exportAllowed'>, ws: Workspace, author: string, now = new Date()): ConsentRecord {
  return { id: newId('cons'), kind: 'consent', workspace: ws, createdAt: now.toISOString(), createdBy: author, createdByRole: 'professional', status: 'active', withdrawnAt: null, withdrawalScope: null, ...structuredClone(args) };
}

export function withdrawConsent(c: ConsentRecord, scope: NonNullable<ConsentRecord['withdrawalScope']>, now = new Date()): ConsentRecord {
  return { ...c, status: 'withdrawn', withdrawnAt: now.toISOString(), withdrawalScope: scope, exportAllowed: scope === 'remove_data' ? false : c.exportAllowed };
}
