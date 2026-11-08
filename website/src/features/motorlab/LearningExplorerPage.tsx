// Motor Learning Explorer — one participant, one task, one metric: every repetition, every session, the competing
// models with their evidence, the learning decomposition, and the reasons behind each estimate.

import { Lock, Network } from 'lucide-react';
import { useMemo, useState } from 'react';
import { href, navigate } from '../../app/router';
import type { ExerciseId } from '../../core/exercises';
import type { Side } from '../../devices/types';
import { PageHeader } from '../../layout/PageHeader';
import { analyzeSeries, DEFAULT_ANALYSIS_CONFIG, type AnalysisConfig, type SeriesAnalysis } from '../../lab/analysis';
import { LEARNING_METRICS, type LearningMetric, type LearningSeries } from '../../lab/dataset';
import { bootstrap, trajectoryBand } from '../../lab/fit';
import { MODELS, reportValue, type ModelId } from '../../lab/models';
import { useAppStore } from '../../state/appStore';
import { Button, LinkButton } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { ResidualChart, TrajectoryChart, type TrajectoryPoint } from './charts';
import { digitsFor, fmt, useDates, Interval, METRIC_LABEL, MODEL_EQUATION, MODEL_LABEL, PARAM_LABEL, Prov, SimulatedBanner, useNames, useParticipantSeries, Warnings, withUnit } from './common';
import { useLT, type LT } from './i18n';
import { useLabRecords, useLabStore } from './store';
import { analysisConfigFromProtocol, type LearningProtocolVersion } from '../../lab/protocol';

