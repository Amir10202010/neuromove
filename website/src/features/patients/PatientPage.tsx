import { Download, FileHeart, Pencil, Play, StickyNote, Target, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { href, navigate } from '../../website/router';
import { Sparkline } from '../../charts/Sparkline';
import { downloadText, exportName, metricsCsv, stamp } from '../../data/export';
import type { Patient, Session } from '../../data/models';
import { useI18n } from '../../i18n';
import { PageHeader } from '../../layout/PageHeader';
import { useAppStore, useWorkspaceData } from '../../state/appStore';
import { consistency, focusSide, metricSeries, patientSessions, sessionSymmetry, stepOf, weeksSince } from '../../session/compare';
import { Button, LinkButton } from '../../ui/Button';
import { Delta } from '../../ui/Delta';
import { EmptyState } from '../../ui/EmptyState';
import { EmptyArt } from '../../figures/EmptyArt';
import { MetricInfo, type MetricInfoKey } from '../../ui/MetricInfo';
import { ConfirmDialog } from '../../ui/Modal';
import { PatientAvatar } from '../../ui/PatientAvatar';
import { Tabs } from '../../ui/Tabs';
import { AlertRow } from '../common/AlertRow';
import { Details } from '../common/Details';
import { CourseSummary } from '../common/Summary';
import { patientLine } from '../common/text';
import { DynamicsChart } from './DynamicsChart';
import { GoalsModal } from './GoalsModal';
import { NotesPanel } from './NotesPanel';
import { PatientFormModal } from './PatientFormModal';

type Tab = 'overview' | 'sessions' | 'goals';

export function PatientPage({ id, tab }: { id: string; tab: Tab }) {
  const { t, f } = useI18n();
  const { ws, patients, sessions, alerts } = useWorkspaceData();
  const patient = patients.find((p) => p.id === id);
  const deletePatient = useAppStore((s) => s.deletePatient);
  const toast = useAppStore((s) => s.toast);
  const [editing, setEditing] = useState(false);
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const details = useAppStore((s) => s.settings.details);

  const list = useMemo(() => (patient ? patientSessions(sessions, patient.id) : []), [sessions, patient]);

  if (!patient) {
    return (
      <div className="page">
        <div className="card">
          <EmptyState
            art={<EmptyArt kind="lost" />}
            title={t('profile.notFound')}
            text={t('profile.notFoundText')}
            action={
              <LinkButton href={href({ name: 'patients' })} variant="primary">
                {t('nav.patients')}
              </LinkButton>
            }
          />
        </div>
      </div>
    );
  }

  const setTab = (next: Tab) => navigate({ name: 'patient', id, tab: next }, { replace: true });
  const courseWeeks = patient.courseStart ? Math.floor(weeksSince(patient.courseStart, new Date().toISOString())) + 1 : null;
  const myAlerts = alerts.filter((a) => a.patientId === patient.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="page">
      <PageHeader
        back={{ href: href({ name: 'patients' }), label: t('nav.patients') }}
        title={
          <span className="row" style={{ gap: 14 }}>
            <PatientAvatar name={patient.code} demo={ws === 'demo'} large />
            <span>
              <span className="row" style={{ gap: 8 }}>
                {patient.code}
                {/* «Активный курс» — обычное состояние: в простом виде не повторяем, особое (пауза, завершён) — показываем */}
                {(details || patient.status !== 'active') && <span className={`badge ${patient.status === 'active' ? 'badge--good' : ''}`}>{t(`patients.status.${patient.status}`)}</span>}
              </span>
              <span className="profile__line">{patientLine(t, patient, details)}</span>
            </span>
          </span>
        }
        actions={
          <>
            <LinkButton href={href({ name: 'family', id: patient.id })} icon={<FileHeart />}>
              <span className="hide-sm">{t('profile.familyReport')}</span>
            </LinkButton>
            <LinkButton variant="primary" href={href({ name: 'sessionNew', patientId: patient.id, protocol: patient.nextProtocol })} icon={<Play />} data-guide="start-test">
              {t('profile.startSession')}
            </LinkButton>
          </>
        }
      />

      {/* Курс, визит, правка, выгрузка и удаление — работа специалиста: в простом виде не мешают читать карточку */}
      {details && (
        <div className="profile__facts">
          <span>{patient.courseStart ? `${t('profile.courseSince', { date: f.date(patient.courseStart) })}${courseWeeks ? ` · ${t('profile.courseWeeks', { weeks: courseWeeks })}` : ''}` : t('profile.noSessionsTitle')}</span>
          <span>
            {t('profile.nextVisit')}: {patient.nextVisit ? f.dateTime(patient.nextVisit) : t('profile.noVisit')}
          </span>
          <span className="spacer" />
          <Button variant="ghost" size="sm" icon={<Pencil />} onClick={() => setEditing(true)}>
            {t('profile.editPatient')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Download />}
            onClick={() => {
              downloadText(exportName(patient.workspace === 'demo', [patient.code, stamp()], 'csv'), metricsCsv(list, [patient]), 'text/csv;charset=utf-8');
            }}
            disabled={!list.length}
          >
            <span className="hide-sm">{t('profile.exportData')}</span>
          </Button>
          <Button variant="ghost" size="sm" icon={<Trash2 />} onClick={() => setConfirmDelete(true)} aria-label={t('profile.deletePatient')} title={t('profile.deletePatient')} />
        </div>
      )}

      <Tabs<Tab>
        label={patient.code}
        value={tab}
        onChange={setTab}
        items={[
          { id: 'overview', label: t('profile.tabs.overview') },
          { id: 'sessions', label: t('profile.tabs.sessions'), count: list.length },
          { id: 'goals', label: t('profile.tabs.goals') },
        ]}
      />

      {tab === 'overview' &&
        (list.length === 0 ? (
          <div className="card">
            <EmptyState
              art={<EmptyArt kind="baseline" />}
              title={t('profile.noSessionsTitle')}
              text={t('profile.noSessionsText')}
              action={
                <LinkButton variant="primary" href={href({ name: 'sessionNew', patientId: patient.id, protocol: 'upper_standard' })} icon={<Play />}>
                  {t('profile.startBaseline')}
                </LinkButton>
              }
            />
          </div>
        ) : (
          <Overview patient={patient} list={list} onGoals={() => setGoalsOpen(true)} alerts={myAlerts} />
        ))}

      {tab === 'sessions' && <SessionsTable patient={patient} list={list} />}

      {tab === 'goals' && (
        <div className="grid grid--2">
          <GoalsCard patient={patient} list={list} onEdit={() => setGoalsOpen(true)} />
          <NotesPanel patient={patient} />
        </div>
      )}

      <PatientFormModal open={editing} onClose={() => setEditing(false)} patient={patient} />
      <GoalsModal open={goalsOpen} onClose={() => setGoalsOpen(false)} patient={patient} />
      <ConfirmDialog
        open={confirmDelete}
        danger
        title={t('patientForm.deleteTitle', { code: patient.code })}
        text={t('patientForm.deleteText')}
        confirmLabel={t('common.delete')}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          deletePatient(patient.id);
          toast('good', t('patientForm.deleted'));
          navigate({ name: 'patients' });
        }}
      />
    </div>
  );
}

