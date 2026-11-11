// Statistical safeguards for the discovery layer: control of error rates over families of tests, and the line
// between exploratory and confirmatory analysis.
//
//   Holm (1979)                  family-wise error rate (FWER): probability of ANY false rejection ≤ α. Uniformly
//                                more powerful than Bonferroni, valid under any dependence.
//   Benjamini & Hochberg (1995)  false discovery rate (FDR): expected share of false rejections among rejections
//                                ≤ q. Valid for independent or positively dependent tests; used for screening.
// Both return adjusted p-values in the ORIGINAL order, so a result can be read as "significant at level α iff the
// adjusted p ≤ α".
//
// Confirmatory vs exploratory (Wagenmakers et al. 2012): an analysis is confirmatory only if its hypothesis,
// outcome, test and decision rule were fixed in a FROZEN protocol before the data it analyses were recorded.
// Everything else is exploratory, however small its p-value — and is labelled so wherever it is shown.

export interface Adjusted {
  p: number;
  adjusted: number;
  reject: boolean;
}

/** Holm step-down adjusted p-values (FWER). NaN p-values are passed through, never counted in the family. */
export function holm(ps: readonly number[], alpha = 0.05): Adjusted[] {
  const idx = ps.map((p, i) => ({ p, i })).filter((x) => Number.isFinite(x.p)).sort((a, b) => a.p - b.p);
  const m = idx.length;
  const out: Adjusted[] = ps.map((p) => ({ p, adjusted: NaN, reject: false }));
  let run = 0;
  idx.forEach((x, k) => {
    run = Math.max(run, Math.min(1, (m - k) * x.p));
    out[x.i] = { p: x.p, adjusted: run, reject: run <= alpha };
  });
  return out;
}

/** Benjamini–Hochberg step-up adjusted p-values (FDR at level q). */
export function benjaminiHochberg(ps: readonly number[], q = 0.05): Adjusted[] {
  const idx = ps.map((p, i) => ({ p, i })).filter((x) => Number.isFinite(x.p)).sort((a, b) => a.p - b.p);
  const m = idx.length;
  const out: Adjusted[] = ps.map((p) => ({ p, adjusted: NaN, reject: false }));
  let run = 1;
  for (let k = m - 1; k >= 0; k--) {
    const x = idx[k] as { p: number; i: number };
    run = Math.min(run, (m * x.p) / (k + 1));
    out[x.i] = { p: x.p, adjusted: run, reject: run <= q };
  }
  return out;
}

/** Bonferroni (for reference and for sequential designs where the family size is fixed in advance). */
export function bonferroni(ps: readonly number[], alpha = 0.05): Adjusted[] {
  const m = ps.filter(Number.isFinite).length;
  return ps.map((p) => ({ p, adjusted: Number.isFinite(p) ? Math.min(1, m * p) : NaN, reject: Number.isFinite(p) && m * p <= alpha }));
}

export type AnalysisIntent = 'confirmatory' | 'exploratory';

export interface IntentInput {
  /** The frozen protocol version that pre-specified the analysis, or null. */
  protocol: { status: 'draft' | 'frozen' | 'archived'; createdAt: string; frozenAt?: string | null } | null;
  /** The analysed outcome, model set and decision rule are the ones in the protocol. */
  matchesProtocol: boolean;
  /** Start time (ISO) of the earliest analysed observation. */
  firstObservation: string | null;
}

/**
 * Confirmatory only when a FROZEN protocol that pre-specifies this exact analysis existed before the first analysed
 * observation. `reasons` lists what is missing otherwise. (A protocol's own creation time is the latest moment its
 * definition can have changed: definitions are immutable once hashed.)
 */
export function analysisIntent(i: IntentInput): { intent: AnalysisIntent; reasons: string[] } {
  const reasons: string[] = [];
  if (!i.protocol) reasons.push('no_protocol_pre-specifies_this_analysis');
  else {
    if (i.protocol.status === 'draft') reasons.push('the_protocol_was_never_frozen');
    if (!i.matchesProtocol) reasons.push('outcome,_models_or_decision_rule_differ_from_the_protocol');
    const fixedAt = i.protocol.frozenAt ?? i.protocol.createdAt;
    if (i.firstObservation === null) reasons.push('no_observation_time_to_compare_with_the_protocol');
    else if (!(Date.parse(fixedAt) <= Date.parse(i.firstObservation))) reasons.push('the_protocol_was_fixed_after_data_collection_had_started');
  }
  return { intent: reasons.length ? 'exploratory' : 'confirmatory', reasons };
}

/**
 * Number of looks at accumulating data matters: testing after every session at a fixed α inflates the error rate.
 * Returns the per-look level that keeps the overall level at α for `looks` equally weighted looks (Šidák).
 */
export function perLookAlpha(alpha: number, looks: number): number {
  return looks <= 1 ? alpha : 1 - (1 - alpha) ** (1 / looks);
}
