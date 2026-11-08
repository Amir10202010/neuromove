// Goal Management: meaningful goals defined with the child and family, append-only history,
// status set only by professionals, GAS levels recorded in the history.

import { History, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { EXERCISE_IDS } from '../../core/exercises';
import { useI18n } from '../../i18n';
import { addGoalEvent, editGoal, newGoal, setGoalStatus, type GoalDraft } from '../../rehab/goals';
import { GOAL_CATEGORIES, GOAL_MEASUREMENT_KINDS, GOAL_STATUSES, type FunctionalGoal, type GoalStatus } from '../../rehab/model';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { Field } from '../../ui/Field';
import { Modal } from '../../ui/Modal';
import { exerciseLabel, useActor, useSave, useXT } from './common';
import { GOAL_ICF_SUGGESTIONS, goalIcf } from '../../rehab/icf';
import { IcfBadges, IcfPicker } from './Icf';
import type { ParticipantData } from './data';

const STATUS_BADGE: Record<GoalStatus, string> = { not_started: 'badge--outline', in_progress: 'badge--info', needs_review: 'badge--warn', achieved: 'badge--good', paused: 'badge--outline' };

export function GoalsTab({ data }: { data: ParticipantData }) {
  const { xt, L } = useXT();
  const { f, t } = useI18n();
  const actor = useActor('professional');
  const save = useSave();
  const [editing, setEditing] = useState<{ goal: FunctionalGoal | null; draft: GoalDraft } | null>(null);
  const [statusFor, setStatusFor] = useState<{ goal: FunctionalGoal; status: GoalStatus; note: string; gas: '' | '-2' | '-1' | '0' | '1' | '2' } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const ws = data.patient!.workspace;
  const blank: GoalDraft = { category: 'reaching', description: '', whyItMatters: '', baseline: '', target: '', measurement: { kind: 'gas', detail: '', exercise: null, side: null }, responsible: data.profile?.assignedProfessional || actor.name, reviewDate: null, contributors: ['professional'] };

  const submitGoal = async () => {
    if (!editing) return;
    const rec = editing.goal ? editGoal(editing.goal, editing.draft, actor.name) : newGoal(data.patient!.id, editing.draft, ws, actor.name);
    if (!rec) return setEditing(null);
    if (await save([rec], actor)) setEditing(null);
  };
  const submitStatus = async () => {
    if (!statusFor) return;
    let g: FunctionalGoal = statusFor.goal;
    if (statusFor.status !== g.status) g = setGoalStatus(g, statusFor.status, actor.name, statusFor.note)!;
    else if (statusFor.note.trim() && statusFor.gas === '') g = addGoalEvent(g, { by: actor.name, byRole: 'professional', type: 'progress_note', note: statusFor.note });
    if (statusFor.gas !== '') g = addGoalEvent(g, { by: actor.name, byRole: 'professional', type: 'gas_rating', note: statusFor.note, gas: Number(statusFor.gas) as -2 | -1 | 0 | 1 | 2 });
    if (g === statusFor.goal) return setStatusFor(null);
    if (await save([g], actor)) setStatusFor(null);
  };
  const d = editing?.draft;
  const setD = <K extends keyof GoalDraft>(k: K, v: GoalDraft[K]) => editing && setEditing({ ...editing, draft: { ...editing.draft, [k]: v } });

  return (
    <section className="card">
      <div className="card__header">
        <h2 className="card__title">{xt('Functional goals')}</h2>
        <Button variant="primary" size="sm" icon={<Plus />} onClick={() => setEditing({ goal: null, draft: blank })}>
          {xt('New goal')}
        </Button>
      </div>
      <p className="card__body muted small">{xt('Goals are written with the child and family in everyday words. No numeric success threshold is set by the software; the professional judges progress.')}</p>
      {data.goals.length === 0 ? (
        <EmptyState compact title={xt('No goals yet')} text={xt('Start from what matters to the child and family.')} />
      ) : (
        <ul className="rh-goal-list">
          {data.goals.map((g) => (
            <li key={g.id} className="rh-goal">
              <div className="rh-goal__head">
                <span className={`badge ${STATUS_BADGE[g.status]}`}>{L.goalStatus[g.status]}</span>
                <span className="muted small">{L.goalCategory[g.category]}</span>
                {g.contributors.includes('family') && <span className="badge badge--outline">{xt('family contributed')}</span>}
                <IcfBadges {...goalIcf(g)} />
              </div>
              <h3 className="rh-goal__title">{g.description}</h3>
              {g.whyItMatters && <p className="rh-goal__why">“{g.whyItMatters}”</p>}
              <dl className="kv rh-kv--compact">
                <dt>{xt('Baseline')}</dt>
                <dd>{g.baseline || '—'}</dd>
                <dt>{xt('Target outcome')}</dt>
                <dd>{g.target || '—'}</dd>
                <dt>{xt('Measurement')}</dt>
                <dd>
                  {L.measurement[g.measurement.kind]}
                  {g.measurement.exercise ? ` · ${exerciseLabel(t, g.measurement.exercise)}` : ''} {g.measurement.detail && <span className="muted">— {g.measurement.detail}</span>}
                </dd>
                <dt>{xt('Responsible')}</dt>
                <dd>{g.responsible}</dd>
                <dt>{xt('Review date')}</dt>
                <dd>{g.reviewDate ? f.date(g.reviewDate) : '—'}</dd>
              </dl>
              <div className="row row--wrap">
                <Button size="sm" icon={<Pencil />} onClick={() => setEditing({ goal: g, draft: { category: g.category, description: g.description, whyItMatters: g.whyItMatters, baseline: g.baseline, target: g.target, measurement: g.measurement, responsible: g.responsible, reviewDate: g.reviewDate, contributors: g.contributors, ...(g.icf ? { icf: g.icf } : {}) } })}>
                  {xt('Edit')}
                </Button>
                <Button size="sm" onClick={() => setStatusFor({ goal: g, status: g.status, note: '', gas: '' })}>
                  {xt('Status, note or GAS level')}
                </Button>
                <Button size="sm" variant="ghost" icon={<History />} aria-expanded={open === g.id} onClick={() => setOpen(open === g.id ? null : g.id)}>
                  {xt('History')} ({g.history.length})
                </Button>
              </div>
              {open === g.id && (
                <ol className="rh-history">
                  {[...g.history].reverse().map((e, i) => (
                    <li key={i}>
                      <span className="num muted">{f.dateTime(e.at)}</span> · <strong>{xt(e.type)}</strong>
                      {e.status && ` → ${L.goalStatus[e.status]}`}
                      {e.gas !== undefined && ` · GAS ${e.gas > 0 ? '+' : ''}${e.gas}`}
                      {e.fields && ` (${e.fields.join(', ')})`} · {e.by} {e.byRole === 'caregiver' && <span className="badge badge--outline">{xt('family')}</span>}
                      {e.note && <div className="rh-history__note">{e.note}</div>}
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.goal ? xt('Edit goal') : xt('New goal')} wide footer={<><Button onClick={() => setEditing(null)}>{xt('Cancel')}</Button><Button variant="primary" disabled={!d?.description.trim()} onClick={() => void submitGoal()}>{xt('Save')}</Button></>}>
        {d && (
          <div className="stack">
            <Field label={xt('Category')}>
              <select className="select" value={d.category} onChange={(e) => setD('category', e.target.value as GoalDraft['category'])}>
                {GOAL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {L.goalCategory[c]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={xt('Goal, in everyday words')}>
              <input className="input" value={d.description} onChange={(e) => setD('description', e.target.value)} />
            </Field>
            <Field label={xt('Why it matters to the child and family')}>
              <textarea className="textarea" rows={2} value={d.whyItMatters} onChange={(e) => setD('whyItMatters', e.target.value)} />
            </Field>
            <div className="grid grid--2">
              <Field label={xt('Baseline')}>
                <textarea className="textarea" rows={2} value={d.baseline} onChange={(e) => setD('baseline', e.target.value)} />
              </Field>
              <Field label={xt('Target outcome')}>
                <textarea className="textarea" rows={2} value={d.target} onChange={(e) => setD('target', e.target.value)} />
              </Field>
            </div>
            <div className="grid grid--2">
              <Field label={xt('Measurement method')}>
                <select className="select" value={d.measurement.kind} onChange={(e) => setD('measurement', { ...d.measurement, kind: e.target.value as GoalDraft['measurement']['kind'], exercise: e.target.value === 'imu' ? (d.measurement.exercise ?? 'shoulder_flexion') : null, side: e.target.value === 'imu' ? (d.measurement.side ?? 'right') : null })}>
                  {GOAL_MEASUREMENT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {L.measurement[k]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={xt('Details')}>
                <input className="input" value={d.measurement.detail} onChange={(e) => setD('measurement', { ...d.measurement, detail: e.target.value })} />
              </Field>
            </div>
            {d.measurement.kind === 'imu' && (
              <div className="grid grid--2">
                <Field label={xt('Movement shown next to the goal')} hint={xt('Body-function context only; it does not decide whether the goal is achieved.')}>
                  <select className="select" value={d.measurement.exercise ?? ''} onChange={(e) => setD('measurement', { ...d.measurement, exercise: e.target.value as (typeof EXERCISE_IDS)[number] })}>
                    {EXERCISE_IDS.map((x) => (
                      <option key={x} value={x}>
                        {exerciseLabel(t, x)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={xt('Side')}>
                  <select className="select" value={d.measurement.side ?? 'right'} onChange={(e) => setD('measurement', { ...d.measurement, side: e.target.value as 'left' | 'right' })}>
                    <option value="left">{xt('left')}</option>
                    <option value="right">{xt('right')}</option>
                  </select>
                </Field>
              </div>
            )}
            <div className="grid grid--2">
              <Field label={xt('Responsible professional')}>
                <input className="input" value={d.responsible} onChange={(e) => setD('responsible', e.target.value)} />
              </Field>
              <Field label={xt('Review date')}>
                <input className="input" type="date" value={d.reviewDate?.slice(0, 10) ?? ''} onChange={(e) => setD('reviewDate', e.target.value || null)} />
              </Field>
            </div>
            <fieldset className="chips">
              <legend className="field__label">{xt('Defined together with')}</legend>
              {(['professional', 'family', 'child'] as const).map((c) => (
                <label key={c} className={`chip rh-chip${d.contributors.includes(c) ? ' is-on' : ''}`}>
                  <input type="checkbox" checked={d.contributors.includes(c)} onChange={(e) => setD('contributors', e.target.checked ? [...d.contributors, c] : d.contributors.filter((x) => x !== c))} />
                  {xt(c)}
                </label>
              ))}
            </fieldset>
            <IcfPicker value={d.icf ?? GOAL_ICF_SUGGESTIONS[d.category]} confirmed={!!d.icf?.length} onChange={(codes) => setD('icf', codes)} />
          </div>
        )}
      </Modal>

      <Modal open={!!statusFor} onClose={() => setStatusFor(null)} title={xt('Goal status and progress')} footer={<><Button onClick={() => setStatusFor(null)}>{xt('Cancel')}</Button><Button variant="primary" onClick={() => void submitStatus()}>{xt('Add to history')}</Button></>}>
        {statusFor && (
          <div className="stack">
            <Field label={xt('Status')}>
              <select className="select" value={statusFor.status} onChange={(e) => setStatusFor({ ...statusFor, status: e.target.value as GoalStatus })}>
                {GOAL_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {L.goalStatus[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={xt('GAS level (optional)')} hint={xt('−2 much less than expected … 0 expected outcome … +2 much more than expected, as defined for this goal.')}>
              <select className="select" value={statusFor.gas} onChange={(e) => setStatusFor({ ...statusFor, gas: e.target.value as typeof statusFor.gas })}>
                <option value="">—</option>
                {['-2', '-1', '0', '1', '2'].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={xt('Note')}>
              <textarea className="textarea" rows={3} value={statusFor.note} onChange={(e) => setStatusFor({ ...statusFor, note: e.target.value })} />
            </Field>
            <p className="muted small">{xt('History entries are never edited or removed.')}</p>
          </div>
        )}
      </Modal>
    </section>
  );
}