function Overview({ patient, list, onGoals, alerts }: { patient: Patient; list: Session[]; onGoals: () => void; alerts: ReturnType<typeof useWorkspaceData>['alerts'] }) {
  const { t, f } = useI18n();
  const { sessions } = useWorkspaceData();
  const focus = focusSide(patient.affectedSide);
  const latest = list[list.length - 1] as Session;

  const tiles: { key: string; label: string; info: MetricInfoKey; values: number[]; unit: '°' | '%' | ''; digits: number; better: 'up' | 'down' }[] = [
    { key: 'rom', label: `${t('metric.romShort')} · ${t('exercise.shoulder_flexion.short')}`, info: 'rom', values: metricSeries(sessions, patient, 'shoulder_flexion', focus, 'rom').map((p) => p.value), unit: '°', digits: 0, better: 'up' },
    { key: 'sym', label: `${t('metric.symmetry')} · ${t('exercise.shoulder_flexion.short')}`, info: 'symmetry', values: metricSeries(sessions, patient, 'shoulder_flexion', focus, 'symmetry').map((p) => p.value), unit: '%', digits: 0, better: 'up' },
    { key: 'trunk', label: t('metric.trunk'), info: 'trunk', values: metricSeries(sessions, patient, 'shoulder_flexion', focus, 'trunk').map((p) => p.value), unit: '°', digits: 0, better: 'down' },
    { key: 'elbow', label: `${t('metric.romShort')} · ${t('exercise.elbow_flexion.short')}`, info: 'rom', values: metricSeries(sessions, patient, 'elbow_flexion', focus, 'rom').map((p) => p.value), unit: '°', digits: 0, better: 'up' },
  ];

  const fmt = (v: number | undefined, unit: string, digits: number) => (v === undefined ? '–' : unit === '%' ? f.pct(v, digits) : unit === '°' ? f.deg(v, digits) : f.num(v, digits));
  const flex = stepOf(latest, 'shoulder_flexion', focus);

  return (
    <div className="stack" style={{ gap: 16 }}>
      {/* Простой вид: главное словами. Наблюдения — сразу под ним: они про то, что требует внимания */}
      <CourseSummary patient={patient} all={sessions} latest={latest} />
      {alerts.length > 0 && (
        <section className="card">
          <div className="card__header">
            <h2 className="card__title">{t('profile.alertsTitle')}</h2>
          </div>
          <div className="card__body stack" style={{ gap: 4, paddingTop: 8 }}>
            {alerts.slice(0, 4).map((a) => (
              <AlertRow key={a.id} alert={a} showPatient={false} />
            ))}
          </div>
        </section>
      )}

      <Details hint={t('details.patientHint')}>
      <div className="grid grid--kpi">
        {tiles.map((tile) => {
          const v = tile.values;
          const cur = v[v.length - 1];
          const first = v[0];
          return (
            <div key={tile.key} className="card stat">
              <span className="stat__label">
                {tile.label}
                <MetricInfo metric={tile.info} />
              </span>
              <span className="stat__value">{fmt(cur, tile.unit, tile.digits)}</span>
              <span className="stat__meta">
                {v.length > 1 && cur !== undefined && first !== undefined ? (
                  <Delta value={cur - first} unit={tile.unit === '%' ? 'pp' : tile.unit} better={tile.better} threshold={tile.unit === '%' ? 2 : 2} suffix={t('common.vsBaseline')} />
                ) : (
                  <span>{t('profile.baselineValue')}</span>
                )}
                <span className="spacer" />
                <Sparkline values={v} width={64} height={24} color={focus === 'left' ? 'var(--left)' : 'var(--right)'} />
              </span>
            </div>
          );
        })}
      </div>

      <div className="grid grid--main-side">
        <DynamicsChart patient={patient} sessions={list} />
        <div className="stack" style={{ gap: 16 }}>
          <GoalsCard patient={patient} list={list} onEdit={onGoals} compact />
          <section className="card">
            <div className="card__header">
              <h2 className="card__title">{t('profile.latest')}</h2>
              <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{f.relative(latest.startedAt)}</span>
            </div>
            <div className="card__body stack" style={{ gap: 10 }}>
              <dl className="kv">
                <dt>{t('common.date')}</dt>
                <dd>{f.dateTime(latest.startedAt)}</dd>
                <dt>{t('report.protocol')}</dt>
                <dd>{t(`protocol.${latest.protocolId}`)}</dd>
                <dt>{t('exercise.shoulder_flexion.short')}</dt>
                <dd>{flex ? f.deg(flex.rom) : '–'}</dd>
                <dt>{t('metric.symmetry')}</dt>
                <dd>{f.pct(sessionSymmetry(latest, 'shoulder_flexion', patient.affectedSide))}</dd>
                <dt>{t('metric.consistency')}</dt>
                <dd>{f.pct(consistency(latest))}</dd>
                <dt>{t('metric.quality')}</dt>
                <dd>{f.pct(latest.quality.percent, 1)}</dd>
              </dl>
              <LinkButton href={href({ name: 'session', id: latest.id, complete: false })} size="sm">
                {t('profile.openReport')}
              </LinkButton>
            </div>
          </section>
        </div>
      </div>
      </Details>
    </div>
  );
}

