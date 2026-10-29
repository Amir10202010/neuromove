import { ArrowRight, CalendarClock, CheckCircle2, FlaskConical, Play, Plus, UserPlus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { href, navigate } from '../../website/router';
import { RaiseProgress } from '../../charts/MoveFigures';
import { Sparkline } from '../../charts/Sparkline';
import type { Patient, Session } from '../../data/models';
import { StatusRing } from '../../figures/StatusRing';
import { useI18n } from '../../i18n';
import { PageHeader } from '../../layout/PageHeader';
import { useAppStore, useWorkspaceData } from '../../state/appStore';
import { focusSide, metricSeries, patientSessions } from '../../session/compare';
import { courseStory, shownDelta, TREND_THRESHOLD } from '../../session/story';
import { Button, LinkButton } from '../../ui/Button';
import { Delta } from '../../ui/Delta';
import { EmptyState } from '../../ui/EmptyState';
import { PatientAvatar } from '../../ui/PatientAvatar';
import { AlertRow } from '../common/AlertRow';
import { Details } from '../common/Details';
import { DeviceCard } from '../common/DeviceCard';
import { armLabel, greeting, isSameDay } from '../common/text';
import { startClinicDemo } from '../demo/clinicDemo';
import { PatientFormModal } from '../patients/PatientFormModal';

interface ScheduleItem {
  key: string;
  time: string;
  patient: Patient;
  session: Session | null;
  protocol: string | null;
}

/**
 * «Впервые здесь?» — для того, кто открыл демо сам, без гида: одна строка и одна кнопка,
 * которая проведёт по всему пути. Прячется навсегда — крестиком.
 */
function HelloCard() {
  const { t } = useI18n();
  const hide = useAppStore((s) => s.setHelloHidden);
  const [starting, setStarting] = useState(false);
  return (
    <section className="hello" aria-labelledby="hello-title">
      <span className="hello__icon" aria-hidden>
        <Play />
      </span>
      <div className="hello__body">
        <h2 id="hello-title" className="hello__title">
          {t('overview.hello.title')}
        </h2>
      </div>
      <Button
        variant="demo"
        icon={<Play />}
        loading={starting}
        onClick={() => {
          setStarting(true);
          startClinicDemo().catch(() => setStarting(false));
        }}
      >
        {t('overview.hello.cta')}
      </Button>
      <button type="button" className="hello__close" onClick={() => hide(true)} aria-label={t('overview.hello.hide')} title={t('overview.hello.hide')}>
        <X aria-hidden />
      </button>
    </section>
  );
}

/**
 * «Следующий пациент» — главное действие дня крупно: кто, во сколько, что с ним за курс
 * (одна фраза и рисунок по настоящим числам) и одна кнопка «Начать тест». Диагноз и протокол
 * здесь не повторяем: они в карточке, а человеку сейчас нужно понять, что делать первым.
 */
function NextUp({ item, sessions }: { item: ScheduleItem; sessions: readonly Session[] }) {
  const { t, f } = useI18n();
  const p = item.patient;
  const story = courseStory(sessions, p);
  const side = focusSide(p.affectedSide);
  let headline = t('overview.firstTest');
  if (story) {
    const delta = shownDelta(story.last, story.first);
    const key = delta >= TREND_THRESHOLD.rom ? 'up' : delta <= -TREND_THRESHOLD.rom ? 'down' : 'same';
    headline = t(`simple.course.${key}`, { arm: armLabel(t, side), value: Math.round(story.last), delta: Math.abs(delta) });
  }
  return (
    <section className="nextup" aria-labelledby="nextup-title">
      <div className="nextup__main">
        <span className="eyebrow">
          <StatusRing state="active" progress={0.12} size={14} />
          {t('overview.next')} · {t('overview.nextAt', { time: f.time(item.time) })}
        </span>
        <h2 id="nextup-title" className="nextup__who">
          <a href={href({ name: 'patient', id: p.id, tab: 'overview' })}>{p.code}</a>
        </h2>
        <p className="nextup__story">{headline}</p>
        <div className="nextup__actions">
          <LinkButton variant="primary" size="lg" href={href({ name: 'sessionNew', patientId: p.id, protocol: item.protocol })} iconRight={<ArrowRight />}>
            {t('overview.start')}
          </LinkButton>
          <LinkButton variant="ghost" href={href({ name: 'patient', id: p.id, tab: 'overview' })}>
            {t('overview.openCard')}
          </LinkButton>
        </div>
      </div>
      {story && (
        <div className="nextup__pic" aria-hidden>
          <RaiseProgress was={story.first} now={story.last} goal={story.goal?.target} side={side} labels={{ was: t('simple.fig.picWas'), goal: t('simple.fig.picGoal') }} ariaLabel="" />
        </div>
      )}
    </section>
  );
}

export function OverviewPage() {
  const { t, f } = useI18n();
  const { ws, patients, sessions, alerts, notes } = useWorkspaceData();
  const profile = useAppStore((s) => s.profile);
  const guideActive = useAppStore((s) => s.guide.active);
  const helloHidden = useAppStore((s) => s.settings.helloHidden);
  const [adding, setAdding] = useState(false);
  const setWorkspace = useAppStore((s) => s.setWorkspace);
  const now = new Date();
  // В демо приветствие без имени: «Добрый день» (специалист в демо — роль, а не человек)
  const name = ws === 'demo' ? '' : profile?.name ?? '';

  const schedule = useMemo<ScheduleItem[]>(() => {
    const items: ScheduleItem[] = [];
    const todaySessions = sessions.filter((s) => isSameDay(s.startedAt));
    for (const p of patients) {
      const done = todaySessions.find((s) => s.patientId === p.id) ?? null;
      if (p.nextVisit && isSameDay(p.nextVisit)) {
        items.push({ key: `v-${p.id}`, time: p.nextVisit, patient: p, session: done, protocol: p.nextProtocol });
      } else if (done) {
        items.push({ key: `s-${done.id}`, time: done.startedAt, patient: p, session: done, protocol: done.protocolId });
      }
    }
    return items.sort((a, b) => a.time.localeCompare(b.time));
  }, [patients, sessions]);

  const open = alerts.filter((a) => !a.acknowledged).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const active = patients.filter((p) => p.status === 'active');
  const last30 = sessions.filter((s) => now.getTime() - new Date(s.startedAt).getTime() < 30 * 86400000);
  const doneToday = schedule.filter((s) => s.session).length;
  // Кого звать следующим: первая кнопка «Начать тест» без отметки о проведённом тесте — главная
  const nextItem = schedule.find((s) => !s.session) ?? null;
  const nextKey = nextItem?.key ?? null;

  const progress = useMemo(
    () =>
      patients
        .map((p) => {
          const side = focusSide(p.affectedSide);
          const series = metricSeries(sessions, p, 'shoulder_flexion', side, 'rom');
          return { p, series };
        })
        .filter((x) => x.series.length > 0)
        .sort((a, b) => a.p.code.localeCompare(b.p.code)),
    [patients, sessions],
  );

  const activity = useMemo(() => {
    const items: { at: string; text: string; href: string; icon: 'session' | 'note' | 'goal' }[] = [];
    const code = (id: string) => patients.find((p) => p.id === id)?.code ?? '–';
    for (const s of sessions) items.push({ at: s.endedAt, text: t('activity.session', { protocol: t(`protocol.${s.protocolId}`), patient: code(s.patientId) }), href: href({ name: 'session', id: s.id, complete: false }), icon: 'session' });
    for (const n of notes) items.push({ at: n.createdAt, text: t('activity.note', { patient: code(n.patientId) }), href: href({ name: 'patient', id: n.patientId, tab: 'goals' }), icon: 'note' });
    for (const a of alerts.filter((x) => x.kind === 'goal_reached')) items.push({ at: a.createdAt, text: t('activity.goal', { patient: code(a.patientId) }), href: href({ name: 'patient', id: a.patientId, tab: 'overview' }), icon: 'goal' });
    return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
  }, [sessions, notes, alerts, patients, t]);

  const empty = patients.length === 0;

  const scheduleList =
    schedule.length === 0 ? (
      <EmptyState compact icon={<CalendarClock />} title={t('overview.scheduleEmpty')} text={t('overview.scheduleEmptyText')} />
    ) : (
      <ul className="schedule">
        {schedule.map((it) => (
          <li key={it.key} className={`schedule__item${it.session ? ' is-done' : it.key === nextKey ? ' is-next' : ''}`}>
            <StatusRing state={it.session ? 'done' : it.key === nextKey ? 'active' : 'todo'} progress={0.12} size={16} />
            <span className="sr-only">{it.session ? t('overview.stateDone') : it.key === nextKey ? t('overview.stateNext') : t('overview.stateLater')}</span>
            <span className="schedule__time num">{f.time(it.time)}</span>
            <PatientAvatar name={it.patient.code} demo={ws === 'demo'} />
            <div className="schedule__who">
              <a href={href({ name: 'patient', id: it.patient.id, tab: 'overview' })} className="schedule__code">
                {it.patient.code}
              </a>
            </div>
            {it.session ? (
              <LinkButton size="sm" variant="ghost" href={href({ name: 'session', id: it.session.id, complete: false })} icon={<CheckCircle2 />}>
                {t('overview.report')}
              </LinkButton>
            ) : (
              <LinkButton size="sm" variant="secondary" href={href({ name: 'sessionNew', patientId: it.patient.id, protocol: it.protocol })}>
                {t('overview.start')}
              </LinkButton>
            )}
          </li>
        ))}
      </ul>
    );

  return (
    <div className="page">
      {/* Главное действие экрана — «Начать тест» у следующего пациента; «Новый тест» всегда
          есть в боковой панели, поэтому в шапке его нет — две главные кнопки спорили бы */}
      <PageHeader
        title={name ? `${greeting(t, now)}, ${name}` : greeting(t, now)}
        lead={f.weekdayDate(now)}
        actions={
          empty ? undefined : (
            <LinkButton variant="secondary" href={href({ name: 'sessionNew', patientId: null })} icon={<Plus />}>
              {t('nav.newSession')}
            </LinkButton>
          )
        }
      />

      {ws === 'demo' && !guideActive && !helloHidden && <HelloCard />}

      {empty ? (
        <div className="grid grid--main-side">
          <section className="card">
            <div className="card__header">
              <h2 className="card__title">{t('overview.firstStepsTitle')}</h2>
            </div>
            <div className="card__body stack">
              <ol className="first-steps">
                <li>{t('overview.firstStep1')}</li>
                <li>{t('overview.firstStep2')}</li>
                <li>{t('overview.firstStep3')}</li>
              </ol>
              <div className="row row--wrap">
                <Button variant="primary" icon={<UserPlus />} onClick={() => setAdding(true)}>
                  {t('patients.add')}
                </Button>
                {ws === 'clinic' && (
                  <Button
                    icon={<FlaskConical />}
                    onClick={() => {
                      setWorkspace('demo');
                      navigate({ name: 'overview' });
                    }}
                  >
                    {t('overview.tryDemo')}
                  </Button>
                )}
              </div>
            </div>
          </section>
          <DeviceCard />
        </div>
      ) : (
        <>

          {/* Простой вид: кто сегодня, что требует внимания, как идут дела — словами */}
          <div className="grid grid--main-side">
            <div className="stack" style={{ gap: 16 }}>
              {nextItem ? (
                <NextUp item={nextItem} sessions={sessions} />
              ) : (
                <section className="nextup nextup--done" aria-live="polite">
                  <div className="nextup__main">
                    <span className="eyebrow">
                      <StatusRing state="done" size={14} />
                      {f.weekdayDate(now)}
                    </span>
                    <h2 className="nextup__who">{schedule.length > 0 ? t('overview.allDone') : t('overview.noVisits')}</h2>
                    <p className="nextup__story">{schedule.length > 0 ? t('overview.allDoneText') : t('overview.noVisitsText')}</p>
                    <div className="nextup__actions">
                      <LinkButton variant="primary" href={href({ name: 'sessionNew', patientId: null })} icon={<Plus />}>
                        {t('nav.newSession')}
                      </LinkButton>
                    </div>
                  </div>
                </section>
              )}

              <section className="card">
                <div className="card__header">
                  <h2 className="card__title">{t('overview.schedule')}</h2>
                  <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                    {schedule.length > 0 ? t('group.todayDone', { done: doneToday, total: schedule.length }) : f.dateShort(now)}
                  </span>
                </div>
                <div className="card__body" style={{ paddingTop: 8 }}>
                  {scheduleList}
                </div>
              </section>

            </div>

            <section className="card">
              <div className="card__header">
                <h2 className="card__title">{t('overview.alerts')}</h2>
                {open.length > 0 && <span className="badge badge--demo">{open.length}</span>}
              </div>
              <div className="card__body" style={{ paddingTop: 8 }}>
                {open.length === 0 ? (
                  <EmptyState compact icon={<CheckCircle2 />} title={t('overview.alertsEmpty')} text={t('overview.alertsEmptyText')} />
                ) : (
                  <div className="stack" style={{ gap: 4 }}>
                    {open.slice(0, 5).map((a) => (
                      <AlertRow key={a.id} alert={a} patient={patients.find((p) => p.id === a.patientId)} />
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>

          <Details hint={t('details.overviewHint')}>
            {/* Цифры дня — в подробностях: на главной они повторяли расписание и «Требуют внимания» */}
            <dl className="daystrip" aria-label={t('overview.dayStrip')}>
              <div>
                <dt>{t('overview.statToday')}</dt>
                <dd className="num">
                  {doneToday}
                  <small>{t('overview.statOf', { total: schedule.length })}</small>
                </dd>
              </div>
              <div>
                <dt>{t('overview.statPatients')}</dt>
                <dd className="num">{active.length}</dd>
              </div>
              <div>
                <dt>{t('overview.sessions30')}</dt>
                <dd className="num">{last30.length}</dd>
              </div>
              <div className={open.length > 0 ? 'is-attention' : undefined}>
                <dt>{t('overview.needAttention')}</dt>
                <dd className="num">{open.length}</dd>
              </div>
            </dl>
            <div className="grid grid--main-side">
              <div className="stack" style={{ gap: 16 }}>
                <section className="card">
                  <div className="card__header">
                    <div>
                      <h2 className="card__title">{t('overview.progress')}</h2>
                      <div className="card__subtitle">{t('overview.progressHint')}</div>
                    </div>
                    <a href={href({ name: 'analytics' })} className="text-link">
                      {t('nav.analytics')}
                    </a>
                  </div>
                  <div className="card__body" style={{ paddingTop: 8 }}>
                    {progress.length === 0 ? (
                      <EmptyState compact title={t('overview.progressEmpty')} />
                    ) : (
                      <div className="table-wrap">
                        <table className="table table--compact">
                          <thead>
                            <tr>
                              <th>{t('common.patient')}</th>
                              <th className="hide-sm num">{t('patients.col.sessions')}</th>
                              <th>{t('profile.dynamics')}</th>
                              <th className="num">{t('profile.currentValue')}</th>
                              <th className="num">{t('common.vsBaseline')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {progress.map(({ p, series }) => {
                              const first = series[0]?.value ?? NaN;
                              const last = series[series.length - 1]?.value ?? NaN;
                              return (
                                <tr key={p.id} className="is-clickable" tabIndex={0} onClick={() => navigate({ name: 'patient', id: p.id, tab: 'overview' })} onKeyDown={(e) => e.key === 'Enter' && navigate({ name: 'patient', id: p.id, tab: 'overview' })}>
                                  <td>
                                    <strong>{p.code}</strong>
                                  </td>
                                  <td className="hide-sm num">{patientSessions(sessions, p.id).length}</td>
                                  <td>
                                    <Sparkline values={series.map((s) => s.value)} color={focusSide(p.affectedSide) === 'left' ? 'var(--left)' : 'var(--right)'} />
                                  </td>
                                  <td className="num">{f.deg(last)}</td>
                                  <td className="num">{series.length > 1 ? <Delta value={last - first} threshold={3} /> : <span className="muted">–</span>}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </section>
              </div>

              <div className="stack" style={{ gap: 16 }}>
                <DeviceCard />

                <section className="card">
                  <div className="card__header">
                    <h2 className="card__title">{t('overview.activity')}</h2>
                  </div>
                  <div className="card__body" style={{ paddingTop: 8 }}>
                    {activity.length === 0 ? (
                      <EmptyState compact title={t('overview.activityEmpty')} />
                    ) : (
                      <ul className="activity">
                        {activity.map((a, i) => (
                          <li key={i}>
                            <span className={`activity__dot activity__dot--${a.icon}`} aria-hidden />
                            <a href={a.href}>{a.text}</a>
                            <span className="muted">{f.relative(a.at)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>
              </div>
            </div>
          </Details>
        </>
      )}
      <PatientFormModal open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
