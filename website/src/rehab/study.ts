// Research pilot infrastructure: enrolment rules, pseudonymised study datasets, feasibility report.
//
// Enrolment is only possible in a study with a recorded ethics approval, and only with a guardian
// permission on record. Withdrawn participants stop contributing data from the withdrawal date
// ('stop_collection') or are removed from exports entirely ('remove_data').
//
// Exports are PSEUDONYMISED, not anonymous: participant codes, names, birth years, record ids,
// professional names and free text are removed; dates become study days relative to enrolment;
// ages become bands. Small studies can still be re-identifiable — the manifest says so.

import { isSimulatedSession, type Patient, type Session } from '../data/models';
import { cell } from '../research/export';
import { copmMeans, gasTScore } from './goals';
import type { ConsentRecord, FunctionalGoal, IncidentRecord, OutcomeAssessment, PracticeRecord, ProgramReview, ProgramVersion, Study } from './model';
import { METRIC_ORDER, METRICS, measureSession } from './movement';
import { allAssignments } from './programs';
import { METRIC_ICF, goalIcf } from './icf';
import { ALGORITHM_VERSION } from '../core/version';

export const STUDY_DATASET_FORMAT = 'neuromove-rehab-study-dataset';
export const STUDY_DATASET_SCHEMA = 1;

export type EnrolmentProblem = 'ethics_not_approved' | 'study_not_open' | 'guardian_permission_missing' | 'child_declined' | 'already_enrolled' | 'pseudonym_taken';

export function enrolmentProblems(study: Study, consent: Pick<ConsentRecord, 'participantId' | 'pseudonym' | 'guardianPermission' | 'childAssent'>, existing: readonly ConsentRecord[]): EnrolmentProblem[] {
  const out: EnrolmentProblem[] = [];
  if (!study.ethics.approvedOn) out.push('ethics_not_approved');
  if (!['approved', 'recruiting', 'active'].includes(study.status)) out.push('study_not_open');
  if (!consent.guardianPermission.obtained || !consent.guardianPermission.date) out.push('guardian_permission_missing');
  if (consent.childAssent === 'declined') out.push('child_declined');
  const mine = existing.filter((c) => c.studyId === study.id);
  if (mine.some((c) => c.participantId === consent.participantId && c.status === 'active')) out.push('already_enrolled');
  if (mine.some((c) => c.pseudonym === consent.pseudonym && c.participantId !== consent.participantId)) out.push('pseudonym_taken');
  return out;
}

export function ageBand(birthYear: number, at: Date): string {
  const age = at.getUTCFullYear() - birthYear;
  if (age < 4) return '0-3';
  if (age < 7) return '4-6';
  if (age < 13) return '7-12';
  return '13-18';
}

export interface StudyInput {
  study: Study;
  consents: readonly ConsentRecord[];
  patients: readonly Patient[];
  goals: readonly FunctionalGoal[];
  programs: readonly ProgramVersion[];
  practice: readonly PracticeRecord[];
  sessions: readonly Session[];
  assessments: readonly OutcomeAssessment[];
  incidents: readonly IncidentRecord[];
  reviews: readonly ProgramReview[];
  now: Date;
}

export type Row = Record<string, string | number | boolean | null>;

export interface StudyDataset {
  manifest: {
    format: string;
    schemaVersion: number;
    datasetId: string;
    study: { shortCode: string; title: string; ethicsReference: string; ethicsApprovedOn: string | null };
    createdAt: string;
    algorithmVersion: string;
    participants: number;
    excluded: { withdrawnRemoveData: number; exportNotAllowed: number };
    privacy: string[];
  };
  tables: Record<string, Row[]>;
  dictionary: { table: string; column: string; description: string }[];
}

const DAY = 86400_000;

/** Tokens instead of record ids: stable inside one dataset, meaningless outside it. */
function tokenizer(prefix: string) {
  const map = new Map<string, string>();
  return (id: string | null) => {
    if (id === null) return null;
    if (!map.has(id)) map.set(id, `${prefix}${map.size + 1}`);
    return map.get(id) as string;
  };
}

