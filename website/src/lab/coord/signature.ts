// Two exploratory questions about reproducibility over sessions.
//
// 1. Individual movement signature ("fingerprint") — is a participant's multivariate movement description more
//    similar to their own other session than to other participants' sessions? A statement about REPRODUCIBILITY of a
//    description, not an identity or a diagnosis: it says whether the features carry stable person-specific
//    information beyond session-to-session variation (which includes sensor re-attachment), and which features do.
//      identification   each later session is matched to the nearest first session of any participant
//                       (features z-scored over all sessions; Euclidean distance over shared features)
//      chance           1 / participants; p by permuting which participant each later session belongs to
//      I_diff           mean distance to others − mean distance to self, in pooled-SD units
//      per feature      one-way ICC(1,1) with sessions as replicates: share of variance between participants
//    Needs ≥ 5 participants with ≥ 2 sessions each; below that it reports insufficient data.
//
// 2. Strategy shift across sessions — did the SHARE of one strategy among the confidently assigned repetitions
//    change between earlier and later sessions? Likelihood-ratio statistic of the best split of the ordered sessions
//    into "before" and "after" (binomial), p by permuting repetitions across sessions (session sizes fixed), which
//    accounts for having searched over the split. Under one stable mixture the false-alarm rate is α by construction.

import { wilson } from '../benchmark';
import { createRng, mean, shuffle } from './stats';

// ── movement signature ────────────────────────────────────────────────────────────────────────────────────

export interface SignatureSession {
  participantId: string;
  recordingId: string;
  /** Order of the session within the participant (0 = first). */
  sessionIndex: number;
  /** Feature means of the session, keyed e.g. `${task}:${feature}`. */
  features: Readonly<Record<string, number>>;
}

export const SIGNATURE_RULE = { minParticipants: 5, minSessions: 2, alpha: 0.05 } as const;

export interface SignatureResult {
  verdict: 'insufficient_data' | 'no_reproducible_signature' | 'reproducible_signature';
  reasons: string[];
  participants: number;
  queries: number;
  /** Share of later sessions matched to their own participant's first session. */
  identification: number | null;
  ci95: [number, number] | null;
  chance: number | null;
  p: number | null;
  /** (mean distance to other participants − mean distance to self) in units of pooled feature SD. */
  iDiff: number | null;
  /** Between-participant share of each feature's variance (ICC(1,1), sessions as replicates), descending. */
  features: { feature: string; icc: number; participants: number }[];
  notes: string[];
}

function icc1(groups: readonly number[][]): number {
  const k = groups.length;
  const N = groups.reduce((a, g) => a + g.length, 0);
  if (k < 2 || N <= k) return NaN;
  const grand = mean(groups.flat());
  let ssb = 0;
  let ssw = 0;
  let sumN2 = 0;
  for (const g of groups) {
    const m = mean(g);
    ssb += g.length * (m - grand) ** 2;
    for (const v of g) ssw += (v - m) ** 2;
    sumN2 += g.length ** 2;
  }
  const msb = ssb / (k - 1);
  const msw = ssw / (N - k);
  const n0 = (N - sumN2 / N) / (k - 1);
  return msb + (n0 - 1) * msw > 0 ? (msb - msw) / (msb + (n0 - 1) * msw) : NaN;
}

