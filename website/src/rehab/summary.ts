// Grounded summaries for professionals.
//
// Step 1 (always, on the device, no AI): the participant's records become a list of numbered FACTS
// (F1, F2 …). Each fact is a plain statement built from structured fields only, with its information
// source (instrument / IMU / reported / professional / analysis) and links to the records it came from.
// The built-in summary is these facts, grouped. It works offline and without any API key.
//
// Step 2 (optional, team server with an API key, staff only): the same facts — pseudonymous: no names,
// no participant code, no free text unless the professional includes goal wording — are sent to Claude,
// which drafts readable sentences. EVERY sentence must cite fact ids; the server and the device check the
// citations and flag wording that diagnoses, prescribes or claims improvement. The draft is shown as an
// AI draft for professional review and is saved nowhere unless the professional copies it into a note.

import type { Note, Session } from '../data/models';
import { copmMeans, gasTScore } from './goals';
import { goalIcf } from './icf';
import type { FunctionalGoal, IncidentRecord, OutcomeAssessment, PracticeRecord, ProgramReview, ProgramVersion, RehabProfile } from './model';
import { compareToBaseline, movementSeries, trendPerWeek, usable } from './movement';
import type { Observation } from './progress';
import { RULES } from './progress';
import { allAssignments, plannedHomeOccasions } from './programs';

export const SUMMARY_SECTIONS = ['goals', 'program', 'practice', 'safety', 'measurements', 'assessments', 'review'] as const;
export type SummarySection = (typeof SUMMARY_SECTIONS)[number];
export type FactSource = 'instrument' | 'imu' | 'reported' | 'professional' | 'analysis';

export interface Fact {
  id: string;
  section: SummarySection;
  source: FactSource;
  /** English template (also the translation key) and its parameters; `text` is the template filled in. */
  key: string;
  params: Record<string, string | number>;
  text: string;
  /** Records the fact was built from (traceability). */
  refs: { kind: string; id: string }[];
}

export interface FactInput {
  now: Date;
  demo: boolean;
  profile: RehabProfile | null;
  goals: readonly FunctionalGoal[];
  program: ProgramVersion | null;
  practice: readonly PracticeRecord[];
  incidents: readonly IncidentRecord[];
  reviews: readonly ProgramReview[];
  assessments: readonly OutcomeAssessment[];
  sessions: readonly Session[];
  notes?: readonly Note[];
  observations: readonly Observation[];
  /** Include the professional's goal wording (free text). Off for AI requests unless the professional opts in. */
  includeGoalText: boolean;
}

const DAY = 86400_000;
const fill = (key: string, p: Record<string, string | number>) => key.replace(/\{(\w+)\}/g, (m, k: string) => (k in p ? String(p[k]) : m));
/** Marks a template so the translation test finds it. */
const fx = (key: string) => key;
const r1 = (x: number) => Math.round(x * 10) / 10;

