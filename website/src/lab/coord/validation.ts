// MCSE validation suite — ground-truth recovery, robustness, false-discovery and minimum-data experiments on the
// SYNTHETIC generator (synthetic.ts, through the full IMU measurement model). Criteria are fixed in CRITERIA
// below and in research/mcse-validation.md BEFORE the suite was first run; failures are reported, not tuned away.

import { buildChannels } from './channels';
import { fitPca, projectRows } from './components';
import { reconstruct } from './linalg';
import { runMcse, type McseResult } from './engine';
import { compareGroups, DEFAULT_DISSOCIATION, type RepVector } from './dissociation';
import { madgwickSeries, qRotate, qFromAxisAngle, qMul, type Quat } from './quat';
import { segmentRepetitions } from './segment';
import { adjustedRand, createRng, mean, median, quantileOf } from './stats';
import { STRATEGIES, generateSession, trueHumerothoracic, worldArmInclination, type Perturbations, type StrategySpec, type SynthRecording } from './synthetic';
import type { Vec3 } from '../../lib/vec3';

export const CRITERIA = {
  V1_inclination_error_deg: 1.0,
  V1_heading_drift_zero_bias_deg_per_10s: 0.5,
  V2_upper_elev_rmse_deg: 2.0,
  V2_trunk_pitch_rmse_deg: 1.5,
  V2_humerothoracic_rmse_deg: 3.0,
  V2_elbow_rmse_deg: 4.0,
  V3_detection_rate: 0.95,
  V3_onset_median_abs_ms: 30,
  V4_pc1_truth_congruence: 0.9,
  V5_power_n48_balanced: 0.8,
  V5_ari_n48_balanced: 0.8,
  V6_false_strategy_rate: 0.05,
  V6_outcome_bimodal_false_rate_adjusted: 0.1,
  V7_dissociation_power: 0.8,
  V7_false_dissociation_rate: 0.05,
  V7_outcome_difference_flagged: 0.95,
  V8_change_power: 0.8,
  V8_false_change_rate: 0.1,
  V10_insufficient_rate: 1.0,
} as const;

export interface Check {
  id: string;
  criterion: string;
  value: number;
  pass: boolean;
}

const BASE = { duration: { mean: 1.2, cv: 0.12 }, amplitudeCv: 0.04, jitterDeg: 3, delayJitterSec: 0.04 };

function session(pid: string, idx: number, seq: StrategySpec[], seed: number, perturb?: Perturbations, side: 'left' | 'right' = 'right', exercise: 'shoulder_flexion' | 'shoulder_abduction' = 'shoulder_flexion'): SynthRecording {
  return generateSession({ participantId: pid, sessionIndex: idx, exercise, side, sequence: seq, seed, ...BASE, ...(perturb ? { perturb } : {}) });
}

function mixed(n: number, fracB: number, a: StrategySpec, b: StrategySpec, rng: ReturnType<typeof createRng>): StrategySpec[] {
  const nb = Math.round(n * fracB);
  const seq = [...Array(n - nb).fill(a), ...Array(nb).fill(b)] as StrategySpec[];
  // shuffle so strategies are interleaved
  for (let i = seq.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [seq[i], seq[j]] = [seq[j] as StrategySpec, seq[i] as StrategySpec];
  }
  return seq;
}

/** Truth labels of the engine's repetitions, matched by time (the truth repetition whose endpoint lies inside). */
function truthLabels(res: McseResult, recs: readonly SynthRecording[]): (string | null)[] {
  return res.reps.map((r) => {
    const rec = recs.find((x) => x.meta.id === r.recordingId);
    if (!rec || !r.rep.onset || !r.rep.offset) return null;
    const t = rec.truth.find((q) => q.endpoint >= (r.rep.onset as { t: number }).t - 0.2 && q.endpoint <= (r.rep.offset as { t: number }).t);
    return t?.strategy ?? null;
  });
}