export function buildStudyDataset(x: StudyInput, datasetId: string): StudyDataset {
  const consents = x.consents.filter((c) => c.studyId === x.study.id);
  const included = consents.filter((c) => c.exportAllowed && !(c.status === 'withdrawn' && c.withdrawalScope === 'remove_data') && c.guardianPermission.obtained);
  const tSession = tokenizer('S');
  const tProgram = tokenizer('PRG');
  const tGoal = tokenizer('G');
  const tables: Record<string, Row[]> = { participants: [], goals: [], programs: [], practice: [], movement: [], assessments: [], incidents: [], reviews: [] };

  for (const c of included) {
    const pid = c.participantId;
    const patient = x.patients.find((p) => p.id === pid);
    const enrolled = Date.parse(c.guardianPermission.date ?? c.createdAt);
    const until = c.status === 'withdrawn' && c.withdrawnAt ? Date.parse(c.withdrawnAt) : Infinity;
    const keep = (iso: string) => Date.parse(iso) <= until;
    const day = (iso: string) => Math.floor((Date.parse(iso) - enrolled) / DAY);
    const ps = c.pseudonym;
    const sessions = x.sessions.filter((s) => s.patientId === pid && !isSimulatedSession(s) && keep(s.startedAt));
    const practice = x.practice.filter((p) => p.participantId === pid && keep(p.date));
    tables.participants!.push({
      participant: ps,
      age_band: patient ? ageBand(patient.birthYear, new Date(enrolled)) : null,
      child_assent: c.childAssent,
      consent_status: c.status,
      withdrawn_day: c.withdrawnAt ? day(c.withdrawnAt) : null,
      sensor_sessions: sessions.length,
      practice_reports: practice.filter((p) => p.completion !== null).length,
    });
    for (const g of x.goals.filter((g) => g.participantId === pid && keep(g.createdAt))) {
      const lastGas = [...g.history].reverse().find((e) => e.gas !== undefined)?.gas ?? null;
      const icf = goalIcf(g);
      tables.goals!.push({ participant: ps, goal: tGoal(g.id), category: g.category, icf: icf.codes.join(';'), icf_confirmed: icf.confirmed, measurement: g.measurement.kind, status: g.status, created_day: day(g.createdAt), history_entries: g.history.length, family_contributed: g.contributors.includes('family'), last_gas_level: lastGas });
    }
    for (const p of x.programs.filter((p) => p.participantId === pid && !p.template && keep(p.createdAt))) {
      const as = allAssignments(p.def);
      tables.programs!.push({ participant: ps, program: tProgram(p.seriesId), version: p.version, created_day: day(p.createdAt), status: p.def.status, modules: p.def.modules.length, home_assignments: as.filter((a) => a.setting === 'home').length, clinic_assignments: as.filter((a) => a.setting === 'clinic').length, from_review: p.basedOnReviewId !== null });
    }
    for (const p of practice)
      tables.practice!.push({
        participant: ps,
        day: day(p.date),
        program: p.programKey ? tProgram(p.programKey.split('@')[0] as string) : null,
        program_version: p.programKey ? Number(p.programKey.split('@')[1]) : null,
        setting: p.setting,
        source: p.source,
        completion: p.completion,
        difficulty: p.difficulty,
        break_requested: p.breakRequested,
        fatigue: p.fatigue,
        discomfort: p.discomfort,
        barriers: p.barriers.join(';'),
        duration_min: p.durationMin,
        sensor_measured: p.sensorSessionId !== null,
      });
    for (const s of sessions)
      for (const m of measureSession(s)) {
        const row: Row = { participant: ps, day: day(s.startedAt), session: tSession(s.id), exercise: m.exercise, side: m.side, eligible: m.eligible, issues: m.issues.join(';'), signal_percent: m.signalPercent, algorithm_version: s.algorithmVersion };
        for (const k of METRIC_ORDER) row[k] = m.values[k] ?? null;
        tables.movement!.push(row);
      }
    for (const a of x.assessments.filter((a) => a.participantId === pid && keep(a.date) && (a.studyId === null || a.studyId === x.study.id))) {
      const superseded = x.assessments.some((b) => b.supersedes === a.id);
      const base = { participant: ps, day: day(a.date), instrument: a.instrument, instrument_version: a.instrumentVersion, timepoint: a.timepoint, superseded };
      for (const t of a.totals) tables.assessments!.push({ ...base, item: `total:${t.key}`, value: t.value, value2: null });
      for (const i of a.items) tables.assessments!.push({ ...base, item: a.instrument === 'gas' ? `goal:${tGoal(i.key)}` : `item:${i.key}`, value: i.value, value2: i.value2 });
      if (a.instrument === 'gas') tables.assessments!.push({ ...base, item: 'derived:gas_t_score', value: gasTScore(a.items), value2: null });
      if (a.instrument === 'copm') {
        const m = copmMeans(a.items);
        tables.assessments!.push({ ...base, item: 'derived:copm_means', value: m.performance, value2: m.satisfaction });
      }
    }
    for (const i of x.incidents.filter((i) => i.participantId === pid && keep(i.occurredAt) && (i.studyId === null || i.studyId === x.study.id)))
      tables.incidents!.push({ participant: ps, day: day(i.occurredAt), category: i.category, type: i.type, reported_by: i.createdByRole, reviewed: i.review !== null });
    for (const r of x.reviews.filter((r) => r.participantId === pid && keep(r.createdAt)))
      tables.reviews!.push({ participant: ps, day: day(r.createdAt), type: r.type, decision: r.decision, observations: r.observations.length, agreed: r.responses.filter((q) => q.response === 'agree').length, disagreed: r.responses.filter((q) => q.response === 'disagree').length, acknowledged: r.acknowledged.length });
  }

  return {
    manifest: {
      format: STUDY_DATASET_FORMAT,
      schemaVersion: STUDY_DATASET_SCHEMA,
      datasetId,
      study: { shortCode: x.study.shortCode, title: x.study.title, ethicsReference: x.study.ethics.reference, ethicsApprovedOn: x.study.ethics.approvedOn },
      createdAt: x.now.toISOString(),
      algorithmVersion: ALGORITHM_VERSION,
      participants: included.length,
      excluded: { withdrawnRemoveData: consents.filter((c) => c.status === 'withdrawn' && c.withdrawalScope === 'remove_data').length, exportNotAllowed: consents.filter((c) => !c.exportAllowed || !c.guardianPermission.obtained).length },
      privacy: [
        'Pseudonymised, not anonymous: small samples may be re-identifiable. Store and share under the approved data-management plan.',
        'Removed: participant codes and names, birth years, record ids, professional names, all free text.',
        'Dates are study days relative to the guardian permission date. Ages are bands.',
        'Simulated sessions are excluded. Data after a withdrawal date are excluded.',
      ],
    },
    tables,
    dictionary: DICTIONARY,
  };
}