export function movementSignature(sessions: readonly SignatureSession[], o: { seed?: number; permutations?: number } = {}): SignatureResult {
  const notes = ['exploratory', 'a_reproducibility_statement_about_a_movement_description_—_not_an_identifier_and_not_a_diagnostic_marker', 'session-to-session_variation_here_includes_sensor_re-attachment'];
  const reasons: string[] = [];
  const byP = new Map<string, SignatureSession[]>();
  for (const s of sessions) byP.set(s.participantId, [...(byP.get(s.participantId) ?? []), s]);
  const parts = [...byP.entries()].filter(([, v]) => v.length >= SIGNATURE_RULE.minSessions).map(([id, v]) => ({ id, sessions: [...v].sort((a, b) => a.sessionIndex - b.sessionIndex) }));
  const P = parts.length;
  const empty: SignatureResult = { verdict: 'insufficient_data', reasons, participants: P, queries: 0, identification: null, ci95: null, chance: null, p: null, iDiff: null, features: [], notes };
  if (P < SIGNATURE_RULE.minParticipants) {
    reasons.push(`${P}_participants_with_≥_${SIGNATURE_RULE.minSessions}_sessions_(minimum_${SIGNATURE_RULE.minParticipants})`);
    return empty;
  }
  const all = parts.flatMap((p) => p.sessions);
  const keys = [...new Set(all.flatMap((s) => Object.keys(s.features)))].filter((k) => all.filter((s) => Number.isFinite(s.features[k] as number)).length >= 0.8 * all.length);
  if (!keys.length) {
    reasons.push('no_feature_is_present_in_≥_80_%_of_the_sessions');
    return empty;
  }
  // z-score per feature over all sessions (unsupervised scaling; uses no participant labels)
  const stat = new Map<string, { m: number; sd: number }>();
  for (const k of keys) {
    const v = all.map((s) => s.features[k]).filter((x): x is number => Number.isFinite(x as number));
    const m = mean(v);
    const sd = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, v.length - 1));
    stat.set(k, { m, sd: sd > 0 ? sd : 1 });
  }
  const z = (s: SignatureSession) => keys.map((k) => (Number.isFinite(s.features[k] as number) ? ((s.features[k] as number) - (stat.get(k) as { m: number }).m) / (stat.get(k) as { sd: number }).sd : NaN));
  const dist = (a: number[], b: number[]) => {
    let q = 0;
    let n = 0;
    for (let j = 0; j < a.length; j++)
      if (Number.isFinite(a[j] as number) && Number.isFinite(b[j] as number)) {
        q += ((a[j] as number) - (b[j] as number)) ** 2;
        n++;
      }
    return n ? Math.sqrt(q / n) : NaN;
  };
  const gallery = parts.map((p) => z(p.sessions[0] as SignatureSession));
  const queries = parts.flatMap((p, pi) => p.sessions.slice(1).map((s) => ({ pi, v: z(s) })));
  const D = queries.map((q) => gallery.map((g) => dist(q.v, g)));
  const score = (owner: readonly number[]) => {
    let ok = 0;
    D.forEach((row, qi) => {
      let best = 0;
      for (let j = 1; j < row.length; j++) if ((row[j] as number) < (row[best] as number)) best = j;
      if (best === owner[qi]) ok++;
    });
    return ok;
  };
  const owner = queries.map((q) => q.pi);
  const hits = score(owner);
  const rng = createRng(o.seed ?? 20261110);
  const perms = o.permutations ?? 1999;
  let ge = 0;
  for (let i = 0; i < perms; i++) if (score(shuffle(owner, rng)) >= hits) ge++;
  const p = (1 + ge) / (perms + 1);
  const self: number[] = [];
  const other: number[] = [];
  D.forEach((row, qi) => row.forEach((d, j) => (j === owner[qi] ? self : other).push(d)));
  const features = keys
    .map((k) => {
      const groups = parts.map((pp) => pp.sessions.map((s) => s.features[k]).filter((x): x is number => Number.isFinite(x as number))).filter((g) => g.length >= 2);
      return { feature: k, icc: icc1(groups), participants: groups.length };
    })
    .filter((f) => Number.isFinite(f.icc))
    .sort((a, b) => b.icc - a.icc);
  const identification = hits / queries.length;
  const verdict = p < SIGNATURE_RULE.alpha ? 'reproducible_signature' : 'no_reproducible_signature';
  if (verdict === 'no_reproducible_signature') reasons.push(`identification_${identification.toFixed(2)}_vs_chance_${(1 / P).toFixed(2)},_p_${p.toFixed(3)}`);
  return { verdict, reasons, participants: P, queries: queries.length, identification, ci95: wilson(hits, queries.length), chance: 1 / P, p, iDiff: mean(other) - mean(self), features, notes };
}

// ── strategy shift across sessions ────────────────────────────────────────────────────────────────────────

