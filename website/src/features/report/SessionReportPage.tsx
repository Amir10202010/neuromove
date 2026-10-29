import { Download, FileHeart, Printer, Save, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { href } from '../../website/router';
import { BarPairs, type BarPairRow } from '../../charts/BarPairs';
import { ChartFrame } from '../../charts/ChartFrame';
import { TraceChart } from '../../charts/TraceChart';
import { EXERCISES, EXERCISE_IDS } from '../../core/exercises';
import { downloadText, exportName, rawCsv, stamp } from '../../data/export';
import type { Patient, Session } from '../../data/models';
import { PLACEMENTS, type Placement, type Side } from '../../devices/types';
import { CAL_POSE_WARN_DEG } from '../../session/SessionEngine';
import { useI18n } from '../../i18n';
import { PageHeader } from '../../layout/PageHeader';
import { StatusRing } from '../../figures/StatusRing';
import { currentClinician, useAppStore, useWorkspaceData } from '../../state/appStore';
import { consistency, focusSide, previousSession, previousWith, sessionSymmetry, stepOf } from '../../session/compare';
import { buildSummary } from '../../session/summary';
import { Button, LinkButton } from '../../ui/Button';
import { Delta } from '../../ui/Delta';
import { EmptyState } from '../../ui/EmptyState';
import { EmptyArt } from '../../figures/EmptyArt';
import { MetricInfo } from '../../ui/MetricInfo';
import { PatientAvatar } from '../../ui/PatientAvatar';
import { Details } from '../common/Details';
import { SessionSummary } from '../common/Summary';
import { armLabel, patientLine } from '../common/text';

export function SessionReportPage({ id, complete }: { id: string; complete: boolean }) {
  const { t, locale } = useI18n();
  const { ws, sessions, patients } = useWorkspaceData();
  const session = sessions.find((s) => s.id === id);
  const patient = session ? patients.find((p) => p.id === session.patientId) : undefined;

  if (!session || !patient) {
    return (
      <div className="page">
        <div className="card">
          <EmptyState
            art={<EmptyArt kind="lost" />}
            title={t('report.notFound')}
            text={t('report.notFoundText')}
            action={
              <LinkButton variant="primary" href={href({ name: 'sessions' })}>
                {t('nav.sessions')}
              </LinkButton>
            }
          />
        </div>
      </div>
    );
  }
  // Ключ: другой сеанс или другой язык — черновик заключения собирается заново
  return <Report key={`${session.id}-${locale}`} session={session} patient={patient} complete={complete} ws={ws} all={sessions} />;
}

function Report({ session, patient, complete, all, ws }: { session: Session; patient: Patient; complete: boolean; all: Session[]; ws: string }) {
  const { t, f } = useI18n();
  const getRaw = useAppStore((s) => s.getRaw);
  const addNote = useAppStore((s) => s.addNote);
  const updateNote = useAppStore((s) => s.updateSessionNote);
  const toast = useAppStore((s) => s.toast);
  const focus = focusSide(patient.affectedSide);
  const prev = previousSession(all, session);

  const exercises = EXERCISE_IDS.filter((ex) => stepOf(session, ex, 'left') || stepOf(session, ex, 'right'));
  const symEx = exercises.find((ex) => sessionSymmetry(session, ex, patient.affectedSide) !== null) ?? null;
  const sym = symEx ? sessionSymmetry(session, symEx, patient.affectedSide) : null;
  const prevSym = symEx && prev ? sessionSymmetry(prev, symEx, patient.affectedSide) : null;
  const cons = consistency(session);

  const [summary, setSummary] = useState(() => buildSummary(t, f, session, patient, all));
  const [note, setNote] = useState(session.note);

  const rows: BarPairRow[] = exercises.map((ex) => {
    const pl = previousWith(all, session, ex, 'left');
    const pr = previousWith(all, session, ex, 'right');
    return {
      id: ex,
      label: t(`exercise.${ex}.short`),
      left: stepOf(session, ex, 'left')?.rom ?? null,
      right: stepOf(session, ex, 'right')?.rom ?? null,
      prevLeft: pl ? stepOf(pl, ex, 'left')?.rom ?? null : null,
      prevRight: pr ? stepOf(pr, ex, 'right')?.rom ?? null : null,
    };
  });
  const maxRom = Math.max(180, ...rows.flatMap((r) => [r.left ?? 0, r.right ?? 0]));

  const exportRaw = async () => {
    const frames = await getRaw(session.id);
    if (!frames?.length) {
      toast('warn', t('report.noRaw'));
      return;
    }
    downloadText(exportName(session.demo, [patient.code, stamp(new Date(session.startedAt)), 'raw'], 'csv'), rawCsv(session, frames, patient.code), 'text/csv;charset=utf-8');
  };

  const events = session.events.filter((e) => ['calibration_moved', 'calibration_forced', 'calibration_pose', 'connection_lost', 'connection_restored', 'data_gap', 'sensor_lost', 'sensor_restored', 'mount_flipped', 'low_battery', 'step_skipped', 'session_stopped', 'pause', 'resume'].includes(e.kind));

  return (
    <div className="page report">
      {/* Момент результата: тест закончен — галочка «встаёт на место», ниже — главное о сеансе */}
      {complete && (
        <div className="done-banner" role="status">
          <span className="done-banner__mark" aria-hidden>
            <StatusRing state="done" size={30} />
          </span>
          <div className="done-banner__text">
            <strong>{t('report.completeTitle')}</strong>
          </div>
          <LinkButton variant="secondary" size="sm" href={href({ name: 'patient', id: patient.id, tab: 'overview' })}>
            {t('overview.openCard')}
          </LinkButton>
        </div>
      )}

      <PageHeader
        back={{ href: href({ name: 'patient', id: patient.id, tab: 'sessions' }), label: `${patient.code} · ${t('profile.tabs.sessions')}` }}
        title={t('report.title', { date: f.dateTime(session.startedAt) })}
        eyebrow={
          // Пометки — только об особом: повтор файла (не замер этого дня) и неполный сеанс.
          // Протокол и «Завершён» — обычное дело, о них не пишем
          session.device.kind === 'replay' || session.status !== 'completed' ? (
            <div className="row row--wrap" style={{ gap: 6, marginBottom: 8 }}>
              {session.device.kind === 'replay' && <span className="badge">{t('common.fromRecording')}</span>}
              {session.status !== 'completed' && <span className="badge badge--warn">{t('report.incomplete')}</span>}
            </div>
          ) : undefined
        }
        actions={
          <>
            <LinkButton href={href({ name: 'sessionPrint', id: session.id })} icon={<Printer />}>
              {t('common.print')}
            </LinkButton>
            <LinkButton href={href({ name: 'family', id: patient.id })} icon={<FileHeart />}>
              <span className="hide-sm">{t('profile.familyReport')}</span>
            </LinkButton>
          </>
        }
      />

      {/* Простой вид: главное одной фразой и градусы по каждому движению */}
      <SessionSummary session={session} patient={patient} all={all} />

      <Details hint={t('details.reportHint')}>
      <a className="patient-chip patient-chip--link" href={href({ name: 'patient', id: patient.id, tab: 'overview' })}>
        <PatientAvatar name={patient.code} demo={ws === 'demo'} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 650 }}>{patient.code}</div>
          <div className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
            {patientLine(t, patient)}
          </div>
        </div>
      </a>

      <div className="grid grid--kpi">
        <div className="card stat">
          <span className="stat__label">{t('report.kpi.duration')}</span>
          <span className="stat__value num">{f.duration(session.activeSec)}</span>
          <span className="stat__meta">
            {t('report.kpi.durationHint')} · {t('common.repsCount', { count: session.steps.reduce((n, s) => n + s.summary.reps.length, 0) })}
          </span>
        </div>
        <div className="card stat">
          <span className="stat__label">
            {t('report.kpi.symmetry')}
            <MetricInfo metric="symmetry" />
          </span>
          <span className="stat__value">{f.pct(sym)}</span>
          <span className="stat__meta">
            {symEx && t(`exercise.${symEx}.short`)}
            {sym !== null && prevSym !== null && <Delta value={sym - prevSym} unit="pp" threshold={2} suffix={t('common.vsPrevious')} />}
          </span>
        </div>
        <div className="card stat">
          <span className="stat__label">
            {t('report.kpi.consistency')}
            <MetricInfo metric="cv" />
          </span>
          <span className="stat__value">{f.pct(cons)}</span>
          <span className="stat__meta">{t('metric.cv')}</span>
        </div>
        <div className="card stat">
          <span className="stat__label">
            {t('report.kpi.quality')}
            <MetricInfo metric="quality" />
          </span>
          <span className="stat__value">{f.pct(session.quality.percent, 1)}</span>
          <span className="stat__meta">
            {session.quality.percent < 95 ? (
              <span className="quality-low row" style={{ gap: 4 }}>
                <TriangleAlert size={14} aria-hidden />
                {t('alert.severity.warning')}
              </span>
            ) : (
              `${t('device.lost')}: ${session.quality.lost}`
            )}
          </span>
        </div>
      </div>

      <section className="card">
        <div className="card__header">
          <div>
            <h2 className="card__title">{t('report.results')}</h2>
            <div className="card__subtitle">{t('report.resultsHint')}</div>
          </div>
        </div>
        <div className="card__body" style={{ paddingTop: 8 }}>
          <div className="table-wrap">
            <table className="table results-table">
              <thead>
                <tr>
                  <th>{t('report.table.exercise')}</th>
                  <th className="num">
                    <span className="side-key side-key--left" aria-hidden /> {t('report.table.left')}
                  </th>
                  <th className="num">
                    <span className="side-key side-key--right" aria-hidden /> {t('report.table.right')}
                  </th>
                  <th className="num">
                    {t('report.table.symmetry')} <MetricInfo metric="symmetry" />
                  </th>
                  <th className="num hide-sm">
                    {t('report.table.sparc')} <MetricInfo metric="sparc" />
                  </th>
                  <th className="num hide-md">
                    {t('report.table.trunk')} <MetricInfo metric="trunk" />
                  </th>
                  <th className="num">{t('report.table.change')}</th>
                </tr>
              </thead>
              <tbody>
                {exercises.map((ex) => {
                  const l = stepOf(session, ex, 'left');
                  const r = stepOf(session, ex, 'right');
                  const main = stepOf(session, ex, focus);
                  const p = previousWith(all, session, ex, focus);
                  const pm = p ? stepOf(p, ex, focus) : null;
                  const rot = EXERCISES[ex].reps === 'bidirectional';
                  const cell = (s: typeof l) =>
                    s ? (
                      <>
                        <span className="results-table__value">{f.deg(s.rom)}</span>
                        {rot && (
                          <span className="results-table__sub">
                            {f.deg(s.supination)} / {f.deg(s.pronation)}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="muted">–</span>
                    );
                  return (
                    <tr key={ex}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{t(`exercise.${ex}.name`)}</div>
                        {[l, r].some((s) => s?.flags.length) && (
                          <div className="results-table__flags">
                            {[l, r].flatMap((s) => (s ? s.flags.map((fl) => `${armLabel(t, s.side)}: ${t(`report.flags.${fl}`)}`) : [])).join('; ')}
                          </div>
                        )}
                      </td>
                      <td className="num">{cell(l)}</td>
                      <td className="num">{cell(r)}</td>
                      <td className="num">{f.pct(sessionSymmetry(session, ex, patient.affectedSide))}</td>
                      <td className="num hide-sm">
                        {f.num(l?.sparc, 2)} / {f.num(r?.sparc, 2)}
                      </td>
                      <td className="num hide-md">{EXERCISES[ex].trunk ? `${f.deg(l?.trunk ?? null)} / ${f.deg(r?.trunk ?? null)}` : '–'}</td>
                      <td className="num">{main && pm ? <Delta value={main.rom - pm.rom} threshold={3} /> : <span className="muted">–</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {hasRotation(exercises) && (
            <p className="field__hint" style={{ marginTop: 8 }}>
              {t('exercise.forearm_rotation.name')}: {t('metric.supination').toLowerCase()} / {t('metric.pronation').toLowerCase()}
            </p>
          )}
        </div>
      </section>

      <div className="grid grid--2">
        <ChartFrame
          title={t('report.romChart')}
          legend={[
            { label: t('side.leftArm'), color: 'var(--left)', kind: 'bar' },
            { label: t('side.rightArm'), color: 'var(--right)', kind: 'bar' },
            { label: t('run.previous'), color: 'var(--text)', kind: 'line' },
          ]}
          table={() => (
            <table className="table table--compact">
              <thead>
                <tr>
                  <th>{t('report.table.exercise')}</th>
                  <th className="num">{t('side.left')}</th>
                  <th className="num">{t('side.right')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.label}</td>
                    <td className="num">{f.deg(r.left)}</td>
                    <td className="num">{f.deg(r.right)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        >
          <BarPairs rows={rows} max={Math.ceil(maxRom / 30) * 30} ariaLabel={t('report.romChart')} />
        </ChartFrame>
        <section className="card">
          <div className="card__header">
            <h2 className="card__title">{t('report.comparison')}</h2>
            {prev && <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{t('report.comparisonFrom', { date: f.date(prev.startedAt) })}</span>}
          </div>
          <div className="card__body">
            {!prev ? (
              <p className="secondary">{t('report.noPrevious')}</p>
            ) : (
              <div className="compare-grid">
                {exercises.flatMap((ex) =>
                  (['left', 'right'] as Side[]).map((side) => {
                    const cur = stepOf(session, ex, side);
                    const p = previousWith(all, session, ex, side);
                    const ps = p ? stepOf(p, ex, side) : null;
                    if (!cur) return null;
                    const affected = patient.affectedSide === side || patient.affectedSide === 'both';
                    return (
                      <div key={`${ex}-${side}`} className={`compare${affected ? ' compare--focus' : ''}`}>
                        <div className="compare__label">
                          <span className={`side-key side-key--${side}`} aria-hidden /> {t(`exercise.${ex}.short`)} · {armLabel(t, side)}
                          {affected && <span className="muted"> · {t('side.affected')}</span>}
                        </div>
                        <div className="compare__values">
                          <span className="muted num">{ps ? f.deg(ps.rom) : '–'}</span>
                          <span aria-hidden className="muted">→</span>
                          <strong className="num">{f.deg(cur.rom)}</strong>
                          {ps && <Delta value={cur.rom - ps.rom} threshold={3} />}
                        </div>
                      </div>
                    );
                  }),
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="stack" style={{ gap: 12 }}>
        <h2 className="section-title">{t('report.detail')}</h2>
        <div className="grid grid--2">
          {session.steps.map((st, i) => {
            const s = st.summary;
            const def = EXERCISES[s.exercise];
            const color = s.side === 'left' ? 'var(--left)' : 'var(--right)';
            const rot = def.reps === 'bidirectional';
            return (
              <section key={i} className="card step-card">
                <div className="card__header">
                  <div>
                    <h3 className="card__title">
                      <span className={`side-key side-key--${s.side}`} aria-hidden /> {t(`exercise.${s.exercise}.name`)} · {armLabel(t, s.side)}
                    </h3>
                    <div className="card__subtitle">
                      {st.status === 'skipped' ? t('run.stepSkipped') : `${t('metric.median')} ${f.deg(s.rom)} · ${t('metric.best')} ${f.deg(s.romBest)} · ${t('common.repsCount', { count: s.reps.length })}`}
                    </div>
                  </div>
                  {s.flags.length > 0 && <span className="badge badge--warn">{s.flags.map((fl) => t(`report.flags.${fl}`)).join(', ')}</span>}
                </div>
                <div className="card__body stack" style={{ gap: 10 }}>
                  {st.trace.t.length > 1 && (
                    <TraceChart trace={st.trace} reps={s.reps} color={color} range={rot ? [-90, 90] : [0, def.gauge.max]} ariaLabel={`${t('report.trace')}: ${t(`exercise.${s.exercise}.name`)}`} />
                  )}
                  {s.reps.length > 0 && (
                    <div className="table-wrap">
                    <table className="table table--compact">
                      <thead>
                        <tr>
                          <th>{t('report.rep')}</th>
                          <th className="num">{rot ? `${t('metric.supination')} / ${t('metric.pronation')}` : t('metric.romShort')}</th>
                          <th className="num">{t('metric.sparcShort')}</th>
                          <th className="num hide-md">{t('metric.peakVelocity')}</th>
                          <th className="num hide-md">{t('metric.repDuration')}</th>
                          {def.trunk && <th className="num">{t('metric.trunkShort')}</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {s.reps.map((r) => (
                          <tr key={r.index}>
                            <td>{r.index + 1}</td>
                            <td className="num">{rot ? `${f.deg(r.supination)} / ${f.deg(r.pronation)}` : f.deg(r.rom)}</td>
                            <td className="num">{f.num(r.sparc, 2)}</td>
                            <td className="num hide-md">{f.num(r.peakVelocity)} °/{t('common.sec')}</td>
                            <td className="num hide-md">
                              {f.num(r.duration, 1)} {t('common.sec')}
                            </td>
                            {def.trunk && <td className="num">{f.deg(r.trunk)}</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </section>

      <div className="grid grid--2">
        <section className="card">
          <div className="card__header">
            <div>
              <h2 className="card__title">{t('report.summary')}</h2>
              <div className="card__subtitle">{t('report.summaryHint')}</div>
            </div>
          </div>
          <div className="card__body stack" style={{ gap: 10 }}>
            <label className="sr-only" htmlFor="summary">
              {t('report.summary')}
            </label>
            <textarea id="summary" className="textarea summary-text" value={summary} onChange={(e) => setSummary(e.target.value)} rows={10} />
            <div>
              <Button
                icon={<Save />}
                onClick={() => {
                  addNote({ patientId: patient.id, sessionId: session.id, author: currentClinician(), text: summary.trim(), kind: 'summary' });
                  toast('good', t('report.summarySaved'));
                }}
              >
                {t('report.saveSummary')}
              </Button>
            </div>
          </div>
        </section>

        <div className="stack" style={{ gap: 16 }}>
          <section className="card">
            <div className="card__header">
              <h2 className="card__title">{t('report.note')}</h2>
            </div>
            <div className="card__body stack" style={{ gap: 10 }}>
              <label className="sr-only" htmlFor="note">
                {t('report.note')}
              </label>
              <textarea id="note" className="textarea" value={note} placeholder={t('report.notePlaceholder')} onChange={(e) => setNote(e.target.value)} />
              <div>
                <Button
                  variant="primary"
                  icon={<Save />}
                  disabled={note === session.note}
                  onClick={() => {
                    updateNote(session.id, note);
                    toast('good', t('report.noteSaved'));
                  }}
                >
                  {t('common.save')}
                </Button>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card__header">
              <h2 className="card__title">{t('report.quality')}</h2>
            </div>
            <div className="card__body stack" style={{ gap: 14 }}>
              <dl className="kv">
                <dt>{t('report.device')}</dt>
                <dd>{session.device.name}</dd>
                <dt>{t('device.format')}</dt>
                <dd className="mono">{session.device.format}</dd>
                <dt>{t('report.algorithm')}</dt>
                <dd className="mono">{session.algorithmVersion}</dd>
                <dt>{t('report.received')}</dt>
                <dd>{session.quality.received}</dd>
                <dt>{t('report.lost')}</dt>
                <dd>{session.quality.lost}</dd>
                <dt>{t('report.saturated')}</dt>
                <dd>{session.quality.saturated}</dd>
                <dt>{t('report.calibrations')}</dt>
                <dd>{session.calibrationAttempts}</dd>
                {session.calibrationPose && (
                  <>
                    <dt>{t('report.calPose')}</dt>
                    <dd>
                      {Object.entries(session.calibrationPose).filter(([p, v]) => p !== 'trunk' && (v ?? 0) >= CAL_POSE_WARN_DEG).length
                        ? Object.entries(session.calibrationPose)
                            .filter(([p, v]) => p !== 'trunk' && (v ?? 0) >= CAL_POSE_WARN_DEG)
                            .map(([p, v]) => `${t(`device.placementLong.${p as Placement}`)} ${v}°`)
                            .join(', ')
                        : t('report.calPoseOk')}
                    </dd>
                  </>
                )}
                {session.device.accCal && Object.keys(session.device.accCal).length > 0 && (
                  <>
                    <dt>{t('report.accCal')}</dt>
                    <dd>{Object.keys(session.device.accCal).map((p) => t(`device.placementLong.${p as Placement}`)).join(', ')}</dd>
                  </>
                )}
                {session.device.moduleIds && Object.keys(session.device.moduleIds).length > 0 && (
                  <>
                    <dt>{t('report.modules')}</dt>
                    <dd className="mono">
                      {Object.entries(session.device.moduleIds)
                        .map(([p, id]) => `${t(`device.placementLong.${p as Placement}`)} ${id === 'none' ? '–' : id}`)
                        .join(', ')}
                    </dd>
                  </>
                )}
                <dt>{t('report.clinician')}</dt>
                <dd>{session.clinician || '–'}</dd>
              </dl>
              <div>
                <Button icon={<Download />} onClick={() => void exportRaw()} disabled={!session.hasRaw} title={session.hasRaw ? t('report.exportCsvHint') : t('report.noRaw')}>
                  {t('report.exportCsv')}
                </Button>
                <div className="field__hint" style={{ marginTop: 6 }}>
                  {session.hasRaw ? t('report.exportCsvHint') : t('report.noRaw')}
                </div>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card__header">
              <h2 className="card__title">{t('report.events')}</h2>
            </div>
            <div className="card__body">
              {events.length === 0 ? (
                <p className="secondary">{t('report.noEvents')}</p>
              ) : (
                <ol className="events">
                  {events.map((e, i) => (
                    <li key={i}>
                      <span className="events__t num">{f.duration(e.t)}</span>
                      <span>
                        {t(`event.${e.kind}`, {
                          step: (e.step ?? 0) + 1,
                          value: e.value ?? '',
                          place: (e.kind === 'sensor_lost' || e.kind === 'mount_flipped') && PLACEMENTS[e.value ?? -1] ? t(`device.placementLong.${PLACEMENTS[e.value ?? -1] as Placement}`) : '',
                        })}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>
        </div>
      </div>
      {/* Оговорка «не медицинское изделие» — в подробностях и на печатном листе */}
      <p className="muted report__disclaimer">{t('app.disclaimer')}</p>
      </Details>
    </div>
  );
}

function hasRotation(exercises: readonly string[]): boolean {
  return exercises.includes('forearm_rotation');
}
