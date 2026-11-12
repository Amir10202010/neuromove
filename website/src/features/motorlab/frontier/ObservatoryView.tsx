// Learning observatory of one participant and series: has the session level changed (and how sure is that), is the
// latest session outside the personal measurement envelope, what else could explain it, what happened inside the
// latest long sitting, which learning terms these data can separate, and what more data would buy.
// The numbers come from lab/observatory/summary.ts; the page only lays them out.

import { useMemo, useState } from 'react';
import { DETECTION_RULE } from '../../../lab/observatory/changeDetection';
import { BASELINE_SESSIONS, observeSeries, participantTransfer } from '../../../lab/observatory/summary';
import { WITHIN_RULE } from '../../../lab/observatory/withinSession';
import { sessionsForDifference } from '../../../lab/design/planning';
import { EmptyState } from '../../../ui/EmptyState';
import { fmt, METRIC_LABEL, MODEL_LABEL, useDates, useNames, useParticipantSeries, withUnit } from '../common';
import { CurveChart, SERIES } from '../coordination/charts';
import { useLT } from '../i18n';
import { useLabRecords } from '../store';
import type { FT } from './i18n';
import { CanonicalNote, Chip, Kpi, code, type Tone } from './shared';
import '../../../styles/coord.css';

const explanationTone = (s: string): Tone => (s === 'excluded' ? 'met' : s === 'sufficient' ? 'signal' : s === 'not_excluded' ? 'caution' : 'refused');
const estimableTone = (s: string): Tone => (s === 'estimable' ? 'met' : s === 'partly_estimable' ? 'caution' : 'refused');

