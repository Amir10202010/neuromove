// Аналитика группы: кто прибавляет, у кого плато, где данные требуют осторожности.
// Изменения показаны как измерены — прибор не доказывает эффект терапии.

import { Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import { navigate } from '../../app/router';
import { ChartFrame } from '../../charts/ChartFrame';
import { ColumnChart, type Column } from '../../charts/ColumnChart';
import { DotPlot } from '../../charts/DotPlot';
import { Dumbbell, type DumbbellRow } from '../../charts/Dumbbell';
import { TimeSeriesChart, type TsSeries } from '../../charts/TimeSeriesChart';
import { EXERCISE_IDS, EXERCISES, type ExerciseId } from '../../core/exercises';
import { downloadText, exportName, metricsCsv, stamp } from '../../data/export';
import type { Level, Patient } from '../../data/models';
import type { Side } from '../../devices/types';
import { useI18n } from '../../i18n';
import { median } from '../../lib/stats';
import { PageHeader } from '../../layout/PageHeader';
import { useWorkspaceData } from '../../state/appStore';
import { focusSide, metricSeries, otherSide, weeksSince, type MetricKey } from '../../session/compare';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { EmptyArt } from '../../figures/EmptyArt';
import { MetricInfo } from '../../ui/MetricInfo';
import { Segmented } from '../../ui/Segmented';
import { ALERT_RULES } from '../../session/alerts';
import { Details } from '../common/Details';
import { GroupList, groupHeadline, groupTrends } from '../common/GroupList';

type SideMode = 'affected' | 'less';
type GmfcsFilter = 'all' | Level;

export function AnalyticsPage() {
  const { t, f } = useI18n();
  const { ws, patients, sessions } = useWorkspaceData();
  const [exercise, setExercise] = useState<ExerciseId>('shoulder_flexion');
  const [sideMode, setSideMode] = useState<SideMode>('affected');
  const [gmfcs, setGmfcs] = useState<GmfcsFilter>('all');
  const [highlight, setHighlight] = useState<string | null>(null);

  const cohort = useMemo(() => patients.filter((p) => gmfcs === 'all' || p.gmfcs === gmfcs).sort((a, b) => a.code.localeCompare(b.code)), [patients, gmfcs]);
  const sideOf = (p: Patient): Side => (sideMode === 'affected' ? focusSide(p.affectedSide) : otherSide(focusSide(p.affectedSide)));
  const cohortSessions = sessions.filter((s) => cohort.some((p) => p.id === s.patientId));

  const series = (metric: MetricKey) =>
    cohort
      .map((p) => ({ p, pts: metricSeries(sessions, p, exercise, sideOf(p), metric) }))
      .filter((x) => x.pts.length > 0);

  const romRows = series('rom');
  const withTwo = romRows.filter((r) => r.pts.length > 1);
  const changes = withTwo.map((r) => (r.pts[r.pts.length - 1]?.value ?? 0) - (r.pts[0]?.value ?? 0));
  const qualities = cohortSessions.map((s) => s.quality.percent);

  const dumb = (metric: MetricKey): DumbbellRow[] =>
    series(metric)
      .filter((r) => r.pts.length > 1)
      .map((r) => ({
        id: r.p.id,
        label: r.p.code,
        from: r.pts[0]?.value ?? 0,
        to: r.pts[r.pts.length - 1]?.value ?? 0,
        onClick: () => navigate({ name: 'patient', id: r.p.id, tab: 'overview' }),
      }))
      .sort((a, b) => b.to - b.from - (a.to - a.from));

  // Объём по неделям курса: все пациенты серым, выбранный — цветом
  const selected = highlight ?? withTwo[0]?.p.id ?? null;
  const weekSeries: TsSeries[] = romRows
    .filter((r) => r.p.courseStart)
    .map((r) => ({
      id: r.p.id,
      label: r.p.code,
      color: r.p.id === selected ? 'var(--brand-600)' : 'var(--muted-series)',
      muted: r.p.id !== selected,
      points: r.pts.map((pt) => ({ t: Math.round(weeksSince(r.p.courseStart as string, pt.date) * 10) / 10, v: pt.value, id: pt.sessionId })),
    }))
    // выбранная линия рисуется последней — поверх серых
    .sort((a, b) => (a.id === selected ? 1 : b.id === selected ? -1 : 0));

  const maxWeek = Math.max(1, ...weekSeries.flatMap((s) => s.points.map((p) => p.t)));
  const weekTicks = Array.from({ length: Math.floor(maxWeek / 2) + 1 }, (_, i) => i * 2);

  // Нагрузка: сеансы по неделям за последние 12 недель
  const now = new Date();
  const monday = (d: Date) => {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  };
  const thisWeek = monday(now);
  const columns: Column[] = Array.from({ length: 12 }, (_, i) => {
    const start = new Date(thisWeek.getTime() - (11 - i) * 7 * 86400000);
    const end = new Date(start.getTime() + 7 * 86400000);
    const n = cohortSessions.filter((s) => {
      const d = new Date(s.startedAt);
      return d >= start && d < end;
    }).length;
    return { id: String(i), label: f.dateShort(start), value: n, title: `${f.dateShort(start)}: ${t('common.sessionsCount', { count: n })}` };
  });

  const measured = new Set(romRows.map((r) => r.p.id)).size;
  // Простой вид — всегда вся группа, подъём вперёд поражённой рукой: без фильтров
  const trends = groupTrends(sessions, patients);
  const head = groupHeadline(trends);
  const exOptions = EXERCISE_IDS;
  const unitFor = (m: MetricKey) => (m === 'symmetry' ? '%' : m === 'sparc' ? '' : '°');

  if (sessions.length === 0) {
    return (
      <div className="page">
        <PageHeader title={t('analytics.title')} />
        <div className="card">
          <EmptyState art={<EmptyArt kind="sessions" size={96} />} title={t('analytics.empty')} text={t('analytics.emptyText')} />
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader title={t('analytics.title')} />

      {/* Простой вид: одна фраза о группе и список «кто как» — словами, по правилам наблюдений */}
      <section data-guide="group" className="card sumcard" aria-labelledby="sumcard-group">
        <div className="sumcard__body">
          <h2 id="sumcard-group" className="sumcard__label">
            {t('simple.main')}
          </h2>
          <p className="sumcard__headline">{head.n > 0 ? t('group.headline', { up: head.up, n: head.n }) : t('group.empty')}</p>
          {(head.drops > 0 || head.plateaus > 0) && (
            <p className="sumcard__sub">
              {head.drops > 0 && t('group.drops', { count: head.drops })}
              {head.drops > 0 && head.plateaus > 0 && ' '}
              {head.plateaus > 0 && t('group.plateaus', { count: head.plateaus, n: ALERT_RULES.plateauSessions })}
            </p>
          )}
          <div style={{ marginTop: 18 }}>
            <GroupList trends={trends} />
          </div>
        </div>
      </section>

      <Details hint={t('details.analyticsHint')}>
      {/* Фильтры, графики, выгрузка и оговорка о причинах изменений — для того, кто разбирает группу */}
      <div className="filters" role="group" aria-label={t('analytics.title')}>
        <label className="sr-only" htmlFor="an-ex">
          {t('analytics.exercise')}
        </label>
        <select id="an-ex" className="select" style={{ width: 'auto', minWidth: 220 }} value={exercise} onChange={(e) => setExercise(e.target.value as ExerciseId)}>
          {exOptions.map((ex) => (
            <option key={ex} value={ex}>
              {t(`exercise.${ex}.name`)}
            </option>
          ))}
        </select>
        <Segmented<SideMode>
          label={t('analytics.side')}
          value={sideMode}
          onChange={setSideMode}
          options={[
            { value: 'affected', label: t('analytics.sideAffected') },
            { value: 'less', label: t('analytics.sideLess') },
          ]}
        />
        <Segmented<GmfcsFilter>
          label={t('analytics.gmfcs')}
          value={gmfcs}
          onChange={setGmfcs}
          options={[
            { value: 'all', label: `GMFCS · ${t('common.all')}` },
            { value: 1, label: 'I' },
            { value: 2, label: 'II' },
            { value: 3, label: 'III' },
          ]}
        />
      </div>

      <div className="grid grid--kpi">
        <div className="card stat">
          <span className="stat__label">{t('analytics.kpiSessions')}</span>
          <span className="stat__value">{cohortSessions.length}</span>
          <span className="stat__meta">{t('common.patientsCount', { count: cohort.length })}</span>
        </div>
        <div className="card stat">
          <span className="stat__label">{t('analytics.kpiPatients')}</span>
          <span className="stat__value">{measured}</span>
          <span className="stat__meta">{t(`exercise.${exercise}.name`)}</span>
        </div>
        <div className="card stat">
          <span className="stat__label">
            {t('analytics.kpiChange')}
            <MetricInfo metric="rom" />
          </span>
          <span className="stat__value">{changes.length ? f.deltaDeg(median(changes)) : '–'}</span>
          <span className="stat__meta">{t('analytics.kpiChangeHint')}</span>
        </div>
        <div className="card stat">
          <span className="stat__label">
            {t('analytics.kpiQuality')}
            <MetricInfo metric="quality" />
          </span>
          <span className="stat__value">{qualities.length ? f.pct(median(qualities), 1) : '–'}</span>
          <span className="stat__meta">{t('common.sessionsCount', { count: qualities.length })}</span>
        </div>
      </div>

      {withTwo.length === 0 ? (
        <div className="card">
          <EmptyState art={<EmptyArt kind="sessions" size={96} />} title={t('analytics.empty')} text={t('analytics.emptyText')} />
        </div>
      ) : (
        <>
          <div className="grid grid--2">
            <ChartFrame
              title={t('analytics.romChange')}
              subtitle={t('analytics.romChangeHint')}
              legend={[
                { label: t('analytics.baseline'), color: 'var(--muted-series)', kind: 'dot' },
                { label: t('analytics.latest'), color: 'var(--brand-700)', kind: 'dot' },
              ]}
              table={() => <DumbbellTable rows={dumb('rom')} unit="°" />}
            >
              <Dumbbell rows={dumb('rom')} unit="°" ariaLabel={t('analytics.romChange')} />
            </ChartFrame>

            <ChartFrame
              title={t('analytics.byWeek')}
              subtitle={t('analytics.byWeekHint')}
              table={() => (
                <table className="table table--compact">
                  <thead>
                    <tr>
                      <th>{t('common.patient')}</th>
                      <th>{t('analytics.weekShort')}</th>
                      <th className="num">{t('metric.romShort')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weekSeries.flatMap((s) =>
                      s.points.map((p) => (
                        <tr key={`${s.id}-${p.t}`}>
                          <td>{s.label}</td>
                          <td className="num">{f.num(p.t, 1)}</td>
                          <td className="num">{f.deg(p.v)}</td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              )}
            >
              <div className="chips" role="group" aria-label={t('common.patient')}>
                {weekSeries
                  .slice()
                  .sort((a, b) => a.label.localeCompare(b.label))
                  .map((s) => (
                    <button key={s.id} type="button" className="chip" aria-pressed={s.id === selected} onClick={() => setHighlight(s.id)}>
                      {s.label}
                    </button>
                  ))}
              </div>
              <TimeSeriesChart
                series={weekSeries}
                unit="°"
                ariaLabel={t('analytics.byWeek')}
                xFormat={(w) => t('analytics.week', { n: Math.round(w * 10) / 10 })}
                xTickFormat={(w) => String(w)}
                xTicks={weekTicks}
                xPad={0.4}
                endLabelMode="label"
                height={250}
                onPointClick={(_, p) => p.id && navigate({ name: 'session', id: p.id, complete: false })}
              />
            </ChartFrame>
          </div>

          <div className="grid grid--3">
            {(
              [
                ['symmetry', 'analytics.symmetryChart', 'up'],
                ['sparc', 'analytics.sparcChart', 'up'],
                ['trunk', 'analytics.trunkChart', 'down'],
              ] as const
            ).map(([m, title, better]) => {
              const rows = dumb(m);
              const disabled = m === 'trunk' && !EXERCISES[exercise].trunk;
              return (
                <ChartFrame
                  key={m}
                  title={
                    <span className="row" style={{ gap: 6 }}>
                      {t(title)}
                      <MetricInfo metric={m} />
                    </span>
                  }
                  subtitle={t('analytics.baselineVsNow')}
                  table={() => <DumbbellTable rows={rows} unit={unitFor(m)} digits={m === 'sparc' ? 2 : 0} />}
                >
                  {disabled || rows.length === 0 ? (
                    <EmptyState compact title={t('common.noData')} />
                  ) : (
                    <Dumbbell rows={rows} unit={unitFor(m)} digits={m === 'sparc' ? 2 : 0} better={better} ariaLabel={t(title)} />
                  )}
                </ChartFrame>
              );
            })}
          </div>

          <div className="grid grid--2">
            <ChartFrame
              title={t('analytics.load')}
              table={() => (
                <table className="table table--compact">
                  <tbody>
                    {columns.map((c) => (
                      <tr key={c.id}>
                        <td>{c.label}</td>
                        <td className="num">{c.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            >
              <ColumnChart columns={columns} ariaLabel={t('analytics.load')} />
            </ChartFrame>
            <ChartFrame
              title={
                <span className="row" style={{ gap: 6 }}>
                  {t('analytics.qualityChart')}
                  <MetricInfo metric="quality" />
                </span>
              }
              table={() => (
                <table className="table table--compact">
                  <tbody>
                    {[...cohortSessions]
                      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
                      .map((s) => (
                        <tr key={s.id}>
                          <td>{f.date(s.startedAt)}</td>
                          <td>{cohort.find((p) => p.id === s.patientId)?.code}</td>
                          <td className="num">{f.pct(s.quality.percent, 1)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            >
              <DotPlot
                dots={cohortSessions.map((s) => ({
                  id: s.id,
                  t: new Date(s.startedAt).getTime(),
                  v: s.quality.percent,
                  title: `${cohort.find((p) => p.id === s.patientId)?.code ?? ''} · ${f.date(s.startedAt)} · ${f.pct(s.quality.percent, 1)}`,
                  onClick: () => navigate({ name: 'session', id: s.id, complete: false }),
                }))}
                threshold={95}
                thresholdLabel={t('analytics.qualityThreshold')}
                ariaLabel={t('analytics.qualityChart')}
              />
            </ChartFrame>
          </div>
        </>
      )}
      <div className="row row--wrap" style={{ gap: 12, alignItems: 'center' }}>
        <Button icon={<Download />} onClick={() => downloadText(exportName(ws === 'demo', ['metrics', stamp()], 'csv'), metricsCsv(cohortSessions, cohort), 'text/csv;charset=utf-8')}>
          {t('analytics.exportCsv')}
        </Button>
        <p className="muted" style={{ fontSize: 'var(--fs-sm)', flex: '1 1 320px' }}>
          {t('analytics.note')}
        </p>
      </div>
      </Details>
    </div>
  );
}

function DumbbellTable({ rows, unit, digits = 0 }: { rows: DumbbellRow[]; unit: string; digits?: number }) {
  const { t, f } = useI18n();
  const fmt = (v: number) => (unit === '%' ? f.pct(v, digits) : unit === '°' ? f.deg(v, digits) : f.num(v, digits));
  return (
    <table className="table table--compact">
      <thead>
        <tr>
          <th>{t('common.patient')}</th>
          <th className="num">{t('analytics.baseline')}</th>
          <th className="num">{t('analytics.latest')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>{r.label}</td>
            <td className="num">{fmt(r.from)}</td>
            <td className="num">{fmt(r.to)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