// ── V1 orientation filter on analytic rotations ─────────────────────────────────────────────────────────
export function v1Orientation(): { cases: { name: string; inclinationMaxDeg: number; headingDriftDeg: number }[] } {
  const rate = 100;
  const cases: { name: string; inclinationMaxDeg: number; headingDriftDeg: number }[] = [];
  const run = (name: string, axis: Vec3, dps: number, biasDps: Vec3, sec: number) => {
    // true orientation q(t) = rot(axis, ω t) applied after an initial 30° tilt about x; sensor gyro = body rate
    const q0 = qFromAxisAngle([1, 0, 0], (30 * Math.PI) / 180);
    const n = Math.round(sec * rate);
    const t: number[] = [];
    const gyro: Vec3[] = [];
    const acc: Vec3[] = [];
    const truth: Quat[] = [];
    const k = Math.hypot(...axis);
    const ax: Vec3 = [axis[0] / k, axis[1] / k, axis[2] / k];
    for (let i = 0; i < n; i++) {
      const ti = i / rate;
      const q = qMul(q0, qFromAxisAngle(ax, (dps * ti * Math.PI) / 180)); // body-frame rotation: ω constant in body frame
      truth.push(q);
      t.push(ti);
      gyro.push([ax[0] * dps + biasDps[0], ax[1] * dps + biasDps[1], ax[2] * dps + biasDps[2]]);
      // specific force at rest-like rotation (no translation): gravity "up" in the sensor frame
      const qc: Quat = [q[0], -q[1], -q[2], -q[3]];
      acc.push(qRotate(qc, [0, 0, 1]));
    }
    const est = madgwickSeries(t, gyro, acc, undefined, rate).q;
    // align initial heading (the filter starts with heading 0 from gravity)
    let incMax = 0;
    let hd = 0;
    const fwd: Vec3 = [1, 0, 0];
    const h = (q: Quat) => {
      const v = qRotate(q, fwd);
      return Math.atan2(v[1], v[0]);
    };
    const off = h(truth[0] as Quat) - h(est[0] as Quat);
    for (let i = 0; i < n; i++) {
      const ue = qRotate(est[i] as Quat, [0, 0, 1]);
      const ut = qRotate(truth[i] as Quat, [0, 0, 1]);
      // inclination: angle between the estimated and true sensor z axes' world elevation
      const ie = (Math.acos(Math.max(-1, Math.min(1, ue[2]))) * 180) / Math.PI;
      const it = (Math.acos(Math.max(-1, Math.min(1, ut[2]))) * 180) / Math.PI;
      incMax = Math.max(incMax, Math.abs(ie - it));
      if (i === n - 1) {
        let d = h(truth[i] as Quat) - h(est[i] as Quat) - off;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        hd = Math.abs((d * 180) / Math.PI);
      }
    }
    cases.push({ name, inclinationMaxDeg: incMax, headingDriftDeg: hd });
  };
  run('vertical-axis 30°/s, no bias, 10 s', [0, 0, 1], 30, [0, 0, 0], 10);
  run('tilted-axis 60°/s, no bias, 10 s', [1, 1, 1], 60, [0, 0, 0], 10);
  run('vertical-axis 30°/s, bias 0.2°/s, 10 s', [0, 0, 1], 30, [0, 0, 0.2], 10);
  run('still, bias 0.2°/s on z, 60 s', [0, 0, 1], 0, [0, 0, 0.2], 60);
  return { cases };
}

// ── V2 channel accuracy ─────────────────────────────────────────────────────────────────────────────────
export function v2Channels(): { condition: string; rmse: Record<string, number> }[] {
  const out: { condition: string; rmse: Record<string, number> }[] = [];
  const seq = [STRATEGIES.armDominant, STRATEGIES.trunkAssisted, STRATEGIES.elbowFlexed, STRATEGIES.trunkLeading, STRATEGIES.armDominant, STRATEGIES.trunkAssisted];
  const conds: { name: string; side: 'left' | 'right'; ex: 'shoulder_flexion' | 'shoulder_abduction'; p?: Perturbations }[] = [
    { name: 'nominal, right, flexion', side: 'right', ex: 'shoulder_flexion' },
    { name: 'nominal, left, flexion', side: 'left', ex: 'shoulder_flexion' },
    { name: 'nominal, right, abduction', side: 'right', ex: 'shoulder_abduction' },
    { name: 'noise ×3', side: 'right', ex: 'shoulder_flexion', p: { noiseFactor: 3 } },
    { name: 'extra misalignment 8°', side: 'right', ex: 'shoulder_flexion', p: { extraMisalignDeg: 8 } },
    { name: 'gyro bias walk 0.05 °/s/√s', side: 'right', ex: 'shoulder_flexion', p: { biasWalkDpsPerSqrtS: 0.05 } },
  ];
  for (const c of conds) {
    const rec = session('SYN-V2', 0, seq, 4242, c.p, c.side, c.ex);
    const cs = buildChannels(rec.frames, rec.meta);
    const err: Record<string, number[]> = { upper_elev: [], trunk_pitch: [], trunk_roll: [], humerothoracic: [], elbow_flex: [] };
    const spans = rec.truth.map((q) => [q.onset, q.offset] as const);
    rec.frames.forEach((f, i) => {
      if (f.t < 5) return;
      const inRep = spans.some(([a, b]) => f.t >= a && f.t <= b);
      const p = rec.poseAt(f.t);
      const arm = c.side === 'right' ? p.right : p.left;
      const towards = c.side === 'right' ? -p.trunkRoll : p.trunkRoll;
      const push = (k: string, v: number | undefined, tv: number) => {
        if (v !== undefined && Number.isFinite(v)) (err[k] as number[]).push(v - tv);
      };
      push('upper_elev', cs.channels.upper_elev?.[i], worldArmInclination(p, c.side));
      push('trunk_pitch', cs.channels.trunk_pitch?.[i], p.trunkPitch);
      push('trunk_roll', cs.channels.trunk_roll?.[i], towards);
      push('elbow_flex', cs.channels.elbow_flex?.[i], arm.elbow);
      if (inRep) push('humerothoracic', cs.channels.humerothoracic?.[i], trueHumerothoracic(p, c.side));
    });
    const rmse: Record<string, number> = {};
    for (const [k, v] of Object.entries(err)) rmse[k] = Math.sqrt(v.reduce((a, b) => a + b * b, 0) / Math.max(1, v.length));
    out.push({ condition: c.name, rmse });
  }
  return out;
}

