// Research Reports — frozen analysis runs: what was measured, how it was processed, which models were used, what
// was observed and estimated, how uncertain it is, and what cannot be concluded. Plus reproducibility check and
// pseudonymised exports (JSON, CSV, data dictionary).

import { FileDown, Printer, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { href } from '../../app/router';
import { downloadText, exportName } from '../../data/export';
import { PageHeader } from '../../layout/PageHeader';
import { dictionaryCsv, modelsCsv, observationsCsv, PYTHON_SNIPPET, runJson } from '../../lab/export';
import { MODELS, reportValue } from '../../lab/models';
import { verifyRun, type AnalysisRun, type Verification } from '../../lab/runs';
import { LAB_ENGINE_VERSION } from '../../lab/version';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { digitsFor, fmt, useDates, Interval, METRIC_LABEL, MODEL_LABEL, PARAM_LABEL, Prov, SimulatedBanner, useLabData, useNames, WARNING_TEXT } from './common';
import { useLT, type LT } from './i18n';
import { useLabRecords } from './store';

export function RunsPage() {
  const lt = useLT();
  const { ws, patients } = useLabData();
  const { runs } = useLabRecords(ws);
  const dates = useDates();
  const sorted = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <div className="page">
      <PageHeader back={{ href: href({ name: 'labOverview' }), label: lt('Motor learning lab') }} title={lt('Research reports')} lead={lt('Frozen analysis runs. Each keeps its own copy of the observations, configuration and versions, so it can be re-checked and never silently changes.')} />
      {!sorted.length ? (
        <EmptyState title={lt('No frozen runs yet')} text={lt('Freeze an analysis in the Motor Learning Explorer or the Motor Twin to create a report.')} />
      ) : (
        <div className="card mlscroll" tabIndex={0}>
          <table className="table table--compact mltable">
            <thead><tr><th>{lt('Created')}</th><th>{lt('Participant')}</th><th>{lt('Title')}</th><th className="num">{lt('Series')}</th><th>{lt('Engine')}</th><th>{lt('Result hash')}</th></tr></thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className="is-clickable" tabIndex={0} onClick={() => (window.location.hash = href({ name: 'labRun', id: r.id }))} onKeyDown={(e) => e.key === 'Enter' && (window.location.hash = href({ name: 'labRun', id: r.id }))}>
                  <td>{dates.dateTime(r.createdAt)}</td>
                  <td>{patients.find((p) => p.id === r.participantId)?.code ?? r.participantId}</td>
                  <td>{r.title} {r.simulated && <span className="badge badge--demo">{lt('simulated')}</span>}</td>
                  <td className="num">{r.results.length}</td>
                  <td>{r.engine}</td>
                  <td className="mlmono">{r.resultHash.slice(0, 12)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function RunReportPage({ id }: { id: string }) {
  const lt = useLT();
  const names = useNames();
  const { ws, patients } = useLabData();
  const { runs } = useLabRecords(ws);
  const run = runs.find((r) => r.id === id);
  const dates = useDates();
  const [check, setCheck] = useState<Verification | null>(null);
  if (!run) return <div className="page"><EmptyState title={lt('Run not found')} text={lt('The run does not exist in this workspace.')} /></div>;
  const demo = run.simulated;
  const dl = (kind: 'json' | 'obs' | 'models' | 'dict') => {
    const base = ['motor-learning', run.id];
    if (kind === 'json') downloadText(exportName(demo, base, 'json'), runJson(run), 'application/json');
    if (kind === 'obs') downloadText(exportName(demo, [...base, 'observations'], 'csv'), observationsCsv(run), 'text/csv;charset=utf-8');
    if (kind === 'models') downloadText(exportName(demo, [...base, 'models'], 'csv'), modelsCsv(run), 'text/csv;charset=utf-8');
    if (kind === 'dict') downloadText(exportName(demo, [...base, 'dictionary'], 'csv'), dictionaryCsv(), 'text/csv;charset=utf-8');
  };
  return (
    <div className="page">
      <PageHeader
        back={{ href: href({ name: 'labRuns' }), label: lt('Research reports') }}
        eyebrow={lt('Frozen analysis run')}
        title={run.title}
        lead={`${patients.find((p) => p.id === run.participantId)?.code ?? run.participantId} · ${dates.dateTime(run.createdAt)} · ${run.createdBy || '—'}`}
        actions={
          <>
            <Button icon={<ShieldCheck />} onClick={() => setCheck(verifyRun(run))}>{lt('Re-check with the current engine')}</Button>
            <Button icon={<Printer />} onClick={() => window.print()}>{lt('Print / PDF')}</Button>
          </>
        }
      />
      <SimulatedBanner show={demo} />
      {check && <VerificationNote v={check} lt={lt} run={run} />}
      <section className="card card__body">
        <h2 className="card__title">{lt('Provenance')}</h2>
        <dl className="vdl">
          <dt>{lt('Engine at freezing')}</dt><dd>{run.engine} ({lt('current')}: {LAB_ENGINE_VERSION})</dd>
          <dt>{lt('Component versions')}</dt><dd className="mlmono">{Object.values(run.versions).join(' · ')}</dd>
          <dt>{lt('Source sessions')}</dt><dd>{run.inputs.length} ({[...new Set(run.inputs.map((x) => x.algorithmVersion))].join(', ')})</dd>
          <dt>{lt('Study protocol')}</dt><dd>{run.protocol ? `${run.protocol.protocolId} v${run.protocol.version} · ${run.protocol.defHash.slice(0, 12)}…` : lt('none (default analysis plan)')}</dd>
          <dt>{lt('Configuration hash')}</dt><dd className="mlmono">{run.configHash}</dd>
          <dt>{lt('Snapshot hash')}</dt><dd className="mlmono">{run.snapshotHash}</dd>
          <dt>{lt('Result hash')}</dt><dd className="mlmono">{run.resultHash}</dd>
        </dl>
      </section>
      <section className="card card__body">
        <h2 className="card__title">{lt('What was measured and how it was processed')}</h2>
        <p>{lt('Three MPU-6050 inertial sensors (accelerometer and gyroscope, 100 Hz). Joint and segment angles from the existing gravity-referenced complementary filter; repetitions by angle thresholds with hysteresis; per-repetition metrics by the core algorithm version listed above. Sessions failing quality rules (signal completeness < 90 %, fewer than 3 repetitions, saturation, data gaps, sensor loss, flipped mount, calibration movement) are kept but not fitted.')}</p>
        <p>{lt('Models: repetition-level measurement model with a pooled repetition SD; candidate longitudinal models fitted by maximum likelihood; 95 % profile-likelihood intervals; AICc and leave-future-out prediction for comparison; parametric bootstrap for prediction intervals. Full specification: research/mathematical-models.md.')}</p>
      </section>
      {run.results.map((a, i) => {
        const s = run.snapshot[i]!;
        const sel = a.selected ? a.comparison.rows.find((r) => r.model === a.selected)!.fit : null;
        const digits = digitsFor(s.unit);
        return (
          <section key={a.seriesKey} className="card card__body">
            <h2 className="card__title">{names.task(s.exercise, s.side)} — {lt(METRIC_LABEL[s.metric])}</h2>
            <p className="mlmuted">{lt('Included sessions')}: {a.included}; {lt('excluded')}: {a.excluded}; {lt('dose')}: {a.doseMode}</p>
            <h3>{lt('Observed')} <Prov kind="derived" /></h3>
            <p>{a.decomposition.overall ? `${lt('Change first → last included session')}: ${fmt(a.decomposition.overall.delta, digits)} ${s.unit} (SE ${fmt(a.decomposition.overall.se, digits)}, ${fmt(a.decomposition.overall.days, 0)} ${lt('days')}) — ${a.decomposition.overall.exceedsNoise ? lt('exceeds session-to-session variability') : lt('within session-to-session variability')}.` : lt('Needs two included sessions.')}</p>
            <h3>{lt('Estimated')} <Prov kind="estimated" /></h3>
            {sel && a.selected ? (
              <>
                <p>{lt('Selected model')}: <strong>{lt(MODEL_LABEL[a.selected])}</strong> ({lt('rule')}: {a.comparison.selectionReason.join(', ')})</p>
                <table className="table table--compact mltable">
                  <tbody>
                    {MODELS[a.selected].params.map((p, j) => {
                      const pr = sel.profiles.find((x) => x.param === p.name);
                      const d = p.unit === 'days' ? 0 : digits;
                      return (
                        <tr key={p.name}>
                          <td>{PARAM_LABEL[p.name] ? lt(PARAM_LABEL[p.name]!) : p.name}</td>
                          <td className="num">{fmt(reportValue(a.selected!, j, sel.params[j] as number), d)}</td>
                          <td>{pr ? <Interval lo={reportValue(a.selected!, j, pr.lo)} hi={reportValue(a.selected!, j, pr.hi)} loOpen={pr.loOpen} hiOpen={pr.hiOpen} digits={d} /> : ''}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            ) : (
              <p>{lt('No model could be fitted.')}</p>
            )}
            <h3>{lt('Predicted')} <Prov kind="predicted" /></h3>
            <p>{a.forecast.length ? a.forecast.map((f) => `${lt('day')} ${fmt(f.t, 0)}: ${fmt(f.mean, digits)} [${fmt(f.obsLo, digits)}; ${fmt(f.obsHi, digits)}]`).join(' · ') : '—'}</p>
            <h3>{lt('Limitations for this series')}</h3>
            <ul className="mlwarnings">{a.warnings.map((w) => <li key={w}>{lt(WARNING_TEXT[w])}</li>)}</ul>
          </section>
        );
      })}
      <section className="card card__body">
        <h2 className="card__title">{lt('What cannot be concluded')}</h2>
        <ul className="mlwarnings">
          <li>{lt('Nothing here is a clinical measurement or diagnosis. The device has not been validated against a reference instrument in children.')}</li>
          <li>{lt('A change in a metric is not, by itself, motor learning; learning requires retention after a delay.')}</li>
          <li>{lt('Models describe one person’s series; they do not generalise to other people and do not identify causes.')}</li>
          <li>{lt('Predictions are conditional on the selected model and the dose assumption; they are not outcomes.')}</li>
        </ul>
      </section>
      <section className="card card__body">
        <h2 className="card__title">{lt('Export (pseudonymised)')}</h2>
        <p className="mlmuted">{lt('Participant and session ids are replaced by run-local pseudonyms; dates by study days. Pseudonymised is not anonymous: share only under the study data agreement.')}</p>
        <div className="mlrow">
          <Button icon={<FileDown />} onClick={() => dl('json')}>JSON</Button>
          <Button icon={<FileDown />} onClick={() => dl('obs')}>{lt('Observations CSV')}</Button>
          <Button icon={<FileDown />} onClick={() => dl('models')}>{lt('Models CSV')}</Button>
          <Button icon={<FileDown />} onClick={() => dl('dict')}>{lt('Data dictionary')}</Button>
        </div>
        <pre className="mlmono" style={{ whiteSpace: 'pre-wrap' }}>{PYTHON_SNIPPET}</pre>
      </section>
    </div>
  );
}

function VerificationNote({ v, lt, run }: { v: Verification; lt: LT; run: AnalysisRun }) {
  const text = useMemo(() => {
    if (v.status === 'reproduced') return lt('Reproduced: the current engine computes the same result from the run’s own snapshot and configuration.');
    if (v.status === 'tampered') return `${lt('Integrity failure: the stored hash does not match the stored')} ${v.what}.`;
    return `${lt('Differs: the current engine computes a different result for')} ${v.changed.length} ${lt('series')}. ${v.engineChanged ? lt('The engine version changed since freezing; the frozen result is kept unchanged.') : ''}`;
  }, [v, lt]);
  void run;
  return <div className={`callout ${v.status === 'reproduced' ? 'callout--good' : v.status === 'tampered' ? 'callout--critical' : 'callout--warn'}`} role="status">{text}</div>;
}
