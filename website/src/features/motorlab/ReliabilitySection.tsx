// Measurement reliability (test–retest) from the sessions that exist in this workspace. It reports ICC(A,1), SEM
// and MDC95 per movement, side and metric only when qualifying pairs exist, and says how many were excluded and why.

import { useMemo, useState } from 'react';
import { buildParticipantSeries, LEARNING_METRICS, type LearningMetric } from '../../lab/dataset';
import { DEFAULT_RETEST, retestReliability } from '../../lab/reliability';
import type { ExerciseId } from '../../core/exercises';
import type { Side } from '../../devices/types';
import { fmt, METRIC_LABEL, Prov, useLabData, useNames, withUnit } from './common';
import { useLT, type LKey } from './i18n';

const SUFF: Record<string, LKey> = { none: 'no data', insufficient: 'insufficient (< 10 participants)', limited: 'limited (10–29)', adequate: 'adequate (≥ 30)' };

export function ReliabilitySection() {
  const lt = useLT();
  const names = useNames();
  const { patients, sessions, practice, includeSimulated } = useLabData();
  const [metric, setMetric] = useState<LearningMetric>('rom');
  const [maxDays, setMaxDays] = useState(DEFAULT_RETEST.maxDays);
  const [unknown, setUnknown] = useState(false);
  const results = useMemo(() => {
    const series = patients.flatMap((p) => buildParticipantSeries(p.id, sessions, { includeSimulated, practice })).filter((s) => s.metric === metric);
    return retestReliability(series, { maxDays, includeUnknownPractice: unknown });
  }, [patients, sessions, includeSimulated, practice, metric, maxDays, unknown]);
  return (
    <section className="mlsection">
      <h2 className="section-title">{lt('Measurement reliability (test–retest)')}</h2>
      <p className="mlmuted">
        {lt('Computed from this workspace: the first two included sessions of each participant at most the chosen number of days apart, with no practice recorded between them. ICC(A,1), SEM and MDC95 appear only when such pairs exist. This is the estimate later protocols can use as the external MDC.')}
      </p>
      <div className="card card__body mlfilters">
        <label className="field">
          <span className="field__label">{lt('Metric')}</span>
          <select className="select" value={metric} onChange={(e) => setMetric(e.target.value as LearningMetric)}>
            {LEARNING_METRICS.map((m) => <option key={m} value={m}>{lt(METRIC_LABEL[m])}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field__label">{lt('Longest test–retest interval, days')}</span>
          <input className="input" type="number" min={1} max={30} value={maxDays} onChange={(e) => setMaxDays(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={unknown} onChange={(e) => setUnknown(e.target.checked)} /> {lt('Also use pairs with unknown practice in between')}
        </label>
      </div>
      <div className="card mlscroll" tabIndex={0}>
        <table className="table table--compact mltable">
          <thead>
            <tr>
              <th>{lt('Task')}</th>
              <th className="num">{lt('Pairs')}</th>
              <th>{lt('Sufficiency')}</th>
              <th className="num">ICC(A,1) [95 %]</th>
              <th className="num">SEM</th>
              <th className="num">MDC95</th>
              <th>{lt('Excluded pairs')}</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={`${r.exercise}${r.side}`} className={r.icc ? '' : 'is-muted'}>
                <td>{names.task(r.exercise as ExerciseId, r.side as Side)}</td>
                <td className="num">{r.pairs.length}</td>
                <td>{lt(SUFF[r.sufficiency]!)}</td>
                <td className="num">{r.icc ? `${fmt(r.icc.agreement, 2)}${r.icc.agreementCi ? ` [${fmt(r.icc.agreementCi[0], 2)}; ${fmt(r.icc.agreementCi[1], 2)}]` : ''}` : '—'}</td>
                <td className="num">{r.icc ? withUnit(r.icc.semAgreement, r.unit) : '—'}</td>
                <td className="num">{r.icc ? withUnit(r.icc.mdc95, r.unit) : '—'}</td>
                <td>{lt('practice recorded')}: {r.skipped.practiceRecorded} · {lt('practice unknown')}: {r.skipped.practiceUnknown} · {lt('too far apart')}: {r.skipped.tooFarApart}</td>
              </tr>
            ))}
            {!results.length && (
              <tr>
                <td colSpan={7} className="mlmuted">{lt('No sensor sessions')}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mlmuted">
        <Prov kind="derived" /> {lt('Reliability of these IMU metrics in children is not established until real test–retest data reach adequate size. Simulated sessions in the demo are not evidence.')}
      </p>
    </section>
  );
}