const DICTIONARY: StudyDataset['dictionary'] = [
  { table: '*', column: 'participant', description: 'Study pseudonym from the consent record' },
  { table: '*', column: 'day', description: 'Days since guardian permission (enrolment), integer' },
  { table: 'participants', column: 'age_band', description: 'Age band at enrolment: 0-3, 4-6, 7-12, 13-18' },
  { table: 'participants', column: 'withdrawn_day', description: 'Study day of withdrawal, empty if active' },
  { table: 'goals', column: 'icf', description: 'ICF-CY categories (WHO), semicolon-separated' },
  { table: 'goals', column: 'icf_confirmed', description: '1 when the professional confirmed the ICF categories; 0 = suggestion from the goal category' },
  { table: 'goals', column: 'measurement', description: 'How the professional chose to follow the goal (gas, copm, observation, caregiver_report, imu, other)' },
  { table: 'goals', column: 'last_gas_level', description: 'Most recent GAS level −2…+2 recorded in the goal history (professional)' },
  { table: 'programs', column: 'from_review', description: '1 when the version was created from a recorded professional review' },
  { table: 'practice', column: 'source', description: 'caregiver_report | child_mode | professional_entry — REPORTED information, not measured' },
  { table: 'practice', column: 'sensor_measured', description: '1 when a professional linked a sensor session to this practice occasion' },
  { table: 'practice', column: 'fatigue', description: 'Reported fatigue 0 none, 1 a little, 2 moderate, 3 a lot (subjective)' },
  { table: 'movement', column: 'eligible', description: '1 when the step passed data-quality checks (signal ≥ 90 %, ≥ 3 repetitions, no blocking flags)' },
  ...METRIC_ORDER.map((k) => ({ table: 'movement', column: k, description: `${METRICS[k].definition} Unit: ${METRICS[k].unit || 'none'}. ICF: ${METRIC_ICF[k]} (body function). Validation: ${METRICS[k].validation} (not clinically validated).` })),
  { table: 'assessments', column: 'item', description: 'total:<key> as entered; goal:<token> GAS level; item:<key> instrument item; derived:* computed by NeuroMove with a documented formula' },
  { table: 'assessments', column: 'superseded', description: '1 when a later record corrected this one (keep for audit, usually exclude)' },
  { table: 'incidents', column: 'category', description: 'safety | deviation | technical' },
  { table: 'reviews', column: 'decision', description: 'Professional decision recorded at review' },
];

