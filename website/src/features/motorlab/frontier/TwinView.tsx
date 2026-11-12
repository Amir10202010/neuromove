// Twin workspace: the six layers of the computational twin of one participant (measurement → kinematic → strategy →
// learning → predictive → experimental), its maturity level against fixed criteria, and prediction records — each
// issued with its interval and calibration, or refused with the reason. Built in a worker (lab/twin/layers.ts).
// The existing Twin page keeps the per-task model, sandbox and assistant; this one shows what the twin rests on.

import { Lock, Play } from 'lucide-react';
import { useMemo, useState } from 'react';
import { href } from '../../../app/router';
import type { ExerciseId } from '../../../core/exercises';
import type { Side } from '../../../devices/types';
import { sealEvidence } from '../../../lab/discovery/evidenceRecord';
import { PREDICTION_RULE, type PredictionRecord } from '../../../lab/twin/prediction';
import type { TwinLayers } from '../../../lab/twin/layers';
import { newId } from '../../../lib/ids';
import { useAppStore } from '../../../state/appStore';
import { EmptyState } from '../../../ui/EmptyState';
import { fmt, METRIC_LABEL, MODEL_LABEL, useDates, useLabData, useNames, withUnit } from '../common';
import { useLT } from '../i18n';
import { useEvidence, useLabRecords, useLabStore } from '../store';
import type { FT } from './i18n';
import { CanonicalNote, Chip, JobStatus, Kpi, code, pct } from './shared';
import { useFrontierJob } from './useFrontierJob';

