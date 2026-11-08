// Research assistant — DETERMINISTIC and GROUNDED.
//
// The computation engine owns every number; this module only selects which computed facts answer a question and
// states them with their evidence (records, statistics, model outputs, verified references). When the data cannot
// answer, it says so and why. No language model is involved and no data leaves the browser.
//
// Integration boundary for a future language model: `evidencePacket()` produces a de-identified, aggregated packet
// (no names, codes, dates or raw signals). Any LLM may only rephrase such a packet; it must not compute statistics.
// Sending it anywhere requires explicit configuration and a privacy review (research/README.md, governance).

import type { SeriesAnalysis } from './analysis';
import type { LearningSeries } from './dataset';
import { MODELS } from './models';
import { nextObservationAdvice } from './sandbox';

export const QUESTIONS = [
  'change_summary',
  'largest_change',
  'change_vs_noise',
  'model_fit',
  'rate_uncertainty',
  'retention_sufficiency',
  'poor_quality_sessions',
  'next_observation',
] as const;
export type QuestionId = (typeof QUESTIONS)[number];

export interface Evidence {
  kind: 'record' | 'statistic' | 'model' | 'reference';
  /** Machine-readable key for the UI to label (translated there). */
  label: string;
  value: string | number | boolean | null;
  /** Session id, series key, model id or DOI. */
  ref: string;
}

export interface Answer {
  question: QuestionId;
  status: 'answered' | 'insufficient_data' | 'not_answerable';
  /** Template key + values; the UI renders the sentence. Keeps numbers out of free text. */
  finding: { key: string; values: Record<string, string | number> } | null;
  evidence: Evidence[];
  /** What these data cannot establish, always shown. */
  cannotConclude: string[];
}

export interface CopilotInput {
  series: readonly LearningSeries[];
  analyses: readonly SeriesAnalysis[];
}

const REF = {
  kantak: '10.1016/j.bbr.2011.11.028',
  raue: '10.1093/bioinformatics/btp358',
  burkner: '10.1080/00949655.2020.1783262',
  hurvich: '10.1093/biomet/76.2.297',
} as const;

const keyParts = (k: string) => {
  const [, exercise, side, metric] = k.split('|');
  return { exercise: exercise ?? '', side: side ?? '', metric: metric ?? '' };
};

