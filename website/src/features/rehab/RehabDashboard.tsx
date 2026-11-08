// Professional workspace: what needs a professional's attention, then every participant with their
// program, next review and open items. Operational, not decorative: every line links to the place
// where it is handled.

import { BookOpen, ClipboardList, FlaskConical, ShieldAlert } from 'lucide-react';
import { useMemo } from 'react';
import { href, navigate } from '../../app/router';
import { useI18n } from '../../i18n';
import { PageHeader } from '../../layout/PageHeader';
import { analyze, unreviewed } from '../../rehab/progress';
import { currentProgram } from '../../rehab/programs';
import { ofKind, useRehabStore } from '../../rehab/store';
import { useWorkspaceData } from '../../state/appStore';
import { LinkButton } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { useObservationText, useXT } from './common';
import { useRehabLoaded } from './data';
import { useEnsureDemo } from './demo';

export function RehabDashboard() {
  const { xt, L } = useXT();
  const { f } = useI18n();
  const loaded = useRehabLoaded();
  useEnsureDemo();
  const { ws, patients, sessions } = useWorkspaceData();
  const records = useRehabStore((s) => s.records);
  const text = useObservationText();

  const rows = useMemo(() => {
    const now = new Date();
    return patients
      .filter((p) => p.status !== 'discharged')
      .map((p) => {
        const profile = ofKind(records, 'profile', ws, p.id)[0] ?? null;
        const goals = ofKind(records, 'goal', ws, p.id);
        const programs = ofKind(records, 'program', ws).filter((x) => x.participantId === p.id);
        const program = currentProgram(programs, p.id);
        const practice = ofKind(records, 'practice', ws, p.id);
        const incidents = ofKind(records, 'incident', ws, p.id);
        const reviews = ofKind(records, 'review', ws, p.id);
        const assessments = ofKind(records, 'assessment', ws, p.id);
        const mine = sessions.filter((s) => s.patientId === p.id);
        const obs = analyze({ participantId: p.id, now, demo: ws === 'demo', profile, goals, program, practice, incidents, reviews, assessments, sessions: mine });
        const lastHome = [...practice].filter((x) => x.setting === 'home').sort((a, b) => b.date.localeCompare(a.date))[0];
        return { p, profile, goals, program, obs, unreviewedReports: unreviewed(practice, reviews).length, lastHome, lastSession: [...mine].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] };
      })
      .sort((a, b) => b.obs.filter((o) => o.severity === 'review').length - a.obs.filter((o) => o.severity === 'review').length);
  }, [patients, records, sessions, ws]);

  const attention = rows.flatMap((r) => r.obs.filter((o) => o.severity === 'review' || o.category === 'data_quality').map((o) => ({ r, o })));
  const safety = attention.filter((a) => a.o.category === 'safety');

  return (
    <div className="page">
      <PageHeader
        title={xt('Rehabilitation')}
        lead={xt('Functional goals, individual programs, home practice and professional review. Analytical observations support review; they never change a program.')}
        actions={
          <>
            <LinkButton href={href({ name: 'rehabActivities' })} icon={<BookOpen />}>
              {xt('Activity library')}
            </LinkButton>
            <LinkButton href={href({ name: 'rehabStudies' })} icon={<FlaskConical />}>
              {xt('Studies')}
            </LinkButton>
          </>
        }
      />
      {ws === 'demo' && <div className="callout callout--demo">{xt('Demo workspace: invented children and simulated sensor sessions. Nothing here is a measurement of a real child.')}</div>}

      {safety.length > 0 && (
        <div className="callout callout--critical" role="alert">
          <ShieldAlert aria-hidden />
          <div>
            <div className="callout__title">{xt('Safety reports need professional review')}</div>
            {safety.map(({ r }) => (
              <div key={r.p.id}>
                <a href={href({ name: 'rehabParticipant', id: r.p.id, tab: 'family', review: null })}>
                  {r.p.code} — {xt('open the family tab')}
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid--main-side">
        <section className="card">
          <div className="card__header">
            <h2 className="card__title">{xt('Participants')}</h2>
          </div>
          {!loaded ? (
            <div className="card__body muted">{xt('Loading…')}</div>
          ) : rows.length === 0 ? (
            <EmptyState title={xt('No participants yet')} text={xt('Add a participant on the Patients page, then open their rehabilitation page here.')} />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{xt('Participant')}</th>
                    <th>{xt('Professional')}</th>
                    <th>{xt('Current program')}</th>
                    <th>{xt('Next review')}</th>
                    <th className="num">{xt('Goals')}</th>
                    <th>{xt('Last home report')}</th>
                    <th className="num">{xt('Unreviewed')}</th>
                    <th className="num">{xt('For review')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.p.id} className="is-clickable" tabIndex={0} onClick={() => navigate({ name: 'rehabParticipant', id: r.p.id, tab: 'overview', review: null })} onKeyDown={(e) => e.key === 'Enter' && navigate({ name: 'rehabParticipant', id: r.p.id, tab: 'overview', review: null })}>
                      <td>
                        <a href={href({ name: 'rehabParticipant', id: r.p.id, tab: 'overview', review: null })} onClick={(e) => e.stopPropagation()}>
                          {r.p.code}
                        </a>
                      </td>
                      <td>{r.profile?.assignedProfessional || <span className="muted">—</span>}</td>
                      <td>
                        {r.program ? (
                          <>
                            {r.program.def.name} <span className="muted">v{r.program.version}</span>{' '}
                            {r.program.def.status !== 'active' && <span className="badge badge--outline">{L.programStatus[r.program.def.status]}</span>}
                          </>
                        ) : (
                          <span className="muted">{xt('none')}</span>
                        )}
                      </td>
                      <td className="num">{r.program?.def.reviewDate ? f.dateCompact(r.program.def.reviewDate) : '—'}</td>
                      <td className="num">
                        {r.goals.filter((g) => g.status === 'in_progress').length}/{r.goals.length}
                      </td>
                      <td className="num">{r.lastHome ? `${f.dateCompact(r.lastHome.date)} · ${r.lastHome.completion ? L.completion[r.lastHome.completion] : xt('observation')}` : '—'}</td>
                      <td className="num">{r.unreviewedReports || '—'}</td>
                      <td className="num">{r.obs.filter((o) => o.severity === 'review').length ? <span className="badge badge--warn">{r.obs.filter((o) => o.severity === 'review').length}</span> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <div className="card__header">
            <h2 className="card__title">
              <ClipboardList aria-hidden className="rh-inline-icon" /> {xt('Needs attention')}
            </h2>
            <span className="muted small">{xt('Rule-based observations for professional review. Not diagnoses, not recommendations.')}</span>
          </div>
          {attention.length === 0 ? (
            <div className="card__body muted">{xt('Nothing waiting for review.')}</div>
          ) : (
            <ul className="rh-obs-list">
              {attention.slice(0, 30).map(({ r, o }) => {
                const tx = text(o);
                return (
                  <li key={`${r.p.id}:${o.id}`} className={`rh-obs rh-obs--${o.category}`}>
                    <a href={href({ name: 'rehabParticipant', id: r.p.id, tab: o.category === 'safety' ? 'family' : 'review', review: null })}>
                      <strong>{r.p.code}</strong> · {tx.title}
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
