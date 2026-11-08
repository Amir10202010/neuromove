// Movement representation research — evaluation infrastructure and a SMALL baseline experiment on SYNTHETIC data.
//
// Purpose: establish a reproducible evaluation harness that cannot leak information between participants, and
// demonstrate on simulated subjects how much a record-wise (window-wise) split inflates performance compared with a
// subject-wise split (Saeb et al. 2017, doi:10.1093/gigascience/gix019). This is NOT a foundation model and its
// numbers say nothing about real children: the subjects are the app's virtual patients.

import { PROTOCOLS, resolveSteps } from '../core/protocols';
import { toPhysical } from '../core/imu';
import type { ExerciseId } from '../core/exercises';
import type { Placement, RawFrame } from '../devices/types';
import { SessionEngine } from '../session/SessionEngine';
import { ImuSimulator } from '../simulation/imuModel';
import { buildProfile } from '../simulation/profiles';
import { VirtualPatient } from '../simulation/VirtualPatient';

export interface Window {
  subject: number;
  session: number;
  label: ExerciseId;
  x: number[];
}

/** Hand-crafted window features (a transparent baseline every learned representation must beat). */
export function windowFeatures(frames: readonly RawFrame[], placements: readonly Placement[]): number[] {
  const out: number[] = [];
  for (const p of placements) {
    const acc: number[][] = [[], [], []];
    const gyr: number[] = [];
    for (const f of frames) {
      const raw = f.data[p];
      if (!raw) continue;
      const s = toPhysical(raw);
      for (let a = 0; a < 3; a++) acc[a]!.push(s.acc[a] as number);
      gyr.push(Math.hypot(s.gyro[0], s.gyro[1], s.gyro[2]));
    }
    for (const a of acc) {
      const m = a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
      const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1));
      out.push(m, sd);
    }
    const gm = gyr.reduce((x, y) => x + y, 0) / Math.max(1, gyr.length);
    out.push(gm, Math.max(0, ...gyr));
  }
  return out;
}

/** Simulate one subject-session and cut it into labelled windows (label = exercise of the current protocol step). */
export function simulateSubjectWindows(subject: number, session: number, severity: number, windowSec = 2): Window[] {
  const rate = 100;
  const seed = 1000 * subject + session;
  const imu = new ImuSimulator(seed, rate);
  const patient = new VirtualPatient(buildProfile({ left: 0.05, right: severity }, 0.4 + 0.1 * (subject % 4)), seed ^ 0x5bd1e995);
  const steps = resolveSteps(PROTOCOLS.upper_standard, 'right').filter((s) => s.side === 'right');
  const engine = new SessionEngine({ steps, rateHz: rate, autoAdvance: true, recordRaw: true });
  engine.onInstruction((ins, t) => patient.instruct(ins, t));
  engine.start();
  for (let seq = 0; seq < 600 * rate && !engine.isFinished; seq++) engine.process([imu.frame(patient.poseAt(seq / rate), seq)]);
  if (!engine.isFinished) engine.stop();
  const res = engine.result();
  const raw = engine.rawFrames;
  if (!raw.length) return [];
  const t0 = (raw[0] as RawFrame).t;
  const spans: { start: number; end: number; label: ExerciseId }[] = [];
  let cur: { start: number; step: number } | null = null;
  for (const e of res.events) {
    if (e.kind === 'step_start' && e.step !== undefined) cur = { start: e.t, step: e.step };
    if ((e.kind === 'step_done' || e.kind === 'step_skipped') && cur) {
      spans.push({ start: cur.start, end: e.t, label: steps[cur.step]!.exercise });
      cur = null;
    }
  }
  const placements: Placement[] = ['trunk', 'upper_r', 'fore_r'];
  const out: Window[] = [];
  for (const sp of spans) {
    for (let a = sp.start; a + windowSec <= sp.end; a += windowSec) {
      const fr = raw.filter((f) => f.t - t0 >= a && f.t - t0 < a + windowSec);
      if (fr.length < windowSec * rate * 0.8) continue;
      out.push({ subject, session, label: sp.label, x: windowFeatures(fr, placements) });
    }
  }
  return out;
}

// ── classifiers ───────────────────────────────────────────────────────────────────────────────

function standardise(train: readonly number[][], test: readonly number[][]): { tr: number[][]; te: number[][] } {
  const d = train[0]?.length ?? 0;
  const mu = new Array<number>(d).fill(0);
  const sd = new Array<number>(d).fill(0);
  for (const x of train) for (let j = 0; j < d; j++) mu[j]! += (x[j] as number) / train.length;
  for (const x of train) for (let j = 0; j < d; j++) sd[j]! += ((x[j] as number) - mu[j]!) ** 2 / Math.max(1, train.length - 1);
  const f = (x: readonly number[]) => x.map((v, j) => (v - mu[j]!) / (Math.sqrt(sd[j]!) || 1));
  return { tr: train.map(f), te: test.map(f) };
}

/** Nearest-centroid classifier on standardised features (statistics from the TRAINING fold only). */
export function nearestCentroid(train: readonly Window[], test: readonly Window[]): number {
  if (!train.length || !test.length) return NaN;
  const { tr, te } = standardise(train.map((w) => w.x), test.map((w) => w.x));
  const labels = [...new Set(train.map((w) => w.label))];
  const cent = labels.map((l) => {
    const xs = tr.filter((_, i) => train[i]!.label === l);
    return xs[0]!.map((_, j) => xs.reduce((a, x) => a + (x[j] as number), 0) / xs.length);
  });
  let ok = 0;
  te.forEach((x, i) => {
    let best = 0;
    let bd = Infinity;
    cent.forEach((c, k) => {
      const dd = c.reduce((a, v, j) => a + (v - (x[j] as number)) ** 2, 0);
      if (dd < bd) {
        bd = dd;
        best = k;
      }
    });
    if (labels[best] === test[i]!.label) ok += 1;
  });
  return ok / test.length;
}

export interface SplitResult {
  scheme: 'random_windows' | 'leave_one_subject_out';
  /** Mean accuracy over folds; per-fold values for subject-wise. */
  accuracy: number;
  folds: number[];
}

/** Record-wise split: windows of the same subject end up in both train and test (LEAKY by design, for comparison). */
export function randomWindowSplit(ws: readonly Window[], seed: number, folds = 5): SplitResult {
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x6d2b79f5) >>> 0) / 4294967296);
  const idx = ws.map((_, i) => ({ i, r: rnd() })).sort((a, b) => a.r - b.r).map((x) => x.i);
  const accs: number[] = [];
  for (let f = 0; f < folds; f++) {
    const te = idx.filter((_, k) => k % folds === f).map((i) => ws[i]!);
    const tr = idx.filter((_, k) => k % folds !== f).map((i) => ws[i]!);
    accs.push(nearestCentroid(tr, te));
  }
  return { scheme: 'random_windows', accuracy: accs.reduce((a, b) => a + b, 0) / accs.length, folds: accs };
}

export function leaveOneSubjectOut(ws: readonly Window[]): SplitResult {
  const subjects = [...new Set(ws.map((w) => w.subject))];
  const accs = subjects.map((s) => nearestCentroid(ws.filter((w) => w.subject !== s), ws.filter((w) => w.subject === s)));
  return { scheme: 'leave_one_subject_out', accuracy: accs.reduce((a, b) => a + b, 0) / accs.length, folds: accs };
}
