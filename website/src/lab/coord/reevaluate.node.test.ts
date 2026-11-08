// Re-applies evaluate() to a stored validation report (used once after the V7b evaluation-formula correction;
// the experiment results themselves are not recomputed or altered). Runs only with COORD_REEVAL set.
import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { evaluate, type ValidationReport } from './validation';

it.runIf(!!process.env.COORD_REEVAL)('re-evaluate stored report', () => {
  const p = process.env.COORD_REEVAL as string;
  const r = JSON.parse(readFileSync(p, 'utf8')) as ValidationReport & { evaluationNotes?: string[] };
  const before = r.checks.map((c) => `${c.id}:${c.pass}`);
  r.checks = evaluate(r);
  r.evaluationNotes = [...(r.evaluationNotes ?? []), `${new Date().toISOString()}: checks re-evaluated after correcting the V7b formula (false dissociation = share of 'dissociation' verdicts). Experiment data unchanged. Before: ${before.join(' ')}`];
  writeFileSync(p, JSON.stringify(r, null, 1));
});