// ── V3 segmentation ─────────────────────────────────────────────────────────────────────────────────────
export function v3Segmentation(noise: number[] = [1, 3]): { noise: number; detection: number; falsePositives: number; onsetMedAbsMs: number; onsetP95AbsMs: number; offsetMedAbsMs: number; truthReps: number }[] {
  return noise.map((nf) => {
    const rng = createRng(77 + nf);
    const recs = [0, 1, 2].map((s) => session('SYN-V3', s, mixed(12, 0.5, STRATEGIES.armDominant, STRATEGIES.trunkAssisted, rng), 300 + s + 10 * nf, { noiseFactor: nf }));
    let truthN = 0;
    let hit = 0;
    let fp = 0;
    const on: number[] = [];
    const off: number[] = [];
    for (const rec of recs) {
      const cs = buildChannels(rec.frames, rec.meta);
      const reps = segmentRepetitions(cs, 'shoulder_flexion', { start: 0, end: cs.t.length - 1 });
      // truth boundaries: 5 % of peak velocity of the NOISE-FREE world arm inclination (same definition)
      const rate = rec.meta.rateHz;
      const tt = Array.from({ length: Math.round(((rec.frames.at(-1)?.t ?? 0) + 0.01) * rate) }, (_, i) => i / rate);
      const inc = tt.map((t) => worldArmInclination(rec.poseAt(t), 'right'));
      const vel = inc.map((_, i) => (i > 0 && i < inc.length - 1 ? ((inc[i + 1] as number) - (inc[i - 1] as number)) * (rate / 2) : 0));
      for (const q of rec.truth) {
        truthN++;
        const a = Math.round((q.onset - 0.5) * rate);
        const b = Math.round((q.offset + 0.5) * rate);
        let pv = 0;
        let ip = a;
        let nv = 0;
        let iN = a;
        for (let i = a; i <= b; i++) {
          if ((vel[i] as number) > pv) {
            pv = vel[i] as number;
            ip = i;
          }
          if ((vel[i] as number) < nv) {
            nv = vel[i] as number;
            iN = i;
          }
        }
        let i0 = ip;
        while (i0 > a && (vel[i0] as number) > 0.05 * pv) i0--;
        let i1 = iN;
        while (i1 < b && Math.abs(vel[i1] as number) > 0.05 * Math.abs(nv)) i1++;
        const m = reps.find((r) => r.onset && r.offset && q.endpoint >= r.onset.t - 0.2 && q.endpoint <= r.offset.t);
        if (!m || !m.onset || !m.offset) continue;
        hit++;
        on.push(Math.abs((m.onset.t - (tt[i0] as number)) * 1000));
        off.push(Math.abs((m.offset.t - (tt[i1] as number)) * 1000));
      }
      fp += reps.filter((r) => !rec.truth.some((q) => r.onset && r.offset && q.endpoint >= r.onset.t - 0.2 && q.endpoint <= r.offset.t)).length;
    }
    return { noise: nf, detection: hit / truthN, falsePositives: fp, onsetMedAbsMs: median(on), onsetP95AbsMs: quantileOf(on, 0.95), offsetMedAbsMs: median(off), truthReps: truthN };
  });
}

/** Generate a participant's sessions and run the engine. */
function participant(pid: string, sessions: StrategySpec[][], seed: number, perturb?: Perturbations, opts: { representation?: 'performance_adjusted' | 'absolute' } = {}): { res: McseResult; recs: SynthRecording[] } {
  const recs = sessions.map((seq, s) => session(pid, s, seq, seed + 31 * s, perturb));
  const res = runMcse(recs.map((r) => ({ frames: r.frames, meta: r.meta })), { exercise: 'shoulder_flexion', seed: seed + 1, ...opts, dissociation: { permutations: 999, bootstraps: 400, splits: 10 } });
  return { res, recs };
}