export function answer(q: QuestionId, input: CopilotInput, focus: string | null): Answer {
  const A = input.analyses;
  const pick = (focus && A.find((a) => a.seriesKey === focus)) || A[0] || null;
  const base = { question: q, evidence: [] as Evidence[], cannotConclude: [] as string[] };
  switch (q) {
    case 'change_summary':
    case 'largest_change': {
      const rows = A.filter((a) => a.decomposition.overall).map((a) => ({ a, o: a.decomposition.overall!, z: a.decomposition.overall!.delta / a.decomposition.overall!.se }));
      if (!rows.length) return { ...base, status: 'insufficient_data', finding: { key: 'needs_two_sessions', values: {} }, cannotConclude: ['change_needs_two_included_sessions'] };
      rows.sort((x, y) => Math.abs(y.z) - Math.abs(x.z));
      const ev: Evidence[] = rows.map((r) => ({ kind: 'statistic', label: `overall_change:${keyParts(r.a.seriesKey).exercise}:${keyParts(r.a.seriesKey).side}:${keyParts(r.a.seriesKey).metric}`, value: r.o.delta, ref: r.a.seriesKey }));
      const top = rows[0]!;
      const exceeding = rows.filter((r) => r.o.exceedsNoise).length;
      return {
        ...base,
        status: 'answered',
        finding:
          q === 'largest_change'
            ? { key: 'largest_change', values: { series: top.a.seriesKey, delta: top.o.delta, se: top.o.se, z: top.z, days: top.o.days } }
            : { key: 'change_summary', values: { series: rows.length, exceeding, sessions: A[0]?.included ?? 0 } },
        evidence: ev,
        cannotConclude: ['change_is_not_learning_without_retention', 'causes_of_change_not_identified', 'imu_metrics_not_clinical_function'],
      };
    }
    case 'change_vs_noise': {
      if (!pick?.decomposition.overall) return { ...base, status: 'insufficient_data', finding: { key: 'needs_two_sessions', values: {} }, cannotConclude: ['change_needs_two_included_sessions'] };
      const o = pick.decomposition.overall;
      return {
        ...base,
        status: 'answered',
        finding: { key: o.exceedsNoise ? 'change_exceeds_noise' : 'change_within_noise', values: { delta: o.delta, se: o.se, threshold: 1.96 * o.se, sigmaE: pick.decomposition.sigmaE, sigmaS: pick.decomposition.sigmaS } },
        evidence: [
          { kind: 'statistic', label: 'sigma_repetition', value: pick.decomposition.sigmaE, ref: pick.seriesKey },
          { kind: 'statistic', label: 'sigma_session', value: pick.decomposition.sigmaS, ref: pick.seriesKey },
          { kind: 'record', label: 'from_session', value: o.fromSessionId, ref: o.fromSessionId },
          { kind: 'record', label: 'to_session', value: o.toSessionId, ref: o.toSessionId },
          ...(o.exceedsExternalMdc !== null ? [{ kind: 'statistic' as const, label: 'exceeds_external_mdc', value: o.exceedsExternalMdc, ref: pick.seriesKey }] : []),
        ],
        cannotConclude: ['noise_estimate_is_internal_not_an_mdc', 'no_reference_instrument_agreement'],
      };
    }
    case 'model_fit': {
      if (!pick || !pick.selected) return { ...base, status: 'insufficient_data', finding: { key: 'no_model', values: {} }, cannotConclude: ['fit_is_not_validity'] };
      const row = pick.comparison.rows.find((r) => r.model === pick.selected)!;
      const d = pick.diagnostics;
      return {
        ...base,
        status: 'answered',
        finding: { key: 'model_fit', values: { model: pick.selected, weight: row.weight, lag1: d?.lag1 ?? NaN, pLag1: d?.pLag1 ?? NaN, maxAbs: d?.maxAbs ?? NaN, lfoMae: row.lfo?.mae ?? NaN, persistenceMae: pick.comparison.persistenceMae ?? NaN, folds: row.lfo?.folds.length ?? 0 } },
        evidence: [
          { kind: 'model', label: 'selected_model', value: pick.selected, ref: pick.seriesKey },
          { kind: 'statistic', label: 'akaike_weight', value: row.weight, ref: pick.selected },
          { kind: 'statistic', label: 'lfo_mae', value: row.lfo?.mae ?? null, ref: pick.selected },
          { kind: 'statistic', label: 'persistence_mae', value: pick.comparison.persistenceMae, ref: pick.seriesKey },
          { kind: 'reference', label: 'leave_future_out', value: null, ref: REF.burkner },
          { kind: 'reference', label: 'aicc', value: null, ref: REF.hurvich },
        ],
        cannotConclude: ['fit_is_not_validity', 'few_sessions_low_power_diagnostics'],
      };
    }
    case 'rate_uncertainty': {
      if (!pick || !pick.selected) return { ...base, status: 'insufficient_data', finding: { key: 'no_model', values: {} }, cannotConclude: [] };
      const fit = pick.comparison.rows.find((r) => r.model === pick.selected)!.fit;
      if (pick.selected === 'stationary') return { ...base, status: 'answered', finding: { key: 'no_rate_in_stationary', values: {} }, evidence: [{ kind: 'model', label: 'selected_model', value: 'stationary', ref: pick.seriesKey }], cannotConclude: ['absence_of_evidence_is_not_evidence_of_absence'] };
      const ev: Evidence[] = fit.profiles.map((p) => ({ kind: 'statistic', label: `profile:${p.param}`, value: `${p.estimate} [${p.loOpen ? '−' : p.lo}; ${p.hiOpen ? '+' : p.hi}]`, ref: pick.selected! }));
      ev.push({ kind: 'reference', label: 'profile_likelihood', value: null, ref: REF.raue });
      const open = fit.profiles.filter((p) => p.loOpen || p.hiOpen).map((p) => p.param);
      return { ...base, status: 'answered', finding: { key: open.length ? 'rate_not_identifiable' : 'rate_identifiable', values: { model: pick.selected, open: open.join(', ') } }, evidence: ev, cannotConclude: ['parameters_are_model_conditional'] };
    }
    case 'retention_sufficiency': {
      if (!pick) return { ...base, status: 'insufficient_data', finding: null, cannotConclude: [] };
      const r = pick.decomposition.retention;
      const tests = r.filter((x) => x.kind === 'retention_test').length;
      return {
        ...base,
        status: 'answered',
        finding: { key: tests ? 'retention_tests_present' : r.length ? 'only_delayed_observations' : 'no_retention_observations', values: { tests, delayed: r.length - tests, unknownPractice: r.filter((x) => x.practiceInDelay === 'unknown').length, evidence: pick.retention.status } },
        evidence: [
          ...r.map((x) => ({ kind: 'record' as const, label: `delay_${x.kind}`, value: x.days, ref: x.toSessionId })),
          { kind: 'model', label: 'forgetting_vs_saturation', value: pick.retention.status, ref: pick.seriesKey },
          { kind: 'reference', label: 'learning_performance_distinction', value: null, ref: REF.kantak },
        ],
        cannotConclude: ['retention_needs_designated_test_without_practice'],
      };
    }
    case 'poor_quality_sessions': {
      const bad = new Map<string, string[]>();
      for (const s of input.series) for (const x of s.sessions) if (!x.included) bad.set(x.sessionId, [...new Set([...(bad.get(x.sessionId) ?? []), ...x.exclusions])]);
      return {
        ...base,
        status: 'answered',
        finding: { key: bad.size ? 'poor_quality_found' : 'no_poor_quality', values: { sessions: bad.size } },
        evidence: [
          { kind: 'statistic' as const, label: 'sessions_examined', value: new Set(input.series.flatMap((s) => s.sessions.map((x) => x.sessionId))).size, ref: 'quality_rules' },
          ...[...bad.entries()].map(([id, why]) => ({ kind: 'record' as const, label: why.join(', '), value: id, ref: id })),
        ],
        cannotConclude: ['quality_rules_are_processing_conditions'],
      };
    }
    case 'next_observation': {
      if (!pick || !pick.selected) return { ...base, status: 'insufficient_data', finding: { key: 'no_model', values: {} }, cannotConclude: [] };
      const fit = pick.comparison.rows.find((r) => r.model === pick.selected)!.fit;
      const adv = nextObservationAdvice(fit, pick.comparison.prepared);
      if (!adv) return { ...base, status: 'not_answerable', finding: { key: 'design_needs_parametric_model', values: { model: pick.selected } }, cannotConclude: ['design_advice_is_model_conditional'] };
      const best = adv.options.filter((o) => o.reduction !== null).sort((a, b) => (b.reduction as number) - (a.reduction as number))[0];
      return {
        ...base,
        status: best ? 'answered' : 'not_answerable',
        finding: best ? { key: 'most_informative_next', values: { afterDays: best.afterDays, label: best.label, reduction: best.reduction as number, focus: adv.focus ?? '' } } : null,
        evidence: adv.options.map((o) => ({ kind: 'statistic' as const, label: `${o.label}:${o.afterDays}d`, value: o.reduction, ref: MODELS[adv.model].id })),
        cannotConclude: ['design_advice_is_model_conditional', 'not_a_treatment_recommendation'],
      };
    }
  }
}

/** De-identified, aggregated packet for an optional future language-model layer (never sent anywhere by this code). */
export function evidencePacket(analyses: readonly SeriesAnalysis[]): object {
  return analyses.map((a) => ({
    task: keyParts(a.seriesKey),
    included: a.included,
    selected: a.selected,
    overall: a.decomposition.overall ? { delta: a.decomposition.overall.delta, se: a.decomposition.overall.se, days: a.decomposition.overall.days } : null,
    warnings: a.warnings,
    retention: a.retention.status,
  }));
}