export function LearningExplorerPage({ participant, task, metric }: { participant: string | null; task: string | null; metric: string | null }) {
  const lt = useLT();
  const names = useNames();
  const { patients, sessions, series, includeSimulated, ws } = useParticipantSeries(participant);
  const withData = patients.filter((p) => sessions.some((s) => s.patientId === p.id));
  const tasks = [...new Set(series.map((s) => `${s.exercise}:${s.side}`))];
  const tk = task && tasks.includes(task) ? task : tasks[0] ?? null;
  const metrics = LEARNING_METRICS.filter((m) => series.some((s) => `${s.exercise}:${s.side}` === tk && s.metric === m));
  const mt: LearningMetric | null = metric && (metrics as string[]).includes(metric) ? (metric as LearningMetric) : metrics[0] ?? null;
  const s = series.find((x) => `${x.exercise}:${x.side}` === tk && x.metric === mt) ?? null;
  const go = (p: Partial<{ participant: string | null; task: string | null; metric: string | null }>) =>
    navigate({ name: 'labLearning', participant: p.participant !== undefined ? p.participant : participant, task: p.task !== undefined ? p.task : tk, metric: p.metric !== undefined ? p.metric : mt }, { replace: true });

  return (
    <div className="page">
      <PageHeader back={{ href: href({ name: 'labOverview' }), label: lt('Motor learning lab') }} title={lt('Motor Learning Explorer')} lead={lt('How one IMU-derived task metric of one person changes through practice — observed values, competing models, uncertainty and what the data cannot tell.')} />
      <SimulatedBanner show={includeSimulated} />
      <section className="card card__body mlfilters" aria-label={lt('Selection')}>
        <label className="field">
          <span className="field__label">{lt('Participant')}</span>
          <select className="select" value={participant ?? ''} onChange={(e) => go({ participant: e.target.value || null, task: null, metric: null })}>
            <option value="">{lt('Choose…')}</option>
            {withData.map((p) => (
              <option key={p.id} value={p.id}>{p.code}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">{lt('Task')}</span>
          <select className="select" value={tk ?? ''} onChange={(e) => go({ task: e.target.value, metric: null })} disabled={!tasks.length}>
            {tasks.map((k) => {
              const [e, sd] = k.split(':') as [ExerciseId, Side];
              return <option key={k} value={k}>{names.task(e, sd)}</option>;
            })}
          </select>
        </label>
        <label className="field">
          <span className="field__label">{lt('Metric')}</span>
          <select className="select" value={mt ?? ''} onChange={(e) => go({ metric: e.target.value })} disabled={!metrics.length}>
            {metrics.map((m) => (
              <option key={m} value={m}>{lt(METRIC_LABEL[m])}</option>
            ))}
          </select>
        </label>
        {participant && (
          <LinkButton href={href({ name: 'labTwin', id: participant })} icon={<Network />}>
            {lt('Computational Motor Twin')}
          </LinkButton>
        )}
      </section>
      {!participant ? (
        <EmptyState title={lt('Choose a participant')} text={lt('Participants with stored sensor sessions are listed. Each task and metric becomes one longitudinal series.')} />
      ) : !s ? (
        <EmptyState title={lt('No sensor sessions')} text={lt('This participant has no stored sensor sessions in this workspace.')} />
      ) : (
        <SeriesView key={s.key} series={s} lt={lt} participant={participant} ws={ws} affected={patients.find((p) => p.id === participant)?.affectedSide ?? 'none'} title={`${names.task(s.exercise, s.side)} · ${lt(METRIC_LABEL[s.metric])}`} />
      )}
    </div>
  );
}

function SeriesView({ series, lt, participant, ws, title, affected }: { series: LearningSeries; lt: LT; participant: string; ws: 'demo' | 'clinic'; title: string; affected: 'left' | 'right' | 'both' | 'none' }) {
  const { protocols } = useLabRecords(ws);
  const frozenProtocols = protocols.filter((v) => v.status === 'frozen');
  const [protocolId, setProtocolId] = useState<string>('');
  const protocol: LearningProtocolVersion | null = frozenProtocols.find((v) => v.id === protocolId) ?? null;
  const dates = useDates();
  const [excluded, setExcluded] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<ModelId | null>(null);
  const [frozen, setFrozen] = useState<string | null>(null);
  const freezeRun = useLabStore((s) => s.freezeRun);
  const profile = useAppStore((s) => s.profile);
  const cfg: AnalysisConfig = useMemo(() => {
    const base = { ...DEFAULT_ANALYSIS_CONFIG, excluded };
    const v = protocols.find((x) => x.id === protocolId && x.status === 'frozen');
    return v ? analysisConfigFromProtocol(v, affected, base) : base;
  }, [excluded, protocols, protocolId, affected]);
  const a = useMemo(() => analyzeSeries(series, cfg), [series, cfg]);
  const model = shown ?? a.selected;
  const row = a.comparison.rows.find((r) => r.model === model) ?? null;
  const d = a.comparison.prepared;
  const span = d.t[d.t.length - 1] ?? 0;
  const band = useMemo(() => {
    if (!row || row.fit.status !== 'ok') return [];
    if (row.model === a.selected) return a.trajectory;
    const grid = Array.from({ length: 61 }, (_, i) => (span * i) / 60);
    return trajectoryBand(row.fit, d, bootstrap(row.fit, d, 120, cfg.seed), grid);
  }, [row, a, d, span, cfg.seed]);
  const digits = digitsFor(series.unit);
  const unitLabel = series.unit || lt('unitless');
  const points: TrajectoryPoint[] = series.sessions.map((o, i) => {
    const est = a.decomposition.sessions[i]!;
    return {
      x: o.day - a.dayOffset,
      reps: o.reps,
      mean: o.mean,
      lo: est.lo,
      hi: est.hi,
      included: o.included && !excluded[o.sessionId],
      label: `${lt('Session')} ${i + 1} · ${dates.date(o.date)}`,
      notes: [...o.exclusions, ...(excluded[o.sessionId] ? [`${lt('excluded by analyst')}: ${excluded[o.sessionId]}`] : []), ...(o.doseBefore !== null ? [`${lt('practice before')}: ${fmt(o.doseBefore, 0)} ${lt('min')}`] : [])],
    };
  });
  const toggle = (id: string) => {
    if (excluded[id]) {
      const next = { ...excluded };
      delete next[id];
      setExcluded(next);
      return;
    }
    const reason = window.prompt(lt('Reason for excluding this session (recorded in the analysis configuration):'));
    if (reason && reason.trim()) setExcluded({ ...excluded, [id]: reason.trim() });
  };
  const freeze = async () => {
    const run = await freezeRun({ workspace: ws, participantId: participant, title, author: profile?.name ?? '', series: [series], config: cfg, protocol });
    if (run) setFrozen(run.id);
  };
  return (
    <>
      <section className="card card__body mlfilters">
        <label className="field">
          <span className="field__label">{lt('Analysis plan')}</span>
          <select className="select" value={protocolId} onChange={(e) => setProtocolId(e.target.value)}>
            <option value="">{lt('default (all models, retention delay 14 days)')}</option>
            {frozenProtocols.map((v) => <option key={v.id} value={v.id}>{v.def.title} · v{v.version}</option>)}
          </select>
        </label>
        <span className="mlmuted">{protocol ? `${lt('Pre-specified by the frozen protocol')} · ${protocol.defHash.slice(0, 12)}…` : lt('Only frozen protocol versions can drive an analysis.')}</span>
      </section>
      <section className="mlkpis" aria-label={lt('Observations')}>
        <Kpi label={lt('Included sessions')} value={String(a.included)} meta={a.excluded ? `${lt('excluded')}: ${a.excluded}` : undefined} />
        <Kpi label={lt('Repetitions')} value={String(series.sessions.reduce((n, o) => n + o.n, 0))} />
        <Kpi label={lt('Repetition SD (σε)')} value={withUnit(a.decomposition.sigmaE, series.unit)} meta={<Prov kind="derived" />} />
        <Kpi label={lt('Session-to-session SD (σs)')} value={withUnit(a.decomposition.sigmaS, series.unit)} meta={<Prov kind="estimated" />} />
        <Kpi label={lt('Dose source')} value={a.doseMode === 'practice_minutes' ? lt('practice log') : lt('assumed: one unit per visit')} text />
      </section>
      <section className="card card__body">
        <TrajectoryChart
          title={`${lt(METRIC_LABEL[series.metric])} — ${lt('sessions and repetitions')}`}
          xLabel={lt('Days since the first included session')}
          yLabel={`${lt(METRIC_LABEL[series.metric])}, ${unitLabel}`}
          points={points}
          model={band}
          modelName={model ? `${lt(MODEL_LABEL[model])} (${lt('95 % band')})` : ''}
          forecast={model === a.selected ? a.forecast.map((f) => ({ t: f.t, mean: f.mean, lo: f.obsLo, hi: f.obsHi })) : []}
          forecastName={lt('Prediction for the next sessions (95 %)')}
          legend={{ observed: lt('Session mean ± 95 % CI'), reps: lt('Repetitions'), excluded: lt('Excluded session') }}
          empty={lt('No observations')}
          fmt={(v) => fmt(v, digits)}
        />
        <p className="mlmuted">
          <Prov kind="derived" /> {lt('Points are stored per-repetition metrics (core algorithm version in each session).')} <Prov kind="estimated" /> {lt('The band is the model’s latent performance with parameter uncertainty (parametric bootstrap).')} <Prov kind="predicted" /> {lt('Predictions assume the observed median interval and dose continue, and that the model is adequate.')}
        </p>
      </section>
      <Warnings list={a.warnings} />

      <section className="mlsection">
        <h2 className="section-title">{lt('Model comparison')}</h2>
        <p className="mlmuted">{lt('Selection rule, fixed in advance: among models within ΔAICc ≤ 2 of the best, prefer those whose parameters the data bound, then the fewest parameters. "No change" is always a candidate. Leave-future-out: each later session is predicted from the earlier ones only.')}</p>
        <div className="card mlscroll" tabIndex={0}>
          <table className="table table--compact mltable">
            <thead>
              <tr>
                <th>{lt('Model')}</th>
                <th>{lt('Status')}</th>
                <th className="num">k</th>
                <th className="num">ΔAICc</th>
                <th className="num">{lt('Weight')}</th>
                <th className="num">{lt('LFO MAE')}</th>
                <th className="num">{lt('LFO coverage')}</th>
                <th>{lt('Identifiable')}</th>
              </tr>
            </thead>
            <tbody>
              {a.comparison.rows.map((r) => (
                <tr key={r.model} className={`is-clickable${r.model === model ? ' is-selected' : ''}${r.fit.status !== 'ok' ? ' is-muted' : ''}`} tabIndex={0} onClick={() => setShown(r.model)} onKeyDown={(e) => e.key === 'Enter' && setShown(r.model)}>
                  <td>
                    {lt(MODEL_LABEL[r.model])} {r.model === a.selected && <span className="badge badge--info">{lt('selected')}</span>}
                    <div className="mlmono">{MODEL_EQUATION[r.model]}</div>
                  </td>
                  <td>{r.fit.status === 'ok' ? lt('fitted') : r.fit.status === 'insufficient_data' ? lt('insufficient data') : lt('failed')}</td>
                  <td className="num">{r.fit.k}</td>
                  <td className="num">{r.fit.status === 'ok' ? (Number.isFinite(r.deltaAicc) ? fmt(r.deltaAicc, 1) : lt('undefined')) : '—'}</td>
                  <td className="num">{r.fit.status === 'ok' ? fmt(r.weight, 2) : '—'}</td>
                  <td className="num">{r.lfo && r.lfo.folds.length ? fmt(r.lfo.mae, digits) : '—'}</td>
                  <td className="num">{r.lfo && r.lfo.folds.length ? `${fmt(r.lfo.coverage95 * 100, 0)} %` : '—'}</td>
                  <td>{r.fit.status !== 'ok' ? '—' : r.model === 'stationary' || r.fit.identifiable ? lt('yes') : lt('no')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mlmuted">
          {a.comparison.lfoTargets.length ? `${lt('Leave-future-out folds')}: ${a.comparison.lfoTargets.length}. ${lt('Naive forecast "same as last session"')}: MAE ${fmt(a.comparison.persistenceMae, digits)}.` : lt('Too few sessions for leave-future-out validation.')} {lt('AICc is undefined when sessions ≤ parameters + 1.')}
        </p>
      </section>

      {row && row.fit.status === 'ok' && <ModelDetail a={a} model={row.model} lt={lt} digits={digits} unit={series.unit} />}
      {row && row.fit.status !== 'ok' && <div className="callout callout--info">{lt(MODEL_LABEL[row.model])}: {row.fit.reason}</div>}

      <Decomposition a={a} series={series} lt={lt} digits={digits} />

      <section className="mlsection">
        <h2 className="section-title">{lt('Sessions in this series')}</h2>
        <div className="card mlscroll" tabIndex={0}>
          <table className="table table--compact mltable">
            <thead>
              <tr>
                <th>#</th>
                <th>{lt('Date')}</th>
                <th className="num">{lt('Day')}</th>
                <th className="num">n</th>
                <th className="num">{lt('Mean')}</th>
                <th className="num">SD</th>
                <th className="num">{lt('Practice before, min')}</th>
                <th>{lt('Quality / exclusion')}</th>
                <th>{lt('Use')}</th>
              </tr>
            </thead>
            <tbody>
              {series.sessions.map((o, i) => (
                <tr key={o.sessionId} className={o.included && !excluded[o.sessionId] ? '' : 'is-muted'}>
                  <td>{i + 1}</td>
                  <td>
                    <a href={href({ name: 'session', id: o.sessionId, complete: false })}>{dates.date(o.date)}</a>
                  </td>
                  <td className="num">{fmt(o.day, 0)}</td>
                  <td className="num">{o.n}</td>
                  <td className="num">{fmt(o.mean, digits)}</td>
                  <td className="num">{fmt(o.sd, digits)}</td>
                  <td className="num">{o.doseBefore === null ? lt('unknown') : fmt(o.doseBefore, 0)}</td>
                  <td>{[...o.exclusions, ...(excluded[o.sessionId] ? [`${lt('excluded by analyst')}: ${excluded[o.sessionId]}`] : [])].join('; ') || lt('passes')}</td>
                  <td>
                    {o.included || excluded[o.sessionId] ? (
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => toggle(o.sessionId)}>
                        {excluded[o.sessionId] ? lt('Include') : lt('Exclude…')}
                      </button>
                    ) : (
                      <span className="mlmuted">{lt('quality rule')}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card card__body mlrow">
        <Button variant="primary" icon={<Lock />} onClick={() => void freeze()}>
          {lt('Freeze this analysis')}
        </Button>
        <span className="mlmuted">{lt('Stores the observations, configuration, versions and results as an immutable run with a SHA-256 hash. Later algorithm changes never rewrite it.')}</span>
        {frozen && (
          <a href={href({ name: 'labRun', id: frozen })} className="badge badge--good">
            {lt('Frozen — open the report')}
          </a>
        )}
      </section>
    </>
  );
}

function Kpi({ label, value, meta, text }: { label: string; value: string; meta?: React.ReactNode; text?: boolean }) {
  return (
    <div className="card card__body stat">
      <span className="stat__label">{label}</span>
      <span className={text ? 'mlkpi__text' : 'stat__value num'}>{value}</span>
      {meta && <span className="stat__meta">{meta}</span>}
    </div>
  );
}

function ModelDetail({ a, model, lt, digits, unit }: { a: SeriesAnalysis; model: ModelId; lt: LT; digits: number; unit: string }) {
  const row = a.comparison.rows.find((r) => r.model === model)!;
  const fit = row.fit;
  const spec = MODELS[model];
  return (
    <section className="mlgrid mlgrid--2">
      <div className="card card__body">
        <h3 className="card__title">{lt('Parameters')} — {lt(MODEL_LABEL[model])}</h3>
        <div className="mlscroll" tabIndex={0}>
        <table className="table table--compact mltable">
          <thead>
            <tr>
              <th>{lt('Parameter')}</th>
              <th className="num">{lt('Estimate')}</th>
              <th>{lt('95 % profile interval')}</th>
            </tr>
          </thead>
          <tbody>
            {spec.params.map((p, i) => {
              const pr = fit.profiles.find((x) => x.param === p.name);
              const v = reportValue(model, i, fit.params[i] as number);
              const u = p.unit === 'days' ? lt('days') : p.unit === 'metric/week' ? `${unit}/${lt('week')}` : p.unit === 'metric/dose' ? `${unit}/${lt('dose unit')}` : unit;
              return (
                <tr key={p.name}>
                  <td>{PARAM_LABEL[p.name] ? lt(PARAM_LABEL[p.name]!) : p.name} <span className="mlmuted">{u}</span></td>
                  <td className="num">{fmt(v, p.unit === 'days' ? 0 : digits + (p.unit === 'metric/dose' ? 2 : 0))}</td>
                  <td>{pr ? <Interval lo={reportValue(model, i, pr.lo)} hi={reportValue(model, i, pr.hi)} loOpen={pr.loOpen} hiOpen={pr.hiOpen} digits={p.unit === 'days' ? 0 : digits + (p.unit === 'metric/dose' ? 2 : 0)} /> : <span className="mlmuted">{lt('nuisance')}</span>}</td>
                </tr>
              );
            })}
            <tr>
              <td>{lt('Repetition SD (σε), shared')}</td>
              <td className="num">{fmt(Math.sqrt(a.comparison.prepared.sigmaE2), digits)}</td>
              <td className="mlmuted">df = {a.comparison.prepared.dfE}</td>
            </tr>
          </tbody>
        </table>
        </div>
        <p className="mlmuted">
          <Prov kind="estimated" /> {lt('Maximum likelihood. "open" = the likelihood never falls far enough before the parameter’s bound: these data do not determine it.')}
        </p>
        {model === 'learning_retention' && (
          <p className="mlmuted">
            {lt('Forgetting vs saturation')}: <strong>{lt(RET_LABEL[a.retention.status])}</strong>
            {a.retention.deltaAicc !== null ? ` (ΔAICc ${fmt(a.retention.deltaAicc, 1)}, CV ${lt('interval')} ${fmt(a.retention.cvInterval, 2)}, CV ${lt('dose')} ${fmt(a.retention.cvDose, 2)})` : ''}
          </p>
        )}
      </div>
      <div className="card card__body">
        <ResidualChart title={lt('Standardised residuals')} xLabel={lt('Included session')} values={fit.residuals} labels={a.comparison.prepared.sessionIds} empty={lt('No residuals')} />
        {model === a.selected && a.diagnostics && (
          <p className="mlmuted">
            {lt('Lag-1 autocorrelation')} {fmt(a.diagnostics.lag1, 2)} ({lt('bootstrap p')} {fmt(a.diagnostics.pLag1, 2)}); max |r| {fmt(a.diagnostics.maxAbs, 2)} ({lt('bootstrap p')} {fmt(a.diagnostics.pMaxAbs, 2)}). {a.diagnostics.notes.includes('few_sessions_low_power') ? lt('With fewer than 8 sessions these checks have little power: passing them is weak evidence.') : ''}
          </p>
        )}
      </div>
    </section>
  );
}

const RET_LABEL = {
  supported: 'supported — forgetting fits better and the model is competitive',
  relative_only: 'only relative — better than saturation, but simpler models fit as well',
  not_distinguishable: 'not distinguishable',
  confounded_by_schedule: 'confounded by a regular schedule',
  not_assessable: 'not assessable',
} as const;

function Decomposition({ a, series, lt, digits }: { a: SeriesAnalysis; series: LearningSeries; lt: LT; digits: number }) {
  const dec = a.decomposition;
  const last = [...dec.sessions].reverse().find((s) => s.included);
  const u = series.unit;
  return (
    <section className="mlsection">
      <h2 className="section-title">{lt('Performance is not learning')}</h2>
      <p className="mlmuted">{lt('Immediate performance, change within a session, change between sessions, retention after a delay and transfer are different quantities. Each is shown only when the data contain it.')}</p>
      <div className="mlgrid mlgrid--3">
        <div className="card card__body">
          <h3 className="card__title">{lt('Immediate performance')}</h3>
          {last ? (
            <p>
              {withUnit(last.mean, u)} <span className="mlmuted">[{fmt(last.lo, digits)}; {fmt(last.hi, digits)}], n = {last.n}</span>
            </p>
          ) : (
            <p className="mlmuted">—</p>
          )}
          <p className="mlmuted">{lt('Last included session; interval from the pooled repetition SD. Not evidence of learning by itself.')}</p>
        </div>
        <div className="card card__body">
          <h3 className="card__title">{lt('Within-session change')}</h3>
          {dec.withinPooled ? (
            <p>
              {withUnit(dec.withinPooled.slope, u, digits + 1)} / {lt('repetition')} <span className="mlmuted">± {fmt(1.96 * dec.withinPooled.se, digits + 1)} ({dec.withinPooled.sessions} {lt('sessions')})</span>
            </p>
          ) : (
            <p className="mlmuted">{lt('Needs sessions with ≥ 4 repetitions (current protocols record 3).')}</p>
          )}
          {dec.online && (
            <p className="mlmuted">
              {lt('Online (last − first repetition)')}: {withUnit(dec.online.mean, u)} ± {fmt(1.96 * dec.online.se, digits)}; {lt('offline (next first − previous last)')}: {dec.offline ? `${withUnit(dec.offline.mean, u)} ± ${fmt(1.96 * dec.offline.se, digits)}` : '—'}. {lt('Single repetitions are noisy; regression to the mean and fatigue also produce these differences.')}
            </p>
          )}
        </div>
        <div className="card card__body">
          <h3 className="card__title">{lt('Between-session change')}</h3>
          {dec.overall ? (
            <p>
              {withUnit(dec.overall.delta, u)} {lt('over')} {fmt(dec.overall.days, 0)} {lt('days')} <span className="mlmuted">± {fmt(1.96 * dec.overall.se, digits)}</span>{' '}
              <span className={`badge ${dec.overall.exceedsNoise ? 'badge--info' : 'badge--outline'}`}>{dec.overall.exceedsNoise ? lt('exceeds session-to-session variability') : lt('within session-to-session variability')}</span>
            </p>
          ) : (
            <p className="mlmuted">{lt('Needs two included sessions.')}</p>
          )}
          <p className="mlmuted">{lt('SE includes repetition noise and day-to-day variability. This is an internal noise estimate, not a published minimal detectable change.')}</p>
        </div>
        <div className="card card__body">
          <h3 className="card__title">{lt('Retention')}</h3>
          {dec.retention.length ? (
            <ul className="mlwarnings">
              {dec.retention.map((r) => (
                <li key={r.toSessionId}>
                  {r.kind === 'retention_test' ? lt('Retention test') : lt('Delayed observation')}: {fmt(r.days, 0)} {lt('days')}, Δ {withUnit(r.delta, u)} ± {fmt(1.96 * r.se, digits)}; {lt('practice in delay')}: {lt(r.practiceInDelay === 'unknown' ? 'unknown' : r.practiceInDelay === 'recorded' ? 'recorded' : 'none recorded')}
                  {r.retentionRatio !== null ? `; ${lt('retained share of gain')} ${fmt(r.retentionRatio * 100, 0)} %` : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mlmuted">{lt('No interval of 14 days or more between included sessions. Retention cannot be assessed.')}</p>
          )}
          <p className="mlmuted">{lt('A delayed observation becomes a retention test only when the study protocol designates it and no practice was recorded in the delay.')}</p>
        </div>
        <div className="card card__body">
          <h3 className="card__title">{lt('Transfer')}</h3>
          <p className="mlmuted">{dec.transfer.status === 'not_designated' ? lt('Not assessable: no study protocol designates trained and untrained (transfer) tasks.') : dec.transfer.status === 'trained_task' ? lt('This is a trained task in the protocol.') : lt('Transfer task: change in an untrained task.')}</p>
        </div>
      </div>
    </section>
  );
}