export function ObservatoryView({ ft, participant }: { ft: FT; participant: string | null }) {
  const lt = useLT();
  const names = useNames();
  const dates = useDates();
  const { series, sessions, ws } = useParticipantSeries(participant);
  const { trialSets } = useLabRecords(ws);
  const [key, setKey] = useState<string | null>(null);
  const [delta, setDelta] = useState('');
  const current = series.find((s) => s.key === key) ?? series.find((s) => s.metric === 'rom') ?? series[0] ?? null;
  const sittings = useMemo(
    () => (current ? trialSets.filter((t) => t.participantId === current.participantId && t.exercise === current.exercise && t.side === current.side).map((t) => t.trials.filter((x) => x.valid).length) : []),
    [trialSets, current],
  );
  const family = current ? series.filter((s) => s.metric === current.metric).length : 1;
  const o = useMemo(() => (current ? observeSeries(current, { all: series, sessions, practiceSittings: sittings, family }) : null), [current, series, sessions, sittings, family]);
  const transfer = useMemo(() => (current ? participantTransfer(series, current.metric) : null), [series, current]);
  const assessable = useMemo(() => (transfer ? transfer.edges.filter((e) => e.status !== 'not_assessable') : []), [transfer]);
  if (!current || !o) return <EmptyState title={ft('No series for this participant')} text={ft('Record sensor sessions of the same movement on several days to build a series.')} />;

  const unit = current.unit;
  const inc = o.included;
  const x = inc.map((s) => s.day);
  const iv = o.baseline.interval;
  const env = o.baseline.envelope;
  const det = o.detection;
  const d = Number(delta.replace(',', '.'));
  const { sigmaE, sigmaS } = o.analysis.decomposition;
  const need = o.planning && Number.isFinite(d) && d > 0 ? sessionsForDifference(sigmaE, sigmaS, o.planning.repetitions, d) : null;
  const sittingDate = o.sitting ? inc.find((s) => s.sessionId === o.sitting?.sessionId)?.date : null;

  return (
    <>
      <section className="card card__body mlfilters">
        <label className="field">
          <span className="field__label">{ft('Series')}</span>
          <select className="select" value={current.key} onChange={(e) => setKey(e.target.value)}>
            {series.map((s) => (
              <option key={s.key} value={s.key}>
                {names.task(s.exercise, s.side)} · {lt(METRIC_LABEL[s.metric])}
              </option>
            ))}
          </select>
        </label>
        <span className="mlmuted">
          {ft('Series of this metric examined together')}: {family} ({ft('the detection thresholds are stricter accordingly')})
        </span>
      </section>

      <section className="mlkpis" aria-label={ft('Summary')}>
        <Kpi label={ft('Included sessions')} value={String(inc.length)} />
        <Kpi label={ft('Repetition SD (σε)')} value={withUnit(sigmaE, unit)} />
        <Kpi label={ft('Day-to-day SD (σs)')} value={withUnit(sigmaS, unit)} />
        <Kpi label={ft('Change detection')} value={code(ft, det.status)} text />
        <Kpi label={ft('Selected model')} value={o.analysis.selected ? lt(MODEL_LABEL[o.analysis.selected]) : '—'} text />
      </section>

      <section className="mlsection">
        <h2 className="section-title">{ft('Session level and the personal measurement envelope')}</h2>
        <div className="card card__body">
          <CurveChart
            title={`${names.task(current.exercise, current.side)} · ${lt(METRIC_LABEL[current.metric])}`}
            xLabel={ft('Days since the first session')}
            yLabel={unit}
            x={x}
            series={[
              { name: ft('Session mean'), y: inc.map((s) => s.mean), color: SERIES[0] },
              ...(iv && env.status !== 'insufficient' ? [{ name: ft('Baseline centre and 95 % envelope for a session'), y: x.map(() => env.centre), color: SERIES[1], dashed: true, band: { lo: x.map(() => iv.lo), hi: x.map(() => iv.hi) } }] : []),
            ]}
            markers={det.cusum.alarmAt !== null && inc[det.cusum.alarmAt] ? [{ x: inc[det.cusum.alarmAt]!.day, label: ft('CUSUM signal') }] : []}
            fmt={(v) => fmt(v, 1)}
          />
          <dl className="fr-dl">
            <dt>{ft('Baseline')}</dt>
            <dd>
              {ft('first sessions')}: {o.baseline.sessions} / {BASELINE_SESSIONS} · <Chip tone={env.status === 'usable' ? 'met' : env.status === 'insufficient' ? 'refused' : 'caution'}>{code(ft, env.status)}</Chip>
            </dd>
            <dt>{ft('Envelope for a session like the latest')}</dt>
            <dd className="num">{iv ? `${withUnit(iv.lo, unit)} … ${withUnit(iv.hi, unit)}` : '—'}</dd>
            <dt>{ft('Latest session')}</dt>
            <dd>
              {o.baseline.latest ? (
                <>
                  <Chip tone={o.baseline.latest.outside ? 'signal' : 'plain'}>{code(ft, o.baseline.latest.outside ? `outside_${o.baseline.latest.direction}` : 'inside_envelope')}</Chip> <span className="num">p = {fmt(o.baseline.latest.p, 3)}</span>
                </>
              ) : (
                ft('not compared: it belongs to the baseline, or the baseline is too short')
              )}
            </dd>
          </dl>
          <p className="mlmuted">{ft('The envelope is the range in which a new session mean is expected if nothing changed: repetition noise, day-to-day variation and the uncertainty of the baseline itself. The first sessions are taken as the baseline because no protocol designates one. Outside the envelope means "not explained by the usual variation of this person" — not that the movement improved or worsened, and not why.')}</p>
        </div>
      </section>

      <section className="mlsection">
        <h2 className="section-title">{ft('Has the level changed?')}</h2>
        <div className="mlgrid mlgrid--2">
          <div className="card card__body">
            <dl className="fr-dl">
              <dt>{ft('CUSUM (primary)')}</dt>
              <dd>
                <Chip tone={det.status === 'change_signalled' ? 'signal' : det.status === 'insufficient_data' ? 'refused' : 'plain'}>{code(ft, det.status)}</Chip>
                {det.cusum.alarmAt !== null && (
                  <>
                    {' '}
                    {ft('at session')} {det.cusum.alarmAt + 1}, {code(ft, det.cusum.direction)}
                  </>
                )}
              </dd>
              <dt>EWMA</dt>
              <dd>{det.ewma.alarmAt !== null ? `${ft('signal at session')} ${det.ewma.alarmAt + 1}` : ft('no signal')}</dd>
              <dt>Shewhart</dt>
              <dd>{det.shewhart.alarmAt !== null ? `${ft('signal at session')} ${det.shewhart.alarmAt + 1}` : ft('no signal')}</dd>
              <dt>{ft('Bayesian change point')}</dt>
              <dd>
                {det.bayes ? (
                  <>
                    P({ft('change')}) = <span className="num">{fmt(det.bayes.pChange, 2)}</span> · {ft('most likely after session')} {det.bayes.mostLikelyAfter + 1} · {ft('shift')} <span className="num">{withUnit(det.bayes.shift, unit)}</span>
                    <br />
                    <span className="mlmuted">
                      {ft('at prior scales')} {det.bayes.sensitivity.map((s) => `${s.scale}: ${fmt(s.pChange, 2)}`).join(' · ')}
                    </span>
                  </>
                ) : (
                  '—'
                )}
              </dd>
              <dt>{ft('Corroborated')}</dt>
              <dd>{det.corroborated ? ft('yes: the posterior probability of a change is at least 0.9') : ft('no')}</dd>
            </dl>
            <p className="mlmuted">
              {ft('False-alarm rate per series calibrated by simulation to')} {det.alpha} {ft('over')} {det.horizon} {ft('sessions; needs at least')} {DETECTION_RULE.minSessions}. {ft('A signal says the level moved; it does not say why. No signal on a short series is not evidence of stability: with ten sessions a shift of two day-to-day SDs is found about one time in three.')}
            </p>
            {det.notes.length > 0 && (
              <ul className="fr-list">
                {det.notes.map((n) => (
                  <li key={n}>{n.replace(/_/g, ' ')}</li>
                ))}
              </ul>
            )}
          </div>
          <div className="card card__body">
            <CurveChart
              title={ft('CUSUM of standardised self-starting residuals')}
              xLabel={ft('Session number')}
              yLabel=""
              x={det.cusum.pos.map((_, i) => i + 1)}
              series={[
                { name: ft('upward'), y: det.cusum.pos, color: SERIES[0] },
                { name: ft('downward'), y: det.cusum.neg.map((v) => -v), color: SERIES[1] },
                { name: ft('threshold'), y: det.cusum.pos.map(() => det.cusum.h), color: SERIES[3], dashed: true, thin: true },
                { name: ft('threshold'), y: det.cusum.pos.map(() => -det.cusum.h), color: SERIES[3], dashed: true, thin: true },
              ]}
              fmt={(v) => fmt(v, 1)}
            />
          </div>
        </div>
      </section>

      {o.explanations && (
        <section className="mlsection">
          <h2 className="section-title">{ft('What else could explain the difference from baseline?')}</h2>
          <div className="card card__body">
            <p>
              <Chip tone={o.explanations.conclusion === 'measurement_excluded' ? 'signal' : o.explanations.conclusion === 'explained_by_measurement' ? 'plain' : 'caution'}>{code(ft, o.explanations.conclusion)}</Chip> {o.explanations.statement}
            </p>
          </div>
          <div className="card mlscroll" tabIndex={0}>
            <table className="table table--compact mltable fr-wrap">
              <thead>
                <tr>
                  <th>{ft('Alternative explanation')}</th>
                  <th>{ft('Status')}</th>
                  <th>{ft('Evidence')}</th>
                  <th>{ft('What would decide it')}</th>
                </tr>
              </thead>
              <tbody>
                {o.explanations.alternatives.map((a) => (
                  <tr key={a.id}>
                    <td>{code(ft, a.id)}</td>
                    <td>
                      <Chip tone={explanationTone(a.status)}>{code(ft, a.status)}</Chip>
                    </td>
                    <td>{a.evidence}</td>
                    <td>{a.wouldDecide}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CanonicalNote ft={ft} />
        </section>
      )}

      {o.falsification && (
        <section className="mlsection">
          <h2 className="section-title">{ft('Attempts to break the signalled change')}</h2>
          <div className="card mlscroll" tabIndex={0}>
            <table className="table table--compact mltable fr-wrap">
              <thead>
                <tr>
                  <th>{ft('Check')}</th>
                  <th>{ft('Result')}</th>
                  <th>{ft('Detail')}</th>
                </tr>
              </thead>
              <tbody>
                {o.falsification.checks.map((c) => (
                  <tr key={c.id}>
                    <td>{code(ft, c.id)}</td>
                    <td>
                      <Chip tone={c.result === 'survived' ? 'met' : c.result === 'failed' ? 'caution' : 'refused'}>{code(ft, c.result)}</Chip>
                    </td>
                    <td>{c.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mlmuted">{o.falsification.fragile ? ft('At least one check failed: the finding is fragile and should not be reported as a change.') : ft('No runnable check broke the finding. The checks that could not be run remain open.')}</p>
        </section>
      )}

      <section className="mlsection">
        <h2 className="section-title">{ft('Within the latest long sitting')}</h2>
        {o.sitting ? (
          <>
            <div className="card card__body">
              <p>
                {sittingDate ? dates.dateTime(sittingDate) : o.sitting.sessionId} · {ft('repetitions')}: {o.sitting.repetitions} · <Chip tone={o.sitting.dynamics.pattern === 'no_trend_detected' ? 'plain' : o.sitting.dynamics.pattern === 'insufficient_repetitions' ? 'refused' : 'signal'}>{code(ft, o.sitting.dynamics.pattern)}</Chip>
              </p>
              <p className="mlmuted">{ft('A rise, a decline or both inside one sitting. The names describe the direction only: a decline is "fatigue-like", not fatigue — tiredness, loss of attention, pain and boredom are not recorded and cannot be told apart from it.')}</p>
            </div>
            <div className="card mlscroll" tabIndex={0}>
              <table className="table table--compact mltable fr-wrap">
                <thead>
                  <tr>
                    <th>{ft('Feature')}</th>
                    <th>{ft('Shape')}</th>
                    <th className="num">{ft('Slope per repetition')}</th>
                    <th className="num">{ft('p (Holm)')}</th>
                    <th>{ft('Direction')}</th>
                  </tr>
                </thead>
                <tbody>
                  {o.sitting.dynamics.features.map((f) => (
                    <tr key={f.feature}>
                      <td>{code(ft, f.feature)}</td>
                      <td>{code(ft, f.shape)}</td>
                      <td className="num">{fmt(f.slope, 2)}</td>
                      <td className="num">{fmt(f.pHolm, 3)}</td>
                      <td>{code(ft, f.direction)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="mlmuted">
            {ft('No included session of this series has the repetitions a trend needs')} ({WITHIN_RULE.minTrend}). {ft('An assessment step of three repetitions cannot show practice or fatigue inside a sitting.')}
          </p>
        )}
      </section>

      <section className="mlsection">
        <h2 className="section-title">{ft('What these data can and cannot separate')}</h2>
        <div className="card mlscroll" tabIndex={0}>
          <table className="table table--compact mltable fr-wrap">
            <thead>
              <tr>
                <th>{ft('Term')}</th>
                <th>{ft('Status')}</th>
                <th>{ft('Supported by')}</th>
                <th>{ft('Missing')}</th>
              </tr>
            </thead>
            <tbody>
              {o.estimability.map((e) => (
                <tr key={e.term}>
                  <td>{code(ft, e.term)}</td>
                  <td>
                    <Chip tone={estimableTone(e.status)}>{code(ft, e.status)}</Chip>
                  </td>
                  <td>{e.supportedBy.join('; ') || '—'}</td>
                  <td>{e.missing.join('; ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {transfer && transfer.nodes.length > 1 && (
        <section className="mlsection">
          <h2 className="section-title">{ft('Change across tasks')}</h2>
          <div className="card mlscroll" tabIndex={0}>
            <table className="table table--compact mltable fr-wrap">
              <thead>
                <tr>
                  <th>{ft('Task')}</th>
                  <th className="num">{ft('Sessions')}</th>
                  <th className="num">{ft('Change, first to last session')}</th>
                  <th className="num">{ft('SE of the change')}</th>
                  <th>{ft('Exceeds 1.96 SE')}</th>
                </tr>
              </thead>
              <tbody>
                {transfer.nodes.map((n) => {
                  const [e, sd] = n.task.split(':');
                  return (
                    <tr key={n.task}>
                      <td>{names.task(e as never, sd as never)}</td>
                      <td className="num">{n.sessions}</td>
                      <td className="num">{n.change ? withUnit(n.change.delta, unit) : '—'}</td>
                      <td className="num">{n.change ? withUnit(n.change.se, unit) : '—'}</td>
                      <td>{n.change ? (n.change.exceedsNoise ? ft('yes') : ft('no')) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {assessable.length > 0 && (
            <div className="card mlscroll" tabIndex={0}>
              <table className="table table--compact mltable fr-wrap">
                <thead>
                  <tr>
                    <th>{ft('From task')}</th>
                    <th>{ft('To task')}</th>
                    <th>{ft('Status')}</th>
                    <th>{ft('Reason')}</th>
                  </tr>
                </thead>
                <tbody>
                  {assessable.map((e) => {
                    const [fe, fs] = e.from.split(':');
                    const [te, ts] = e.to.split(':');
                    return (
                      <tr key={`${e.from}>${e.to}`}>
                        <td>{names.task(fe as never, fs as never)}</td>
                        <td>{names.task(te as never, ts as never)}</td>
                        <td>
                          <Chip tone={e.status === 'transfer_candidate' ? 'signal' : 'plain'}>{code(ft, e.status)}</Chip>
                        </td>
                        <td>{e.reason}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mlmuted">
            {ft('Change of the session mean between the first and the last included session of each task; its SE includes day-to-day variation.')} {!transfer.hasTransferTask && ft('No task is designated as trained or as a transfer task in the stored data, so two tasks changing together is shown as co-change — never as transfer.')}
          </p>
        </section>
      )}

      {o.planning && (
        <section className="mlsection">
          <h2 className="section-title">{ft('What more data would buy')}</h2>
          <div className="mlgrid mlgrid--2">
            <div className="card mlscroll" tabIndex={0}>
              <table className="table table--compact mltable fr-wrap">
                <caption className="mlmuted">
                  {ft('With the present number of sessions')} ({o.planning.sessions})
                </caption>
                <thead>
                  <tr>
                    <th className="num">{ft('Repetitions per session')}</th>
                    <th className="num">{ft('SE of the level')}</th>
                    <th className="num">{ft('SE of the weekly slope')}</th>
                    <th className="num">{ft('Smallest detectable change between two sessions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {o.planning.options.map((a) => (
                    <tr key={a.repetitions}>
                      <td className="num">
                        {a.repetitions}
                        {a.repetitions === o.planning?.repetitions ? ` (${ft('now')})` : ''}
                      </td>
                      <td className="num">{withUnit(a.seLevel, unit)}</td>
                      <td className="num">{a.seSlopePerWeek === null ? '—' : withUnit(a.seSlopePerWeek, unit)}</td>
                      <td className="num">{withUnit(a.mdcSession, unit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card card__body">
              <p>
                <Chip>{code(ft, o.planning.advice.better)}</Chip> {o.planning.advice.explanation}
              </p>
              <label className="field">
                <span className="field__label">
                  {ft('Difference of level to detect')}, {unit || '—'}
                </span>
                <input className="input" inputMode="decimal" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder={fmt(o.planning.options.find((a) => a.repetitions === o.planning?.repetitions)?.mdcSession ?? null, 1)} />
              </label>
              <p className="mlmuted">
                {need !== null ? `${ft('Sessions needed in each of two phases (80 % power, two-sided 5 %)')}: ${need}` : ft('Enter a difference to see how many sessions per phase it needs.')}
              </p>
              <p className="mlmuted">{ft('Planning numbers assume the repetition and day-to-day variation estimated from this series stay the same. They are for designing a measurement schedule, not a statement about the participant.')}</p>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
