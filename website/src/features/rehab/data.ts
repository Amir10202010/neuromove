// Hooks that bring together the existing workspace data (patients, sensor sessions, notes) and the
// rehab records of the current workspace — one participant at a time.

import { useEffect, useMemo } from 'react';
import type { Patient } from '../../data/models';
import type { FunctionalGoal, IncidentRecord, OutcomeAssessment, PracticeRecord, ProgramReview, ProgramVersion, RehabProfile, ActivityVersion, Study, ConsentRecord } from '../../rehab/model';
import { analyze, type Observation } from '../../rehab/progress';
import { currentProgram } from '../../rehab/programs';
import { ofKind, useRehabStore } from '../../rehab/store';
import { useWorkspaceData } from '../../state/appStore';

export function useRehabLoaded(): boolean {
  const loaded = useRehabStore((s) => s.loaded);
  const load = useRehabStore((s) => s.load);
  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);
  return loaded;
}

export interface ParticipantData {
  patient: Patient | undefined;
  profile: RehabProfile | null;
  goals: FunctionalGoal[];
  programs: ProgramVersion[];
  program: ProgramVersion | null;
  practice: PracticeRecord[];
  incidents: IncidentRecord[];
  reviews: ProgramReview[];
  assessments: OutcomeAssessment[];
  activities: ActivityVersion[];
  sessions: ReturnType<typeof useWorkspaceData>['sessions'];
  notes: ReturnType<typeof useWorkspaceData>['notes'];
  observations: Observation[];
  demo: boolean;
}

export function useParticipant(id: string): ParticipantData {
  const { ws, patients, sessions, notes } = useWorkspaceData();
  const records = useRehabStore((s) => s.records);
  return useMemo(() => {
    const patient = patients.find((p) => p.id === id);
    const profile = ofKind(records, 'profile', ws, id)[0] ?? null;
    const goals = ofKind(records, 'goal', ws, id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const programs = ofKind(records, 'program', ws).filter((p) => p.participantId === id);
    const program = currentProgram(programs, id);
    const practice = ofKind(records, 'practice', ws, id).sort((a, b) => b.date.localeCompare(a.date));
    const incidents = ofKind(records, 'incident', ws, id).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    const reviews = ofKind(records, 'review', ws, id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const assessments = ofKind(records, 'assessment', ws, id).sort((a, b) => b.date.localeCompare(a.date));
    const activities = ofKind(records, 'activity', ws);
    const mySessions = sessions.filter((s) => s.patientId === id);
    const myNotes = notes.filter((n) => n.patientId === id);
    const demo = ws === 'demo';
    const observations = analyze({ participantId: id, now: new Date(), demo, profile, goals, program, practice, incidents, reviews, assessments, sessions: mySessions });
    return { patient, profile, goals, programs, program, practice, incidents, reviews, assessments, activities, sessions: mySessions, notes: myNotes, observations, demo };
  }, [id, ws, patients, sessions, notes, records]);
}

export function useLibrary(): { activities: ActivityVersion[]; templates: ProgramVersion[]; studies: Study[]; consents: ConsentRecord[] } {
  const { ws } = useWorkspaceData();
  const records = useRehabStore((s) => s.records);
  return useMemo(
    () => ({ activities: ofKind(records, 'activity', ws), templates: ofKind(records, 'program', ws).filter((p) => p.template), studies: ofKind(records, 'study', ws), consents: ofKind(records, 'consent', ws) }),
    [records, ws],
  );
}

export const activityByKey = (all: readonly ActivityVersion[], key: string) => all.find((a) => a.id === key);
