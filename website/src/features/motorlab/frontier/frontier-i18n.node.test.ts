// Every literal ft('…') key of the research-frontier workspaces has a Russian and a Kazakh string, and the engine
// codes the pages show most (statuses and verdicts of the engines) are in the code dictionary.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXPLANATIONS } from '../../../lab/discovery/explanations';
import { MEASUREMENT_STATUSES, PROVENANCE_LABELS } from '../../../lab/measure/registry';
import { PROPAGATION_VALIDITY } from '../../../lab/measure/uncertainty';
import { LEARNING_TERMS } from '../../../lab/observatory/estimability';
import { WITHIN_FEATURES } from '../../../lab/observatory/withinSession';
import { FRONTIER_CODE_KEYS, FRONTIER_KK_KEYS, FRONTIER_RU_KEYS } from './i18n';

describe('research-frontier workspace strings', () => {
  const dir = new URL('./', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.tsx'));
  const used = new Set(files.flatMap((f) => [...readFileSync(new URL(f, dir), 'utf8').matchAll(/ft\('((?:[^'\\]|\\.)*)'\)/g)].map((m) => (m[1] as string).replace(/\\'/g, "'").replace(/\\\\/g, '\\'))));

  it('RU and KK cover every key used in the pages, and nothing unused is kept', () => {
    const ru = new Set(FRONTIER_RU_KEYS);
    const kk = new Set(FRONTIER_KK_KEYS);
    expect([...used].filter((k) => !ru.has(k) || !kk.has(k))).toEqual([]);
    expect(FRONTIER_RU_KEYS.filter((k) => !used.has(k))).toEqual([]);
    expect(files.length).toBeGreaterThanOrEqual(9);
    expect(used.size).toBeGreaterThan(300);
  });

  it('the code dictionary covers the statuses and verdicts of the engines', () => {
    const codes = new Set([...FRONTIER_CODE_KEYS, ...FRONTIER_RU_KEYS]);
    const must = [
      ...MEASUREMENT_STATUSES,
      ...PROVENANCE_LABELS,
      ...EXPLANATIONS,
      ...LEARNING_TERMS,
      ...WITHIN_FEATURES,
      ...new Set(Object.values(PROPAGATION_VALIDITY)),
      'insufficient_data', 'no_change_signalled', 'change_signalled',
      'beyond_noise', 'within_placement', 'within_noise', 'not_assessable',
      'issued', 'refused', 'too_few_sessions', 'no_model_fitted', 'horizon_beyond_observed_span', 'interval_uninformative', 'no_predictive_skill_demonstrated', 'undercoverage',
      'exploratory', 'confirmatory', 'as_expected', 'not_as_expected', 'descriptive',
    ];
    expect(must.filter((c) => !codes.has(c))).toEqual([]);
    // a code never shadows an interface string
    expect(FRONTIER_CODE_KEYS.filter((c) => FRONTIER_RU_KEYS.includes(c))).toEqual([]);
  });
});
