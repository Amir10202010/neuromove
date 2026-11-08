// Movement intelligence: IMU-derived metrics per movement over time, individual baseline, documented
// definitions and validation status. Measurements only — never presented as function or as improvement.

import { useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import { METRICS, METRIC_ORDER, NOT_COMPUTED, compareToBaseline, movementSeries, trendPerWeek, usable, type MetricId, type Series } from '../../rehab/movement';
import { newProfile } from '../../rehab/workflows';
import { EmptyState } from '../../ui/EmptyState';
import { exerciseLabel, SourceBadge, useActor, useSave, useXT } from './common';
import { METRIC_ICF } from '../../rehab/icf';
import { IcfBadges } from './Icf';
import type { ParticipantData } from './data';

const fmt = (v: number | undefined | null, d = 1) => (v === undefined || v === null || !Number.isFinite(v) ? '—' : v.toFixed(d).replace('-', '−'));

export function MovementTab({ data }: { data: ParticipantData }) {
  const { xt } = useXT();
  const { t, f } = useI18n();
  const actor = useActor('professional');
  const save = useSave();
  const series = useMemo(() => movementSeries(data.sessions, { includeSimulated: data.demo }), [data.sessions, data.demo]);
  const [key, setKey] = useState<string>(() => (series[0] ? `${series[0].exercise}:${series[0].side}` : ''));
  const [metric, setMetric] = useState<MetricId>('rom');
  const s = series.find((x) => `${x.exercise}:${x.side}` === key) ?? series[0];
  const designated = data.profile?.baselineSessionIds ?? [];

  const toggleBaseline = async (sessionId: string) => {
    const p = data.profile ?? newProfile(data.patient!.id, data.patient!.workspace, actor.name);
    const ids = p.baselineSessionIds.includes(sessionId) ? p.baselineSessionIds.filter((x) => x !== sessionId) : [...p.baselineSessionIds, sessionId];
    await save([{ ...p, baselineSessionIds: ids, updatedAt: new Date().toISOString(), updatedBy: actor.name }], actor);
  };

  if (!s)
    return (
      <section className="card">
        <EmptyState title={xt('No sensor sessions yet')} text={xt('Movement analytics appear after a sensor test of this participant. Home activities without sensors are recorded as reports, not measurements.')} />
      </section>
    );

  const cmp = compareToBaseline(s, metric, designated, data.demo);
  const trend = trendPerWeek(s, metric, data.demo);
  const def = METRICS[metric];
  return (
    <div className="stack">
      <section className="card">
        <div className="card__header">
          <h2 className="card__title">
            {xt('Movement measurements')} <SourceBadge source="imu" />
          </h2>
          <span className="muted small">{xt('IMU-derived values from the three-sensor setup. Not clinically validated; a change in an angle does not imply a change in daily function.')} {xt('ICF level: body functions (b), not activities or participation (d).')}</span>
        </div>
        <div className="card__body stack">
          <div className="row row--wrap">
            <select className="select" aria-label={xt('Movement')} value={`${s.exercise}:${s.side}`} onChange={(e) => setKey(e.target.value)}>
              {series.map((x) => (
                <option key={`${x.exercise}:${x.side}`} value={`${x.exercise}:${x.side}`}>
                  {exerciseLabel(t, x.exercise)} · {x.side === 'left' ? xt('left') : xt('right')} ({x.points.length})
                </option>
              ))}
            </select>
            <select className="select" aria-label={xt('Metric')} value={metric} onChange={(e) => setMetric(e.target.value as MetricId)}>
              {METRIC_ORDER.map((m) => (
                <option key={m} value={m}>
                  {xt(`metric.${m}`)}
                  {METRICS[m].unit ? `, ${METRICS[m].unit}` : ''}
                </option>
              ))}
            </select>
            <span className={`badge ${def.validation === 'software_verified' ? 'badge--outline' : 'badge--warn'}`}>{def.validation === 'software_verified' ? xt('software-verified, not clinically validated') : xt('experimental')}</span>
          </div>
          <MetricChart series={s} metric={metric} designated={designated} demo={data.demo} />
          <div className="grid grid--3">
            <div className="stat">
              <span className="stat__label">{xt('Baseline')}</span>
              <span className="stat__value num">
                {fmt(cmp?.baseline.value)}
                <span className="stat__unit">{def.unit}</span>
              </span>
              <span className="stat__meta">{cmp ? (cmp.baseline.designated ? xt('designated by the professional') : xt('provisional: first usable session')) : xt('needs two usable sessions')}</span>
            </div>
            <div className="stat">
              <span className="stat__label">{xt('Latest − baseline')}</span>
              <span className="stat__value num">
                {cmp ? `${cmp.delta > 0 ? '+' : ''}${fmt(cmp.delta)}` : '—'}
                <span className="stat__unit">{def.unit}</span>
              </span>
              <span className="stat__meta">{cmp?.noise !== null && cmp?.noise !== undefined ? xt('noise check ±{n} (heuristic, not an MDC)', { n: fmt(cmp.noise) }) : xt('no noise estimate')}</span>
            </div>
            <div className="stat">
              <span className="stat__label">{xt('Trend per week')}</span>
              <span className="stat__value num">
                {trend ? `${trend.slope > 0 ? '+' : ''}${fmt(trend.slope, 2)}` : '—'}
                <span className="stat__unit">{def.unit}</span>
              </span>
              <span className="stat__meta">{trend ? xt('descriptive, {n} sessions', { n: trend.points }) : xt('needs ≥ 3 usable sessions')}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card__header">
          <h2 className="card__title">{xt('Sessions')}</h2>
          <span className="muted small">{xt('Choose the baseline sessions. Sessions failing quality checks are shown but not compared.')}</span>
        </div>
        <div className="table-wrap">
          <table className="table table--compact">
            <thead>
              <tr>
                <th>{xt('Date')}</th>
                <th className="num">{xt('metric.rom')}</th>
                <th className="num">{xt('metric.peak_velocity')}</th>
                <th className="num">{xt('metric.sparc')}</th>
                <th className="num">{xt('metric.rom_cv')}</th>
                <th className="num">{xt('metric.rep_count')}</th>
                <th>{xt('Quality')}</th>
                <th>{xt('Baseline')}</th>
              </tr>
            </thead>
            <tbody>
              {[...s.points].reverse().map((p) => (
                <tr key={p.sessionId}>
                  <td className="num">{f.dateCompact(p.date)}</td>
                  <td className="num">{fmt(p.values.rom)}</td>
                  <td className="num">{fmt(p.values.peak_velocity, 0)}</td>
                  <td className="num">{fmt(p.values.sparc, 2)}</td>
                  <td className="num">{fmt(p.values.rom_cv)}</td>
                  <td className="num">{p.values.rep_count ?? '—'}</td>
                  <td>
                    {usable(p, data.demo) ? <span className="badge badge--good">{xt('usable')}</span> : <span className="badge badge--warn">{p.issues.map((i) => xt(`issue.${i}`)).join(', ')}</span>}
                    {p.simulated && <span className="badge badge--demo">{xt('simulated')}</span>}
                  </td>
                  <td>
                    <label className="checkbox">
                      <input type="checkbox" checked={designated.includes(p.sessionId)} disabled={!usable(p, data.demo)} onChange={() => void toggleBaseline(p.sessionId)} />
                      <span className="sr-only">{xt('Baseline')}</span>
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card__header">
          <h2 className="card__title">{xt('How each metric is computed')}</h2>
        </div>
        <div className="table-wrap">
          <table className="table table--compact">
            <thead>
              <tr>
                <th>{xt('Metric')}</th>
                <th>{xt('Definition')}</th>
                <th>{xt('Limitations')}</th>
                <th>{xt('Validation')}</th>
                <th>ICF</th>
              </tr>
            </thead>
            <tbody>
              {METRIC_ORDER.map((m) => (
                <tr key={m}>
                  <td>
                    {xt(`metric.${m}`)} {METRICS[m].unit && <span className="muted">({METRICS[m].unit})</span>}
                  </td>
                  <td className="small">{METRICS[m].definition}</td>
                  <td className="small">{METRICS[m].limitations}</td>
                  <td className="small">{METRICS[m].validation === 'software_verified' ? xt('software-verified, not clinically validated') : xt('experimental')}</td>
                  <td>
                    <IcfBadges codes={[METRIC_ICF[m]]} confirmed />
                  </td>
                </tr>
              ))}
              {NOT_COMPUTED.map((n) => (
                <tr key={n.id}>
                  <td>{xt('Angular acceleration')}</td>
                  <td className="small" colSpan={2}>
                    {n.reason}
                  </td>
                  <td className="small">{xt('not computed')}</td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="card__body muted small">{xt('Definitions are technical (English) so they can be cited exactly in reports.')}</p>
      </section>
    </div>
  );
}

function MetricChart({ series, metric, designated, demo }: { series: Series; metric: MetricId; designated: readonly string[]; demo: boolean }) {
  const { xt } = useXT();
  const pts = series.points.filter((p) => p.values[metric] !== undefined);
  if (pts.length === 0) return <p className="muted">{xt('No values for this metric.')}</p>;
  const W = 640;
  const H = 180;
  const pad = 28;
  const vals = pts.map((p) => p.values[metric] as number);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  const t0 = Date.parse(pts[0]!.date);
  const t1 = Date.parse(pts.at(-1)!.date);
  const x = (d: string) => pad + ((Date.parse(d) - t0) / (t1 - t0 || 1)) * (W - 2 * pad);
  const y = (v: number) => H - pad - ((v - lo) / span) * (H - 2 * pad);
  const ok = pts.filter((p) => usable(p, demo));
  return (
    <figure className="rh-mchart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={xt(`metric.${metric}`)}>
        <line x1={pad} x2={W - pad} y1={H - pad} y2={H - pad} className="rh-mchart__axis" />
        <text x={4} y={y(hi) + 4} className="rh-mchart__tick">
          {hi.toFixed(1)}
        </text>
        <text x={4} y={y(lo) + 4} className="rh-mchart__tick">
          {lo.toFixed(1)}
        </text>
        {ok.length > 1 && <polyline className="rh-mchart__line" points={ok.map((p) => `${x(p.date)},${y(p.values[metric] as number)}`).join(' ')} />}
        {pts.map((p) => (
          <circle key={p.sessionId} cx={x(p.date)} cy={y(p.values[metric] as number)} r={designated.includes(p.sessionId) ? 6 : 4} className={`rh-mchart__pt${usable(p, demo) ? '' : ' is-excluded'}${designated.includes(p.sessionId) ? ' is-baseline' : ''}`}>
            <title>{`${p.date.slice(0, 10)}: ${(p.values[metric] as number).toFixed(2)}${usable(p, demo) ? '' : ` (${p.issues.join(', ')})`}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="muted small">{xt('Filled: usable sessions. Hollow: excluded by quality checks. Large: designated baseline.')}</figcaption>
    </figure>
  );
}
