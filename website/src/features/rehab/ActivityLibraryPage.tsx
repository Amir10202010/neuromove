// Activity Library: professional-authored activities, each save an immutable version; separated into
// clinician-approved, experimental and draft. No AI generation of exercises.

import { Plus, Save, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { href } from '../../app/router';
import { EXERCISE_IDS } from '../../core/exercises';
import { useI18n } from '../../i18n';
import { PageHeader } from '../../layout/PageHeader';
import { ACTIVITY_MEASUREMENTS, ACTIVITY_STATUSES, GOAL_CATEGORIES, MOVEMENT_DOMAINS, STEP_ICONS, type ActivityDef, type ActivityStatus, type ActivityVersion } from '../../rehab/model';
import { checkActivity, emptyActivity, historyOf, latestBySeries, newActivityVersion, type ActivityProblem } from '../../rehab/programs';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { Field } from '../../ui/Field';
import { exerciseLabel, useActor, useSave, useXT } from './common';
import { useLibrary, useRehabLoaded } from './data';
import { useEnsureDemo } from './demo';
import { StepIconView } from './icons';
import { useAppStore } from '../../state/appStore';

const PROBLEMS: Record<ActivityProblem, string> = {
  name_required: 'A name is required.',
  imu_exercise_required: 'Choose which sensor movement the IMU session measures.',
  caregiver_instructions_required: 'A home activity needs instructions for the family before it can be approved or marked experimental.',
  steps_required: 'A home activity needs at least one visual step.',
};

const STATUS_BADGE: Record<ActivityStatus, string> = { draft: 'badge--outline', experimental: 'badge--warn', clinician_approved: 'badge--good' };

export function ActivityLibraryPage() {
  const { xt, L, locale } = useXT();
  const { f, t } = useI18n();
  useRehabLoaded();
  useEnsureDemo();
  const ws = useAppStore((s) => s.settings.workspace);
  const actor = useActor('professional');
  const save = useSave();
  const { activities } = useLibrary();
  const [filter, setFilter] = useState<ActivityStatus | 'all'>('all');
  const latest = useMemo(() => latestBySeries(activities).sort((a, b) => a.def.name.localeCompare(b.def.name)), [activities]);
  const shown = latest.filter((a) => filter === 'all' || a.status === filter);
  const [edit, setEdit] = useState<{ seriesId?: string; def: ActivityDef; status: ActivityStatus; note: string } | null>(null);
  const problems = edit ? checkActivity(edit.def, edit.status) : [];
  const setD = <K extends keyof ActivityDef>(k: K, v: ActivityDef[K]) => edit && setEdit({ ...edit, def: { ...edit.def, [k]: v } });

  const submit = async () => {
    if (!edit) return;
    const v = newActivityVersion(activities, { seriesId: edit.seriesId, def: edit.def, status: edit.status, changeNote: edit.note, workspace: ws, author: actor.name, authorRole: 'professional' });
    if (!v) return setEdit(null);
    if (await save([v], actor)) setEdit({ seriesId: v.seriesId, def: structuredClone(v.def), status: v.status, note: '' });
  };

  return (
    <div className="page">
      <PageHeader back={{ href: href({ name: 'rehab' }), label: xt('Rehabilitation') }} title={xt('Activity library')} lead={xt('Activities written by rehabilitation professionals. Each save is a new version; programs keep the version they assigned. Drafts cannot be assigned.')} />
      <div className="grid grid--side-main">
        <section className="card">
          <div className="card__header">
            <div className="row row--wrap">
              {(['all', ...ACTIVITY_STATUSES] as const).map((s) => (
                <button key={s} type="button" className={`chip rh-chip${filter === s ? ' is-on' : ''}`} aria-pressed={filter === s} onClick={() => setFilter(s)}>
                  {s === 'all' ? xt('All') : L.activityStatus[s]}
                </button>
              ))}
            </div>
            <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setEdit({ def: emptyActivity(locale), status: 'draft', note: '' })}>
              {xt('New activity')}
            </Button>
          </div>
          {shown.length === 0 ? (
            <EmptyState compact title={xt('No activities')} />
          ) : (
            <ul className="vplist">
              {shown.map((a) => (
                <li key={a.id}>
                  <button type="button" className={`vplist__item${edit?.seriesId === a.seriesId ? ' is-active' : ''}`} onClick={() => setEdit({ seriesId: a.seriesId, def: structuredClone(a.def), status: a.status, note: '' })}>
                    <strong>{a.def.name}</strong>
                    <span className="muted small">
                      <span className={`badge ${STATUS_BADGE[a.status]}`}>{L.activityStatus[a.status]}</span> v{a.version} · {L.domain[a.def.domain]} {a.def.homeSuitable && `· ${L.setting.home}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {edit ? (
          <section className="card">
            <div className="card__header">
              <h2 className="card__title">{edit.seriesId ? edit.def.name || xt('Activity') : xt('New activity')}</h2>
              <span className="muted small">{xt('Written by a professional. Safety notes and instructions are the author’s responsibility.')}</span>
            </div>
            <div className="card__body stack">
              <div className="grid grid--2">
                <Field label={xt('Name')}>
                  <input className="input" value={edit.def.name} onChange={(e) => setD('name', e.target.value)} />
                </Field>
                <Field label={xt('Status')}>
                  <select className="select" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as ActivityStatus })}>
                    {ACTIVITY_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {L.activityStatus[s]}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label={xt('Description')}>
                <textarea className="textarea" rows={2} value={edit.def.description} onChange={(e) => setD('description', e.target.value)} />
              </Field>
              <fieldset className="chips">
                <legend className="field__label">{xt('Target functional goals')}</legend>
                {GOAL_CATEGORIES.map((c) => (
                  <label key={c} className={`chip rh-chip${edit.def.goalCategories.includes(c) ? ' is-on' : ''}`}>
                    <input type="checkbox" checked={edit.def.goalCategories.includes(c)} onChange={(e) => setD('goalCategories', e.target.checked ? [...edit.def.goalCategories, c] : edit.def.goalCategories.filter((x) => x !== c))} />
                    {L.goalCategory[c]}
                  </label>
                ))}
              </fieldset>
              <div className="grid grid--3">
                <Field label={xt('Movement domain')}>
                  <select className="select" value={edit.def.domain} onChange={(e) => setD('domain', e.target.value as ActivityDef['domain'])}>
                    {MOVEMENT_DOMAINS.map((d) => (
                      <option key={d} value={d}>
                        {L.domain[d]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={xt('Measurement method')}>
                  <select className="select" value={edit.def.measurement.kind} onChange={(e) => setD('measurement', { ...edit.def.measurement, kind: e.target.value as ActivityDef['measurement']['kind'], exercise: e.target.value === 'imu_session' ? (edit.def.measurement.exercise ?? 'shoulder_flexion') : null })}>
                    {ACTIVITY_MEASUREMENTS.map((m) => (
                      <option key={m} value={m}>
                        {xt(`measure.${m}`)}
                      </option>
                    ))}
                  </select>
                </Field>
                {edit.def.measurement.kind === 'imu_session' && (
                  <Field label={xt('Sensor movement')}>
                    <select className="select" value={edit.def.measurement.exercise ?? ''} onChange={(e) => setD('measurement', { ...edit.def.measurement, exercise: e.target.value as (typeof EXERCISE_IDS)[number] })}>
                      {EXERCISE_IDS.map((x) => (
                        <option key={x} value={x}>
                          {exerciseLabel(t, x)}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
              </div>
              <Field label={xt('Required setup')}>
                <input className="input" value={edit.def.setup} onChange={(e) => setD('setup', e.target.value)} />
              </Field>
              <Field label={xt('Instructions for professionals')}>
                <textarea className="textarea" rows={3} value={edit.def.professionalInstructions} onChange={(e) => setD('professionalInstructions', e.target.value)} />
              </Field>
              <label className="checkbox">
                <input type="checkbox" checked={edit.def.homeSuitable} onChange={(e) => setD('homeSuitable', e.target.checked)} />
                {xt('Suitable for home practice with a caregiver')}
              </label>
              {edit.def.homeSuitable && (
                <>
                  <Field label={xt('Instructions for the family (plain words)')}>
                    <textarea className="textarea" rows={3} value={edit.def.caregiverInstructions} onChange={(e) => setD('caregiverInstructions', e.target.value)} />
                  </Field>
                  <div>
                    <div className="field__label">{xt('Visual steps for the child')}</div>
                    {edit.def.steps.map((s, i) => (
                      <div key={i} className="row row--wrap rh-step-edit">
                        <StepIconView icon={s.icon} size={28} />
                        <select className="select rh-input--short" aria-label={xt('Picture')} value={s.icon} onChange={(e) => setD('steps', edit.def.steps.map((x, j) => (j === i ? { ...x, icon: e.target.value as typeof s.icon } : x)))}>
                          {STEP_ICONS.map((ic) => (
                            <option key={ic} value={ic}>
                              {xt(`icon.${ic}`)}
                            </option>
                          ))}
                        </select>
                        <input className="input rh-grow" aria-label={xt('Step text')} value={s.text} onChange={(e) => setD('steps', edit.def.steps.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
                        <Button size="sm" variant="ghost" icon={<Trash2 />} aria-label={xt('Remove')} onClick={() => setD('steps', edit.def.steps.filter((_, j) => j !== i))} />
                      </div>
                    ))}
                    {edit.def.steps.length < 8 && (
                      <Button size="sm" icon={<Plus />} onClick={() => setD('steps', [...edit.def.steps, { icon: 'reach', text: '' }])}>
                        {xt('Add step')}
                      </Button>
                    )}
                  </div>
                </>
              )}
              <div className="grid grid--2">
                <Field label={xt('Completion criteria')}>
                  <textarea className="textarea" rows={2} value={edit.def.completionCriteria} onChange={(e) => setD('completionCriteria', e.target.value)} />
                </Field>
                <Field label={xt('Safety notes')}>
                  <textarea className="textarea" rows={2} value={edit.def.safetyNotes} onChange={(e) => setD('safetyNotes', e.target.value)} />
                </Field>
              </div>
              <Field label={xt('Evidence references (one per line)')}>
                <textarea className="textarea" rows={2} value={edit.def.evidenceRefs.join('\n')} onChange={(e) => setD('evidenceRefs', e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))} />
              </Field>
              <Field label={xt('What changed in this version')}>
                <input className="input" value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
              </Field>
              {problems.length > 0 && (
                <ul className="callout callout--warn rh-problems" role="alert">
                  {problems.map((p) => (
                    <li key={p}>{xt(PROBLEMS[p])}</li>
                  ))}
                </ul>
              )}
              {edit.seriesId && <ActivityHistory versions={historyOf(activities, edit.seriesId)} f={f} />}
            </div>
            <div className="card__footer">
              <Button onClick={() => setEdit(null)}>{xt('Close')}</Button>
              <Button variant="primary" icon={<Save />} disabled={problems.length > 0} onClick={() => void submit()}>
                {xt('Save as new version')}
              </Button>
            </div>
          </section>
        ) : (
          <section className="card">
            <EmptyState title={xt('Select an activity or create one')} text={xt('Approved and experimental activities can be assigned in programs. Experimental activities are labelled everywhere they appear.')} />
          </section>
        )}
      </div>
    </div>
  );
}

function ActivityHistory({ versions, f }: { versions: ActivityVersion[]; f: ReturnType<typeof useI18n>['f'] }) {
  const { xt, L } = useXT();
  return (
    <div>
      <div className="field__label">{xt('Versions')}</div>
      <ol className="rh-versions small">
        {versions.map((v) => (
          <li key={v.id}>
            v{v.version} · {L.activityStatus[v.status]} · {f.dateCompact(v.createdAt)} · {v.createdBy} {v.changeNote && `— ${v.changeNote}`}
          </li>
        ))}
      </ol>
    </div>
  );
}
