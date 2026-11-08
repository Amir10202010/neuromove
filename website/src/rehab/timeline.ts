// Participant timeline: one continuous history across clinic and home. Every entry keeps its
// information source so measured, instrument-based, reported and professional entries are never
// confused (a caregiver report is never drawn as a measurement).

import { isSimulatedSession, type Note, type Session } from '../data/models';
import type { FunctionalGoal, IncidentRecord, InformationSource, OutcomeAssessment, PracticeRecord, ProgramReview, ProgramVersion } from './model';

export type TimelineType = 'sensor_session' | 'practice' | 'observation' | 'assessment' | 'review' | 'program_version' | 'goal_event' | 'incident' | 'note';

export interface TimelineEntry {
  at: string;
  type: TimelineType;
  source: InformationSource;
  /** Record kind + id the entry links to. */
  ref: { kind: 'session' | 'practice' | 'assessment' | 'review' | 'program' | 'goal' | 'incident' | 'note'; id: string };
  setting: 'clinic' | 'home' | null;
  simulated: boolean;
  /** Short facts for the UI (already-structured values, no free text from other people's notes). */
  facts: Record<string, string | number | boolean>;
}

export interface TimelineInput {
  sessions: readonly Session[];
  practice: readonly PracticeRecord[];
  assessments: readonly OutcomeAssessment[];
  reviews: readonly ProgramReview[];
  programs: readonly ProgramVersion[];
  goals: readonly FunctionalGoal[];
  incidents: readonly IncidentRecord[];
  notes: readonly Note[];
}

export function buildTimeline(x: TimelineInput): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const s of x.sessions)
    out.push({ at: s.startedAt, type: 'sensor_session', source: 'imu', ref: { kind: 'session', id: s.id }, setting: 'clinic', simulated: isSimulatedSession(s), facts: { protocol: s.protocolId, status: s.status, signal: Math.round(s.quality.percent), steps: s.steps.length } });
  for (const p of x.practice)
    out.push({
      at: p.date,
      type: p.completion === null ? 'observation' : 'practice',
      source: p.source === 'professional_entry' ? 'professional' : 'reported',
      ref: { kind: 'practice', id: p.id },
      setting: p.setting,
      simulated: false,
      facts: { completion: p.completion ?? '', source: p.source, measured: p.sensorSessionId !== null, fatigue: p.fatigue ?? '', discomfort: p.discomfort ?? '', difficulty: p.difficulty, breakRequested: p.breakRequested },
    });
  for (const a of x.assessments) out.push({ at: a.date, type: 'assessment', source: 'instrument', ref: { kind: 'assessment', id: a.id }, setting: 'clinic', simulated: false, facts: { instrument: a.instrumentName, timepoint: a.timepoint } });
  for (const r of x.reviews) out.push({ at: r.createdAt, type: 'review', source: 'professional', ref: { kind: 'review', id: r.id }, setting: null, simulated: false, facts: { decision: r.decision, reviewType: r.type, observations: r.observations.length } });
  for (const p of x.programs)
    if (!p.template) out.push({ at: p.createdAt, type: 'program_version', source: 'professional', ref: { kind: 'program', id: p.id }, setting: null, simulated: false, facts: { name: p.def.name, version: p.version, status: p.def.status, fromReview: p.basedOnReviewId !== null } });
  for (const g of x.goals)
    for (const e of g.history)
      out.push({ at: e.at, type: 'goal_event', source: e.byRole === 'caregiver' ? 'reported' : 'professional', ref: { kind: 'goal', id: g.id }, setting: null, simulated: false, facts: { event: e.type, status: e.status ?? '', gas: e.gas ?? '' } });
  for (const i of x.incidents)
    out.push({ at: i.occurredAt, type: 'incident', source: i.createdByRole === 'caregiver' ? 'reported' : 'professional', ref: { kind: 'incident', id: i.id }, setting: null, simulated: false, facts: { category: i.category, incident: i.type, reviewed: i.review !== null } });
  for (const n of x.notes) out.push({ at: n.createdAt, type: 'note', source: 'professional', ref: { kind: 'note', id: n.id }, setting: null, simulated: false, facts: { noteKind: n.kind } });
  return out.sort((a, b) => b.at.localeCompare(a.at));
}
