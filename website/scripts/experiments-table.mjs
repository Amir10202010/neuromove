// Таблица «до / после» из сырых результатов экспериментов (docs/ENGINEERING_10H/data/*.json).
// Числа в EXPERIMENTS.md вставляются отсюда, а не переписываются руками.
//   node scripts/experiments-table.mjs data/2026-10-02-before.json data/2026-10-02-after-elbow.json
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'docs/ENGINEERING_10H';
const [beforePath, afterPath] = process.argv.slice(2);
const load = (p) => JSON.parse(readFileSync(join(dir, p), 'utf8'));
const before = load(beforePath);
const after = afterPath ? load(afterPath) : null;
const byId = (d) => new Map(d.results.map((r) => [r.id, r]));
const b = byId(before);
const a = after ? byId(after) : null;

const fmt = (s) =>
  Object.entries(s)
    .map(([k, v]) => `${k} ${typeof v === 'number' ? String(v).replace('.', ',') : v}`)
    .join('; ');
const verdict = (r) => (!r ? '—' : r.pass ? 'да' : r.knownLimitation ? `нет (${r.knownLimitation})` : '**нет**');

const ids = [...new Set([...b.keys(), ...(a ? a.keys() : [])])];
console.log(`Прогон «до»: ${before.started} → ${before.finished}, зёрен в C1: ${b.get('C1-shoulder_flexion')?.seeds.length}`);
if (after) console.log(`Прогон «после»: ${after.started} → ${after.finished}`);
console.log('');
console.log(a ? '| Сценарий | Критерий | До | Сводка до | После | Сводка после |' : '| Сценарий | Критерий | Итог | Сводка |');
console.log(a ? '|---|---|---|---|---|---|' : '|---|---|---|---|');
for (const id of ids) {
  const rb = b.get(id);
  const ra = a?.get(id);
  const crit = (ra ?? rb).criterion.replace(/^C\d+[a-zA-Z]*(\s*\([^)]*\))?:\s*/, '');
  if (a) console.log(`| ${id} | ${crit} | ${verdict(rb)} | ${rb ? fmt(rb.summary) : '—'} | ${verdict(ra)} | ${ra ? fmt(ra.summary) : '—'} |`);
  else console.log(`| ${id} | ${crit} | ${verdict(rb)} | ${fmt(rb.summary)} |`);
}
