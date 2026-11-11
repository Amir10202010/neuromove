// Scientific sandbox: the twenty ground-truth scenarios (a generative process with known hidden parameters, run
// through the real analysis engine) and the benchmark registry with the results of the last full run — including
// the benchmarks that FAIL their criterion. Everything here is synthetic and says so.

import { Dices, Play } from 'lucide-react';
import { useState } from 'react';
import { DOCUMENTED_FAILURES, EXISTING_SUITES, type BenchmarkRecord } from '../../../lab/benchmark';
import { MAX_INTERACTIVE_RUNS } from '../../../lab/frontierJobs';
import { SCENARIOS } from '../../../lab/scenario/engine';
import { FRONTIER_VERSIONS, type FrontierComponent } from '../../../lab/version';
import { LATEST_BENCHMARKS } from '../../../lab/scenario/latest';
import { fmt, useDates } from '../common';
import { CurveChart, SERIES } from '../coordination/charts';
import type { FT } from './i18n';
import { CanonicalNote, Chip, JobStatus, Kpi, code, pct } from './shared';
import { useFrontierJob } from './useFrontierJob';
import '../../../styles/coord.css';

const COMPONENTS = ['measure', 'strategy', 'observatory', 'twin', 'scenario', 'discovery'] as const;

export function SandboxView({ ft }: { ft: FT }) {
  const dates = useDates();
  const [id, setId] = useState<string>(SCENARIOS[0]?.id ?? '');
  const [seed, setSeed] = useState('1');
  const [runs, setRuns] = useState('100');
  const [component, setComponent] = useState<string>('all');
  const [open, setOpen] = useState<string | null>(null);
  const one = useFrontierJob('scenario');
  const mc = useFrontierJob('montecarlo');
  const sc = SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
  const seedN = Number.isFinite(Number(seed)) ? Math.round(Number(seed)) : 1;
  const runsN = Math.max(1, Math.min(MAX_INTERACTIVE_RUNS, Number.isFinite(Number(runs)) ? Math.round(Number(runs)) : 100));
  const pick = (next: string) => {
    setId(next);
    one.reset();
    mc.reset();
  };
  const run = one.job.state === 'done' && one.job.result.run?.scenario === id ? one.job.result.run : null;
  const res = mc.job.state === 'done' && mc.job.result.result?.scenario === id ? mc.job.result.result : null;
  const B = LATEST_BENCHMARKS;
  const records = B ? B.records.filter((r) => component === 'all' || r.component === component) : [];
  // components whose engine changed after the stored run: its numbers describe the earlier version
  const stale = B ? (Object.keys(FRONTIER_VERSIONS) as FrontierComponent[]).filter((c) => B.versions[c] !== FRONTIER_VERSIONS[c]) : [];
  if (!sc) return null;
  const judged = res ? res.asExpected + res.notAsExpected : 0;

  return (
    <>
      <div className="callout callout--demo" role="note">
        <Dices aria-hidden />
        <div>
          <div className="callout__title">{ft('Synthetic data with known ground truth')}</div>
          {ft('A scenario shows how the software behaves under stated assumptions. It is never evidence about a real participant, and the generators are simpler than real movement.')}
        </div>
      </div>

      <section className="mlsection">
        <h2 className="section-title">{ft('Ground-truth scenarios')}</h2>
        <div className="card card__body mlfilters">
          <label className="field">
            <span className="field__label">{ft('Scenario')}</span>
            <select className="select" value={sc.id} onChange={(e) => pick(e.target.value)}>
              {SCENARIOS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.number}. {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">{ft('Seed')}</span>
            <input className="input" inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value)} />
          </label>
          <button type="button" className="btn btn--primary" disabled={one.job.state === 'running'} onClick={() => one.run({ kind: 'scenario', id: sc.id, seed: seedN })}>
            <Play aria-hidden /> {ft('Run once')}
          </button>
          <label className="field">
            <span className="field__label">
              {ft('Runs')} (≤ {MAX_INTERACTIVE_RUNS})
            </span>
            <input className="input" inputMode="numeric" value={runs} onChange={(e) => setRuns(e.target.value)} />
          </label>
          <button type="button" className="btn btn--secondary" disabled={mc.job.state === 'running'} onClick={() => mc.run({ kind: 'montecarlo', id: sc.id, runs: sc.cost === 'slow' ? Math.min(runsN, 40) : runsN, seed: seedN })}>
            <Dices aria-hidden /> {ft('Monte Carlo')}
          </button>
        </div>
        <div className="card card__body">
          <dl className="fr-dl">
            <dt>{ft('Generative process')}</dt>
            <dd>{sc.process}</dd>
            <dt>{ft('Hidden truth')}</dt>
            <dd className="fr-mono">{Object.entries(sc.truth).map(([k, v]) => `${k} = ${v}`).join(', ')}</dd>
            <dt>{ft('A correct analysis')}</dt>
            <dd>{sc.expected}</dd>
            <dt>{ft('Simpler than reality in')}</dt>
            <dd>{sc.simplification}</dd>
            <dt>{ft('Level')}</dt>
            <dd>
              {code(ft, sc.level)} · {sc.cost === 'slow' ? ft('simulates raw sensor frames (at most 40 runs here)') : ft('fast')}
            </dd>
            <dt>{ft('Related benchmarks')}</dt>
            <dd>{sc.related.join(', ') || '—'}</dd>
          </dl>
        </div>
        <JobStatus job={one.job} ft={ft} />
        {run && (
          <div className="card card__body">
            <p>
              {ft('Seed')} {run.seed} · <Chip tone={run.verdict === 'as_expected' ? 'met' : run.verdict === 'descriptive' ? 'plain' : 'caution'}>{code(ft, run.verdict)}</Chip>
            </p>
            <dl className="fr-dl">
              {Object.entries(run.observed).map(([k, v]) => (
                <div key={k} style={{ display: 'contents' }}>
                  <dt className="fr-mono">{k}</dt>
                  <dd>{typeof v === 'number' ? fmt(v, 3) : v === null ? '—' : String(v)}</dd>
                </div>
              ))}
            </dl>
            {run.series && (
              <CurveChart
                title={run.series.label}
                xLabel={ft('Session number')}
                yLabel=""
                x={run.series.y.map((_, i) => i + 1)}
                series={[
                  { name: ft('observed by the engine'), y: run.series.y, color: SERIES[0] },
                  { name: ft('hidden truth'), y: run.series.truth, color: SERIES[1], dashed: true },
                ]}
                fmt={(v) => fmt(v, 1)}
              />
            )}
          </div>
        )}
        <JobStatus job={mc.job} ft={ft} />
        {res && (
          <div className="card card__body">
            <p>
              {ft('Runs executed')}: <strong className="num">{res.runs}</strong> · {ft('as expected')}: <strong className="num">{res.asExpected}</strong> · {ft('not as expected')}: <strong className="num">{res.notAsExpected}</strong>
              {res.descriptive ? ` · ${ft('descriptive (no right answer)')}: ${res.descriptive}` : ''}
              {judged ? ` · ${ft('rate')} ${pct(res.asExpected / judged, 1)}` : ''}
            </p>
            <dl className="fr-dl">
              {Object.entries(res.tallies).map(([k, v]) => (
                <div key={k} style={{ display: 'contents' }}>
                  <dt className="fr-mono">{k}</dt>
                  <dd>
                    {Object.entries(v)
                      .sort((a, b) => b[1] - a[1])
                      .map(([name, n]) => `${name.replace(/_/g, ' ')}: ${n}`)
                      .join(' · ')}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mlmuted">{ft('A rate from a few hundred runs has a wide interval. The benchmark registry below holds the full runs with their confidence intervals.')}</p>
          </div>
        )}
      </section>

      <section className="mlsection">
        <h2 className="section-title">{ft('Benchmark registry')}</h2>
        {!B ? (
          <p className="mlmuted">{ft('This build carries no full benchmark run. Run the registry with FRONTIER_FULL=1 FRONTIER_LATEST=1 to record one.')}</p>
        ) : (
          <>
            <div className="mlkpis">
              <Kpi label={ft('Benchmarks')} value={String(B.total)} meta={`${ft('descriptive (no criterion)')}: ${B.descriptive}`} />
              <Kpi label={ft('With a criterion')} value={String(B.withCriterion)} />
              <Kpi label={ft('Criterion met')} value={String(B.passed)} />
              <Kpi label={ft('Criterion failed')} value={String(B.failed.length)} meta={B.failed.join(', ') || undefined} />
              <Kpi label={ft('Simulation runs')} value={B.cases.toLocaleString('en-US').replace(/,/g, ' ')} meta={dates.dateTime(B.generatedAt)} />
            </div>
            {stale.length > 0 && (
              <div className="callout callout--warn" role="note">
                <div>
                  <div className="callout__title">{ft('Recorded with an earlier engine version')}</div>
                  {stale.map((c) => `${B.versions[c]} → ${FRONTIER_VERSIONS[c]}`).join(' · ')}. {ft('The numbers below describe the earlier version until the registry is run again.')}
                </div>
              </div>
            )}
            {B.failed.length > 0 && (
              <div className="callout callout--warn" role="note">
                <div>
                  <div className="callout__title">{ft('Benchmarks that fail their criterion')}</div>
                  {B.failed.map((f) => `${f}${DOCUMENTED_FAILURES.includes(f) ? ` (${ft('documented finding')})` : ''}`).join(', ')}. {ft('A failed criterion is reported and kept: the criterion was fixed before the run and is not edited afterwards.')}
                </div>
              </div>
            )}
            <div className="card card__body mlfilters">
              <label className="field">
                <span className="field__label">{ft('Component')}</span>
                <select className="select" value={component} onChange={(e) => setComponent(e.target.value)}>
                  <option value="all">{ft('all')}</option>
                  {COMPONENTS.map((c) => (
                    <option key={c} value={c}>
                      {code(ft, c)}
                    </option>
                  ))}
                </select>
              </label>
              <span className="mlmuted">
                {ft('Earlier suites with their own files')}: {EXISTING_SUITES.map((s) => `${s.ids} (${s.document})`).join(' · ')}
              </span>
            </div>
            <div className="card mlscroll" tabIndex={0}>
              <table className="table table--compact mltable fr-wrap">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>{ft('Benchmark')}</th>
                    <th className="num">{ft('Value')}</th>
                    <th>{ft('Criterion')}</th>
                    <th>{ft('Result')}</th>
                    <th className="num">{ft('Runs')}</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <BenchRow key={r.id} r={r} ft={ft} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <CanonicalNote ft={ft} />
      </section>
    </>
  );
}

function BenchRow({ r, ft, open, onToggle }: { r: BenchmarkRecord; ft: FT; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr>
        <td className="fr-mono">{r.id}</td>
        <td>
          <button type="button" className="fr-rowbtn" aria-expanded={open} onClick={onToggle}>
            {r.name}
          </button>
        </td>
        <td className="num">{r.value === null ? '—' : fmt(r.value, 3)}</td>
        <td>{r.criterion}</td>
        <td>
          <Chip tone={r.pass === null ? 'plain' : r.pass ? 'met' : 'caution'}>{r.pass === null ? ft('descriptive') : r.pass ? ft('criterion met') : ft('criterion failed')}</Chip>
        </td>
        <td className="num">{r.cases}</td>
      </tr>
      {open && (
        <tr className="fr-detail">
          <td colSpan={6}>
            <dl className="fr-dl">
              <dt>{ft('Purpose')}</dt>
              <dd>{r.purpose}</dd>
              <dt>{ft('Assumptions')}</dt>
              <dd>{r.assumptions}</dd>
              <dt>{ft('Ground truth')}</dt>
              <dd>{r.groundTruth}</dd>
              <dt>{ft('Metric')}</dt>
              <dd>{r.metric}</dd>
              <dt>{ft('Detail')}</dt>
              <dd className="fr-mono">{Object.entries(r.detail).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ')}</dd>
              <dt>{ft('Known failure modes')}</dt>
              <dd>{r.knownFailureModes.join('; ')}</dd>
              <dt>{ft('Version')}</dt>
              <dd className="fr-mono">{r.version}</dd>
            </dl>
          </td>
        </tr>
      )}
    </>
  );
}