function GoalsCard({ patient, list, onEdit, compact }: { patient: Patient; list: Session[]; onEdit: () => void; compact?: boolean }) {
  const { t, f } = useI18n();
  const latest = list[list.length - 1];
  const baseline = list[0];
  return (
    <section className="card">
      <div className="card__header">
        <h2 className="card__title">{t('profile.goals')}</h2>
        <Button variant="ghost" size="sm" icon={<Target />} onClick={onEdit}>
          {patient.goals.length ? t('common.edit') : t('profile.addGoal')}
        </Button>
      </div>
      <div className="card__body stack" style={{ gap: 14, paddingTop: 10 }}>
        {patient.goals.length === 0 ? (
          <p className="secondary" style={{ fontSize: 'var(--fs-sm)' }}>
            {t('profile.noGoalsText')}
          </p>
        ) : (
          patient.goals.map((g) => {
            const cur = latest ? stepOf(latest, g.exercise, g.side)?.rom : undefined;
            const base = baseline ? stepOf(baseline, g.exercise, g.side)?.rom : undefined;
            const from = base ?? 0;
            const pct = cur !== undefined ? Math.max(0, Math.min(100, ((cur - from) / Math.max(1, g.targetRom - from)) * 100)) : 0;
            return (
              <div key={g.id} className="goal">
                <div className="row row--between" style={{ alignItems: 'baseline' }}>
                  <span className="goal__title">
                    {t(`exercise.${g.exercise}.name`)}, {g.side === 'left' ? t('side.leftArm').toLowerCase() : t('side.rightArm').toLowerCase()}
                  </span>
                  <span className="num" style={{ fontWeight: 600 }}>
                    {cur !== undefined ? t('profile.goalProgress', { current: Math.round(cur), target: g.targetRom }) : `${g.targetRom}°`}
                  </span>
                </div>
                <div className="progress" style={{ marginTop: 8 }} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
                  <div className="progress__bar" style={{ width: `${g.achievedAt ? 100 : pct}%`, background: g.achievedAt ? 'var(--good)' : undefined }} />
                </div>
                <div className="goal__meta">
                  {g.achievedAt ? (
                    <span className="badge badge--good">{t('profile.goalReached', { date: f.dateShort(g.achievedAt) })}</span>
                  ) : g.dueDate ? (
                    <span>{t('profile.goalDue', { date: f.date(g.dueDate) })}</span>
                  ) : null}
                  {!compact && base !== undefined && (
                    <span>
                      {t('profile.baselineValue')}: {f.deg(base)}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function SessionsTable({ patient, list }: { patient: Patient; list: Session[] }) {
  const { t, f } = useI18n();
  const focus = focusSide(patient.affectedSide);
  const rows = [...list].reverse();
  if (!rows.length) {
    return (
      <div className="card">
        <EmptyState title={t('profile.noSessionsTitle')} text={t('profile.noSessionsText')} />
      </div>
    );
  }
  return (
    <section className="card">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t('sessions.col.date')}</th>
              <th>{t('sessions.col.protocol')}</th>
              <th className="num hide-sm">{t('sessions.col.duration')}</th>
              <th className="num">{t('sessions.col.key')}</th>
              <th className="num hide-sm">{t('metric.symmetry')}</th>
              <th className="num hide-md">{t('metric.trunk')}</th>
              <th className="num hide-sm">{t('sessions.col.quality')}</th>
              <th>{t('sessions.col.status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => {
              const flex = stepOf(s, 'shoulder_flexion', focus);
              const prev = rows[i + 1];
              const prevFlex = prev ? stepOf(prev, 'shoulder_flexion', focus) : null;
              const go = () => navigate({ name: 'session', id: s.id, complete: false });
              return (
                <tr key={s.id} className="is-clickable" tabIndex={0} onClick={go} onKeyDown={(e) => e.key === 'Enter' && go()}>
                  <td>
                    <div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{f.dateCompact(s.startedAt)}</div>
                    <div className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                      {f.time(s.startedAt)}
                      {s.note && <StickyNote size={12} style={{ display: 'inline', marginLeft: 6, verticalAlign: '-1px' }} aria-label={t('report.note')} />}
                    </div>
                  </td>
                  <td>{t(`protocol.${s.protocolId}`)}</td>
                  <td className="num hide-sm">{f.duration(s.activeSec)}</td>
                  <td className="num">
                    {flex ? (
                      <span className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                        {f.deg(flex.rom)}
                        {prevFlex && <Delta value={flex.rom - prevFlex.rom} threshold={3} />}
                      </span>
                    ) : (
                      '–'
                    )}
                  </td>
                  <td className="num hide-sm">{f.pct(sessionSymmetry(s, 'shoulder_flexion', patient.affectedSide))}</td>
                  <td className="num hide-md">{f.deg(flex?.trunk ?? null)}</td>
                  <td className="num hide-sm">
                    <span className={s.quality.percent < 95 ? 'quality-low' : ''}>{f.pct(s.quality.percent, 1)}</span>
                  </td>
                  <td>
                    {s.status === 'completed' ? <span className="badge badge--good">{t('report.completed')}</span> : <span className="badge badge--warn">{t('report.incomplete')}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
