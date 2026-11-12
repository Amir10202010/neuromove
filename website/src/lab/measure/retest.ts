// Test–retest measurement science beyond a single ICC: variance components, reliability AND measurement error as
// distinct properties, agreement, systematic change between occasions, and heteroscedasticity.
//
// COSMIN perspective (Mokkink & Eekhout 2026, doi:10.1016/j.jclinepi.2025.112058): reliability (ICC) is the ability
// to tell PEOPLE apart and depends on how different the people in the sample are; measurement error (SEM, MDC) is
// the precision of ONE person's score and does not. A high ICC in a heterogeneous sample says nothing about whether
// a small change in one child is real — so both are always reported together, with the MDC in the metric's units.
//
// Design assumed: every participant measured on ≥ 2 occasions under conditions believed STABLE (no practice in
// between, short interval), with repetitions kept. Nothing here can verify stability; the systematic-change test
// reports when the occasions differ on average (familiarisation, learning, protocol drift).
//
// Model (nested random effects):  y_ijk = μ + P_i + S_ij + ε_ijk
//   P_i ~ (0, σp²) participant, S_ij ~ (0, σs²) session within participant, ε_ijk ~ (0, σε²) repetition.
// Estimation: unweighted-means ANOVA (exact for balanced designs); negative estimates are set to 0 and flagged.
//   SEM(n)   = √(σs² + σε²/n)                  measurement error of a session mean of n repetitions
//   MDC95(n) = 1.96·√2·SEM(n)                  smallest difference between two sessions beyond error (Weir 2005)
//   ICC(n)   = σp² / (σp² + σs² + σε²/n)       reliability of a session mean of n repetitions
// The existing two-way ICC(A,1)/ICC(C,1) (research/stats.ts icc) is reported alongside for the first two occasions.

import { agreement, icc, sufficiency, tCdf, tQuantile, type BlandAltman, type Icc, type Sufficiency } from '../../research/stats';
import { kendallTau, sdInterval } from './stats';

export interface RetestParticipant {
  participantId: string;
  /** Repetition values of each occasion, in time order. */
  sessions: number[][];
}

export interface VarianceComponents {
  participants: number;
  sessions: number;
  repetitions: number;
  /** SDs of the three components, metric units. */
  sigmaP: number;
  sigmaS: number;
  sigmaE: number;
  /** A component whose estimate was negative and set to 0 (the data cannot bound it away from 0). */
  truncated: { participant: boolean; session: boolean };
  dfP: number;
  dfS: number;
  dfE: number;
  /** Design values used for "a typical session": harmonic mean of repetitions per session. */
  repsTypical: number;
}

export interface RetestReport {
  components: VarianceComponents | null;
  /** For a session mean of `repsTypical` repetitions. */
  sem: number | null;
  semCi: [number, number] | null;
  mdc95: number | null;
  iccSessionMean: number | null;
  /** MDC95 relative to the between-participant SD: > 1 means the detectable change exceeds a typical difference between two children. */
  mdcOverBetweenSd: number | null;
  /** Two-way ANOVA ICCs of the first two occasions (absolute agreement and consistency), existing implementation. */
  icc: Icc | null;
  /** Bland–Altman agreement of occasion 2 vs occasion 1 (difference = retest − test). */
  agreement: BlandAltman | null;
  /** Mean change occasion 1 → 2 across participants with its 95 % CI and paired-t p-value. */
  systematic: { mean: number; ci: [number, number]; p: number } | null;
  /** Kendall τ between |difference| and mean: does the error grow with the magnitude? */
  heteroscedasticity: { tau: number; p: number | null; present: boolean | null };
  sufficiency: Sufficiency;
  notes: string[];
}

const meanOf = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function varianceComponents(data: readonly RetestParticipant[]): VarianceComponents | null {
  const parts = data.map((p) => ({ ...p, sessions: p.sessions.filter((s) => s.length > 0) })).filter((p) => p.sessions.length >= 2);
  const I = parts.length;
  if (I < 2) return null;
  let ssE = 0;
  let dfE = 0;
  let ssS = 0;
  let dfS = 0;
  let invN = 0;
  let nSess = 0;
  let nRep = 0;
  let invJ = 0;
  const pMeans: number[] = [];
  for (const p of parts) {
    const sMeans = p.sessions.map(meanOf);
    p.sessions.forEach((s, j) => {
      for (const y of s) ssE += (y - (sMeans[j] as number)) ** 2;
      dfE += s.length - 1;
      invN += 1 / s.length;
      nRep += s.length;
    });
    const pm = meanOf(sMeans);
    pMeans.push(pm);
    for (const m of sMeans) ssS += (m - pm) ** 2;
    dfS += p.sessions.length - 1;
    nSess += p.sessions.length;
    invJ += 1 / p.sessions.length;
  }
  const h = invN / nSess; // mean 1/n_ij
  const g = invJ / I; // mean 1/J_i
  const msE = dfE > 0 ? ssE / dfE : 0;
  const msS = ssS / dfS; // estimates σs² + σε²·h
  const grand = meanOf(pMeans);
  const msP = pMeans.reduce((a, m) => a + (m - grand) ** 2, 0) / (I - 1); // estimates σp² + (σs² + σε²·h)·g
  const vS = msS - msE * h;
  const vP = msP - msS * g;
  return {
    participants: I,
    sessions: nSess,
    repetitions: nRep,
    sigmaP: Math.sqrt(Math.max(0, vP)),
    sigmaS: Math.sqrt(Math.max(0, vS)),
    sigmaE: Math.sqrt(msE),
    truncated: { participant: vP < 0, session: vS < 0 },
    dfP: I - 1,
    dfS,
    dfE,
    repsTypical: 1 / h,
  };
}