// ── V4 component recovery and sensitivity ───────────────────────────────────────────────────────────────
export function v4Components(): { condition: string; k: number; status: string; pc1TruthCongruence: number; explained1: number; alignmentCongruence: number }[] {
  const out: { condition: string; k: number; status: string; pc1TruthCongruence: number; explained1: number; alignmentCongruence: number }[] = [];
  // truth direction: difference of the NOISE-FREE mean curves of the two strategies (same channels, landmark-aligned)
  const noiseFree = (spec: StrategySpec) => {
    const rec = generateSession({ participantId: 'SYN-V4T', sessionIndex: 0, exercise: 'shoulder_flexion', side: 'right', sequence: [spec, spec, spec], duration: { mean: 1.2, cv: 0 }, amplitudeCv: 0, jitterDeg: 0, delayJitterSec: 0, seed: 9 });
    return runMcse([{ frames: rec.frames, meta: rec.meta }], { exercise: 'shoulder_flexion' });
  };
  const ta = noiseFree(STRATEGIES.armDominant);
  const tb = noiseFree(STRATEGIES.trunkAssisted);
  const mc = (r: McseResult) => r.reps[0]?.x.map((_, j) => mean(r.reps.map((q) => q.x[j] as number))) ?? [];
  const da = mc(ta);
  const db = mc(tb);
  const truth = da.map((v, j) => (db[j] as number) - v);
  const conds: { name: string; p?: Perturbations }[] = [
    { name: 'nominal' },
    { name: 'noise ×3', p: { noiseFactor: 3 } },
    { name: 'noise ×6', p: { noiseFactor: 6 } },
    { name: 'dropped frames 2 %', p: { dropProbability: 0.02 } },
    { name: 'misalignment 8° + bias walk', p: { extraMisalignDeg: 8, biasWalkDpsPerSqrtS: 0.05 } },
    { name: 'trunk sensor missing', p: { removeSensor: 'trunk' } },
  ];
  for (const c of conds) {
    const rng = createRng(4000);
    const { res } = participant('SYN-V4', [0, 1, 2].map(() => mixed(12, 0.5, STRATEGIES.armDominant, STRATEGIES.trunkAssisted, rng)), 4100, c.p);
    const comp = res.components;
    const v = comp?.loadings[0] ?? [];
    // congruence with the truth restricted to the channels actually in the representation
    const chans = res.channels.representation;
    const all = ['trunk_pitch', 'trunk_roll', 'upper_elev', 'fore_elev', 'elbow_flex'];
    const tr = chans.flatMap((ch) => truth.slice(all.indexOf(ch) * 101, all.indexOf(ch) * 101 + 101));
    let ab = 0;
    let aa = 0;
    let bb = 0;
    for (let i = 0; i < v.length; i++) {
      ab += (v[i] as number) * (tr[i] as number);
      aa += (v[i] as number) ** 2;
      bb += (tr[i] as number) ** 2;
    }
    out.push({ condition: c.name, k: comp?.selection.k ?? 0, status: comp?.selection.status ?? 'none', pc1TruthCongruence: aa && bb ? Math.abs(ab) / Math.sqrt(aa * bb) : NaN, explained1: comp?.explained[0] ?? NaN, alignmentCongruence: comp?.alignmentCongruence[0] ?? NaN });
  }
  return out;
}

// ── V5 strategy recovery power / V6 false discovery / V10 minimum data ─────────────────────────────────
export interface DiscoveryRun {
  n: number;
  fracB: number;
  verdicts: Record<string, number>;
  power: number;
  medianAri: number;
}

export function v5Recovery(sizes: number[], fracs: number[], replicates: number): DiscoveryRun[] {
  const out: DiscoveryRun[] = [];
  for (const n of sizes)
    for (const f of fracs) {
      const verdicts: Record<string, number> = {};
      const aris: number[] = [];
      for (let r = 0; r < replicates; r++) {
        const rng = createRng(5000 + 97 * n + 13 * r + Math.round(f * 100));
        const per = Math.ceil(n / 3);
        const { res, recs } = participant(`SYN-V5-${n}-${r}`, [0, 1, 2].map(() => mixed(per, f, STRATEGIES.armDominant, STRATEGIES.trunkAssisted, rng)), 5100 + 7 * r + n);
        const v = res.strategies?.verdict ?? 'none';
        verdicts[v] = (verdicts[v] ?? 0) + 1;
        if (v === 'multiple_strategies') {
          const t = truthLabels(res, recs);
          const ok = res.reps.map((q, i) => [q.strategy.label ?? 'U', t[i] ?? 'X'] as const);
          aris.push(adjustedRand(ok.map((x) => x[0]), ok.map((x) => x[1])));
        } else aris.push(0);
      }
      out.push({ n, fracB: f, verdicts, power: (verdicts.multiple_strategies ?? 0) / replicates, medianAri: median(aris) });
    }
  return out;
}

export function v6FalseDiscovery(sizes: number[], replicates: number): { condition: string; n: number; verdicts: Record<string, number>; falseRate: number }[] {
  const out: { condition: string; n: number; verdicts: Record<string, number>; falseRate: number }[] = [];
  const bimodalA = { ...STRATEGIES.armDominant, id: 'arm_high' };
  const bimodalB = { ...STRATEGIES.armDominant, id: 'arm_low', shoulder: 95, elbow: 4 };
  const conds: { name: string; a: StrategySpec; b: StrategySpec; rep?: 'performance_adjusted' | 'absolute' }[] = [
    { name: 'one strategy (arm), adjusted', a: STRATEGIES.armDominant, b: STRATEGIES.armDominant },
    { name: 'one strategy (trunk-assisted), adjusted', a: STRATEGIES.trunkAssisted, b: STRATEGIES.trunkAssisted },
    { name: 'one strategy, two outcome levels (95° / 120°), adjusted', a: bimodalA, b: bimodalB },
    { name: 'one strategy, two outcome levels (95° / 120°), ABSOLUTE representation', a: bimodalA, b: bimodalB, rep: 'absolute' },
  ];
  for (const c of conds)
    for (const n of sizes) {
      const verdicts: Record<string, number> = {};
      for (let r = 0; r < replicates; r++) {
        const rng = createRng(6000 + 31 * n + r);
        const per = Math.ceil(n / 3);
        const { res } = participant(`SYN-V6-${n}-${r}`, [0, 1, 2].map(() => mixed(per, 0.5, c.a, c.b, rng)), 6100 + 11 * r + n, undefined, c.rep ? { representation: c.rep } : {});
        const v = res.strategies?.verdict ?? 'none';
        verdicts[v] = (verdicts[v] ?? 0) + 1;
      }
      out.push({ condition: c.name, n, verdicts, falseRate: (verdicts.multiple_strategies ?? 0) / replicates });
    }
  return out;
}