export function buildFacts(x: FactInput): Fact[] {
  const out: Fact[] = [];
  const ago = (iso: string) => Math.max(0, Math.round((x.now.getTime() - Date.parse(iso)) / DAY));
  const add = (section: SummarySection, source: FactSource, key: string, params: Record<string, string | number>, refs: Fact['refs']) =>
    out.push({ id: `F${out.length + 1}`, section, source, key, params, text: fill(key, params), refs });

  // Goals (professional; GAS levels are instrument-based)
  x.goals.forEach((g, i) => {
    const gas = [...g.history].reverse().find((e) => e.gas !== undefined);
    const icf = goalIcf(g);
    const params: Record<string, string | number> = { n: i + 1, category: g.category, status: g.status, icf: icf.codes.join(', ') || '—', days: ago(g.createdAt) };
    if (x.includeGoalText) {
      params.text = g.description.slice(0, 200);
      add('goals', 'professional', fx('Goal {n} ({category}; ICF {icf}): "{text}". Status: {status}. Set {days} days ago.'), params, [{ kind: 'goal', id: g.id }]);
    } else add('goals', 'professional', fx('Goal {n} ({category}; ICF {icf}). Status: {status}. Set {days} days ago.'), params, [{ kind: 'goal', id: g.id }]);
    if (gas?.gas !== undefined) add('goals', 'instrument', fx('Goal {n}: last GAS level {gas}, recorded {days} days ago.'), { n: i + 1, gas: gas.gas, days: ago(gas.at) }, [{ kind: 'goal', id: g.id }]);
    const family = g.history.filter((e) => e.type === 'family_input').length;
    if (family) add('goals', 'reported', fx('Goal {n}: the family added {count} comments about what matters at home.'), { n: i + 1, count: family }, [{ kind: 'goal', id: g.id }]);
  });

  // Program (professional)
  const prog = x.program;
  if (prog) {
    const home = allAssignments(prog.def).filter((a) => a.setting === 'home');
    add('program', 'professional', fx('Current program: version {v}, status {status}, started {days} days ago; {home} home and {clinic} clinic activities assigned.'), { v: prog.version, status: prog.def.status, days: prog.def.startDate ? ago(prog.def.startDate) : ago(prog.createdAt), home: home.length, clinic: allAssignments(prog.def).length - home.length }, [{ kind: 'program', id: prog.id }]);
    if (prog.version > 1) add('program', 'professional', fx('Version {v} was created {days} days ago{review}.'), { v: prog.version, days: ago(prog.createdAt), review: prog.basedOnReviewId ? ' after a professional review' : '' }, [{ kind: 'program', id: prog.id }]);
    if (prog.def.reviewDate) {
      const d = Math.round((Date.parse(prog.def.reviewDate) - x.now.getTime()) / DAY);
      add('program', 'professional', d >= 0 ? fx('Program review date is in {days} days.') : fx('Program review date passed {days} days ago.'), { days: Math.abs(d) }, [{ kind: 'program', id: prog.id }]);
    }
  }

  // Practice, last 28 days (reported)
  const since = x.now.getTime() - 28 * DAY;
  const recent = x.practice.filter((p) => Date.parse(p.date) >= since && p.completion !== null && p.setting === 'home');
  if (recent.length || prog) {
    const c = (k: string) => recent.filter((p) => p.completion === k).length;
    const planned = prog ? plannedHomeOccasions(prog.def, new Date(Math.max(since, prog.def.startDate ? Date.parse(prog.def.startDate) : since)), x.now) : null;
    add('practice', 'reported', fx('Home practice reports in the last 28 days: {total} (done {done}, partly {partial}, not done {not}, stopped {stopped}); planned by the professional: {planned}.'), { total: recent.length, done: c('completed'), partial: c('partial'), not: c('not_completed'), stopped: c('stopped'), planned: planned ?? 'not specified' }, recent.map((p) => ({ kind: 'practice', id: p.id })));
    const tired = recent.filter((p) => p.fatigue !== null && p.fatigue >= 2);
    if (tired.length) add('practice', 'reported', fx('Moderate or high fatigue was reported {n} times in the last 28 days.'), { n: tired.length }, tired.map((p) => ({ kind: 'practice', id: p.id })));
    const barriers = new Map<string, number>();
    for (const p of recent) for (const b of p.barriers) barriers.set(b, (barriers.get(b) ?? 0) + 1);
    if (barriers.size) add('practice', 'reported', fx('Barriers reported: {list}.'), { list: [...barriers].map(([b, n]) => `${b} ×${n}`).join(', ') }, recent.filter((p) => p.barriers.length).map((p) => ({ kind: 'practice', id: p.id })));
    const notes = x.practice.filter((p) => Date.parse(p.date) >= since && p.completion === null).length;
    if (notes) add('practice', 'reported', fx('The family sent {n} free messages in the last 28 days (content not included).'), { n: notes }, []);
  }

  // Safety (reported or professional)
  const inc = x.incidents.filter((i) => i.category === 'safety');
  if (inc.length) {
    const open = inc.filter((i) => i.review === null);
    add('safety', 'reported', fx('Safety reports in total: {n} ({types}); not yet reviewed by a professional: {open}.'), { n: inc.length, types: [...new Set(inc.map((i) => i.type))].join(', '), open: open.length }, inc.map((i) => ({ kind: 'incident', id: i.id })));
  }

  // Measurements (IMU; not clinically validated)
  const series = movementSeries(x.sessions, { includeSimulated: x.demo });
  const designated = x.profile?.baselineSessionIds ?? [];
  for (const s of series) {
    const pts = s.points.filter((p) => usable(p, x.demo));
    const label = `${s.exercise} ${s.side}`;
    if (!pts.length) {
      add('measurements', 'imu', fx('{movement}: {n} sensor sessions, none passed the data-quality checks.'), { movement: label, n: s.points.length }, s.points.map((p) => ({ kind: 'session', id: p.sessionId })));
      continue;
    }
    const last = pts.at(-1)!;
    add('measurements', 'imu', fx('{movement}: latest measured range {rom}° ({days} days ago), from {n} usable sessions{sim}. IMU measurement, not clinically validated.'), { movement: label, rom: r1(last.values.rom ?? NaN), days: ago(last.date), n: pts.length, sim: last.simulated ? ', simulated (demo)' : '' }, [{ kind: 'session', id: last.sessionId }]);
    const cmp = compareToBaseline(s, 'rom', designated, x.demo);
    if (cmp)
      add('measurements', 'imu', fx('{movement}: range {direction} baseline by {delta}° (baseline {base}°{prov}; noise check ±{noise}°, {exceeds}).'), {
        movement: label,
        direction: cmp.delta >= 0 ? 'above' : 'below',
        delta: r1(Math.abs(cmp.delta)),
        base: r1(cmp.baseline.value),
        prov: cmp.baseline.designated ? '' : ', provisional',
        noise: cmp.noise === null ? '—' : r1(cmp.noise),
        exceeds: cmp.exceedsNoise === null ? 'no noise estimate' : cmp.exceedsNoise ? 'larger than the noise check' : 'within the noise check',
      }, [...cmp.baseline.sessionIds.map((id) => ({ kind: 'session', id })), { kind: 'session', id: cmp.latest.sessionId }]);
    const tr = trendPerWeek(s, 'rom_cv', x.demo);
    if (tr) add('measurements', 'imu', fx('{movement}: repetition consistency (CV of range) trend {slope} percentage points per week over {n} sessions.'), { movement: label, slope: r1(tr.slope), n: tr.points }, pts.slice(-tr.points).map((p) => ({ kind: 'session', id: p.sessionId })));
  }

  // Assessments (instrument-based)
  const current = x.assessments.filter((a) => !x.assessments.some((b) => b.supersedes === a.id));
  for (const a of [...current].sort((p, q) => p.date.localeCompare(q.date))) {
    let result: string;
    if (a.instrument === 'gas') result = `T-score ${gasTScore(a.items)?.toFixed(1) ?? '—'}`;
    else if (a.instrument === 'copm') {
      const m = copmMeans(a.items);
      result = `performance ${m.performance?.toFixed(1) ?? '—'}, satisfaction ${m.satisfaction?.toFixed(1) ?? '—'}`;
    } else result = a.totals.map((t) => `${t.key} ${t.value}`).join(', ') || 'no total entered';
    add('assessments', 'instrument', fx('{instrument} ({timepoint}), {days} days ago: {result}.'), { instrument: a.instrumentName, timepoint: a.timepoint, days: ago(a.date), result }, [{ kind: 'assessment', id: a.id }]);
  }

  // Review state and analysis (engine observations are analysis, not data)
  const lastReview = [...x.reviews].filter((r) => r.type === 'progress_review').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (lastReview) add('review', 'professional', fx('Last professional review {days} days ago; decision: {decision}.'), { days: ago(lastReview.createdAt), decision: lastReview.decision }, [{ kind: 'review', id: lastReview.id }]);
  for (const o of x.observations) {
    const rule = RULES.find((r) => r.id === o.ruleId);
    add('review', 'analysis', fx('Rule-based observation "{rule}" is open ({severity}). It does not mean: {not}'), { rule: o.ruleId, severity: o.severity, not: rule?.notMeaning ?? '' }, o.evidence.map((e) => ({ kind: e.ref, id: e.id })));
  }
  return out;
}