/** SEM, MDC95 and ICC of a session mean of `n` repetitions from the variance components (planning: any n). */
export function reliabilityAt(vc: VarianceComponents, n: number): { sem: number; mdc95: number; icc: number } {
  const err = vc.sigmaS ** 2 + vc.sigmaE ** 2 / Math.max(1, n);
  const sem = Math.sqrt(err);
  return { sem, mdc95: 1.959963984540054 * Math.SQRT2 * sem, icc: vc.sigmaP ** 2 + err > 0 ? vc.sigmaP ** 2 / (vc.sigmaP ** 2 + err) : NaN };
}

export const HETEROSCEDASTICITY_ALPHA = 0.05;

export function retestReport(data: readonly RetestParticipant[]): RetestReport {
  const notes: string[] = [];
  const usable = data.filter((p) => p.sessions.filter((s) => s.length > 0).length >= 2);
  const vc = varianceComponents(usable);
  const first2 = usable.map((p) => p.sessions.filter((s) => s.length > 0).slice(0, 2).map(meanOf) as [number, number]);
  const n = first2.length;
  let sem: number | null = null;
  let semCi: [number, number] | null = null;
  let mdc: number | null = null;
  let iccMean: number | null = null;
  if (vc) {
    const r = reliabilityAt(vc, vc.repsTypical);
    sem = r.sem;
    mdc = r.mdc95;
    iccMean = Number.isFinite(r.icc) ? r.icc : null;
    // SEM² at the typical session length is the between-session mean square (dfS degrees of freedom)
    semCi = sdInterval(sem, vc.dfS);
    if (vc.truncated.session) notes.push('session_component_estimated_as_0:_day-to-day_variation_is_not_distinguishable_from_repetition_noise_in_these_data');
    if (vc.truncated.participant) notes.push('participant_component_estimated_as_0:_the_sample_does_not_differ_between_participants_beyond_error_(ICC_0)');
  }
  const d = first2.map(([a, b]) => b - a);
  const m = first2.map(([a, b]) => (a + b) / 2);
  let systematic: RetestReport['systematic'] = null;
  if (n >= 3) {
    const md = meanOf(d);
    const sd = Math.sqrt(d.reduce((a, x) => a + (x - md) ** 2, 0) / (n - 1));
    const se = sd / Math.sqrt(n);
    const tq = tQuantile(0.975, n - 1);
    systematic = { mean: md, ci: [md - tq * se, md + tq * se], p: se > 0 ? 2 * (1 - tCdf(Math.abs(md / se), n - 1)) : md === 0 ? 1 : 0 };
    if (systematic.p < 0.05) notes.push('occasions_differ_on_average:_the_"stable"_assumption_is_doubtful_(familiarisation,_learning_or_protocol_drift)_—_agreement_SEM_exceeds_consistency_SEM');
  }
  const kt = kendallTau(m, d.map(Math.abs));
  const hetero = { tau: kt.tau, p: kt.p, present: kt.p === null ? null : kt.p < HETEROSCEDASTICITY_ALPHA && kt.tau > 0 };
  if (hetero.present) notes.push('error_grows_with_the_magnitude:_a_single_SEM/MDC_in_absolute_units_misstates_the_error_—_report_it_relative_to_the_value_or_on_a_log_scale');
  notes.push('ICC_describes_how_well_participants_are_told_apart_in_THIS_sample;_whether_a_change_in_one_participant_is_real_is_answered_by_the_MDC,_not_by_the_ICC');
  notes.push('valid_only_if_the_occasions_were_recorded_under_stable_conditions_(no_practice_between,_same_protocol)');
  return {
    components: vc,
    sem,
    semCi,
    mdc95: mdc,
    iccSessionMean: iccMean,
    mdcOverBetweenSd: vc && mdc !== null && vc.sigmaP > 0 ? mdc / vc.sigmaP : null,
    icc: n >= 2 ? icc(first2) : null,
    agreement: n >= 3 ? agreement(first2.map(([a, b], i) => ({ imu: b, ref: a, subject: usable[i]!.participantId }))) : null,
    systematic,
    heteroscedasticity: hetero,
    sufficiency: sufficiency(n, 'icc'),
    notes,
  };
}
