// Counterfactual research sandbox. Every output here is HYPOTHETICAL: what a fitted model would predict under a
// schedule that did not happen. It is conditional on the model being an adequate description, and on the dose
// assumption. It is never a recommendation and never evidence that an intervention works.

import { createRng } from '../lib/random';
import type { BootstrapResult, ModelFit } from './fit';
import { jacobian, invert, quantile } from './numeric';
import { lrStep, MODELS, toFree, toNatural, type ModelId, type Prepared } from './models';

export interface ScenarioSession {
  /** Days after the last observed session. */
  afterDays: number;
  /** Dose in the interval ending at this session (same unit as the fit's dose mode). */
  dose: number;
}

export interface Scenario {
  label: string;
  sessions: ScenarioSession[];
  /** Override the retention half-life (days) — sensitivity analysis; null = use the fitted/bootstrapped values. */
  halfLifeOverride: number | null;
  /** Multiply the gain per dose (sensitivity); 1 = as fitted. */
  gainMultiplier: number;
}

export interface ScenarioResult {
  label: string;
  /** Days since the first included session. */
  t: number[];
  median: number[];
  lo: number[];
  hi: number[];
  /** Plug-in (MLE) trajectory. */
  mle: number[];
  supported: boolean;
  reason: string | null;
}

/** Which models can evaluate a change in practice dose/schedule (only models with a dose term). */
export const SCENARIO_MODELS: readonly ModelId[] = ['learning_retention'];

export function regularScenario(label: string, count: number, intervalDays: number, dosePerInterval: number): Scenario {
  return { label, sessions: Array.from({ length: count }, (_, i) => ({ afterDays: intervalDays * (i + 1), dose: dosePerInterval })), halfLifeOverride: null, gainMultiplier: 1 };
}

export function runScenario(fit: ModelFit, d: Prepared, boot: BootstrapResult | null, sc: Scenario): ScenarioResult {
  const base = { label: sc.label, t: [] as number[], median: [] as number[], lo: [] as number[], hi: [] as number[], mle: [] as number[] };
  if (fit.status !== 'ok') return { ...base, supported: false, reason: 'model_not_fitted' };
  if (!SCENARIO_MODELS.includes(fit.model)) return { ...base, supported: false, reason: 'model_has_no_dose_term' };
  const tLast = d.t[d.t.length - 1] as number;
  const times = sc.sessions.map((s) => tLast + s.afterDays);
  const adjust = (p: readonly number[]) => {
    const q = [...p];
    if (sc.halfLifeOverride !== null) q[1] = sc.halfLifeOverride;
    q[2] = (q[2] as number) * sc.gainMultiplier;
    return q;
  };
  const path = (p: readonly number[]) => {
    const spec = MODELS[fit.model];
    const lastZ = spec.latent(p, d).mean[d.t.length - 1] as number;
    let z = lastZ;
    let prev = tLast;
    return sc.sessions.map((s, i) => {
      z = lrStep(z, p[0] as number, p[1] as number, p[2] as number, s.dose, (times[i] as number) - prev);
      prev = times[i] as number;
      return z;
    });
  };
  const mle = path(adjust(fit.params));
  const draws: number[][] = times.map(() => []);
  const rng = createRng(0xa5a5);
  if (boot && boot.ok >= 20) {
    for (const p of boot.params) path(adjust(p)).forEach((v, i) => draws[i]!.push(v));
  }
  void rng;
  const has = draws[0] && draws[0].length >= 20;
  return {
    label: sc.label,
    t: times,
    mle,
    median: has ? draws.map((x) => quantile([...x].sort((a, b) => a - b), 0.5)) : mle,
    lo: has ? draws.map((x) => quantile([...x].sort((a, b) => a - b), 0.025)) : mle,
    hi: has ? draws.map((x) => quantile([...x].sort((a, b) => a - b), 0.975)) : mle,
    supported: true,
    reason: has ? null : 'no_bootstrap_band',
  };
}

// ── Which next observation is most informative? ─────────────────────────────────────────────────

