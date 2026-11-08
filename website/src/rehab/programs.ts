// Program Studio and Activity Library logic (pure, no UI, no storage).
//
// Versions are immutable. Saving an edit creates version N+1 with a required reason; the previous
// version stays readable forever and every practice record keeps pointing at the version it followed.
// Nothing here changes a program on its own: there is no function that derives a dose, a frequency or
// a difficulty from data. Every number in a program was typed by a professional.

import { newId } from '../lib/ids';
import type { Workspace } from '../data/models';
import { canonicalJson } from './validate';
import type { ActivityDef, ActivityStatus, ActivityVersion, Assignment, AuthorRole, ModuleType, ProgramDef, ProgramModule, ProgramVersion } from './model';

// ── Generic version helpers ────────────────────────────────────────────────────────────────────

interface Versioned {
  id: string;
  seriesId: string;
  version: number;
}

export function latestBySeries<T extends Versioned>(all: readonly T[]): T[] {
  const by = new Map<string, T>();
  for (const v of all) {
    const cur = by.get(v.seriesId);
    if (!cur || v.version > cur.version) by.set(v.seriesId, v);
  }
  return [...by.values()];
}

export function historyOf<T extends Versioned>(all: readonly T[], seriesId: string): T[] {
  return all.filter((v) => v.seriesId === seriesId).sort((a, b) => b.version - a.version);
}

const nextVersionOf = (all: readonly Versioned[], seriesId: string) => all.filter((v) => v.seriesId === seriesId).reduce((m, v) => Math.max(m, v.version), 0) + 1;

// ── Activities ─────────────────────────────────────────────────────────────────────────────────

export function emptyActivity(language: ActivityDef['language']): ActivityDef {
  return {
    name: '',
    description: '',
    goalCategories: [],
    domain: 'upper_limb_range',
    setup: '',
    professionalInstructions: '',
    caregiverInstructions: '',
    steps: [],
    homeSuitable: false,
    measurement: { kind: 'completion_only', exercise: null, detail: '' },
    completionCriteria: '',
    safetyNotes: '',
    evidenceRefs: [],
    language,
  };
}

export type ActivityProblem = 'name_required' | 'imu_exercise_required' | 'caregiver_instructions_required' | 'steps_required';

export function checkActivity(d: ActivityDef, status: ActivityStatus): ActivityProblem[] {
  const out: ActivityProblem[] = [];
  if (!d.name.trim()) out.push('name_required');
  if (d.measurement.kind === 'imu_session' && !d.measurement.exercise) out.push('imu_exercise_required');
  // A home activity that a professional approves must say something to the family in plain words
  if (status !== 'draft' && d.homeSuitable && !d.caregiverInstructions.trim()) out.push('caregiver_instructions_required');
  if (status !== 'draft' && d.homeSuitable && d.steps.length === 0) out.push('steps_required');
  return out;
}

/** Save an activity edit or status change as a NEW version. null = nothing changed. */
export function newActivityVersion(
  existing: readonly ActivityVersion[],
  args: { seriesId?: string; def: ActivityDef; status: ActivityStatus; changeNote: string; workspace: Workspace; author: string; authorRole: AuthorRole },
  now = new Date(),
): ActivityVersion | null {
  const seriesId = args.seriesId ?? newId('act');
  const latest = historyOf(existing, seriesId)[0];
  if (latest && latest.status === args.status && canonicalJson(latest.def) === canonicalJson(args.def)) return null;
  const version = nextVersionOf(existing, seriesId);
  return {
    id: `${seriesId}@${version}`,
    kind: 'activity',
    workspace: args.workspace,
    participantId: null,
    createdAt: now.toISOString(),
    createdBy: args.author,
    createdByRole: args.authorRole,
    seriesId,
    version,
    status: args.status,
    def: structuredClone(args.def),
    changeNote: args.changeNote,
  };
}

// ── Programs ───────────────────────────────────────────────────────────────────────────────────

/** Default module titles of the modular pathway (Module A–E). Editable; not a prescribed schedule. */
export const MODULE_ORDER: ModuleType[] = ['assessment', 'supervised', 'home', 'review', 'reassessment'];