// ── AI draft contract ──────────────────────────────────────────────────────────────────────────

export interface DraftSentence {
  text: string;
  facts: string[];
}
export interface DraftSection {
  section: SummarySection;
  sentences: DraftSentence[];
}
export interface SummaryDraft {
  sections: DraftSection[];
}

export const SUMMARY_LANGUAGES = { ru: 'Russian', kk: 'Kazakh', en: 'English' } as const;
export type SummaryLanguage = keyof typeof SUMMARY_LANGUAGES;

export function systemPrompt(language: SummaryLanguage): string {
  return [
    'You draft a short progress summary for a pediatric rehabilitation professional, who will review and edit it.',
    'Use ONLY the numbered facts provided. Every sentence must cite the ids of the facts it is based on, and must not add any information that is not in those facts.',
    'Keep the three kinds of information apart and say which kind a sentence is about: instrument-based assessments, IMU sensor measurements (not clinically validated, body-function level), and what the family or child reported.',
    'Do not diagnose, do not interpret medical conditions, do not recommend or change treatment, exercises, doses, frequency or difficulty, and do not judge eligibility. Do not say that the child improved or got worse; describe measured differences neutrally (higher/lower, within/larger than the noise check). A change in a measured angle does not mean a change in daily function.',
    'Rule-based observations are prompts for the professional, not findings; mention open ones briefly as items to look at.',
    'Never blame the family; missing reports do not prove that practice did not happen.',
    `Write in ${SUMMARY_LANGUAGES[language]}. Plain, concise, at most 3 sentences per section. Omit sections that have no facts.`,
  ].join('\n');
}

