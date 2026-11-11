// Validation of the learning observatory on SYNTHETIC series with known ground truth. Criteria fixed 2026-11-10
// before the reported run; thresholds of the detectors were calibrated on other seeds (CALIBRATION).
//
//   O1  false alarms under no change (independent normal sessions), horizons 10 and 20
//   O2  power and detection delay for a step change
//   O3  missing sessions: at random, and more likely when performance is poor
//   O4  autocorrelated day-to-day variation (model misspecification)
//   O5  heavy-tailed session noise (model misspecification)
//   O6  Bayesian change point: calibration under no change, recovery of the change position
//   O7  several features monitored together (family control)
//   O8  gradual drift
//   O9  a step caused by a change of measurement conditions — indistinguishable by construction
//   W1–W4 within-session patterns: none, practice-like, decline-like, rise-then-decline

import { round, wilson, type BenchmarkRecord } from '../benchmark';
import { createRng, type Rng } from '../../lib/random';
import { FRONTIER_VERSIONS } from '../version';
import { detectChange } from './changeDetection';
import { sittingDynamics, type SittingPattern } from './withinSession';

const V = FRONTIER_VERSIONS.observatory;
const rec = (r: Omit<BenchmarkRecord, 'component' | 'version'>): BenchmarkRecord => ({ ...r, component: 'observatory', version: V });

export const OBSERVATORY_CRITERIA = {
  O1_false_alarm_max: 0.06,
  O2_power_2sd_min: 0.8,
  O3_mcar_false_alarm_max: 0.06,
  O6_null_strong_max: 0.05,
  O6_tau_within_1_min: 0.7,
  O7_family_false_alarm_max: 0.06,
  W1_false_pattern_max: 0.1,
  W_power_min: 0.8,
  W3_power_min: 0.6,
} as const;

type Gen = (rng: Rng, k: number) => number;
const series = (n: number, rng: Rng, shift: (k: number) => number, noise: Gen = (r) => r.normal()): number[] => Array.from({ length: n }, (_, k) => 100 + 5 * (shift(k) + noise(rng, k)));
const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;

