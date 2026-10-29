// Ручные мутации ключевых формул (docs/ENGINEERING_10H, P2-4): каждая ломает одно правило, и хотя бы
// один тест обязан упасть. Выжившая мутация — дыра в тестах. Файл всегда возвращается на место.
//   node scripts/mutate.mjs            — все мутации, итог в docs/ENGINEERING_10H/data/mutations.json
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const MUTATIONS = [
  { id: 'hinge-sign', file: 'src/core/pipeline.ts', find: 'const HINGE_SIGN: Record<Side, number> = { right: 1, left: -1 };', repl: 'const HINGE_SIGN: Record<Side, number> = { right: -1, left: 1 };', tests: ['src/verification/experiments.node.test.ts'] },
  { id: 'rotation-sign', file: 'src/core/pipeline.ts', find: 'const ROTATION_SIGN: Record<Side, number> = { right: -1, left: 1 };', repl: 'const ROTATION_SIGN: Record<Side, number> = { right: 1, left: -1 };', tests: ['src/core/core.test.ts'] },
  { id: 'stale-off', file: 'src/core/pipeline.ts', find: 'export const STALE_SEC = 0.25;', repl: 'export const STALE_SEC = 1e9;', tests: ['src/session/invariants.test.ts'] },
  { id: 'elbow-old-formula', file: 'src/core/pipeline.ts', find: 'angle: calU ? elbowFlexion(side, upper.up, calU, ef, Math.hypot(...fore.gyro), ef - eu, fore.t, elbowTrack) : ef - eu,', repl: 'angle: ef - eu,', tests: ['src/verification/experiments.node.test.ts'] },
  { id: 'filter-alpha', file: 'src/core/orientation.ts', find: 'export const FILTER_ALPHA = 0.98;', repl: 'export const FILTER_ALPHA = 0.5;', tests: ['src/verification/experiments.node.test.ts', 'src/core/core.test.ts'] },
  { id: 'acccal-sign', file: 'src/core/imu.ts', find: '(raw[i] as number) - cal.off[i]', repl: '(raw[i] as number) + cal.off[i]', tests: ['src/core/validation.test.ts', 'src/verification/experiments.node.test.ts'] },
  { id: 'calibrator-blind', file: 'src/core/pipeline.ts', find: 'private readonly gyroRange = 16,', repl: 'private readonly gyroRange = 1600,', tests: ['src/session/invariants.test.ts', 'src/session/engine.test.ts'] },
  { id: 'seq-duplicates', file: 'src/devices/contract.ts', find: 'if (seq === prevRaw) {', repl: 'if (seq === prevRaw && false) {', tests: ['src/devices/contract.test.ts', 'src/verification/fuzz.test.ts'] },
  { id: 'seq-no-confirm', file: 'src/devices/contract.ts', find: '    this.pending = { seq, gap: gapOnReset, item };\n    return out;', repl: '    out.push({ seq: this.accept(seq, gapOnReset), item });\n    return out;', tests: ['src/devices/contract.test.ts'] },
  { id: 'csv-formula', file: 'src/data/export.ts', find: '/^[=+\\-@\\t\\r\\n＝＋－＠]/', repl: '/^[+\\-@\\t\\r\\n＝＋－＠]/', tests: ['src/data/export.test.ts'] },
  { id: 'clinic-sim-guard', file: 'src/data/backup.ts', find: "if (workspace === 'clinic' && isSimulatedSession(s)) return null;", repl: '', tests: ['src/data/backup.test.ts'] },
  { id: 'export-zeros', file: 'src/devices/contract.ts', find: 'const present = sensors.filter((p) => f.data[p]);', repl: 'const present = sensors;', tests: ['src/devices/contract.test.ts'] },
  { id: 'saturation-flag', file: 'src/session/SessionEngine.ts', find: "!st.flags.includes('saturation')) st.flags.push('saturation');", repl: "false) st.flags.push('saturation');", tests: ['src/verification/experiments.node.test.ts'] },
  { id: 'mount-flip-blind', file: 'src/core/pipeline.ts', find: "if (raised === 'sideways') return up[2] < -0.5;", repl: "if (raised === 'sideways') return up[2] < -5;", tests: ['src/session/invariants.test.ts'] },
  { id: 'primary-missing', file: 'src/session/SessionEngine.ts', find: '    if (!this.checkSensors(st, f.t)) return;\n    if (!f.data[primary]) return;', repl: '    if (!f.data[primary]) return;\n    if (!this.checkSensors(st, f.t)) return;', tests: ['src/session/invariants.test.ts'] },
  { id: 'forced-cal-flag', file: 'src/session/SessionEngine.ts', find: "if (this.calForced && !st.flags.includes('calibration_moved')) st.flags.push('calibration_moved');", repl: '', tests: ['src/session/invariants.test.ts'] },
];

const results = [];
for (const m of MUTATIONS) {
  const original = readFileSync(m.file, 'utf8');
  const hits = original.split(m.find).length - 1;
  if (hits !== 1) {
    results.push({ id: m.id, status: 'skipped', reason: `шаблон найден ${hits} раз` });
    continue;
  }
  writeFileSync(m.file, original.replace(m.find, m.repl));
  let killed = false;
  let failedTests = '';
  try {
    execFileSync('npx', ['vitest', 'run', ...m.tests], { stdio: 'pipe', encoding: 'utf8' });
  } catch (e) {
    killed = true;
    failedTests = String(e.stdout ?? '').match(/Tests\s+(\d+) failed/)?.[1] ?? '?';
  } finally {
    writeFileSync(m.file, original);
  }
  results.push({ id: m.id, file: m.file, status: killed ? 'killed' : 'SURVIVED', failedTests });
  console.log(`${killed ? '✓ убита' : '✗ ВЫЖИЛА'}  ${m.id}${killed ? ` (упало тестов: ${failedTests})` : ''}`);
}
writeFileSync('docs/ENGINEERING_10H/data/mutations.json', JSON.stringify({ ran: new Date().toISOString(), results }, null, 1));
const survived = results.filter((r) => r.status !== 'killed');
console.log(`${results.length - survived.length} из ${results.length} мутаций убиты`);
process.exit(survived.length ? 1 : 0);
