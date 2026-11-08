// Goal Management: creation, edits and status changes as append-only history, family input, and
// Goal Attainment Scaling arithmetic. No function here decides that a goal is achieved — only a
// professional sets a status.

import { newId } from '../lib/ids';
import type { Workspace } from '../data/models';
import type { AuthorRole, FunctionalGoal, GoalEvent, GoalStatus } from './model';

export type GoalDraft = Pick<FunctionalGoal, 'category' | 'description' | 'whyItMatters' | 'baseline' | 'target' | 'measurement' | 'responsible' | 'reviewDate' | 'contributors'> & Pick<Partial<FunctionalGoal>, 'icf'>;

export function newGoal(participantId: string, draft: GoalDraft, ws: Workspace, author: string, now = new Date()): FunctionalGoal {
  const at = now.toISOString();
  return {
    id: newId('goal'),
    kind: 'goal',
    workspace: ws,
    participantId,
    createdAt: at,
    createdBy: author,
    createdByRole: 'professional',
    ...structuredClone(draft),
    status: 'not_started',
    history: [{ at, by: author, byRole: 'professional', type: 'created', note: '', status: 'not_started' }],
    updatedAt: at,
  };
}

const EDITABLE: (keyof GoalDraft)[] = ['category', 'description', 'whyItMatters', 'baseline', 'target', 'measurement', 'responsible', 'reviewDate', 'contributors', 'icf'];

/** Professional edit: new field values + an 'edited' entry naming the fields. null = nothing changed. */
export function editGoal(g: FunctionalGoal, draft: GoalDraft, author: string, note = '', now = new Date()): FunctionalGoal | null {
  const fields = EDITABLE.filter((k) => JSON.stringify(g[k]) !== JSON.stringify(draft[k]));
  if (!fields.length) return null;
  const at = now.toISOString();
  return { ...g, ...structuredClone(draft), history: [...g.history, { at, by: author, byRole: 'professional', type: 'edited', note, fields }], updatedAt: at };
}

export function setGoalStatus(g: FunctionalGoal, status: GoalStatus, author: string, note: string, now = new Date()): FunctionalGoal | null {
  if (g.status === status) return null;
  const at = now.toISOString();
  return { ...g, status, history: [...g.history, { at, by: author, byRole: 'professional', type: 'status', note, status }], updatedAt: at };
}

export function addGoalEvent(g: FunctionalGoal, e: Omit<GoalEvent, 'at'>, now = new Date()): FunctionalGoal {
  const at = now.toISOString();
  const contributors = e.byRole === 'caregiver' && !g.contributors.includes('family') ? [...g.contributors, 'family' as const] : g.contributors;
  return { ...g, contributors, history: [...g.history, { ...e, at }], updatedAt: at };
}

/** Family input on a goal ("why it matters at home", "what we noticed"). Never changes status or targets. */
export function familyInput(g: FunctionalGoal, by: string, note: string, now = new Date()): FunctionalGoal {
  return addGoalEvent(g, { by, byRole: 'caregiver' satisfies AuthorRole, type: 'family_input', note }, now);
}

/** Goals that need a professional look: review date passed, explicitly 'needs_review', or no entry for `staleDays`. */
export function goalsNeedingReview(goals: readonly FunctionalGoal[], now = new Date(), staleDays = 56): { goal: FunctionalGoal; reason: 'review_date_passed' | 'needs_review' | 'no_recent_entry' }[] {
  const out: { goal: FunctionalGoal; reason: 'review_date_passed' | 'needs_review' | 'no_recent_entry' }[] = [];
  for (const g of goals) {
    if (g.status === 'achieved' || g.status === 'paused') continue;
    if (g.status === 'needs_review') out.push({ goal: g, reason: 'needs_review' });
    else if (g.reviewDate && g.reviewDate.slice(0, 10) < now.toISOString().slice(0, 10)) out.push({ goal: g, reason: 'review_date_passed' });
    else {
      const last = g.history[g.history.length - 1]?.at ?? g.createdAt;
      if (now.getTime() - Date.parse(last) > staleDays * 86400_000) out.push({ goal: g, reason: 'no_recent_entry' });
    }
  }
  return out;
}

/**
 * Goal Attainment Scaling summary T-score (Kiresuk & Sherman 1968):
 *   T = 50 + 10 Σ(wᵢxᵢ) / √((1 − ρ) Σwᵢ² + ρ (Σwᵢ)²),  ρ = 0.3 by convention.
 * xᵢ ∈ {−2…+2} are levels the professional recorded; wᵢ default 1. Returns null when no goal has a level.
 * Shown as a descriptive summary with its formula, never as a measure of "how much better the child is".
 */
export function gasTScore(items: readonly { value: number | null; weight: number | null }[], rho = 0.3): number | null {
  const rated = items.filter((i): i is { value: number; weight: number | null } => i.value !== null);
  if (!rated.length) return null;
  const w = rated.map((i) => i.weight ?? 1);
  const sumWx = rated.reduce((s, i, k) => s + (w[k] as number) * i.value, 0);
  const sumW2 = w.reduce((s, x) => s + x * x, 0);
  const sumW = w.reduce((s, x) => s + x, 0);
  return 50 + (10 * sumWx) / Math.sqrt((1 - rho) * sumW2 + rho * sumW * sumW);
}

/** COPM: mean performance and satisfaction over the problems rated (1–10). No change threshold is applied (see the evidence map: the commonly quoted 2-point figure is unverified here). */
export function copmMeans(items: readonly { value: number | null; value2: number | null }[]): { performance: number | null; satisfaction: number | null; n: number } {
  const p = items.map((i) => i.value).filter((v): v is number => v !== null);
  const s = items.map((i) => i.value2).filter((v): v is number => v !== null);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return { performance: mean(p), satisfaction: mean(s), n: Math.max(p.length, s.length) };
}
