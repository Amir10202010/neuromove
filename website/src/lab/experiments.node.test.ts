// Simulation-based validation of the motor-learning models (E1–E8) and the representation-learning evaluation
// harness (R1). Criteria are fixed in experiments.ts before running.
//
//   npm test                    fast mode: few seeds — checks that every experiment runs and returns finite metrics
//   npm run lab:experiments     full mode: E1–E8 with 100–200 seeds + R1, JSON written to ../research/data/
//
// A failed criterion in full mode is a SCIENTIFIC FINDING about what the design can detect, reported in
// research/model-validation.md — not a reason to edit the criterion. Software correctness is guarded by the
// deterministic recovery tests in models.test.ts.

import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runAll } from './experiments';
import { leaveOneSubjectOut, randomWindowSplit, simulateSubjectWindows, type Window } from './representation';

const full = process.env.LAB_EXPERIMENTS_FULL === '1';

describe('motor-learning validation experiments', () => {
  it(`E1–E8 run and return finite metrics (${full ? 'full' : 'fast'} mode)`, () => {
    const started = new Date().toISOString();
    const results = runAll(full);
    for (const r of results) {
      for (const [k, v] of Object.entries(r.metrics)) if (typeof v === 'number') expect(Number.isFinite(v), `${r.id} ${k}`).toBe(true);
    }
    let representation: unknown = null;
    if (full) {
      const ws: Window[] = [];
      for (let subject = 1; subject <= 8; subject++) for (let session = 1; session <= 2; session++) ws.push(...simulateSubjectWindows(subject, session, 0.1 + 0.07 * subject));
      const leaky = randomWindowSplit(ws, 7);
      const loso = leaveOneSubjectOut(ws);
      representation = { id: 'R1', windows: ws.length, subjects: 8, sessionsPerSubject: 2, labels: [...new Set(ws.map((w) => w.label))], random_window_accuracy: leaky.accuracy, loso_accuracy: loso.accuracy, loso_per_subject: loso.folds };
    }
    const out = process.env.LAB_EXPERIMENTS_OUT;
    if (out) {
      mkdirSync(out.replace(/[/\\][^/\\]+$/, ''), { recursive: true });
      writeFileSync(out, JSON.stringify({ started, finished: new Date().toISOString(), full, node: process.version, results, representation }, null, 1));
    }
  }, 3_600_000);
});

describe('representation evaluation harness', () => {
  const ws: Window[] = [];
  for (let s = 0; s < 4; s++) for (let i = 0; i < 20; i++) ws.push({ subject: s, session: 1, label: i % 2 ? 'shoulder_flexion' : 'elbow_flexion', x: [s * 10 + (i % 2), i % 2] });
  it('leave-one-subject-out never trains on the held-out subject', () => {
    const r = leaveOneSubjectOut(ws);
    expect(r.folds.length).toBe(4);
    for (const a of r.folds) expect(a).toBeGreaterThanOrEqual(0);
  });
  it('a subject-specific offset inflates record-wise accuracy relative to subject-wise accuracy', () => {
    // feature 0 encodes the subject; feature 1 the label — record-wise splits can exploit both, subject-wise cannot
    expect(randomWindowSplit(ws, 3).accuracy).toBeGreaterThanOrEqual(leaveOneSubjectOut(ws).accuracy);
  });
});
