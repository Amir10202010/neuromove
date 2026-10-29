// Динамика пациента по сеансам: выбранная метрика и движение, обе стороны, цель пунктиром.

import { useState } from 'react';
import { navigate } from '../../app/router';
import { ChartFrame, type LegendItem } from '../../charts/ChartFrame';
import { TimeSeriesChart, type TsSeries } from '../../charts/TimeSeriesChart';
import { EXERCISE_IDS, type ExerciseId } from '../../core/exercises';
import type { Patient, Session } from '../../data/models';
import type { Side } from '../../devices/types';
import { useI18n } from '../../i18n';
import { focusSide, metricSeries, type MetricKey } from '../../session/compare';
import { MetricInfo } from '../../ui/MetricInfo';
import { Segmented } from '../../ui/Segmented';

export function DynamicsChart({ patient, sessions, initialExercise = 'shoulder_flexion' }: { patient: Patient; sessions: readonly Session[]; initialExercise?: ExerciseId }) {
  const { t, f } = useI18n();
  const [metric, setMetric] = useState<MetricKey>('rom');
  const [exercise, setExercise] = useState<ExerciseId>(initialExercise);
  const affected = patient.affectedSide;
  const focus = focusSide(affected);

  const available = EXERCISE_IDS.filter((ex) => metricSeries(sessions, patient, ex, focus, 'rom').length > 0);

  const series: TsSeries[] = (() => {
    const mk = (side: Side): TsSeries => ({
      id: side,
      label: `${side === 'left' ? t('side.leftArm') : t('side.rightArm')}${affected === side || affected === 'both' ? ` · ${t('side.affected')}` : ''}`,
      color: side === 'left' ? 'var(--left)' : 'var(--right)',
      muted: affected !== 'both' && affected !== side,
      points: metricSeries(sessions, patient, exercise, side, metric).map((p) => ({ t: new Date(p.date).getTime(), v: p.value, id: p.sessionId })),
    });
    if (metric === 'symmetry') {
      return [
        {
          id: 'sym',
          label: t('metric.symmetry'),
          color: 'var(--brand-600)',
          points: metricSeries(sessions, patient, exercise, focus, 'symmetry').map((p) => ({ t: new Date(p.date).getTime(), v: p.value, id: p.sessionId })),
        },
      ];
    }
    return (['left', 'right'] as Side[]).map(mk).filter((s) => s.points.length);
  })();

  const goal = metric === 'rom' ? patient.goals.find((g) => g.exercise === exercise && (g.side === focus || affected === 'both')) : undefined;
  const unit = metric === 'symmetry' ? '%' : metric === 'sparc' ? '' : '°';
  const digits = metric === 'sparc' ? 2 : 0;
  const legend: LegendItem[] = series.map((s) => ({ label: s.label, color: s.color }));
  if (goal) legend.push({ label: `${t('run.goal')} ${goal.targetRom}°`, color: 'var(--goal)', kind: 'dashed' });

  const fmt = (v: number) => (unit === '%' ? f.pct(v) : unit === '°' ? f.deg(v) : f.num(v, 2));
  const dates = [...new Set(series.flatMap((s) => s.points.map((p) => p.t)))].sort((a, b) => a - b);
  const infoKey = metric === 'rom' ? 'rom' : metric === 'symmetry' ? 'symmetry' : metric === 'sparc' ? 'sparc' : 'trunk';

  return (
    <ChartFrame
      title={
        <span className="row" style={{ gap: 6 }}>
          {t('profile.dynamics')}
          <MetricInfo metric={infoKey} />
        </span>
      }
      subtitle={t('profile.dynamicsHint')}
      legend={legend}
      table={() => (
        <table className="table table--compact">
          <thead>
            <tr>
              <th>{t('common.date')}</th>
              {series.map((s) => (
                <th key={s.id} className="num">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dates.map((d) => (
              <tr key={d}>
                <td>{f.date(new Date(d))}</td>
                {series.map((s) => {
                  const p = s.points.find((q) => q.t === d);
                  return (
                    <td key={s.id} className="num">
                      {p ? fmt(p.v) : '–'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    >
      <div className="chart-controls">
        <Segmented<MetricKey>
          label={t('profile.metric')}
          value={metric}
          onChange={setMetric}
          options={[
            { value: 'rom', label: t('metric.romShort') },
            { value: 'symmetry', label: t('metric.symmetry') },
            { value: 'sparc', label: t('metric.sparc') },
            { value: 'trunk', label: t('metric.trunkShort') },
          ]}
        />
        <label className="sr-only" htmlFor="dyn-ex">
          {t('profile.exercise')}
        </label>
        <select id="dyn-ex" className="select" style={{ width: 'auto', minWidth: 200 }} value={exercise} onChange={(e) => setExercise(e.target.value as ExerciseId)}>
          {(available.length ? available : EXERCISE_IDS).map((ex) => (
            <option key={ex} value={ex}>
              {t(`exercise.${ex}.name`)}
            </option>
          ))}
        </select>
      </div>
      {series.every((s) => s.points.length === 0) ? (
        <div className="empty empty--compact">
          <div className="empty__title">{t('common.noData')}</div>
        </div>
      ) : (
        <TimeSeriesChart
          series={series}
          unit={unit}
          digits={digits}
          goal={goal ? { value: goal.targetRom, label: `${t('run.goal')} ${goal.targetRom}°` } : null}
          ariaLabel={`${t('profile.dynamics')}: ${t(`exercise.${exercise}.name`)}`}
          onPointClick={(_, p) => p.id && navigate({ name: 'session', id: p.id, complete: false })}
          height={260}
        />
      )}
    </ChartFrame>
  );
}