export function v10MinimumData(replicates: number): { n: number; verdicts: Record<string, number>; componentStatus: Record<string, number> }[] {
  return [6, 9].map((n) => {
    const verdicts: Record<string, number> = {};
    const componentStatus: Record<string, number> = {};
    for (let r = 0; r < replicates; r++) {
      const rng = createRng(10_000 + n + r);
      const { res } = participant(`SYN-V10-${n}-${r}`, [mixed(n, 0.5, STRATEGIES.armDominant, STRATEGIES.trunkAssisted, rng)], 10_100 + r);
      const v = res.strategies?.verdict ?? 'none';
      verdicts[v] = (verdicts[v] ?? 0) + 1;
      const cst = res.components?.selection.status ?? 'none';
      componentStatus[cst] = (componentStatus[cst] ?? 0) + 1;
    }
    return { n, verdicts, componentStatus };
  });
}

// ── V7 dissociation ─────────────────────────────────────────────────────────────────────────────────────
/** One session with interleaved repetitions of two specs; returns the engine's vectors split by TRUE strategy. */
function withinSessionSets(a: StrategySpec, b: StrategySpec, nPer: number, seed: number): { A: RepVector[]; B: RepVector[] } {
  const rng = createRng(seed);
  const tagA = { ...a, id: 'set_A' };
  const tagB = { ...b, id: 'set_B' };
  const seq = mixed(2 * nPer, 0.5, tagA, tagB, rng);
  const rec = generateSession({ participantId: 'SYN-V7', sessionIndex: 0, exercise: 'shoulder_flexion', side: 'right', sequence: seq, seed, ...BASE });
  const res = runMcse([{ frames: rec.frames, meta: rec.meta }], { exercise: 'shoulder_flexion', representation: 'absolute', selection: { permutations: 5, bootstraps: 5 }, strategyBootstraps: 2 });
  const t = truthLabels(res, [rec]);
  const vec = (i: number): RepVector => ({ id: `${seed}:${res.reps[i]!.id}`, outcome: res.reps[i]!.outcome, x: res.reps[i]!.x, scores: [] });
  return { A: res.reps.map((_, i) => i).filter((i) => t[i] === 'set_A').map(vec), B: res.reps.map((_, i) => i).filter((i) => t[i] === 'set_B').map(vec) };
}

function sessionSet(spec: StrategySpec, n: number, seed: number): RepVector[] {
  const rec = generateSession({ participantId: 'SYN-V7X', sessionIndex: 0, exercise: 'shoulder_flexion', side: 'right', sequence: Array(n).fill(spec) as StrategySpec[], seed, ...BASE });
  const res = runMcse([{ frames: rec.frames, meta: rec.meta }], { exercise: 'shoulder_flexion', representation: 'absolute', selection: { permutations: 5, bootstraps: 5 }, strategyBootstraps: 2 });
  return res.reps.map((r) => ({ id: `${seed}:${r.id}`, outcome: r.outcome, x: r.x, scores: [] }));
}

export function v7Dissociation(replicates: number, nPer = 12): { condition: string; verdicts: Record<string, number>; rate: number; target: string }[] {
  const lowArm: StrategySpec = { ...STRATEGIES.armDominant, id: 'arm_low', shoulder: 96, elbow: 4 };
  const conds: { name: string; a: StrategySpec; b: StrategySpec; target: string; cross?: boolean }[] = [
    { name: 'equal outcome, arm vs trunk-assisted (one session)', a: STRATEGIES.armDominant, b: STRATEGIES.trunkAssisted, target: 'dissociation' },
    { name: 'equal outcome, trunk-assisted vs trunk-leading — timing only (one session)', a: STRATEGIES.trunkAssisted, b: STRATEGIES.trunkLeading, target: 'dissociation' },
    { name: 'same strategy, two random sets (one session)', a: STRATEGIES.armDominant, b: STRATEGIES.armDominant, target: 'no_coordination_difference' },
    { name: 'same strategy, outcome 120° vs 96° (one session)', a: STRATEGIES.armDominant, b: lowArm, target: 'outcome_not_equivalent' },
    { name: 'same strategy, two sessions with re-attached sensors (cross-session rule)', a: STRATEGIES.armDominant, b: STRATEGIES.armDominant, target: 'not_dissociation', cross: true },
  ];
  const chans = ['trunk_pitch', 'trunk_roll', 'upper_elev', 'fore_elev', 'elbow_flex'] as const;
  const cfg = { ...DEFAULT_DISSOCIATION, permutations: 999, bootstraps: 500, splits: 10 };
  return conds.map((c) => {
    const verdicts: Record<string, number> = {};
    for (let r = 0; r < replicates; r++) {
      const sets = c.cross ? { A: sessionSet(c.a, nPer, 7000 + 2 * r), B: sessionSet(c.b, nPer, 7001 + 2 * r) } : withinSessionSets(c.a, c.b, nPer, 7000 + 3 * r);
      const v = compareGroups('A', sets.A, 'B', sets.B, chans, { ...cfg, seed: 7100 + r, crossSession: !!c.cross }).verdict;
      verdicts[v] = (verdicts[v] ?? 0) + 1;
    }
    const hits = c.target === 'not_dissociation' ? replicates - (verdicts.dissociation ?? 0) : (verdicts[c.target] ?? 0);
    return { condition: c.name, verdicts, rate: hits / replicates, target: c.target };
  });
}