export interface ShiftSession {
  sessionId: string;
  /** Confidently assigned repetitions of the strategy of interest, and of all other supported strategies. */
  a: number;
  b: number;
}

export const SHIFT_RULE = { minSessions: 2, minRepetitions: 12, alpha: 0.05 } as const;

export interface StrategyShift {
  verdict: 'insufficient_data' | 'no_shift_detected' | 'shift_detected';
  reasons: string[];
  /** Sessions before the split / from the split on, and the share of strategy A in each part. */
  split: number | null;
  shareBefore: number | null;
  shareAfter: number | null;
  /** Likelihood-ratio statistic of the best split and its permutation p-value. */
  statistic: number | null;
  p: number | null;
}

const xlogy = (x: number, y: number) => (x > 0 ? x * Math.log(y) : 0);
function llBinom(a: number, n: number): number {
  if (!n) return 0;
  const p = a / n;
  return xlogy(a, p) + xlogy(n - a, 1 - p);
}
function bestSplit(a: readonly number[], n: readonly number[]): { k: number; lr: number } {
  const A = a.reduce((x, y) => x + y, 0);
  const N = n.reduce((x, y) => x + y, 0);
  const l0 = llBinom(A, N);
  let best = { k: 1, lr: -Infinity };
  let ca = 0;
  let cn = 0;
  for (let k = 1; k < a.length; k++) {
    ca += a[k - 1] as number;
    cn += n[k - 1] as number;
    const lr = 2 * (llBinom(ca, cn) + llBinom(A - ca, N - cn) - l0);
    if (lr > best.lr) best = { k, lr };
  }
  return best;
}

export function strategyShift(sessions: readonly ShiftSession[], o: { seed?: number; permutations?: number } = {}): StrategyShift {
  const reasons: string[] = [];
  const use = sessions.filter((s) => s.a + s.b > 0);
  const N = use.reduce((x, s) => x + s.a + s.b, 0);
  const A = use.reduce((x, s) => x + s.a, 0);
  const none = (verdict: StrategyShift['verdict']): StrategyShift => ({ verdict, reasons, split: null, shareBefore: null, shareAfter: null, statistic: null, p: null });
  if (use.length < SHIFT_RULE.minSessions || N < SHIFT_RULE.minRepetitions) {
    reasons.push(`${use.length}_sessions_with_${N}_confidently_assigned_repetitions_(minimum_${SHIFT_RULE.minSessions}_and_${SHIFT_RULE.minRepetitions})`);
    return none('insufficient_data');
  }
  if (A === 0 || A === N) {
    reasons.push('only_one_strategy_among_the_confident_assignments');
    return { ...none('no_shift_detected'), shareBefore: A / N, shareAfter: A / N };
  }
  const a = use.map((s) => s.a);
  const n = use.map((s) => s.a + s.b);
  const obs = bestSplit(a, n);
  const rng = createRng(o.seed ?? 20261110);
  const P = o.permutations ?? 1999;
  const pool = [...new Array<number>(A).fill(1), ...new Array<number>(N - A).fill(0)];
  let ge = 0;
  for (let q = 0; q < P; q++) {
    const sh = shuffle(pool, rng);
    let off = 0;
    const pa = n.map((m) => {
      let c = 0;
      for (let i = 0; i < m; i++) c += sh[off + i] as number;
      off += m;
      return c;
    });
    if (bestSplit(pa, n).lr >= obs.lr - 1e-12) ge++;
  }
  const p = (1 + ge) / (P + 1);
  const ca = a.slice(0, obs.k).reduce((x, y) => x + y, 0);
  const cn = n.slice(0, obs.k).reduce((x, y) => x + y, 0);
  const verdict = p < SHIFT_RULE.alpha ? 'shift_detected' : 'no_shift_detected';
  if (verdict === 'no_shift_detected') reasons.push(`p_${p.toFixed(3)}`);
  return { verdict, reasons, split: obs.k, shareBefore: ca / cn, shareAfter: (A - ca) / (N - cn), statistic: obs.lr, p };
}