export function newModule(type: ModuleType, title: string): ProgramModule {
  return { id: newId('mod'), type, title, notes: '', assignments: [] };
}

export function newAssignment(activityKey: string, setting: Assignment['setting']): Assignment {
  return { id: newId('as'), activityKey, setting, frequencyPerWeek: null, durationMin: null, dosageNote: '', caregiverNote: '', goalIds: [], feedbackTargetDeg: null };
}

/** An empty modular pathway (A–E). Titles come from the caller (localised). */
export function modularPathway(titles: Record<ModuleType, string>): ProgramModule[] {
  return MODULE_ORDER.map((t) => newModule(t, titles[t]));
}

export function emptyProgram(responsible: string, titles: Record<ModuleType, string>): ProgramDef {
  return {
    name: '',
    description: '',
    responsible,
    goalIds: [],
    domain: 'upper_limb_range',
    startDate: null,
    reviewDate: null,
    plannedWeeks: null,
    plannedSessions: null,
    sessionStructure: '',
    measurementRequirements: '',
    modules: modularPathway(titles),
    checkpoints: [],
    notes: '',
    status: 'active',
  };
}

export type ProgramProblem =
  | 'name_required'
  | 'responsible_required'
  | 'unknown_activity'
  | 'draft_activity'
  | 'home_unsuitable_activity'
  | 'unknown_goal'
  | 'review_before_start'
  | 'reason_required'
  | 'duplicate_ids';

/**
 * Problems that block saving a program version. `activities` = all activity versions, `goalIds` = goals of
 * the participant (null for templates, which reference no goals).
 */
export function checkProgram(def: ProgramDef, activities: readonly ActivityVersion[], goalIds: readonly string[] | null, opts: { version: number; changeReason: string }): ProgramProblem[] {
  const out = new Set<ProgramProblem>();
  if (!def.name.trim()) out.add('name_required');
  if (!def.responsible.trim()) out.add('responsible_required');
  if (opts.version > 1 && !opts.changeReason.trim()) out.add('reason_required');
  if (def.startDate && def.reviewDate && def.reviewDate < def.startDate) out.add('review_before_start');
  const byKey = new Map(activities.map((a) => [a.id, a]));
  const ids = new Set<string>();
  for (const m of def.modules) {
    if (ids.has(m.id)) out.add('duplicate_ids');
    ids.add(m.id);
    for (const a of m.assignments) {
      if (ids.has(a.id)) out.add('duplicate_ids');
      ids.add(a.id);
      const act = byKey.get(a.activityKey);
      if (!act) out.add('unknown_activity');
      // Drafts are not assignable; experimental activities are, and are labelled as such everywhere
      else if (act.status === 'draft') out.add('draft_activity');
      else if (a.setting === 'home' && !act.def.homeSuitable) out.add('home_unsuitable_activity');
      if (goalIds && a.goalIds.some((g) => !goalIds.includes(g))) out.add('unknown_goal');
    }
  }
  if (goalIds && def.goalIds.some((g) => !goalIds.includes(g))) out.add('unknown_goal');
  return [...out];
}

/**
 * Save a program as a NEW immutable version. null = nothing changed. A new series starts at version 1;
 * `from` (a template or another participant's program) is only copied, never linked as a parent.
 */
export function newProgramVersion(
  existing: readonly ProgramVersion[],
  args: {
    seriesId?: string;
    def: ProgramDef;
    participantId: string | null;
    template: boolean;
    changeReason: string;
    basedOnReviewId: string | null;
    workspace: Workspace;
    author: string;
  },
  now = new Date(),
): ProgramVersion | null {
  const seriesId = args.seriesId ?? newId('prg');
  const latest = historyOf(existing, seriesId)[0];
  if (latest && canonicalJson(latest.def) === canonicalJson(args.def)) return null;
  if (latest && (latest.participantId !== args.participantId || latest.template !== args.template)) throw new Error('program_series_owner_changed');
  const version = nextVersionOf(existing, seriesId);
  return {
    id: `${seriesId}@${version}`,
    kind: 'program',
    workspace: args.workspace,
    participantId: args.template ? null : args.participantId,
    createdAt: now.toISOString(),
    createdBy: args.author,
    createdByRole: 'professional',
    seriesId,
    version,
    template: args.template,
    def: structuredClone(args.def),
    changeReason: args.changeReason,
    basedOnReviewId: args.basedOnReviewId,
    previousKey: latest?.id ?? null,
  };
}

