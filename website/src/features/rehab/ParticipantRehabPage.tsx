// One child's rehabilitation page: profile, goals, program and its history, timeline, movement
// analytics, assessments, family reports and professional review — one continuous history.

import { Baby, HeartHandshake } from 'lucide-react';
import { useState } from 'react';
import { href, navigate, type RehabTab } from '../../app/router';
import { useI18n } from '../../i18n';
import { PageHeader } from '../../layout/PageHeader';
import { CLASSIFICATION_SYSTEMS, GOAL_CATEGORIES, type RehabProfile } from '../../rehab/model';
import { unreviewed } from '../../rehab/progress';
import { buildTimeline } from '../../rehab/timeline';
import { newProfile } from '../../rehab/workflows';
import { Button, LinkButton } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { Field } from '../../ui/Field';
import { Tabs } from '../../ui/Tabs';
import { SourceBadge, useActor, useSave, useXT } from './common';
import { useParticipant, useRehabLoaded, type ParticipantData } from './data';
import { useEnsureDemo } from './demo';
import { AssessmentsTab } from './AssessmentsTab';
import { FamilyTab } from './FamilyTab';
import { GoalsTab } from './GoalsTab';
import { MovementTab } from './MovementTab';
import { ProgramTab } from './ProgramTab';
import { ReviewTab } from './ReviewTab';
import { ChildSettings } from './ChildSettings';
import { CaregiverAccounts } from './CaregiverAccounts';

export function ParticipantRehabPage({ id, tab, reviewId }: { id: string; tab: RehabTab; reviewId: string | null }) {
  const { xt } = useXT();
  const loaded = useRehabLoaded();
  useEnsureDemo();
  const data = useParticipant(id);
  const { patient } = data;
  if (!patient) return <EmptyState title={xt('Participant not found')} action={<LinkButton href={href({ name: 'rehab' })}>{xt('Rehabilitation')}</LinkButton>} />;
  const forReview = data.observations.filter((o) => o.severity === 'review').length;
  const openReports = unreviewed(data.practice, data.reviews).length + data.incidents.filter((i) => i.review === null).length;
  const go = (t: RehabTab) => navigate({ name: 'rehabParticipant', id, tab: t, review: null }, { replace: true });
  return (
    <div className="page">
      <PageHeader
        back={{ href: href({ name: 'rehab' }), label: xt('Rehabilitation') }}
        title={patient.code}
        lead={data.program ? `${data.program.def.name} · v${data.program.version}` : xt('No program yet')}
        actions={
          <>
            <LinkButton href={href({ name: 'familyHome', id })} icon={<HeartHandshake />}>
              {xt('Family view')}
            </LinkButton>
            <LinkButton href={href({ name: 'childPlay', id })} icon={<Baby />}>
              {xt('Child mode')}
            </LinkButton>
          </>
        }
      />
      {data.demo && <div className="callout callout--demo">{xt('Demo workspace: an invented child; sensor sessions are simulated.')}</div>}
      <Tabs
        label={xt('Sections')}
        value={tab}
        onChange={go}
        items={[
          { id: 'overview', label: xt('Profile') },
          { id: 'goals', label: xt('Goals'), count: data.goals.length },
          { id: 'program', label: xt('Program') },
          { id: 'timeline', label: xt('Timeline') },
          { id: 'movement', label: xt('Movement') },
          { id: 'assessments', label: xt('Assessments'), count: data.assessments.length },
          { id: 'family', label: xt('Family'), ...(openReports ? { count: openReports } : {}) },
          { id: 'review', label: xt('Review'), ...(forReview ? { count: forReview } : {}) },
        ]}
      />
      {!loaded ? (
        <div className="card card__body muted">{xt('Loading…')}</div>
      ) : (
        <div className="rh-tab-panel" role="tabpanel">
          {tab === 'overview' && <ProfileTab data={data} />}
          {tab === 'goals' && <GoalsTab data={data} />}
          {tab === 'program' && <ProgramTab data={data} reviewId={reviewId} />}
          {tab === 'timeline' && <TimelineTab data={data} />}
          {tab === 'movement' && <MovementTab data={data} />}
          {tab === 'assessments' && <AssessmentsTab data={data} />}
          {tab === 'family' && <FamilyTab data={data} />}
          {tab === 'review' && <ReviewTab data={data} />}
        </div>
      )}
    </div>
  );
}

