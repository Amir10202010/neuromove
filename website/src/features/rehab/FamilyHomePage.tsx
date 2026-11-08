// Family workspace: the professional's plan in plain words. Families see the activities assigned for
// home, record what happened (including "not done" — a normal answer), report difficulty, fatigue or
// discomfort, add what matters at home, and read summaries the professional chose to share.
// Nothing here is a measurement, and nothing here changes the program.

import { ArrowLeft, Baby, CalendarDays, Check, HeartHandshake, MessageCircle, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { href } from '../../app/router';
import { useI18n } from '../../i18n';
import { LanguageSwitch } from '../../layout/LanguageSwitch';
import { familyInput } from '../../rehab/goals';
import { BARRIERS, type Assignment, type Barrier, type Completion, type PracticeRecord } from '../../rehab/model';
import { allAssignments } from '../../rehab/programs';
import { reportPractice } from '../../rehab/workflows';
import { Button } from '../../ui/Button';
import { useActor, useIsCaregiverAccount, useSave, useXT } from './common';
import { activityByKey, useParticipant, useRehabLoaded } from './data';
import { useEnsureDemo } from './demo';
import { StepIconView } from './icons';

export function FamilyHomePage({ id }: { id: string }) {
  const { xt, L } = useXT();
  const { f } = useI18n();
  useRehabLoaded();
  useEnsureDemo();
  const data = useParticipant(id);
  const actor = useActor('family', id);
  const caregiverAccount = useIsCaregiverAccount();
  const save = useSave();
  const [reporting, setReporting] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [goalNote, setGoalNote] = useState<Record<string, string>>({});
  const { patient, program } = data;
  if (!patient || (caregiverAccount && !actor.participantIds.includes(id))) {
    return (
      <main className="family-shell" tabIndex={-1}>
        <div className="family-card">
          <p>{xt('This page is not available.')}</p>
        </div>
      </main>
    );
  }
  const home = program ? allAssignments(program.def).filter((a) => a.setting === 'home') : [];
  const summaries = data.notes.filter((n) => n.kind === 'summary').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const mine = data.practice.filter((p) => p.setting === 'home').slice(0, 8);

  const sendNote = async () => {
    if (!note.trim()) return;
    const { practice } = reportPractice({ participantId: id, programKey: program?.id ?? null, assignmentId: null, activityKey: null, setting: 'home', source: 'caregiver_report', completion: null, difficulty: false, breakRequested: false, fatigue: null, discomfort: null, barriers: [], durationMin: null, observation: note }, patient.workspace, actor.name, 'caregiver');
    if (await save([practice], actor)) setNote('');
  };

  return (
    <main className="family-shell" tabIndex={-1}>
      <header className="family-top">
        <div className="family-top__who">
          <HeartHandshake aria-hidden />
          <div>
            <div className="family-top__title">{xt('Home practice')}</div>
            <div className="family-top__child">{patient.code}</div>
          </div>
        </div>
        <div className="row row--wrap">
          <LanguageSwitch />
          <a className="btn btn--primary btn--lg" href={href({ name: 'childPlay', id })}>
            <Baby aria-hidden /> {xt('Child mode')}
          </a>
        </div>
      </header>
      {patient.workspace === 'demo' && <div className="callout callout--demo family-wide">{xt('Demo: an invented child and invented reports.')}</div>}

      <section className="family-card family-card--calm">
        <p className="family-lead">{xt('These are the activities your therapist chose for home. Do what feels right for your child today. Missing a day is fine — just tell us what happened.')}</p>
        <p className="family-safety">
          <ShieldAlert aria-hidden /> {xt('If your child feels pain, stop. Never continue through pain. Tell your therapist in the report below.')}
        </p>
      </section>

      <section aria-labelledby="fam-acts">
        <h2 id="fam-acts" className="family-h2">
          {xt('Activities for home')}
        </h2>
        {home.length === 0 && <div className="family-card">{xt('No home activities assigned yet.')}</div>}
        {home.map((a) => {
          const act = activityByKey(data.activities, a.activityKey);
          if (!act) return null;
          return (
            <article key={a.id} className="family-card activity-card">
              <h3 className="activity-card__title">
                {act.def.name} {act.status === 'experimental' && <span className="badge badge--warn">{L.activityStatus.experimental}</span>}
              </h3>
              {act.def.caregiverInstructions && <p>{act.def.caregiverInstructions}</p>}
              {act.def.steps.length > 0 && (
                <ol className="rh-step-strip">
                  {act.def.steps.map((s, i) => (
                    <li key={i}>
                      <StepIconView icon={s.icon} size={40} />
                      <span>{s.text}</span>
                    </li>
                  ))}
                </ol>
              )}
              <p className="muted">
                {a.frequencyPerWeek !== null && xt('About {n} times a week', { n: a.frequencyPerWeek })}
                {a.frequencyPerWeek !== null && a.durationMin !== null && ' · '}
                {a.durationMin !== null && xt('about {n} minutes', { n: a.durationMin })}
              </p>
              {a.caregiverNote && <p className="family-note">{a.caregiverNote}</p>}
              {act.def.safetyNotes && (
                <p className="family-safety small">
                  <ShieldAlert aria-hidden /> {act.def.safetyNotes}
                </p>
              )}
              {reporting === a.id ? (
                <ReportForm
                  assignment={a}
                  onCancel={() => setReporting(null)}
                  onSave={async (r) => {
                    const { practice, incidents } = reportPractice({ ...r, participantId: id, programKey: program!.id, assignmentId: a.id, activityKey: a.activityKey, setting: 'home', source: 'caregiver_report' }, patient.workspace, actor.name, 'caregiver');
                    if (await save([practice, ...incidents], actor)) setReporting(null);
                  }}
                />
              ) : (
                <Button variant="primary" size="lg" onClick={() => setReporting(a.id)}>
                  {xt('Tell us how it went')}
                </Button>
              )}
            </article>
          );
        })}
      </section>

      <section className="family-card" aria-labelledby="fam-msg">
        <h2 id="fam-msg" className="family-h2">
          <MessageCircle aria-hidden className="rh-inline-icon" /> {xt('Tell your therapist something')}
        </h2>
        <label className="sr-only" htmlFor="fam-note">
          {xt('Your message')}
        </label>
        <textarea id="fam-note" className="textarea family-text" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={xt('What did you notice at home?')} />
        <Button variant="primary" size="lg" disabled={!note.trim()} onClick={() => void sendNote()}>
          {xt('Send')}
        </Button>
      </section>

      <section className="family-card" aria-labelledby="fam-goals">
        <h2 id="fam-goals" className="family-h2">
          {xt('Our goals')}
        </h2>
        {data.goals.length === 0 && <p className="muted">{xt('Your therapist will set goals together with you.')}</p>}
        <ul className="family-goals">
          {data.goals.map((g) => (
            <li key={g.id}>
              <div className="family-goals__head">
                <strong>{g.description}</strong> <span className="badge badge--outline">{L.goalStatus[g.status]}</span>
              </div>
              {g.whyItMatters && <p className="muted">“{g.whyItMatters}”</p>}
              <div className="row row--wrap">
                <input className="input rh-grow" aria-label={xt('Add what matters at home')} placeholder={xt('Add what matters at home')} value={goalNote[g.id] ?? ''} onChange={(e) => setGoalNote({ ...goalNote, [g.id]: e.target.value })} />
                <Button disabled={!goalNote[g.id]?.trim()} onClick={async () => { if (await save([familyInput(g, actor.name, goalNote[g.id]!.trim())], actor)) setGoalNote({ ...goalNote, [g.id]: '' }); }}>
                  {xt('Add')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <div className="family-grid">
        <section className="family-card" aria-labelledby="fam-sum">
          <h2 id="fam-sum" className="family-h2">
            {xt('From your therapist')}
          </h2>
          {summaries.length === 0 ? (
            <p className="muted">{xt('No messages yet.')}</p>
          ) : (
            <ul className="rh-plain-list">
              {summaries.map((n) => (
                <li key={n.id}>
                  <span className="muted">{f.date(n.createdAt)}</span>
                  <p>{n.text}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="family-card" aria-labelledby="fam-up">
          <h2 id="fam-up" className="family-h2">
            <CalendarDays aria-hidden className="rh-inline-icon" /> {xt('Coming up')}
          </h2>
          <ul className="rh-plain-list">
            <li>
              {xt('Next visit')}: <strong>{patient.nextVisit ? f.dateTime(patient.nextVisit) : '—'}</strong>
            </li>
            <li>
              {xt('Next review of the plan')}: <strong>{program?.def.reviewDate ? f.date(program.def.reviewDate) : '—'}</strong>
            </li>
          </ul>
        </section>
      </div>

      <section className="family-card" aria-labelledby="fam-hist">
        <h2 id="fam-hist" className="family-h2">
          {xt('What you told us recently')}
        </h2>
        {mine.length === 0 ? (
          <p className="muted">{xt('Nothing yet.')}</p>
        ) : (
          <ul className="rh-plain-list">
            {mine.map((p) => (
              <li key={p.id}>
                <span className="muted">{f.dateCompact(p.date)}</span> · {p.activityKey ? (activityByKey(data.activities, p.activityKey)?.def.name ?? '') : xt('Message')} {p.completion && `· ${L.completion[p.completion]}`}
              </li>
            ))}
          </ul>
        )}
      </section>

      {!caregiverAccount && (
        <footer className="family-foot">
          <a href={href({ name: 'rehabParticipant', id, tab: 'family', review: null })} className="text-link">
            <ArrowLeft aria-hidden className="rh-inline-icon" /> {xt('For the therapist')}
          </a>
        </footer>
      )}
    </main>
  );
}

type ReportFields = Pick<PracticeRecord, 'completion' | 'difficulty' | 'breakRequested' | 'fatigue' | 'discomfort' | 'barriers' | 'durationMin' | 'observation'>;

function ReportForm({ assignment, onSave, onCancel }: { assignment: Assignment; onSave: (r: ReportFields) => Promise<void>; onCancel: () => void }) {
  const { xt, L } = useXT();
  const [r, setR] = useState<ReportFields>({ completion: null, difficulty: false, breakRequested: false, fatigue: null, discomfort: null, barriers: [], durationMin: assignment.durationMin, observation: '' });
  const set = <K extends keyof ReportFields>(k: K, v: ReportFields[K]) => setR({ ...r, [k]: v });
  const COMPLETIONS: Completion[] = ['completed', 'partial', 'not_completed', 'stopped'];
  return (
    <div className="report-form">
      <fieldset className="rh-big-choice">
        <legend>{xt('How did it go?')}</legend>
        {COMPLETIONS.map((c) => (
          <button key={c} type="button" className={`rh-big-choice__opt${r.completion === c ? ' is-on' : ''}`} aria-pressed={r.completion === c} onClick={() => set('completion', c)}>
            {r.completion === c && <Check aria-hidden />} {L.completion[c]}
          </button>
        ))}
      </fieldset>
      {(r.completion === 'not_completed' || r.completion === 'partial' || r.completion === 'stopped') && (
        <fieldset className="chips">
          <legend>{xt('What got in the way? (optional)')}</legend>
          {BARRIERS.map((b: Barrier) => (
            <label key={b} className={`chip rh-chip rh-chip--lg${r.barriers.includes(b) ? ' is-on' : ''}`}>
              <input type="checkbox" checked={r.barriers.includes(b)} onChange={(e) => set('barriers', e.target.checked ? [...r.barriers, b] : r.barriers.filter((x) => x !== b))} />
              {L.barrier[b]}
            </label>
          ))}
        </fieldset>
      )}
      <fieldset className="rh-big-choice">
        <legend>{xt('How tired was your child?')}</legend>
        {([0, 1, 2, 3] as const).map((v) => (
          <button key={v} type="button" className={`rh-big-choice__opt${r.fatigue === v ? ' is-on' : ''}`} aria-pressed={r.fatigue === v} onClick={() => set('fatigue', v)}>
            <span className={`rh-face rh-face--${v}`} aria-hidden />
            {L.fatigue[v]}
          </button>
        ))}
      </fieldset>
      <fieldset className="rh-big-choice">
        <legend>{xt('Any discomfort?')}</legend>
        {(['none', 'some', 'pain'] as const).map((v) => (
          <button key={v} type="button" className={`rh-big-choice__opt${r.discomfort === v ? ' is-on' : ''}${v === 'pain' ? ' big-choice__opt--pain' : ''}`} aria-pressed={r.discomfort === v} onClick={() => set('discomfort', v)}>
            {L.discomfort[v]}
          </button>
        ))}
      </fieldset>
      {r.discomfort === 'pain' && (
        <div className="callout callout--critical" role="alert">
          <ShieldAlert aria-hidden />
          <div>{xt('Please stop the activity. Your therapist will see this report and get in touch. If the pain is strong or does not pass, contact a doctor.')}</div>
        </div>
      )}
      <div className="row row--wrap">
        <label className="checkbox rh-checkbox--lg">
          <input type="checkbox" checked={r.difficulty} onChange={(e) => set('difficulty', e.target.checked)} />
          {xt('It was difficult')}
        </label>
        <label className="checkbox rh-checkbox--lg">
          <input type="checkbox" checked={r.breakRequested} onChange={(e) => set('breakRequested', e.target.checked)} />
          {xt('My child asked for a break')}
        </label>
      </div>
      <label className="field__label" htmlFor={`min-${assignment.id}`}>
        {xt('Minutes (about)')}
      </label>
      <input id={`min-${assignment.id}`} className="input rh-input--short" type="number" min={0} max={600} value={r.durationMin ?? ''} onChange={(e) => set('durationMin', e.target.value === '' ? null : Number(e.target.value))} />
      <label className="field__label" htmlFor={`obs-${assignment.id}`}>
        {xt('Anything you noticed (optional)')}
      </label>
      <textarea id={`obs-${assignment.id}`} className="textarea family-text" rows={2} value={r.observation} onChange={(e) => set('observation', e.target.value)} />
      <div className="row row--wrap">
        <Button size="lg" onClick={onCancel}>
          {xt('Cancel')}
        </Button>
        <Button size="lg" variant="primary" disabled={r.completion === null} onClick={() => void onSave(r)}>
          {xt('Save report')}
        </Button>
      </div>
    </div>
  );
}
