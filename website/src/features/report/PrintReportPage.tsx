// Отчёт для печати и PDF: A4, чёрно-белая печать читается, «ДЕМО» — водяным знаком.
// PDF — через печать браузера («Сохранить как PDF»): библиотека не нужна (софт.md).

import { ArrowLeft, Printer } from 'lucide-react';
import { href } from '../../website/router';
import { BarPairs } from '../../charts/BarPairs';
import { TimeSeriesChart } from '../../charts/TimeSeriesChart';
import { EXERCISES, EXERCISE_IDS } from '../../core/exercises';
import { ALGORITHM_VERSION, APP_VERSION } from '../../core/version';
import { useI18n } from '../../i18n';
import { useWorkspaceData } from '../../state/appStore';
import { focusSide, metricSeries, previousWith, sessionSymmetry, stepOf } from '../../session/compare';
import { Button, LinkButton } from '../../ui/Button';
import { LogoMark } from '../../ui/Logo';
import { armLabel, patientLine, roman } from '../common/text';

export function PrintReportPage({ id }: { id: string }) {
  const { t, f } = useI18n();
  const { sessions, patients } = useWorkspaceData();
  const session = sessions.find((s) => s.id === id);
  const patient = session ? patients.find((p) => p.id === session.patientId) : undefined;
  if (!session || !patient) {
    return (
      <div className="print-page">
        <div className="print-toolbar">
          <LinkButton href={href({ name: 'sessions' })} icon={<ArrowLeft />}>
            {t('common.back')}
          </LinkButton>
        </div>
        <p style={{ padding: 24 }}>{t('report.notFound')}</p>
      </div>
    );
  }
  const focus = focusSide(patient.affectedSide);
  const exercises = EXERCISE_IDS.filter((ex) => stepOf(session, ex, 'left') || stepOf(session, ex, 'right'));
  const trendEx = exercises.includes('shoulder_flexion') ? 'shoulder_flexion' : exercises[0];
  // Отчёт за дату — только сеансы до неё включительно: позже сделанные сюда не относятся
  const upToThis = sessions.filter((x) => x.startedAt <= session.startedAt);
  const trend = trendEx ? metricSeries(upToThis, patient, trendEx, focus, 'rom') : [];
  const goal = trendEx ? patient.goals.find((g) => g.exercise === trendEx && g.side === focus) : undefined;

  return (
    <div className="print-page">
      <div className="print-toolbar">
        <LinkButton href={href({ name: 'session', id: session.id, complete: false })} icon={<ArrowLeft />}>
          {t('common.back')}
        </LinkButton>
        <span className="spacer" />
        <Button variant="primary" icon={<Printer />} onClick={() => window.print()}>
          {t('report.printButton')}
        </Button>
      </div>

      <article className="sheet">
        {session.demo && (
          <div className="sheet__watermark" aria-hidden>
            {t('report.printDemoWatermark')}
          </div>
        )}
        <header className="sheet__head">
          <div className="row" style={{ gap: 10 }}>
            <LogoMark size={30} />
            <div>
              <div className="sheet__brand">NeuroMove</div>
              <div className="sheet__muted">{t('app.tagline')}</div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <h1 className="sheet__title">{t('report.printTitle')}</h1>
            <div className="sheet__muted">
              {f.date(session.startedAt)}, {f.time(session.startedAt)}
            </div>
            {session.device.kind === 'replay' && <div className="sheet__muted">{t('common.fromRecording')}</div>}
          </div>
        </header>

        <section className="sheet__grid">
          <div>
            <h2 className="sheet__h2">{t('report.printPatient')}</h2>
            <dl className="sheet__kv">
              <dt>{t('patientForm.code')}</dt>
              <dd>
                <strong>{patient.code}</strong>
              </dd>
              <dt>{t('patients.col.form')}</dt>
              <dd>{patientLine(t, patient, false)}</dd>
              <dt>GMFCS / MACS</dt>
              <dd>
                {roman(patient.gmfcs)} / {roman(patient.macs)}
              </dd>
              {patient.courseStart && (
                <>
                  <dt>{t('patientForm.courseStart')}</dt>
                  <dd>{f.date(patient.courseStart)}</dd>
                </>
              )}
            </dl>
          </div>
          <div>
            <h2 className="sheet__h2">{t('report.printSession')}</h2>
            <dl className="sheet__kv">
              <dt>{t('report.protocol')}</dt>
              <dd>{t(`protocol.${session.protocolId}`)}</dd>
              <dt>{t('report.kpi.duration')}</dt>
              <dd>{f.duration(session.activeSec)}</dd>
              <dt>{t('metric.quality')}</dt>
              <dd>{f.pct(session.quality.percent, 1)}</dd>
              <dt>{t('report.device')}</dt>
              <dd>{session.device.name}</dd>
              <dt>{t('report.clinician')}</dt>
              <dd>{session.clinician || '–'}</dd>
            </dl>
          </div>
        </section>

        <section>
          <h2 className="sheet__h2">{t('report.results')}</h2>
          <div className="sheet__scroll">
            <table className="sheet__table">
              <thead>
                <tr>
                  <th>{t('report.table.exercise')}</th>
                  <th>{t('report.table.left')}, °</th>
                  <th>{t('report.table.right')}, °</th>
                  <th>{t('report.table.symmetry')}</th>
                  <th>{t('report.table.sparc')}</th>
                  <th>{t('report.table.trunk')}</th>
                  <th>{t('report.table.change')}</th>
                </tr>
              </thead>
              <tbody>
                {exercises.map((ex) => {
                  const l = stepOf(session, ex, 'left');
                  const r = stepOf(session, ex, 'right');
                  const main = stepOf(session, ex, focus);
                  const p = previousWith(sessions, session, ex, focus);
                  const pm = p ? stepOf(p, ex, focus) : null;
                  return (
                    <tr key={ex}>
                      <td>{t(`exercise.${ex}.name`)}</td>
                      <td>{l ? f.num(l.rom) : '–'}</td>
                      <td>{r ? f.num(r.rom) : '–'}</td>
                      <td>{f.pct(sessionSymmetry(session, ex, patient.affectedSide))}</td>
                      <td>
                        {f.num(l?.sparc, 2)} / {f.num(r?.sparc, 2)}
                      </td>
                      <td>{EXERCISES[ex].trunk ? `${f.num(l?.trunk ?? null)} / ${f.num(r?.trunk ?? null)}` : '–'}</td>
                      <td>{main && pm ? `${f.deltaDeg(main.rom - pm.rom)} (${armLabel(t, focus).toLowerCase()})` : '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="sheet__muted" style={{ marginTop: 6 }}>
            {t('report.resultsHint')}. {t('metric.info.sparc.formula')}.{exercises.includes('forearm_rotation') ? ` ${t('report.rotationArc')}` : ''}
          </p>
        </section>

        <section className="sheet__grid">
          <div>
            <h2 className="sheet__h2">{t('report.romChart')}</h2>
            <BarPairs
              rows={exercises.map((ex) => ({ id: ex, label: t(`exercise.${ex}.short`), left: stepOf(session, ex, 'left')?.rom ?? null, right: stepOf(session, ex, 'right')?.rom ?? null }))}
              ariaLabel={t('report.romChart')}
            />
          </div>
          <div>
            <h2 className="sheet__h2">{trendEx ? t('report.trendChart', { exercise: t(`exercise.${trendEx}.name`).toLowerCase() }) : ''}</h2>
            {trend.length > 0 && (
              <TimeSeriesChart
                series={[{ id: 'main', label: armLabel(t, focus), color: focus === 'left' ? 'var(--left)' : 'var(--right)', points: trend.map((p) => ({ t: new Date(p.date).getTime(), v: p.value })) }]}
                goal={goal ? { value: goal.targetRom, label: `${t('run.goal')} ${goal.targetRom}°` } : null}
                height={190}
                ariaLabel={t('profile.dynamics')}
              />
            )}
          </div>
        </section>

        {session.note && (
          <section>
            <h2 className="sheet__h2">{t('report.note')}</h2>
            <p className="sheet__note">{session.note}</p>
          </section>
        )}

        <section className="sheet__sign">
          <span>{t('report.printSignature')}</span>
          <span className="sheet__line" />
          <span>{session.clinician}</span>
        </section>

        <footer className="sheet__foot">
          <p>{t('app.disclaimer')}</p>
          <p>{t('report.printGenerated', { version: APP_VERSION, algo: session.algorithmVersion || ALGORITHM_VERSION })}</p>
        </footer>
      </article>
    </div>
  );
}
