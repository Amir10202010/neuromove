// research/HYPOTHESIS_REGISTRY.md is GENERATED from the registry in hypotheses.ts, so the document and the code
// cannot drift apart. registry-doc.node.test.ts fails when the file on disk differs from this text, and rewrites it
// with HYPOTHESES_WRITE=1.

import { HYPOTHESES, type Hypothesis } from './hypotheses';

const list = (xs: readonly string[]) => (xs.length ? xs.join('; ') : '—');
const code = (xs: readonly string[]) => (xs.length ? xs.map((x) => `\`${x}\``).join(', ') : '—');

const EVIDENCE: Record<Hypothesis['evidence'], string> = {
  none: 'none',
  simulation_only: 'simulation only — the method was checked on synthetic data with known truth; nothing is known about people',
  pilot_data: 'pilot data',
  confirmatory_data: 'confirmatory data',
};

function entry(h: Hypothesis): string {
  return [
    `## ${h.id}`,
    '',
    `**Question.** ${h.question}`,
    '',
    `**Rationale.** ${h.rationale}`,
    '',
    '| | |',
    '|---|---|',
    `| Null hypothesis | ${h.null} |`,
    `| Alternative | ${h.alternative} |`,
    `| Test | ${h.test} |`,
    `| Falsified by | ${h.falsifiedBy} |`,
    `| Independent variables | ${list(h.independent)} |`,
    `| Dependent variables | ${list(h.dependent)} |`,
    `| Measured by NeuroMove (registry ids) | ${code(h.measurements)} |`,
    `| Needed from outside | ${list(h.external)} |`,
    `| Population | ${h.population} |`,
    `| Task and design | ${h.taskContext} |`,
    `| Confounders | ${list(h.confounders)} |`,
    `| Assumptions | ${list(h.assumptions)} |`,
    `| Sample size | ${h.sampleSize} |`,
    `| Method benchmarks | ${h.benchmarks.join(', ') || '—'} |`,
    `| References | ${code(h.references)} |`,
    `| Evidence today | ${EVIDENCE[h.evidence]} |`,
    `| What blocks it | ${h.blocker} |`,
    `| Kind of analysis | ${h.intent === 'exploratory' ? 'exploratory' : 'confirmatory only if pre-registered in a frozen protocol before data collection; exploratory otherwise'} |`,
    '',
  ].join('\n');
}

export function hypothesesMarkdown(): string {
  const head = [
    '# Hypothesis registry',
    '',
    '> Generated from `website/src/lab/discovery/hypotheses.ts` — do not edit by hand. To change a hypothesis, change the registry and run `HYPOTHESES_WRITE=1 npx vitest run src/lab/discovery/registry-doc.node.test.ts` in `website/`.',
    '',
    'The research hypotheses NeuroMove could test, written before any data exist. The registry holds questions, not answers: **no hypothesis here is supported by data from people.** "Simulation only" means that the analysis method was checked on synthetic data with known truth.',
    '',
    'Interface: `#/research/frontier/hypotheses`, where each entry is also judged against the real (non-simulated) data in the workspace: `registered`, `not testable with current data` (with what is missing), `testable`, `under test`.',
    '',
    '## Rules',
    '',
    '- Every hypothesis has a null, a test fixed in advance, and a condition that would falsify it.',
    '- Every NeuroMove measurement it names exists in the observability registry and is observable with three inertial sensors; a test fails otherwise. What must come from outside (clinical assessment, practice log, protocol designation) is listed separately.',
    '- An analysis is **confirmatory** only if a frozen protocol fixed the outcome, the models and the decision rule before the first analysed observation was recorded (`wagenmakers2012`). Everything else is exploratory, however small its p-value, and is labelled so in every report (`analysisIntent` in `discovery/multiplicity.ts`).',
    '- Families of tests are adjusted: Holm for family-wise error (`holm1979`), Benjamini–Hochberg for screening (`benjamini1995`). Checked by simulation in benchmarks D1 and D2.',
    '- A lead in time, a correlation or a model preference is never reported as recovery or as a cause.',
    '- Testing any of these on children requires a documented positive ethics decision and the consent and assent described in [ETHICS_AND_DATA_GOVERNANCE.md](ETHICS_AND_DATA_GOVERNANCE.md). The software does not provide either.',
    '',
    '## Overview',
    '',
    '| Id | Question | Evidence today |',
    '|---|---|---|',
    ...HYPOTHESES.map((h) => `| ${h.id} | ${h.question} | ${h.evidence.replace(/_/g, ' ')} |`),
    '',
  ].join('\n');
  return `${head}\n${HYPOTHESES.map(entry).join('\n')}`;
}