export function tableCsv(rows: readonly Row[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0] as Row);
  return '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c] as string | number | boolean | null)).join(','))].join('\n') + '\n';
}

// ── Feasibility / evaluation report ────────────────────────────────────────────────────────────

export interface StudyReport {
  feasibility: { enrolled: number; withdrawn: number; sensorSessions: number; incompleteSessions: number; technicalIncidents: number; eligibleStepShare: number | null; baselineAssessed: number; followUpAssessed: number };
  engagement: { reports: number; completed: number; partial: number; notCompleted: number; stopped: number; perWeek: { week: number; reports: number; completed: number }[]; barriers: Record<string, number> };
  measurementQuality: { steps: number; eligible: number; issues: Record<string, number>; meanSignal: number | null };
  safety: { incidents: number; safety: number; reviewed: number; byType: Record<string, number> };
  goals: { total: number; byStatus: Record<string, number>; gasChanges: { participant: string; first: number | null; last: number | null }[] };
}

export function studyReport(d: StudyDataset): StudyReport {
  const T = d.tables;
  const count = <K extends string>(xs: readonly K[]) => xs.reduce<Record<string, number>>((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {});
  const practice = (T.practice ?? []).filter((p) => p.completion !== null);
  const movement = T.movement ?? [];
  const weeks = new Map<number, { reports: number; completed: number }>();
  for (const p of practice) {
    const w = Math.floor(Number(p.day) / 7);
    const cur = weeks.get(w) ?? { reports: 0, completed: 0 };
    cur.reports++;
    if (p.completion === 'completed') cur.completed++;
    weeks.set(w, cur);
  }
  const sigs = movement.map((m) => Number(m.signal_percent)).filter(Number.isFinite);
  const gas = (T.assessments ?? []).filter((a) => a.item === 'derived:gas_t_score' && !a.superseded);
  const byP = new Map<string, number[]>();
  for (const a of gas.sort((x, y) => Number(x.day) - Number(y.day))) byP.set(String(a.participant), [...(byP.get(String(a.participant)) ?? []), Number(a.value)]);
  const assessed = (tp: string) => new Set((T.assessments ?? []).filter((a) => a.timepoint === tp).map((a) => a.participant)).size;
  return {
    feasibility: {
      enrolled: (T.participants ?? []).length,
      withdrawn: (T.participants ?? []).filter((p) => p.consent_status === 'withdrawn').length,
      sensorSessions: new Set(movement.map((m) => m.session)).size,
      incompleteSessions: new Set(movement.filter((m) => String(m.issues).includes('skipped')).map((m) => m.session)).size,
      technicalIncidents: (T.incidents ?? []).filter((i) => i.category === 'technical').length,
      eligibleStepShare: movement.length ? movement.filter((m) => m.eligible).length / movement.length : null,
      baselineAssessed: assessed('baseline'),
      followUpAssessed: assessed('follow_up'),
    },
    engagement: {
      reports: practice.length,
      completed: practice.filter((p) => p.completion === 'completed').length,
      partial: practice.filter((p) => p.completion === 'partial').length,
      notCompleted: practice.filter((p) => p.completion === 'not_completed').length,
      stopped: practice.filter((p) => p.completion === 'stopped').length,
      perWeek: [...weeks.entries()].sort((a, b) => a[0] - b[0]).map(([week, v]) => ({ week, ...v })),
      barriers: count(practice.flatMap((p) => String(p.barriers || '').split(';').filter(Boolean))),
    },
    measurementQuality: { steps: movement.length, eligible: movement.filter((m) => m.eligible).length, issues: count(movement.flatMap((m) => String(m.issues || '').split(';').filter(Boolean))), meanSignal: sigs.length ? sigs.reduce((a, b) => a + b, 0) / sigs.length : null },
    safety: { incidents: (T.incidents ?? []).length, safety: (T.incidents ?? []).filter((i) => i.category === 'safety').length, reviewed: (T.incidents ?? []).filter((i) => i.reviewed).length, byType: count((T.incidents ?? []).map((i) => String(i.type))) },
    goals: {
      total: (T.goals ?? []).length,
      byStatus: count((T.goals ?? []).map((g) => String(g.status))),
      gasChanges: [...byP.entries()].map(([participant, v]) => ({ participant, first: v[0] ?? null, last: v.length > 1 ? (v.at(-1) as number) : null })),
    },
  };
}

/** Markdown study report. Interpretation sections are left for the researchers: findings may be negative, neutral or positive. */
export function studyReportMarkdown(d: StudyDataset, r: StudyReport): string {
  const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)} %`);
  const kv = (m: Record<string, number>) => Object.entries(m).map(([k, v]) => `${k}: ${v}`).join(', ') || '—';
  return [
    `# Study report — ${d.manifest.study.shortCode}`,
    '',
    `${d.manifest.study.title}. Ethics reference: ${d.manifest.study.ethicsReference || '—'} (approved ${d.manifest.study.ethicsApprovedOn ?? '—'}). Dataset ${d.manifest.datasetId}, generated ${d.manifest.createdAt}.`,
    '',
    '> Descriptive feasibility data only. No efficacy claim can be derived from this report. Findings may be negative, neutral or positive; all are reported.',
    '',
    '## Feasibility',
    `- Enrolled: ${r.feasibility.enrolled}; withdrawn: ${r.feasibility.withdrawn}`,
    `- Sensor sessions: ${r.feasibility.sensorSessions}; sessions with skipped steps: ${r.feasibility.incompleteSessions}; technical incidents: ${r.feasibility.technicalIncidents}`,
    `- Steps passing data-quality checks: ${pct(r.feasibility.eligibleStepShare)}`,
    `- Participants with a baseline / follow-up instrument assessment: ${r.feasibility.baselineAssessed} / ${r.feasibility.followUpAssessed}`,
    '',
    '## Engagement (reported, not measured)',
    `- Reports: ${r.engagement.reports} — completed ${r.engagement.completed}, partial ${r.engagement.partial}, not completed ${r.engagement.notCompleted}, stopped ${r.engagement.stopped}`,
    `- Per study week (reports / completed): ${r.engagement.perWeek.map((w) => `w${w.week}: ${w.reports}/${w.completed}`).join(', ') || '—'}`,
    `- Barriers: ${kv(r.engagement.barriers)}`,
    '',
    '## Measurement quality',
    `- Steps: ${r.measurementQuality.steps}; eligible: ${r.measurementQuality.eligible}; mean signal completeness: ${r.measurementQuality.meanSignal === null ? '—' : r.measurementQuality.meanSignal.toFixed(1) + ' %'}`,
    `- Issues: ${kv(r.measurementQuality.issues)}`,
    '- Agreement with reference measurements: see the goniometer validation datasets (Research → Datasets).',
    '',
    '## Safety and deviations',
    `- Incidents: ${r.safety.incidents} (safety ${r.safety.safety}; reviewed ${r.safety.reviewed}). By type: ${kv(r.safety.byType)}`,
    '',
    '## Goals and outcomes (individual, descriptive)',
    `- Goals: ${r.goals.total}; by status: ${kv(r.goals.byStatus)}`,
    ...r.goals.gasChanges.map((g) => `- ${g.participant}: GAS T-score first ${g.first?.toFixed(1) ?? '—'}, last ${g.last?.toFixed(1) ?? '—'}`),
    '',
    '## Usability',
    '- Professional, caregiver and child usability are evaluated with the instruments named in the study protocol; enter results here.',
    '',
    '## Interpretation (to be written by the research team)',
    '- Positive findings:',
    '- Neutral findings:',
    '- Negative findings and problems:',
    '- Deviations from protocol:',
    '',
  ].join('\n');
}