// ── V8 longitudinal ─────────────────────────────────────────────────────────────────────────────────────
export function v8Longitudinal(replicates: number): { condition: string; lastSessionChangeRate: number; persistenceRate: number; replicates: number }[] {
  const conds: { name: string; sessions: (rng: ReturnType<typeof createRng>) => StrategySpec[][] }[] = [
    { name: 'gradual switch trunk-assisted → arm over 5 sessions', sessions: (rng) => [0, 1, 2, 3, 4].map((s) => mixed(10, s / 4, STRATEGIES.trunkAssisted, STRATEGIES.armDominant, rng)) },
    { name: 'stationary 50/50 mix, 5 sessions', sessions: (rng) => [0, 1, 2, 3, 4].map(() => mixed(10, 0.5, STRATEGIES.trunkAssisted, STRATEGIES.armDominant, rng)) },
    { name: 'stationary single strategy, 5 sessions', sessions: () => [0, 1, 2, 3, 4].map(() => Array(10).fill(STRATEGIES.armDominant) as StrategySpec[]) },
  ];
  return conds.map((c) => {
    let change = 0;
    let persist = 0;
    for (let r = 0; r < replicates; r++) {
      const rng = createRng(8000 + r);
      const { res } = participant(`SYN-V8-${r}`, c.sessions(rng), 8100 + 13 * r);
      if (res.longitudinal?.sessions.at(-1)?.fromBaselineDeg?.changed) change++;
      const p = res.longitudinal?.transitions?.persistenceP;
      if (p !== null && p !== undefined && p < 0.05) persist++;
    }
    return { condition: c.name, lastSessionChangeRate: change / replicates, persistenceRate: persist / replicates, replicates };
  });
}

// ── V11 sensor re-placement margin (calibration experiment, seeds disjoint from every validation experiment) ──
export function calibrateReplacementMargin(replicates: number): { margin95: number; values: number[]; replicates: number } {
  const values: number[] = [];
  for (const spec of [STRATEGIES.armDominant, STRATEGIES.trunkAssisted])
    for (let r = 0; r < replicates; r++) {
      const recs = [0, 1, 2, 3, 4].map((s) => session(`SYN-V11-${r}`, s, Array(10).fill(spec) as StrategySpec[], 50_000 + 1009 * r + 37 * s + (spec === STRATEGIES.armDominant ? 0 : 500_000)));
      const res = runMcse(recs.map((x) => ({ frames: x.frames, meta: x.meta })), { exercise: 'shoulder_flexion', seed: 51_000 + r, selection: { permutations: 5, bootstraps: 5 }, strategyBootstraps: 2, dissociation: { permutations: 99, bootstraps: 50, splits: 0 } });
      for (const s of res.longitudinal?.sessions ?? []) if (s.fromBaselineDeg) values.push(s.fromBaselineDeg.value);
    }
  return { margin95: quantileOf(values, 0.95), values, replicates };
}

// ── V9 participant-wise generalisation ─────────────────────────────────────────────────────────────────
export function v9Generalisation(): { participantWiseRmse: number; recordWiseRmse: number; inflation: number; participants: number } {
  // participant-specific coordination: each synthetic participant has its own shoulder/trunk/elbow mix
  const rng = createRng(9000);
  const X: number[][] = [];
  const who: number[] = [];
  for (let p = 0; p < 6; p++) {
    const spec: StrategySpec = { ...STRATEGIES.armDominant, id: `p${p}`, shoulder: 100 + 8 * rng.normal(), trunkPitch: -10 + 6 * rng.normal(), elbow: 10 + 10 * Math.abs(rng.normal()), trunkDelay: 0.15 * rng.normal() };
    const rec = generateSession({ participantId: `SYN-V9-${p}`, sessionIndex: 0, exercise: 'shoulder_flexion', side: 'right', sequence: Array(12).fill(spec) as StrategySpec[], seed: 9100 + p, ...BASE });
    const res = runMcse([{ frames: rec.frames, meta: rec.meta }], { exercise: 'shoulder_flexion', representation: 'absolute', selection: { permutations: 5, bootstraps: 5 }, strategyBootstraps: 2 });
    for (const r of res.reps) {
      X.push(r.x);
      who.push(p);
    }
  }
  return generalisationRmse(X, who, 2);
}