export function factsPrompt(facts: readonly Pick<Fact, 'id' | 'section' | 'source' | 'text'>[]): string {
  return ['Facts:', ...facts.map((f) => `${f.id} [${f.section}; source: ${f.source}] ${f.text}`)].join('\n');
}

export type SentenceFlag = 'uncited' | 'unknown_fact' | 'wording';

/** Wording a summary must not contain (diagnosis, prescription, improvement claims) in EN / RU / KK. */
const FORBIDDEN = /\b(diagnos\w*|prescri\w*|recommend\w*|should (increase|decrease|add|stop|continue)|improv\w*|deteriorat\w*|worsen\w*)\b|диагноз|рекоменд|назнач|улучш|ухудш|следует (увелич|уменьш)|ұсыным|ұсынамыз|жақсар|нашарла/i;

export interface CheckedSentence extends DraftSentence {
  flags: SentenceFlag[];
}
export interface CheckedDraft {
  sections: { section: SummarySection; sentences: CheckedSentence[] }[];
  flagged: number;
}

/** Check a draft against the facts it was given. Nothing is dropped silently: problems are flagged. */
export function checkDraft(draft: SummaryDraft, facts: readonly Pick<Fact, 'id'>[]): CheckedDraft {
  const ids = new Set(facts.map((f) => f.id));
  let flagged = 0;
  const sections = draft.sections
    .filter((s) => (SUMMARY_SECTIONS as readonly string[]).includes(s.section))
    .map((s) => ({
      section: s.section,
      sentences: s.sentences.map((x) => {
        const flags: SentenceFlag[] = [];
        if (!x.facts.length) flags.push('uncited');
        if (x.facts.some((f) => !ids.has(f))) flags.push('unknown_fact');
        if (FORBIDDEN.test(x.text)) flags.push('wording');
        if (flags.length) flagged++;
        const checked: CheckedSentence = { text: x.text.slice(0, 1200), facts: x.facts.filter((f) => ids.has(f)), flags };
        return checked;
      }),
    }));
  return { sections, flagged };
}

/** Structural check of a draft coming back from the model (or from the server). */
export function validDraft(x: unknown): x is SummaryDraft {
  if (!x || typeof x !== 'object' || !Array.isArray((x as SummaryDraft).sections)) return false;
  return (x as SummaryDraft).sections.every(
    (s) => s && typeof s.section === 'string' && Array.isArray(s.sentences) && s.sentences.every((t) => t && typeof t.text === 'string' && Array.isArray(t.facts) && t.facts.every((f) => typeof f === 'string')),
  );
}

/** Facts the server accepts: bounded, plain strings, no extra fields. */
export function validFactsPayload(x: unknown): x is Pick<Fact, 'id' | 'section' | 'source' | 'text'>[] {
  return (
    Array.isArray(x) &&
    x.length > 0 &&
    x.length <= 200 &&
    x.every(
      (f) =>
        f &&
        typeof f === 'object' &&
        typeof f.id === 'string' &&
        /^F\d{1,3}$/.test(f.id) &&
        (SUMMARY_SECTIONS as readonly string[]).includes(f.section) &&
        ['instrument', 'imu', 'reported', 'professional', 'analysis'].includes(f.source) &&
        typeof f.text === 'string' &&
        f.text.length <= 600,
    )
  );
}