/** Copy a template (or another program) into a fresh definition for a participant: new module/assignment ids. */
export function instantiate(def: ProgramDef, responsible: string): ProgramDef {
  return {
    ...structuredClone(def),
    responsible,
    goalIds: [],
    modules: def.modules.map((m) => ({ ...structuredClone(m), id: newId('mod'), assignments: m.assignments.map((a) => ({ ...structuredClone(a), id: newId('as'), goalIds: [] })) })),
    checkpoints: def.checkpoints.map((c) => ({ ...c, id: newId('cp') })),
    status: 'active',
  };
}

/** The participant's current program = latest version of their most recently started series. */
export function currentProgram(all: readonly ProgramVersion[], participantId: string): ProgramVersion | null {
  const mine = latestBySeries(all.filter((p) => !p.template && p.participantId === participantId));
  if (!mine.length) return null;
  const firstOf = (seriesId: string) => all.filter((p) => p.seriesId === seriesId).reduce((m, p) => (p.createdAt < m ? p.createdAt : m), '9999');
  mine.sort((a, b) => firstOf(b.seriesId).localeCompare(firstOf(a.seriesId)));
  const active = mine.find((p) => p.def.status !== 'completed');
  return active ?? mine[0] ?? null;
}

export function allAssignments(def: ProgramDef): (Assignment & { moduleId: string; moduleType: ModuleType })[] {
  return def.modules.flatMap((m) => m.assignments.map((a) => ({ ...a, moduleId: m.id, moduleType: m.type })));
}

export type ChangeKind = 'field' | 'assignment_added' | 'assignment_removed' | 'assignment_changed' | 'module_added' | 'module_removed';

/** What changed between two versions — shown in the version history so professionals see the decision trail. */
export function diffPrograms(a: ProgramDef, b: ProgramDef): { kind: ChangeKind; key: string }[] {
  const out: { kind: ChangeKind; key: string }[] = [];
  for (const k of ['name', 'description', 'responsible', 'domain', 'startDate', 'reviewDate', 'plannedWeeks', 'plannedSessions', 'sessionStructure', 'measurementRequirements', 'notes', 'status', 'goalIds', 'checkpoints'] as const)
    if (canonicalJson(a[k]) !== canonicalJson(b[k])) out.push({ kind: 'field', key: k });
  const ma = new Map(a.modules.map((m) => [m.id, m]));
  const mb = new Map(b.modules.map((m) => [m.id, m]));
  for (const id of mb.keys()) if (!ma.has(id)) out.push({ kind: 'module_added', key: mb.get(id)!.title });
  for (const id of ma.keys()) if (!mb.has(id)) out.push({ kind: 'module_removed', key: ma.get(id)!.title });
  const aa = new Map(allAssignments(a).map((x) => [x.id, x]));
  const ab = new Map(allAssignments(b).map((x) => [x.id, x]));
  for (const [id, x] of ab) {
    const prev = aa.get(id);
    if (!prev) out.push({ kind: 'assignment_added', key: x.activityKey });
    else if (canonicalJson(prev) !== canonicalJson(x)) out.push({ kind: 'assignment_changed', key: x.activityKey });
  }
  for (const [id, x] of aa) if (!ab.has(id)) out.push({ kind: 'assignment_removed', key: x.activityKey });
  return out;
}

/**
 * How many home practice occasions the professional planned in [from, to): sum of frequencyPerWeek ×
 * weeks. null when no home assignment has a frequency (then adherence is not computed, not assumed).
 */
export function plannedHomeOccasions(def: ProgramDef, from: Date, to: Date): number | null {
  const freq = allAssignments(def)
    .filter((a) => a.setting === 'home' && a.frequencyPerWeek !== null)
    .map((a) => a.frequencyPerWeek as number);
  if (!freq.length) return null;
  const weeks = Math.max(0, (to.getTime() - from.getTime()) / (7 * 86400_000));
  return Math.round(freq.reduce((s, f) => s + f, 0) * weeks);
}