function generalisationRmse(X: number[][], who: number[], k: number): { participantWiseRmse: number; recordWiseRmse: number; inflation: number; participants: number } {
  const err = (trainIdx: number[], testIdx: number[]) => {
    const m = fitPca(trainIdx.map((i) => X[i] as number[]));
    const sc = projectRows(m, testIdx.map((i) => X[i] as number[]), k);
    let s = 0;
    let c = 0;
    testIdx.forEach((i, t) => {
      const xr = reconstruct(sc[t] as number[], m.V, m.mu);
      (X[i] as number[]).forEach((v, j) => {
        s += (v - (xr[j] as number)) ** 2;
        c++;
      });
    });
    return { s, c };
  };
  const ps = [...new Set(who)];
  let s1 = 0;
  let c1 = 0;
  for (const p of ps) {
    const e = err(who.map((w, i) => (w !== p ? i : -1)).filter((i) => i >= 0), who.map((w, i) => (w === p ? i : -1)).filter((i) => i >= 0));
    s1 += e.s;
    c1 += e.c;
  }
  const rng = createRng(9999);
  const idx = X.map((_, i) => ({ i, r: rng.next() })).sort((a, b) => a.r - b.r).map((x) => x.i);
  let s2 = 0;
  let c2 = 0;
  for (let f = 0; f < ps.length; f++) {
    const e = err(idx.filter((_, j) => j % ps.length !== f), idx.filter((_, j) => j % ps.length === f));
    s2 += e.s;
    c2 += e.c;
  }
  const a = Math.sqrt(s1 / c1);
  const b = Math.sqrt(s2 / c2);
  return { participantWiseRmse: a, recordWiseRmse: b, inflation: a / b, participants: ps.length };
}

export interface ValidationReport {
  generatedAt: string;
  replicates: number;
  criteria: typeof CRITERIA;
  v1: ReturnType<typeof v1Orientation>;
  v2: ReturnType<typeof v2Channels>;
  v3: ReturnType<typeof v3Segmentation>;
  v4: ReturnType<typeof v4Components>;
  v5: DiscoveryRun[];
  v6: ReturnType<typeof v6FalseDiscovery>;
  v7: ReturnType<typeof v7Dissociation>;
  v8: ReturnType<typeof v8Longitudinal>;
  v9: ReturnType<typeof v9Generalisation> | null;
  v10: ReturnType<typeof v10MinimumData>;
  /** Re-computation of the re-placement margin on its own (disjoint) seeds — shows its stability. */
  v11: ReturnType<typeof calibrateReplacementMargin> | null;
  checks: Check[];
}