export function observatoryValidation(full: boolean): BenchmarkRecord[] {
  const mode = full ? 'full' : 'quick';
  const R = full ? 4000 : 60;
  const out: BenchmarkRecord[] = [];

  // O1
  {
    const detail: Record<string, number | string> = {};
    let worst = 0;
    for (const H of [10, 20] as const) {
      const rng = createRng(61_000 + H);
      let c = 0;
      let e = 0;
      let s = 0;
      for (let r = 0; r < R; r++) {
        const d = detectChange(series(H, rng, () => 0), { horizon: H });
        if (d.cusum.alarmAt !== null) c++;
        if (d.ewma.alarmAt !== null) e++;
        if (d.shewhart.alarmAt !== null) s++;
      }
      detail[`cusum_h${H}`] = round(c / R);
      detail[`ewma_h${H}`] = round(e / R);
      detail[`shewhart_h${H}`] = round(s / R);
      worst = Math.max(worst, c / R);
    }
    out.push(rec({
      id: 'O1', name: 'Change detection: false alarms under no change', purpose: 'How often does the primary detector signal a change in a series that has none, when the level and spread are learned from the series itself?',
      assumptions: 'Independent normal session means, no change; 10 or 20 sessions; self-starting residuals', groundTruth: 'No change',
      metric: 'largest series-wise false-alarm probability of the CUSUM over the two horizons', criterion: `≤ ${OBSERVATORY_CRITERIA.O1_false_alarm_max} (nominal 0.05)`,
      cases: 2 * R, value: round(worst), detail, pass: worst <= OBSERVATORY_CRITERIA.O1_false_alarm_max,
      knownFailureModes: ['autocorrelated or heavy-tailed day-to-day variation (O4, O5)', 'series longer than the design horizon'], mode,
    }));
  }
  // O2
  {
    const detail: Record<string, number | string> = {};
    let p2 = 0;
    for (const d of [1, 1.5, 2, 3]) {
      const rng = createRng(62_000 + Math.round(d * 10));
      let hit = 0;
      const delays: number[] = [];
      for (let r = 0; r < R; r++) {
        const x = detectChange(series(20, rng, (k) => (k >= 8 ? d : 0)), { horizon: 20 });
        if (x.cusum.alarmAt !== null && x.cusum.alarmAt >= 8) {
          hit++;
          delays.push(x.cusum.alarmAt - 8 + 1);
        }
      }
      detail[`power_step_${d}sd`] = round(hit / R);
      detail[`median_delay_sessions_${d}sd`] = med(delays);
      if (d === 2) p2 = hit / R;
    }
    // short series: step after session 4 of 10
    const rng = createRng(62_900);
    let hs = 0;
    for (let r = 0; r < R; r++) if (detectChange(series(10, rng, (k) => (k >= 4 ? 2 : 0)), { horizon: 10 }).cusum.alarmAt !== null) hs++;
    detail.power_step_2sd_10_sessions_after_4 = round(hs / R);
    out.push(rec({
      id: 'O2', name: 'Change detection: power and delay for a step', purpose: 'How large must a lasting change of level be, and how many sessions does it take, before it is signalled?',
      assumptions: '20 sessions, step after session 8, in units of the day-to-day SD of a session mean', groundTruth: 'Step of 1–3 SD',
      metric: 'power for a 2 SD step (alarm at or after the change)', criterion: `≥ ${OBSERVATORY_CRITERIA.O2_power_2sd_min}`,
      cases: 5 * R, value: round(p2), detail, pass: p2 >= OBSERVATORY_CRITERIA.O2_power_2sd_min,
      knownFailureModes: ['a self-starting chart absorbs an undetected shift into its own mean and spread: small steps are missed permanently', 'with 10 sessions and a change after the 4th the power is low — "no signal" is not evidence of stability'], mode,
    }));
  }
  // O3
  {
    const rng = createRng(63_000);
    let fa = 0;
    let pw = 0;
    let faMnar = 0;
    let pwMnar = 0;
    let pwFull = 0;
    for (let r = 0; r < R; r++) {
      const nul = series(20, rng, () => 0);
      const alt = series(20, rng, (k) => (k >= 8 ? -2 : 0));
      const keep = nul.map(() => rng.next() >= 0.3);
      if (detectChange(nul.filter((_, i) => keep[i]), { horizon: 20 }).cusum.alarmAt !== null) fa++;
      if (detectChange(alt.filter((_, i) => keep[i]), { horizon: 20 }).cusum.alarmAt !== null) pw++;
      if (detectChange(alt, { horizon: 20 }).cusum.alarmAt !== null) pwFull++;
      // missing not at random: a session below the starting level by more than 0.5 SD is missed with probability 0.6
      const mnar = (y: number[]) => y.filter((v) => !(v < 100 - 2.5 && rng.next() < 0.6));
      if (detectChange(mnar(nul), { horizon: 20 }).cusum.alarmAt !== null) faMnar++;
      if (detectChange(mnar(alt), { horizon: 20 }).cusum.alarmAt !== null) pwMnar++;
    }
    out.push(rec({
      id: 'O3', name: 'Change detection: missing sessions', purpose: 'Do missing sessions create false alarms, and how much do they hide a real decline — especially when poor sessions are the ones that go missing?',
      assumptions: '20 planned sessions; 30 % missing at random, or sessions more than 0.5 SD below the starting level missed with probability 0.6; nothing is interpolated', groundTruth: 'No change, or a decline of 2 SD after session 8',
      metric: 'false-alarm probability with 30 % of sessions missing at random', criterion: `≤ ${OBSERVATORY_CRITERIA.O3_mcar_false_alarm_max}`,
      cases: 5 * R, value: round(fa / R), detail: { power_decline_all_sessions: round(pwFull / R), power_decline_30pct_missing_at_random: round(pw / R), false_alarm_missing_when_poor: round(faMnar / R), power_decline_missing_when_poor: round(pwMnar / R) }, pass: fa / R <= OBSERVATORY_CRITERIA.O3_mcar_false_alarm_max,
      knownFailureModes: ['sessions missed BECAUSE performance was poor hide a decline: the power falls and nothing in the data reveals it — the reason for a missed session must be recorded'], mode,
    }));
  }
  // O4, O5 (misspecification — descriptive)
  {
    const rng = createRng(64_000);
    let ar = 0;
    let ht = 0;
    for (let r = 0; r < R; r++) {
      let prev = rng.normal();
      const arSeries = Array.from({ length: 20 }, (_, k) => {
        if (k > 0) prev = 0.5 * prev + Math.sqrt(1 - 0.25) * rng.normal();
        return 100 + 5 * prev;
      });
      if (detectChange(arSeries, { horizon: 20 }).cusum.alarmAt !== null) ar++;
      // Student-t with 3 df, scaled to unit variance
      const t3 = () => {
        const z = rng.normal();
        const c = rng.normal() ** 2 + rng.normal() ** 2 + rng.normal() ** 2;
        return (z / Math.sqrt(c / 3)) / Math.sqrt(3);
      };
      if (detectChange(series(20, rng, () => 0, t3), { horizon: 20 }).cusum.alarmAt !== null) ht++;
    }
    out.push(rec({
      id: 'O4', name: 'Change detection: autocorrelated day-to-day variation', purpose: 'What happens to the false-alarm probability when consecutive sessions are correlated (AR(1), ρ = 0.5) — a violation of the detector\'s assumption?',
      assumptions: 'Stationary AR(1) session means, ρ = 0.5, no change of level', groundTruth: 'No change', metric: 'false-alarm probability of the CUSUM', criterion: 'descriptive',
      cases: R, value: round(ar / R), detail: { nominal: 0.05 }, pass: null, knownFailureModes: ['slowly wandering performance is signalled as a change far more often than 5 %: a signal says "not one stable level", which a slow wander is not either'], mode,
    }));
    out.push(rec({
      id: 'O5', name: 'Change detection: heavy-tailed session noise', purpose: 'What happens to the false-alarm probability when single sessions are occasionally far off (Student-t, 3 df)?',
      assumptions: 'Independent t(3) session deviations scaled to unit variance, no change of level', groundTruth: 'No change', metric: 'false-alarm probability of the CUSUM', criterion: 'descriptive',
      cases: R, value: round(ht / R), detail: { nominal: 0.05 }, pass: null, knownFailureModes: ['an outlying session early in the series inflates the running SD and reduces power afterwards'], mode,
    }));
  }
  // O6
  {
    const rng = createRng(66_000);
    let strongNull = 0;
    let strongAlt = 0;
    let tauOk = 0;
    const pNull: number[] = [];
    const Rb = full ? 2000 : 40;
    for (let r = 0; r < Rb; r++) {
      const a = detectChange(series(16, rng, () => 0), { horizon: 20 }).bayes;
      if (a) {
        pNull.push(a.pChange);
        if (a.pChange >= 0.9) strongNull++;
      }
      const b = detectChange(series(16, rng, (k) => (k >= 8 ? 2 : 0)), { horizon: 20 }).bayes;
      if (b) {
        if (b.pChange >= 0.9) strongAlt++;
        if (Math.abs(b.mostLikelyAfter - 8) <= 1) tauOk++;
      }
    }
    out.push(rec({
      id: 'O6', name: 'Bayesian change point: calibration and position', purpose: 'Is strong posterior support for a change rare when there is none, and is the position of a real change recovered?',
      assumptions: '16 independent normal sessions; prior probability ½ of a change, uniform over its position, standardised shift ~ N(0, 1)', groundTruth: 'No change, or a 2 SD step after session 8',
      metric: 'share of unchanged series with posterior probability of a change ≥ 0.9; share of changed series with the most likely position within ±1 session', criterion: `≤ ${OBSERVATORY_CRITERIA.O6_null_strong_max} and ≥ ${OBSERVATORY_CRITERIA.O6_tau_within_1_min}`,
      cases: 2 * Rb, value: round(strongNull / Rb), detail: { median_posterior_no_change: round(med(pNull)), strong_support_when_changed: round(strongAlt / Rb), position_within_1_session: round(tauOk / Rb) }, pass: strongNull / Rb <= OBSERVATORY_CRITERIA.O6_null_strong_max && tauOk / Rb >= OBSERVATORY_CRITERIA.O6_tau_within_1_min,
      knownFailureModes: ['the posterior depends on the prior scale of the shift: it is always reported at three scales', 'a single change is assumed: a gradual change is described as a step somewhere in the middle'], mode,
    }));
  }
  // O7
  {
    const rng = createRng(67_000);
    let any = 0;
    const Rf = full ? 2000 : 40;
    for (let r = 0; r < Rf; r++) {
      let hit = false;
      for (let f = 0; f < 5; f++) if (detectChange(series(20, rng, () => 0), { horizon: 20, family: 5 }).cusum.alarmAt !== null) hit = true;
      if (hit) any++;
    }
    out.push(rec({
      id: 'O7', name: 'Change detection: five features monitored together', purpose: 'When five features of the same sessions are monitored, is the chance of ANY false alarm still about 5 %?',
      assumptions: 'Five independent unchanged series of 20 sessions; thresholds for α/5', groundTruth: 'No change in any feature', metric: 'probability that at least one of the five signals', criterion: `≤ ${OBSERVATORY_CRITERIA.O7_family_false_alarm_max}`,
      cases: Rf, value: round(any / Rf), detail: {}, pass: any / Rf <= OBSERVATORY_CRITERIA.O7_family_false_alarm_max,
      knownFailureModes: ['real features are positively correlated: the correction is then conservative (less power), not wrong'], mode,
    }));
  }
  // O8, O9 (descriptive)
  {
    const rng = createRng(68_000);
    let drift = 0;
    const delays: number[] = [];
    let placement = 0;
    for (let r = 0; r < R; r++) {
      const d = detectChange(series(20, rng, (k) => (k >= 6 ? 0.2 * (k - 5) : 0)), { horizon: 20 });
      if (d.cusum.alarmAt !== null) {
        drift++;
        delays.push(d.cusum.alarmAt - 6 + 1);
      }
      if (detectChange(series(20, rng, (k) => (k >= 10 ? 1.5 : 0)), { horizon: 20 }).cusum.alarmAt !== null) placement++;
    }
    out.push(rec({
      id: 'O8', name: 'Change detection: gradual drift', purpose: 'Is a slow, steady change (0.2 SD per session from session 6) signalled, and when?',
      assumptions: '20 sessions; linear drift reaching 2.8 SD at the last session', groundTruth: 'Drift from session 6', metric: 'probability of a signal', criterion: 'descriptive',
      cases: R, value: round(drift / R), detail: { median_sessions_from_drift_start_to_signal: med(delays) }, pass: null, knownFailureModes: ['a self-starting chart partly learns a slow drift as part of the normal spread'], mode,
    }));
    out.push(rec({
      id: 'O9', name: 'Change detection: a step caused by measurement conditions', purpose: 'If the sensor-placement protocol changes at session 10 and shifts the metric by 1.5 SD, does the detector signal it?',
      assumptions: 'The movement does not change; a constant measurement bias of 1.5 SD from session 10 (e.g. a different operator or strap position)', groundTruth: 'No change of the movement', metric: 'probability of a signal', criterion: 'descriptive',
      cases: R, value: round(placement / R), detail: {}, pass: null,
      knownFailureModes: ['the detector cannot tell a change of measurement conditions from a change of the movement: every signal must be checked against placement confidence and the session log before it is interpreted (lab/discovery/explanations.ts)'], mode,
    }));
  }
  // W1–W4
  {
    // each sitting runs 4 × 499 permutation fits: 400 sittings per pattern keep the full run to a few minutes
    const Rw = full ? 400 : 8;
    const run = (n: number, shape: (i: number, n: number) => number, seed: number): Record<SittingPattern, number> => {
      const rng = createRng(seed);
      const counts = { insufficient_repetitions: 0, no_trend_detected: 0, practice_like: 0, decline_like: 0, rise_then_decline: 0, mixed: 0 } as Record<SittingPattern, number>;
      for (let r = 0; r < Rw; r++) {
        const s = (up: 1 | -1, base: number, sd: number) => Array.from({ length: n }, (_, i) => base + sd * (up * shape(i, n) + rng.normal()));
        const p = sittingDynamics({ amplitude: s(1, 100, 5), peak_rate: s(1, 200, 15), duration: s(-1, 1.2, 0.08), smoothness: s(1, -1.6, 0.05) }, seed + r).pattern;
        counts[p]++;
      }
      return counts;
    };
    // run 1 (seeds 69000+) FAILED W1 (0.121): shapes were selected by AICc alone. A permutation test per feature was
    // added (withinSession.ts); run 2 uses seeds 169000+.
    const none = run(24, () => 0, 169_000);
    const falseRate = 1 - none.no_trend_detected / Rw;
    out.push(rec({
      id: 'W1', name: 'Within-session pattern: none', purpose: 'With no change across the repetitions of a sitting, how often is a pattern reported?',
      assumptions: '24 repetitions, four independent features, normal repetition noise', groundTruth: 'No trend', metric: 'share of sittings with any pattern other than no_trend_detected', criterion: `≤ ${OBSERVATORY_CRITERIA.W1_false_pattern_max}`,
      cases: Rw, value: round(falseRate), detail: { ...none }, pass: falseRate <= OBSERVATORY_CRITERIA.W1_false_pattern_max, knownFailureModes: ['run 1 failed (12.1 %): shapes were chosen by AICc alone; a permutation test per feature, Holm-adjusted, now decides whether a feature moves', 'features of one movement are correlated; the Holm correction assumes nothing about that and stays valid'], mode,
    }));
    const up = run(24, (i, n) => (2 * i) / (n - 1), 169_100);
    out.push(rec({
      id: 'W2', name: 'Within-session pattern: practice-like', purpose: 'Is a steady improvement of 2 repetition-SDs across a sitting recognised?',
      assumptions: '24 repetitions; every feature moves 2 SD in the "up" direction, linearly', groundTruth: 'Monotone improvement', metric: 'share classified practice_like', criterion: `≥ ${OBSERVATORY_CRITERIA.W_power_min}`,
      cases: Rw, value: round(up.practice_like / Rw), detail: { ...up }, pass: up.practice_like / Rw >= OBSERVATORY_CRITERIA.W_power_min, knownFailureModes: ['with 8–12 repetitions the power is much lower'], mode,
    }));
    const down = run(24, (i, n) => (-2 * i) / (n - 1), 169_200);
    out.push(rec({
      id: 'W4', name: 'Within-session pattern: decline-like', purpose: 'Is a steady decline of 2 repetition-SDs across a sitting recognised — and reported as a pattern, not as fatigue?',
      assumptions: 'As W2, in the "down" direction', groundTruth: 'Monotone decline', metric: 'share classified decline_like', criterion: `≥ ${OBSERVATORY_CRITERIA.W_power_min}`,
      cases: Rw, value: round(down.decline_like / Rw), detail: { ...down }, pass: down.decline_like / Rw >= OBSERVATORY_CRITERIA.W_power_min, knownFailureModes: ['fatigue, loss of attention, discomfort and boredom give the same pattern'], mode,
    }));
    const hump = run(30, (i, n) => { const x = i / (n - 1); return x < 0.5 ? 5 * x : 2.5 - 5 * (x - 0.5); }, 169_300);
    const [lo, hi] = wilson(hump.rise_then_decline, Rw);
    out.push(rec({
      id: 'W3', name: 'Within-session pattern: rise then decline', purpose: 'Is an improvement followed by a decline (2.5 SD up over the first half, back down over the second) recognised?',
      assumptions: '30 repetitions, symmetric rise and fall in every feature', groundTruth: 'Rise then decline, slope change at the middle', metric: 'share classified rise_then_decline', criterion: `≥ ${OBSERVATORY_CRITERIA.W3_power_min}`,
      cases: Rw, value: round(hump.rise_then_decline / Rw), detail: { ...hump, ci95: `[${round(lo)}, ${round(hi)}]` }, pass: hump.rise_then_decline / Rw >= OBSERVATORY_CRITERIA.W3_power_min, knownFailureModes: ['a rise and fall of equal size has no linear trend: with fewer than 12 repetitions it is reported as no trend'], mode,
    }));
  }
  return out;
}