export function TwinView({ ft, participant }: { ft: FT; participant: string | null }) {
  const dates = useDates();
  const { ws, sessions, practice, includeSimulated } = useLabData();
  const { trialSets } = useLabRecords(ws);
  const evidence = useEvidence(ws);
  const saveEvidence = useLabStore((s) => s.saveEvidence);
  const author = useAppStore((s) => s.profile?.name ?? '');
  const { job, run } = useFrontierJob('layers');
  const [sealed, setSealed] = useState<string | null>(null);
  const mine = useMemo(() => sessions.filter((s) => s.patientId === participant), [sessions, participant]);
  const sittings = useMemo(() => {
    const out: Record<string, number[]> = {};
    for (const t of trialSets) if (t.participantId === participant) (out[`${t.exercise}:${t.side}`] ??= []).push(t.trials.filter((x) => x.valid).length);
    return out;
  }, [trialSets, participant]);
  if (!participant || !mine.length) return <EmptyState title={ft('No sensor sessions for this participant')} text={ft('The twin is built from recorded sensor sessions.')} />;

  const build = () => {
    setSealed(null);
    run({ kind: 'layers', input: { participantId: participant, sessions: mine, includeSimulated, practice: practice.filter((p) => p.participantId === participant), practiceSittings: sittings } });
  };
  const layers = job.state === 'done' && job.result.layers.participantId === participant ? job.result.layers : null;
  const seal = async () => {
    if (!layers) return;
    const rec = sealEvidence({
      id: newId('ev'),
      workspace: ws,
      participantId: participant,
      type: 'twin_snapshot',
      title: ft('Twin snapshot'),
      createdAt: new Date().toISOString(),
      createdBy: author || 'unknown',
      versions: layers.versions,
      derivedFrom: mine.map((s) => ({ kind: 'session', id: s.id, hash: null })),
      body: layers,
      simulated: layers.simulated,
    });
    if (await saveEvidence(rec)) setSealed(rec.contentHash);
  };
  const snapshots = evidence.filter((e) => e.type === 'twin_snapshot' && e.participantId === participant);

  return (
    <>
      <section className="card card__body mlfilters">
        <button type="button" className="btn btn--primary" disabled={job.state === 'running'} onClick={build}>
          <Play aria-hidden /> {ft('Build the twin layers')}
        </button>
        <a href={href({ name: 'labTwin', id: participant })}>{ft('Open the per-task model, sandbox and assistant')}</a>
        <span className="mlmuted">{ft('Fits every range-of-motion series of the participant and evaluates each forecast out of sample; takes a few seconds.')}</span>
      </section>
      <JobStatus job={job} ft={ft} />
      {layers && <Layers layers={layers} ft={ft} />}
      {layers && (
        <section className="mlsection">
          <div className="mlrow">
            <button type="button" className="btn btn--secondary" onClick={() => void seal()} disabled={sealed !== null}>
              <Lock aria-hidden /> {ft('Seal this snapshot')}
            </button>
            <span className="mlmuted">
              {ft('Snapshot hash')} <span className="fr-mono">{layers.hash.slice(0, 16)}…</span>
              {sealed ? ` · ${ft('Sealed on this device')}` : ''}
            </span>
          </div>
          <p className="mlmuted">{ft('A sealed snapshot records what the twin said, and from which sessions, before later sessions exist — so a prediction can be checked against what was observed afterwards.')}</p>
        </section>
      )}
      {snapshots.length > 0 && (
        <section className="mlsection">
          <h2 className="section-title">{ft('Sealed snapshots on this device')}</h2>
          <div className="card mlscroll" tabIndex={0}>
            <table className="table table--compact mltable fr-wrap">
              <thead>
                <tr>
                  <th>{ft('Sealed')}</th>
                  <th className="num">{ft('Sessions')}</th>
                  <th className="num">{ft('Maturity level')}</th>
                  <th className="num">{ft('Predictions issued / refused')}</th>
                  <th>SHA-256</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((e) => {
                  const b = e.body as TwinLayers;
                  return (
                    <tr key={e.id}>
                      <td>{dates.dateTime(e.createdAt)}</td>
                      <td className="num">{e.derivedFrom.length}</td>
                      <td className="num">{b.maturity?.level ?? '—'}</td>
                      <td className="num">
                        {b.predictive?.filter((p) => p.status === 'issued').length ?? 0} / {b.predictive?.filter((p) => p.status === 'refused').length ?? 0}
                      </td>
                      <td className="fr-mono">{e.contentHash.slice(0, 16)}…</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

function Layers({ layers: L, ft }: { layers: TwinLayers; ft: FT }) {
  const lt = useLT();
  const names = useNames();
  const dates = useDates();
  const task = (t: string) => {
    const [e, s] = t.split(':');
    return names.task(e as ExerciseId, s as Side);
  };
  const metric = (m: string) => (m in METRIC_LABEL ? lt(METRIC_LABEL[m as keyof typeof METRIC_LABEL]) : m);
  const m = L.measurement;
  return (
    <>
      <section className="mlsection">
        <h2 className="section-title">{ft('Maturity')}</h2>
        {L.maturity.syntheticOnly && <div className="callout callout--demo">{ft('Every session of this participant is simulated: the level below describes what the software can do with such data, not a validated twin of a person.')}</div>}
        <ol className="fr-ladder">
          {L.maturity.levels.map((l) => (
            <li key={l.level} className={`${l.met ? 'is-met' : ''}${l.level === L.maturity.level ? ' is-current' : ''}`}>
              <div className="mlrow">
                <strong>
                  {ft('Level')} {l.level}
                </strong>
                <span>{l.name}</span>
                <Chip tone={l.met ? 'met' : 'refused'}>{l.met ? ft('criteria met') : ft('not met')}</Chip>
              </div>
              {l.evidence.map((e) => (
                <span key={e} className="mlmuted">
                  {e}
                </span>
              ))}
              {l.missing.length > 0 && (
                <ul className="fr-list">
                  {l.missing.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
        <p className="mlmuted">{ft('The level is the highest one whose fixed criteria the existing data meet, counted from the bottom. Level 4 cannot be reached by software evidence.')}</p>
      </section>

      <section className="mlsection">
        <h2 className="section-title">1 · {ft('Measurement layer')}</h2>
        <div className="mlkpis">
          <Kpi label={ft('Sensor sessions')} value={String(m.sessions)} meta={m.firstDate && m.lastDate ? `${dates.date(m.firstDate)} – ${dates.date(m.lastDate)}` : undefined} />
          <Kpi label={ft('With raw 100 Hz frames')} value={String(m.withRaw)} meta={`${ft('with a verified manifest')}: ${m.rawWithManifest}`} />
          <Kpi label={ft('Signal below 90 %')} value={String(m.signalBelow90)} />
          <Kpi label={ft('Incomplete sessions')} value={String(m.incomplete)} />
          <Kpi label={ft('External assessments')} value={String(m.externalAssessments)} />
        </div>
        <p className="mlmuted">
          {ft('Algorithm versions')}: {m.algorithmVersions.join(', ') || '—'} · {ft('Provenance of the values in this twin')}: {Object.entries(L.provenance).map(([k, v]) => `${code(ft, k)} ${v}`).join(' · ') || '—'}
        </p>
      </section>

      <section className="mlsection">
        <h2 className="section-title">2 · {ft('Kinematic layer')}</h2>
        <div className="card mlscroll" tabIndex={0}>
          <table className="table table--compact mltable fr-wrap">
            <thead>
              <tr>
                <th>{ft('Task')}</th>
                <th>{ft('Metric')}</th>
                <th>{ft('Status')}</th>
                <th className="num">{ft('Sessions')}</th>
                <th className="num">{ft('Latest session mean')}</th>
              </tr>
            </thead>
            <tbody>
              {L.kinematic.map((k) => (
                <tr key={`${k.task}|${k.metric}`}>
                  <td>{task(k.task)}</td>
                  <td>{metric(k.metric)}</td>
                  <td>{code(ft, k.status)}</td>
                  <td className="num">{k.sessions}</td>
                  <td className="num">{k.latest ? `${withUnit(k.latest.mean, k.unit)} (n = ${k.latest.n})` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mlsection">
        <h2 className="section-title">3 · {ft('Strategy layer')}</h2>
        <div className="card card__body">
          <p>
            <Chip tone={L.strategy.status === 'available' ? 'met' : 'refused'}>{code(ft, L.strategy.status)}</Chip> {L.strategy.reason ?? ''}
          </p>
          <a href={href({ name: 'labFrontier', view: 'strategy', participant: L.participantId })}>{ft('Open the strategy atlas')}</a>
        </div>
      </section>

      <section className="mlsection">
        <h2 className="section-title">4 · {ft('Learning layer')}</h2>
        <div className="card mlscroll" tabIndex={0}>
          <table className="table table--compact mltable fr-wrap">
            <thead>
              <tr>
                <th>{ft('Task')}</th>
                <th className="num">{ft('Sessions')}</th>
                <th>{ft('Baseline')}</th>
                <th>{ft('Latest vs envelope')}</th>
                <th>{ft('Selected model')}</th>
                <th>{ft('Change detection')}</th>
                <th>{ft('Retention')}</th>
                <th>{ft('Not estimable from these data')}</th>
              </tr>
            </thead>
            <tbody>
              {L.learning.map((l) => (
                <tr key={l.seriesKey}>
                  <td>
                    {task(l.task)} · {metric(l.metric)}
                  </td>
                  <td className="num">{l.included}</td>
                  <td>
                    {code(ft, l.baseline.status)}
                    {l.baseline.interval ? ` · ${fmt(l.baseline.interval[0], 1)} … ${fmt(l.baseline.interval[1], 1)}` : ''}
                  </td>
                  <td>{l.baseline.latest ? code(ft, l.baseline.latest.outside ? `outside_${l.baseline.latest.direction}` : 'inside_envelope') : '—'}</td>
                  <td>{l.selectedModel ? lt(MODEL_LABEL[l.selectedModel]) : '—'}</td>
                  <td>
                    {code(ft, l.detection.status)}
                    {l.detection.pChange !== null ? ` · P = ${fmt(l.detection.pChange, 2)}` : ''}
                  </td>
                  <td>{code(ft, l.retention)}</td>
                  <td>{l.notEstimable.map((t) => code(ft, t)).join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mlsection">
        <h2 className="section-title">5 · {ft('Predictive layer')}</h2>
        {L.predictive.map((p) => (
          <Prediction key={p.id} p={p} ft={ft} task={task} metric={metric} />
        ))}
        <p className="mlmuted">
          {ft('A prediction is the expected mean of a future session of the stated repetitions, an Akaike-weighted mixture of the fitted models. It is refused when there are fewer than')} {PREDICTION_RULE.minSessions} {ft('sessions, when the horizon exceeds the observed span, when the interval is wider than twice the observed range, or when past forecasts of this series were demonstrably worse than "same as last session" or covered too rarely.')}
        </p>
      </section>

      <section className="mlsection">
        <h2 className="section-title">6 · {ft('Experimental layer')}</h2>
        <div className="card card__body">
          <dl className="fr-dl">
            <dt>{ft('Hypothetical schedule scenarios')}</dt>
            <dd>
              <Chip tone={L.experimental.doseScenarios ? 'met' : 'refused'}>{L.experimental.doseScenarios ? ft('have a fitted basis') : ft('would rest on an assumption')}</Chip> {L.experimental.doseScenarioReason}
            </dd>
            <dt>{ft('Advice on the next observation')}</dt>
            <dd>{L.experimental.designAdvice ? ft('available') : ft('not available: no model with a time structure is selected')}</dd>
          </dl>
          <p className="mlmuted">{L.experimental.note}</p>
        </div>
        <CanonicalNote ft={ft} />
      </section>
    </>
  );
}

function Prediction({ p, ft, task, metric }: { p: PredictionRecord; ft: FT; task: (t: string) => string; metric: (m: string) => string }) {
  const lt = useLT();
  const unit = p.target.unit;
  const c = p.calibration;
  return (
    <div className="card card__body">
      <div className="mlrow">
        <strong>
          {task(`${p.target.exercise}:${p.target.side}`)} · {metric(p.target.metric)}
        </strong>
        <Chip tone={p.status === 'issued' ? 'signal' : 'refused'}>{code(ft, p.status)}</Chip>
        {p.extrapolation.warning !== 'none' && <Chip tone="caution">{code(ft, p.extrapolation.warning)}</Chip>}
      </div>
      <dl className="fr-dl">
        <dt>{ft('Target')}</dt>
        <dd>
          {ft('mean of a future session')} · {ft('repetitions')}: {p.target.repetitions} · {ft('horizon, days')}: {fmt(p.horizon.days, 0)} ({pct(p.horizon.overSpan)} {ft('of the observed span')})
        </dd>
        {p.status === 'issued' ? (
          <>
            <dt>{ft('Prediction')}</dt>
            <dd className="num">
              {withUnit(p.point, unit)} · 95 % {p.interval95 ? `${withUnit(p.interval95[0], unit)} … ${withUnit(p.interval95[1], unit)}` : '—'}
            </dd>
          </>
        ) : (
          <>
            <dt>{ft('Refused because')}</dt>
            <dd>{p.refusal.map((r) => code(ft, r)).join('; ')}</dd>
          </>
        )}
        <dt>{ft('Models in the mixture')}</dt>
        <dd>{p.models.map((x) => `${lt(MODEL_LABEL[x.model])} ${pct(x.weight)}`).join(' · ') || '—'}</dd>
        <dt>{ft('Past forecasts of this series')}</dt>
        <dd>
          {c.status === 'evaluated' ? (
            <>
              {ft('out-of-sample forecasts')}: {c.folds} · {ft('inside their 95 % interval')}: {pct(c.coverage95)}
              {c.coverageCi ? ` [${pct(c.coverageCi[0])}; ${pct(c.coverageCi[1])}]` : ''} · {ft('mean absolute error')} {withUnit(c.mae, unit)} {ft('vs')} {withUnit(c.persistenceMae, unit)} {ft('for "same as last session"')}
            </>
          ) : (
            ft('too few sessions to evaluate')
          )}
        </dd>
        <dt>{ft('Inputs')}</dt>
        <dd>
          {ft('sessions')}: {p.inputs.included} · {ft('observed span, days')}: {fmt(p.inputs.spanDays, 0)} · <span className="fr-mono">{p.inputs.dataHash.slice(0, 12)}…</span>
        </dd>
      </dl>
      {p.limitations.length > 0 && (
        <ul className="fr-list">
          {p.limitations.map((x) => (
            <li key={x}>{x.replace(/_/g, ' ')}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