function ProfileTab({ data }: { data: ParticipantData }) {
  const { xt, L } = useXT();
  const { t } = useI18n();
  const actor = useActor('professional');
  const save = useSave();
  const patient = data.patient!;
  const ws = patient.workspace;
  const base = data.profile ?? newProfile(patient.id, ws, actor.name);
  const [draft, setDraft] = useState<RehabProfile>(base);
  const [cls, setCls] = useState({ system: 'GMFCS' as RehabProfile['classifications'][number]['system'], level: '' });
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  const set = <K extends keyof RehabProfile>(k: K, v: RehabProfile[K]) => setDraft({ ...draft, [k]: v });
  const submit = async () => {
    const at = new Date().toISOString();
    await save([{ ...draft, updatedAt: at, updatedBy: actor.name }], actor);
  };
  return (
    <div className="grid grid--2">
      <section className="card">
        <div className="card__header">
          <h2 className="card__title">{xt('Rehabilitation profile')}</h2>
          <span className="muted small">{xt('Pseudonymous. Keep personal data to the minimum the work needs.')}</span>
        </div>
        <div className="card__body stack">
          <dl className="kv">
            <dt>{xt('Code')}</dt>
            <dd>{patient.code}</dd>
            <dt>{xt('Birth year')}</dt>
            <dd>{patient.birthYear}</dd>
            <dt>{xt('Affected side')}</dt>
            <dd>{t(`side.${patient.affectedSide}` as never)}</dd>
          </dl>
          <Field label={xt('Assigned professional')}>
            <input className="input" value={draft.assignedProfessional} onChange={(e) => set('assignedProfessional', e.target.value)} />
          </Field>
          <fieldset className="chips" aria-label={xt('Rehabilitation domains')}>
            <legend className="field__label">{xt('Rehabilitation domains')}</legend>
            {GOAL_CATEGORIES.map((c) => (
              <label key={c} className={`chip rh-chip${draft.domains.includes(c) ? ' is-on' : ''}`}>
                <input type="checkbox" checked={draft.domains.includes(c)} onChange={(e) => set('domains', e.target.checked ? [...draft.domains, c] : draft.domains.filter((x) => x !== c))} />
                {L.goalCategory[c]}
              </label>
            ))}
          </fieldset>
          <Field label={xt('Caregiver participation')}>
            <select className="select" value={draft.caregiverParticipation} onChange={(e) => set('caregiverParticipation', e.target.value as RehabProfile['caregiverParticipation'])}>
              <option value="not_set">{xt('Not set')}</option>
              <option value="none">{xt('None')}</option>
              <option value="occasional">{xt('Occasional')}</option>
              <option value="regular">{xt('Regular')}</option>
            </select>
          </Field>
          <Field label={xt('Relevant assessment information')} hint={xt('Entered by an authorised professional. NeuroMove does not diagnose or classify.')}>
            <textarea className="textarea" rows={4} value={draft.assessmentSummary} onChange={(e) => set('assessmentSummary', e.target.value)} />
          </Field>
          <div>
            <div className="field__label">{xt('Classifications entered by a professional')}</div>
            <ul className="rh-plain-list">
              {draft.classifications.map((c, i) => (
                <li key={i}>
                  <strong>{c.label}</strong> {c.level} <span className="muted small">— {c.enteredBy}</span>
                </li>
              ))}
            </ul>
            <div className="row row--wrap">
              <select className="select" aria-label={xt('System')} value={cls.system} onChange={(e) => setCls({ ...cls, system: e.target.value as typeof cls.system })}>
                {CLASSIFICATION_SYSTEMS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <input className="input rh-input--short" aria-label={xt('Level')} value={cls.level} onChange={(e) => setCls({ ...cls, level: e.target.value })} />
              <Button size="sm" disabled={!cls.level.trim()} onClick={() => { set('classifications', [...draft.classifications, { system: cls.system, label: cls.system, level: cls.level.trim(), enteredBy: actor.name, at: new Date().toISOString() }]); setCls({ ...cls, level: '' }); }}>
                {xt('Add')}
              </Button>
            </div>
          </div>
        </div>
        <div className="card__footer">
          <Button variant="primary" disabled={!dirty && !!data.profile} onClick={() => void submit()}>
            {data.profile ? xt('Save profile') : xt('Create profile')}
          </Button>
        </div>
      </section>
      <div className="stack">
        <ChildSettings value={draft.child} onChange={(child) => set('child', child)} />
        <CaregiverAccounts participantId={patient.id} />
      </div>
    </div>
  );
}

function TimelineTab({ data }: { data: ParticipantData }) {
  const { xt, L } = useXT();
  const { f } = useI18n();
  const [filter, setFilter] = useState<'all' | 'imu' | 'reported' | 'instrument' | 'professional'>('all');
  const tl = buildTimeline({ sessions: data.sessions, practice: data.practice, assessments: data.assessments, reviews: data.reviews, programs: data.programs, goals: data.goals, incidents: data.incidents, notes: data.notes }).filter((e) => filter === 'all' || e.source === filter);
  const title = (e: (typeof tl)[number]): string => {
    switch (e.type) {
      case 'sensor_session':
        return `${xt('Sensor session')} · ${xt('signal')} ${e.facts.signal} %`;
      case 'practice':
        return `${xt('Practice')} (${L.setting[e.setting ?? 'home']}) · ${L.completion[e.facts.completion as keyof typeof L.completion] ?? ''}${e.facts.measured ? ` · ${xt('linked to a sensor session')}` : ''}`;
      case 'observation':
        return xt('Family observation');
      case 'assessment':
        return `${e.facts.instrument} · ${L.timepoint[e.facts.timepoint as keyof typeof L.timepoint]}`;
      case 'review':
        return `${xt('Professional review')} · ${L.decision[e.facts.decision as keyof typeof L.decision]}`;
      case 'program_version':
        return `${xt('Program version')} ${e.facts.version}: ${e.facts.name}${e.facts.fromReview ? ` · ${xt('from a review')}` : ''}`;
      case 'goal_event':
        return `${xt('Goal')} · ${xt(String(e.facts.event))}${e.facts.status ? ` → ${L.goalStatus[e.facts.status as keyof typeof L.goalStatus]}` : ''}`;
      case 'incident':
        return `${L.incidentType[e.facts.incident as keyof typeof L.incidentType]}${e.facts.reviewed ? ` · ${xt('reviewed')}` : ` · ${xt('not reviewed yet')}`}`;
      case 'note':
        return e.facts.noteKind === 'summary' ? xt('Family summary published') : xt('Clinical note');
    }
  };
  return (
    <section className="card">
      <div className="card__header">
        <h2 className="card__title">{xt('Timeline')}</h2>
        <div className="row row--wrap">
          {(['all', 'imu', 'reported', 'instrument', 'professional'] as const).map((s) => (
            <button key={s} type="button" className={`chip rh-chip${filter === s ? ' is-on' : ''}`} onClick={() => setFilter(s)} aria-pressed={filter === s}>
              {s === 'all' ? xt('All') : L.source[s]}
            </button>
          ))}
        </div>
      </div>
      {tl.length === 0 ? (
        <div className="card__body muted">{xt('Nothing recorded yet.')}</div>
      ) : (
        <ol className="rh-timeline">
          {tl.map((e, i) => (
            <li key={`${e.ref.id}:${i}`} className={`rh-timeline__item rh-timeline__item--${e.source}`}>
              <span className="rh-timeline__date num">{f.dateCompact(e.at)}</span>
              <SourceBadge source={e.source} />
              {e.simulated && <span className="badge badge--demo">{xt('simulated')}</span>}
              <span>{title(e)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