export interface DesignOption {
  afterDays: number;
  dose: number;
  label: 'continued_practice' | 'no_practice_probe';
  /** Approximate SE of each interpretable parameter (free scale: log for time constants) after adding the session. */
  se: Record<string, number | null>;
  /** Relative reduction of the SE of the focus parameter vs. now (0.2 = 20 % smaller). */
  reduction: number | null;
}

export interface DesignAdvice {
  model: ModelId;
  focus: string | null;
  current: Record<string, number | null>;
  options: DesignOption[];
  method: 'expected_fisher_information';
  notes: string[];
}

/**
 * Expected Fisher information of the mean-structure parameters (local, at the MLE):
 *   I(θ) = Jᵀ R⁻¹ J,  J = ∂m/∂θ (free parameters), R = diag(σs² + σε²/n).
 * Adding a candidate session adds one row to J. Only deterministic-mean models qualify; this is an asymptotic
 * approximation and is labelled as such.
 */
export function nextObservationAdvice(fit: ModelFit, d: Prepared, reps = 3): DesignAdvice | null {
  if (fit.status !== 'ok' || fit.model === 'local_level' || fit.model === 'stationary') return null;
  const spec = MODELS[fit.model];
  const nMean = spec.params.length - 1;
  const freeHat = fit.params.slice(0, nMean).map((v, i) => toFree(spec.params[i]!.transform, v));
  const sS = fit.params[nMean] as number;
  const meansAt = (u: number[], times: number[], doses: number[]) => {
    const p = [...u.map((v, i) => toNatural(spec.params[i]!.transform, v)), sS];
    const dd: Prepared = { ...d, t: times, dose: doses, y: times.map(() => 0), n: times.map(() => reps) };
    return spec.latent(p, dd).mean;
  };
  const seFrom = (times: number[], doses: number[], ns: number[]) => {
    const J = jacobian((u) => meansAt(u, times, doses), freeHat);
    const I: number[][] = Array.from({ length: nMean }, () => new Array<number>(nMean).fill(0));
    times.forEach((_, k) => {
      const r = sS * sS + d.sigmaE2 / Math.max(1, ns[k] as number);
      for (let a = 0; a < nMean; a++) for (let b = 0; b < nMean; b++) I[a]![b]! += (J[k]![a]! * J[k]![b]!) / r;
    });
    const C = invert(I);
    const out: Record<string, number | null> = {};
    spec.params.slice(0, nMean).forEach((def, i) => {
      if (!def.interpretable) return;
      out[def.name] = C && C[i]![i]! > 0 ? Math.sqrt(C[i]![i] as number) : null;
    });
    return out;
  };
  const current = seFrom(d.t, d.dose, d.n);
  const focus = fit.model === 'learning_retention' ? 'retention_half_life_days' : fit.model === 'exponential' ? 'time_constant_days' : 'slope_per_week';
  const medDose = [...d.dose.slice(1)].sort((a, b) => a - b)[Math.floor((d.dose.length - 1) / 2)] ?? 1;
  const last = d.t[d.t.length - 1] as number;
  const options: DesignOption[] = [];
  for (const after of [7, 14, 21, 28, 42, 56, 84]) {
    const variants: { label: DesignOption['label']; dose: number }[] = [{ label: 'continued_practice', dose: d.doseMode === 'time_on_program' ? after : medDose }];
    if (fit.model === 'learning_retention') variants.push({ label: 'no_practice_probe', dose: 0 });
    for (const v of variants) {
      const se = seFrom([...d.t, last + after], [...d.dose, v.dose], [...d.n, reps]);
      const now = current[focus];
      const next = se[focus];
      options.push({ afterDays: after, dose: v.dose, label: v.label, se, reduction: now && next ? 1 - next / now : null });
    }
  }
  const notes = ['asymptotic_local_approximation', 'assumes_model_is_adequate'];
  if (fit.model === 'learning_retention') notes.push('no_practice_probe_is_a_design_question_not_a_recommendation');
  return { model: fit.model, focus, current, options, method: 'expected_fisher_information', notes };
}