export function evaluate(r: Omit<ValidationReport, 'checks' | 'generatedAt' | 'criteria' | 'replicates' | 'v11'>): Check[] {
  const c: Check[] = [];
  const add = (id: string, criterion: string, value: number, pass: boolean) => c.push({ id, criterion, value, pass });
  const noBias = r.v1.cases.filter((x) => x.name.includes('no bias'));
  add('V1a', `inclination error ≤ ${CRITERIA.V1_inclination_error_deg}° (all analytic cases)`, Math.max(...r.v1.cases.map((x) => x.inclinationMaxDeg)), Math.max(...r.v1.cases.map((x) => x.inclinationMaxDeg)) <= CRITERIA.V1_inclination_error_deg);
  add('V1b', `heading drift ≤ ${CRITERIA.V1_heading_drift_zero_bias_deg_per_10s}° per 10 s without bias`, Math.max(...noBias.map((x) => x.headingDriftDeg)), Math.max(...noBias.map((x) => x.headingDriftDeg)) <= CRITERIA.V1_heading_drift_zero_bias_deg_per_10s);
  const nom = r.v2.filter((x) => x.condition.startsWith('nominal'));
  const worst = (k: string) => Math.max(...nom.map((x) => x.rmse[k] ?? NaN));
  add('V2a', `upper_elev RMSE ≤ ${CRITERIA.V2_upper_elev_rmse_deg}° (nominal)`, worst('upper_elev'), worst('upper_elev') <= CRITERIA.V2_upper_elev_rmse_deg);
  add('V2b', `trunk_pitch RMSE ≤ ${CRITERIA.V2_trunk_pitch_rmse_deg}° (nominal)`, worst('trunk_pitch'), worst('trunk_pitch') <= CRITERIA.V2_trunk_pitch_rmse_deg);
  add('V2c', `humerothoracic RMSE ≤ ${CRITERIA.V2_humerothoracic_rmse_deg}° within repetitions (nominal)`, worst('humerothoracic'), worst('humerothoracic') <= CRITERIA.V2_humerothoracic_rmse_deg);
  add('V2d', `elbow_flex RMSE ≤ ${CRITERIA.V2_elbow_rmse_deg}° (nominal)`, worst('elbow_flex'), worst('elbow_flex') <= CRITERIA.V2_elbow_rmse_deg);
  const s1 = r.v3.find((x) => x.noise === 1);
  if (s1) {
    add('V3a', `repetition detection ≥ ${CRITERIA.V3_detection_rate} (nominal noise)`, s1.detection, s1.detection >= CRITERIA.V3_detection_rate);
    add('V3b', `median |onset error| ≤ ${CRITERIA.V3_onset_median_abs_ms} ms (nominal noise)`, s1.onsetMedAbsMs, s1.onsetMedAbsMs <= CRITERIA.V3_onset_median_abs_ms);
  }
  const n4 = r.v4.find((x) => x.condition === 'nominal');
  if (n4) add('V4', `PC1 congruence with the true strategy-difference direction ≥ ${CRITERIA.V4_pc1_truth_congruence} (nominal)`, n4.pc1TruthCongruence, n4.pc1TruthCongruence >= CRITERIA.V4_pc1_truth_congruence);
  const v5 = r.v5.find((x) => x.n === 48 && x.fracB === 0.5);
  if (v5) {
    add('V5a', `strategy-recovery power ≥ ${CRITERIA.V5_power_n48_balanced} (n = 48, 50/50)`, v5.power, v5.power >= CRITERIA.V5_power_n48_balanced);
    add('V5b', `median ARI ≥ ${CRITERIA.V5_ari_n48_balanced} (n = 48, 50/50)`, v5.medianAri, v5.medianAri >= CRITERIA.V5_ari_n48_balanced);
  }
  const single = r.v6.filter((x) => x.condition.startsWith('one strategy (') );
  const fr = single.length ? Math.max(...single.map((x) => x.falseRate)) : NaN;
  add('V6a', `false "multiple strategies" rate ≤ ${CRITERIA.V6_false_strategy_rate} (single-strategy data, every n)`, fr, fr <= CRITERIA.V6_false_strategy_rate);
  const bim = r.v6.filter((x) => x.condition.includes('two outcome levels') && x.condition.endsWith('adjusted'));
  const br = bim.length ? Math.max(...bim.map((x) => x.falseRate)) : NaN;
  add('V6b', `false strategies from outcome differences alone ≤ ${CRITERIA.V6_outcome_bimodal_false_rate_adjusted} (performance-adjusted)`, br, br <= CRITERIA.V6_outcome_bimodal_false_rate_adjusted);
  const d0 = r.v7.find((x) => x.condition.startsWith('equal outcome, arm'));
  if (d0) add('V7a', `dissociation power ≥ ${CRITERIA.V7_dissociation_power} (arm vs trunk-assisted, ≈12 per group, one session)`, d0.rate, d0.rate >= CRITERIA.V7_dissociation_power);
  const d1 = r.v7.find((x) => x.condition.startsWith('same strategy, two random'));
  // false dissociation = verdict 'dissociation' on two sets of the SAME strategy (run 2 computed 1 − rate(no_difference),
  // which wrongly counted 'outcome_not_equivalent' as a false dissociation; corrected, criterion unchanged)
  if (d1) {
    const fd = (d1.verdicts.dissociation ?? 0) / Object.values(d1.verdicts).reduce((a, b) => a + b, 0);
    add('V7b', `false dissociation rate ≤ ${CRITERIA.V7_false_dissociation_rate}`, fd, fd <= CRITERIA.V7_false_dissociation_rate);
  }
  const d2 = r.v7.find((x) => x.condition.includes('outcome 120'));
  if (d2) add('V7c', `outcome difference flagged ≥ ${CRITERIA.V7_outcome_difference_flagged}`, d2.rate, d2.rate >= CRITERIA.V7_outcome_difference_flagged);
  const l0 = r.v8.find((x) => x.condition.startsWith('gradual'));
  if (l0) add('V8a', `change from baseline detected at the last session ≥ ${CRITERIA.V8_change_power} (gradual switch)`, l0.lastSessionChangeRate, l0.lastSessionChangeRate >= CRITERIA.V8_change_power);
  const l1 = r.v8.filter((x) => x.condition.startsWith('stationary'));
  const lf = l1.length ? Math.max(...l1.map((x) => x.lastSessionChangeRate)) : NaN;
  add('V8b', `false change-from-baseline rate ≤ ${CRITERIA.V8_false_change_rate} (stationary)`, lf, lf <= CRITERIA.V8_false_change_rate);
  const allIns = r.v10.every((x) => (x.verdicts.insufficient_data ?? 0) === Object.values(x.verdicts).reduce((a, b) => a + b, 0));
  add('V10', 'n < 12 always reported as insufficient_data', allIns ? 1 : 0, allIns);
  return c;
}

export function runValidation(o: { replicates: number; full: boolean }): ValidationReport {
  const R = o.replicates;
  const parts = {
    v1: v1Orientation(),
    v2: v2Channels(),
    v3: v3Segmentation(o.full ? [1, 3, 6] : [1]),
    v4: o.full ? v4Components() : v4Components().slice(0, 1),
    // rate experiments only in the full run (quick mode would not have enough replicates to estimate a rate)
    v5: o.full ? v5Recovery([12, 24, 48], [0.5, 0.25], R) : [],
    v6: o.full ? v6FalseDiscovery([24, 48], R) : [],
    v7: o.full ? v7Dissociation(R) : [],
    v8: o.full ? v8Longitudinal(R) : [],
    v9: o.full ? v9Generalisation() : null,
    v10: v10MinimumData(Math.max(2, Math.ceil(R / 2))),
    v11: o.full ? calibrateReplacementMargin(Math.max(5, Math.ceil(R / 2))) : null,
  };
  return { generatedAt: new Date().toISOString(), replicates: R, criteria: CRITERIA, ...parts, checks: evaluate(parts) };
}
